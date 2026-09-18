# de4js とJavaScript難読化解除ツール総覧 ―― 難読化タイプ別に武器を選ぶ

> **この節で分かること**
> - de4js が何をするツールで、どの難読化形式に対応しているかを説明できる
> - 難読化のタイプ（Eval系・配列系・obfuscator.io・エソテリックエンコード・バンドル・意味復元）を見分け、それぞれに適したツールを選べる
> - webcrack・wakaru・Restringer・Synchrony・humanify など主要ツールの得意分野を区別できる
> - AST（抽象構文木）を基盤に自作の難読化解除トランスフォームを組む道具立て（astexplorer / Babel / recast）を挙げられる
> - 本番に漏れたソースマップ（`.js.map`）から元コードを復元する手順を説明できる
> - 制御フロー平坦化（CFF）とVM型難読化の解除がなぜ難しいか、どう攻めるかの概念を説明できる

**元資料**: https://lelinhtinh.github.io/de4js/ （原典はegress proxyでブロック、GitHub READMEでfull相当を補完）／ https://gist.github.com/0xdevalias/d8b743efb82c0e9406fc69da0d6c6581 （原典partial取得）
**関連する節**: 第4章「リバースエンジニアリング」の各節（DOM XSSのsink追跡、隠れたエンドポイント発見）

---

## 1. なぜ難読化解除が必要なのか

### 攻撃者が読むのではなく、防御者が読むための技術

Webサイトのフロントエンドは、ほぼ必ずJavaScriptで動く。そしてその多くは**ミニファイ（minify）**、さらには**難読化（obfuscation）**されて配布される。ミニファイとは、変数名を短くしたり空白を削ったりしてファイルサイズを小さくする処理のこと。難読化とは、それに加えて**わざと人間に読みにくくして、ロジックを隠す**処理のことである。

バグバウンティでクライアントサイドの脆弱性を探すとき、この難読化されたJSを**読めるように戻す**作業が最初の関門になる。たとえばDOM XSS（ページ内のJavaScriptがユーザー入力を危険な場所に書き込むことで起きるクロスサイトスクリプティング）を探すには、`innerHTML` や `eval` といった危険な受け口（sink）へ、どこからデータが流れ込むかを追う必要がある。難読化されたままでは、この流れが一切追えない。

### 設計意図：難読化は「保護」だが完全ではない

難読化を施す側の意図は、ソースコードの盗用防止やロジックの隠蔽である。しかし、de4js のREADMEはこの点にはっきり釘を刺している。

> `*` _[**Obfuscator.IO**](https://obfuscator.io/) is always up to date. The automatic deobfuscation tools (including this project) will usually not match its latest version. But that doesn't mean it's a safe tool to secure your source code._

訳すと「Obfuscator.IO は常に最新に更新される。本プロジェクトを含む自動難読化解除ツールは通常その最新版に追随できない。ただしそれは難読化がソースコード保護として安全であることを意味しない」。

つまり、難読化はあくまで「読む手間を増やす」だけで、**根本的な保護にはならない**。防御者・診断者の立場から見れば、適切なツールを選べば大半は元の形に近づけられる。本節で扱うのは、その「適切なツールをどう選ぶか」である。

なお、本節で紹介する手法はすべて**許可された検証・バグバウンティ・自分で立てた検証環境**を前提とした、脆弱性診断のための防御的・診断的用途に限る。

---

## 2. de4js とは何か ―― ブラウザで動く難読化解除の入り口

### 概要

**de4js**（作者: lelinhtinh、ライセンス: MIT）は、ブラウザ上で動作するJavaScriptの難読化解除・アンパッカーである。「JavaScript Deobfuscator and Unpacker」と自称し、難読化されたコードを整形（beautify）し、シンタックスハイライトを付け、各種パッカー／難読化を解除する。

パッカー（packer）とは、コードを圧縮・変形して1つの塊にまとめ、実行時に `eval` などで元に戻す仕組みのこと。de4js はこの「元に戻す」処理をブラウザ内で肩代わりしてくれる。

### de4js の主な機能（Features）

READMEに列挙された機能は以下のとおり。

- Works offline.（オフラインでも動作する）
- Source code beautifier / syntax highlighter.（コード整形・シンタックスハイライト）
- Makes obfuscated code readable.（難読化コードを可読化する。後述のUnreadable／リネーム機能。helper が必要）
- Performance unpackers（性能重視のアンパッカー群）

「オフライン動作」は診断上重要である。解析対象のコードを外部サービスに送りたくない場面（顧客のコードや、送信すると相手に気づかれる場面）で、手元で完結できるからだ。

---

## 3. de4js が対応する難読化・パッカーの種類

de4js の中核は「難読化の種類を選んでアンパックする」点にある。READMEに逐語で列挙された対応形式は次のとおり。

| 種別（de4jsのラベル） | 例・原典URL | どういう難読化か |
|-----|-----|-----|
| **Eval** | Packer, WiseLoop | `eval()` で展開するタイプ |
| **Array** | Javascript Obfuscator, Free JS Obfuscator | 配列参照置換タイプ |
| **_Number** | `https://jsfiddle.net/ps5anL99/embedded/result,js,html,css/` | 正式名称不明の数値系エンコード（原文注記 _(not correct name)_）。リンク先は難読化サービスではなく、この形式の動作を示す**jsfiddleのデモ**である |
| **Packer** | `http://dean.edwards.name/packer/` | Dean Edwards の有名なpacker |
| **Javascript Obfuscator** | `https://javascriptobfuscator.com/Javascript-Obfuscator.aspx` | 商用難読化サービスの出力 |
| **Free JS Obfuscator** | `http://www.freejsobfuscator.com/` | 無料難読化サービスの出力 |
| **Obfuscator.IO** | `https://obfuscator.io/` | 原文注記 _(but not all cases)_ = 全ケースには対応しない |
| **My Obfuscate** | `http://myobfuscate.com/` | 難読化サービスの出力 |
| **URL encode** | bookmarklet 等 | URLエンコード形式 |
| **JSFuck** | `https://github.com/aemkei/jsfuck` | `[]()!+` の6文字のみで表現する難読化 |
| **JJencode** | `http://utf-8.jp/public/jjencode.html` | 記号のみでの難読化 |
| **AAencode** | `http://utf-8.jp/public/aaencode.html` | 顔文字風にエンコードする難読化 |
| **WiseLoop** | `http://wiseloop.com/demo/php-javascript-obfuscator` | WiseLoop製難読化 |

### エソテリックエンコードという特殊なグループ

JSFuck・JJencode・AAencode は「**エソテリックエンコード（esoteric encoding）**」と呼ばれる。エソテリックエンコードとは、`[]()!+` などごく限られた文字や記号だけを使って、見た目が異様（読めない・意味不明）になるように書き換えたエンコードのこと。たとえば JSFuck は `[`, `]`, `(`, `)`, `!`, `+` のわずか6文字だけでJavaScriptプログラム全体を表現する。AAencode は顔文字（絵文字のような記号列）に見える形へ変換する。これらは一見まったく読めないが、変換規則が固定なので、de4js の専用アンパッカーで機械的に戻せる。

なお、以降この節（導入の「この節で分かること」や第14節の対応表を含む）で「エソテリックエンコード」と言うときは、この JSFuck / JJencode / AAencode のような「限られた文字で表現する、見た目が異様なエンコード」を指す。

> ### 📌 ここは自分で開いて読んでください
> **資料**: de4js インタラクティブUI本体 — https://lelinhtinh.github.io/de4js/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限／egress proxyでブロック）。以下の記述はGitHub READMEにもとづく要約である。UIボタンの逐語ラベルのみ未取得。
> **読みどころ**:
> 1. 左ペインに難読化コードを貼り、右上のアンパッカー種別ドロップダウン（Eval / Array / _Number / Packer / Javascript Obfuscator / Free JS Obfuscator / Obfuscator.IO / My Obfuscate / URL encode / JSFuck / JJencode / AAencode / WiseLoop）で、どれが自分のサンプルに効くか総当たりで試す挙動を確認する。
> 2. 「Beautify」だけで済むケースと「アンパック」が要るケースの差を、実サンプルで体感する。
> 3. 「Unreadable（変数リネーム）」は既定で無効。UserScript `de4js_helper.user.js` を入れると jsnice 連携で有効化される点を実際に試す（オフライン不可）。
> 4. Obfuscator.IO の最新版は de4js では解けない場合があること（READMEの注記）を、実際の obfuscator.io 出力で確認する。
> **代替手段**: なし（機能・対応形式はGitHub READMEでfull相当を再現済み）

---

## 4. Unreadable（変数リネーム）機能と helper

de4js の「Makes obfuscated code readable」は、変数名を意味のある名前に戻す機能で、UI上は **Unreadable** オプションと呼ばれる。しかしこれは既定で**無効**になっている。READMEの逐語説明はこうだ。

> The **Unreadable** option is disabled by default, because it uses data from [JS Nice](http://www.jsnice.org/). This cannot be done with JavaScript. You need to install UserScript [de4js_helper.user.js](https://github.com/lelinhtinh/de4js/blob/master/userscript/de4js_helper.user.js) to enable it.

つまり、変数名の復元には **JS Nice**（jsnice.org、統計的に変数名や型を推定するサービス）のデータを使う必要があり、これはブラウザ内のJavaScriptだけでは実現できない。有効化するには **UserScript**（ブラウザ拡張の一種で、特定ページにスクリプトを注入する仕組み）`de4js_helper.user.js` をインストールする。

インストール先は次のいずれか1つ。

| 提供元 | URL |
|-----|-----|
| Open User JS | `https://openuserjs.org/scripts/baivong/de4js_helper` |
| Greasy Fork | `https://greasyfork.org/vi/scripts/33479-de4js-helper` |
| GitHub | `https://lelinhtinh.github.io/de4js/userscript/de4js_helper.user.js` |

重要な注意として、READMEは次のように明記する。

> `*` _**de4js helper** doesn't work offline._

helper はオフラインでは動作しない。jsnice.org と通信するためである。したがって「Works offline」なのは整形・アンパックまでで、**変数リネームだけはオンライン必須**という切り分けを覚えておく。

---

## 5. de4js をローカル／セルフホストで動かす

解析対象を外部に出したくない、あるいは自分の検証環境に組み込みたい場合、de4js は自前でホストできる。READMEのコマンドを逐語で示す。

### Docker で起動する

```bash
docker-compose up
```

起動後、ブラウザで `http://localhost:4000/de4js/` を開く。コンテナのシェルにアタッチしてビルドし直すには次のようにする。

```bash
docker exec -it de4js_app bash
bundle exec jekyll build
```

### ローカル開発としてインストールする

de4js は Jekyll（Ruby製の静的サイトジェネレータ）で作られている。

```bash
git clone https://github.com/lelinhtinh/de4js.git
cd de4js
```

Ruby 2.1.0 以上が必要。Ubuntu でライブラリ不足が出たら次で補う。

```bash
sudo apt install ruby-dev zlib1g-dev
```

Bundler と依存をインストールする。

```bash
gem install bundler
bundle install
```

Windows 10 で EventMachine のC拡張がロードされない場合の修正。

```bash
gem uninstall eventmachine
gem install eventmachine --platform ruby
```

Workbox CLI（Service Worker生成に使う）をインストールする。

```bash
npm install workbox-cli --global
```

起動・監視・ビルドはそれぞれ次のとおり。

```bash
npm start
npm run watch
npm run build
```

`npm run watch` は livereload 付き（ファイル変更時に自動リロード）である。

### de4js が内部で使うライブラリ

de4js は自前で全部を実装しているわけではなく、既存のオープンソースを組み合わせている。READMEの Open Source Contributors に挙がるものは次のとおり。

| ライブラリ | URL | 役割 |
|-----|-----|-----|
| mathjs | `https://github.com/josdejong/mathjs` | 数式評価 |
| js-beautify | `https://github.com/beautify-web/js-beautify` | 整形・アンパック |
| highlight.js | `https://github.com/isagalaev/highlight.js` | シンタックスハイライト |
| clipboard.js | `https://github.com/zenorocha/clipboard.js` | クリップボード操作 |
| magic-check | `https://github.com/forsigner/magic-check` | チェックボックスUI |
| cat-in-136（AAdecode） | `https://cat-in-136.github.io/2010/12/aadecode-decode-encoded-as-aaencode.html` | AAencode解除 |
| Decoder-JJEncode | `https://github.com/jacobsoo/Decoder-JJEncode` | JJencode解除 |
| NotSoWise | `https://github.com/FAKE1007/NotSoWise` | WiseLoop解除 |

このリストは、各難読化形式が「どのライブラリの実装で解けているか」を知る手がかりになる。たとえばAAencodeを自作で扱いたければ cat-in-136 の実装を参照すればよい。

---

## 6. de4js の Related projects ―― 中国系難読化などの担当ツール

de4js 本体が対応しない形式は、READMEの「Related projects」に挙がる姉妹ツールが担当する。特に**中国系難読化**（Sojson、JSjiami）は de4js 本体の直接対応外で、ここに載るツールが受け持つ。

| ツール | URL | 説明（逐語ベース） |
|-----|-----|-----|
| IlluminateJS | `https://github.com/geeksonsecurity/illuminatejs` | A static JavaScript deobfuscator. |
| JStillery | `https://github.com/mindedsecurity/JStillery` | 部分評価（partial evaluation）による高度な難読化解除 |
| Akamai Deobfuscator | `https://github.com/char/akamai-deobfuscator` | Akamai スクリプトの難読化解除を助ける |
| Nice2Predict | `https://github.com/eth-sri/Nice2Predict` | プログラム特性予測の学習フレームワーク |
| Javascript deobfuscation AMA | `https://github.com/jsoverson/javascript-deobfuscation-AMA` | 難読化解除に関するQ&A |
| Deobfuscator IO | `https://github.com/sd-soleaio/deobfuscator-io` | obfuscator.io 向け（不完全・Archived） |
| JavaScript Deobfuscator | `https://github.com/LostMyCode/javascript-deobfuscator` | obfuscator.io 難読化の解除 |
| Prepack | `https://github.com/facebook/prepack` | JSバンドル最適化（部分評価で定数畳み込みし難読化解除にも使える） |
| JS Deobfuscate | `https://github.com/RuochenLyu/js-deobfuscate` | JSjiami・Sojson 対応 |
| JSDec | `https://github.com/liulihaocai/JSDec` | Sojson v4/Premium/v5 対応のオンラインデコーダ（更新停止） |
| Synchrony | `https://github.com/uwu/synchrony` | javascript-obfuscator クリーナー／難読化解除 |

〔補足〕Sojson / Sojson v5 は de4js 本体の直接対応形式ではなく、**JSDec**（sojson v4/Premium/v5対応）や **JS Deobfuscate**（JSjiami, Sojson対応）が担当する。中国系難読化を解析する際はこれらを併用する。なお Synchrony の正リポジトリと使い方は本節9で改めて確定情報を示す。

---

## 7. 0xdevalias gist ―― ツール総覧の全体像

de4js は「入り口」であって、これ一つで全部が解けるわけではない。0xdevalias が公開する gist（`https://gist.github.com/0xdevalias/d8b743efb82c0e9406fc69da0d6c6581`）は、JavaScript難読化解除・リバースエンジニアリングのツールを横断的にまとめた参考リンク集である。ここからカテゴリ別に主要ツールを見ていく。

### 7-1. 汎用整形・un-minify・可読化

まずは「難読化されていない、単にミニファイされただけ」のコードを読める形に戻す道具。

| ツール | URL | 説明（逐語） |
|-----|-----|-----|
| ESLint | https://eslint.org/docs/ | "The context object contains information that is relevant to the context of the rule"（カスタムルール・code path解析に対応） |
| Prettier | https://prettier.io/ | "An opinionated code formatter. It enforces a consistent style by parsing your code" |
| js-beautify | https://github.com/beautify-web/js-beautify | "Reformat and re-indent bookmarklets, ugly JavaScript, unpack scripts packed by Dean Edward's popular packer" |
| Unminify | https://github.com/shapesecurity/unminify （対話版 https://unminify.io/ ） | "Reverse many of the transformations applied by minifiers and naïve obfuscators" |
| de4js | https://github.com/lelinhtinh/de4js （対話版 https://lelinhtinh.github.io/de4js/ ） | "JavaScript Deobfuscator and Unpacker" |
| JSNice | http://www.jsnice.org/ | "Statistical renaming, type inference and deobfuscation" |
| js-deobfuscator | https://github.com/kuizuo/js-deobfuscator （対話版 https://js-deobfuscator.vercel.app/ ） | "JS obfuscated code restoration; Let confusion no longer be a stumbling block"（難読化コードの復元。「混乱がもうつまずきの石にならないように」） |

### 7-2. バンドル展開・アンパック

現代のWebアプリはwebpack・browserifyなどの**バンドラ**で複数ファイルを1つに束ねている。バンドラとは、多数のJSモジュールを1つのファイルにまとめるツールのこと。これを元の複数ファイルに戻すのがデバンドラである。

| ツール | URL | 説明（逐語） |
|-----|-----|-----|
| webpack-exploder | https://github.com/spaceraccoon/webpack-exploder/ | "Unpack the source code of React and other Webpacked apps!" |
| webpack-unpack | https://github.com/goto-bus-stop/webpack-unpack | "Extract modules from a bundle generated by webpack" |
| amd-unpack | https://github.com/goto-bus-stop/amd-unpack | "Extract modules from a bundled AMD project using define/require functions" |
| debundle | https://github.com/1egoman/debundle | "Takes a Browserify or Webpack bundle and recreates the initial, pre-bundled source" |
| reliable-debundle | https://github.com/scil/reliable-debundle | debundle のフォーク。ES6対応を改善 |
| retidy | https://github.com/Xmader/retidy | "Extract, unminify, and beautify each file from a webpack/parcel bundle" |
| rn-debundle | https://github.com/nickw444/rn-debundle | React Native バンドラ用デバンドラ |
| unsea | https://github.com/j4k0xb/unsea | "Extracts the javascript source code and assets of Node Single Executable Applications" |

### 7-3. 難読化解除エンジン（obfuscator.io / 文字列復元 / デコンパイル）

本格的な難読化（特に obfuscator.io）を解くための中核ツール群。ここが実務での主役になる。

| ツール | URL | 説明（逐語） |
|-----|-----|-----|
| **webcrack** | https://github.com/j4k0xb/webcrack （https://webcrack.netlify.app/ ） | "Deobfuscate obfuscator.io, unminify and unpack bundled javascript" |
| **wakaru** | https://github.com/pionxzh/wakaru （https://wakaru.vercel.app/ ） | "Javascript decompiler, unpacker and unminify toolkit. Brings back the original code from a bundled and transpiled source" |
| **Restringer** | https://github.com/PerimeterX/restringer （https://restringer.tech/ ） | "Deobfuscate Javascript and reconstruct strings. Simplify cumbersome logic while adhering to scope limitations" |
| js-deobfuscator | https://github.com/kuizuo/js-deobfuscator | obfuscator.io系の復元 |
| Synchrony | https://github.com/uwu/synchrony | "Javascript-obfuscator cleaner & deobfuscator" |

webcrack は「obfuscator.io の難読化解除＋un-minify＋バンドル展開を一体化」したツールで、現行の第一選択の一つ。wakaru は webpack抽出・browserify抽出・smart rename（賢い変数リネーム）・各種un-minification変換を備えたツールキット。Restringer は PerimeterX 製で、文字列再構築と、スコープを尊重した論理簡約を行う。

### 7-4. LLM／AIベースの難読化解除

| ツール | URL | 説明（逐語） |
|-----|-----|-----|
| **humanify** | https://github.com/jehna/humanify | "Un-minify Javascript code using ChatGPT. Uses large language models to un-minify Javascript" |
| **JsDeObsBench** | https://jsdeobf.github.io/ | "Leaderboard measuring and benchmarking LLMs for JavaScript Deobfuscation" |

humanify は ChatGPT・llama2 などのLLMで、意味を失った変数名を人間可読な名前に復元するツール。README補足では "This tool uses large language modeles (like ChatGPT & llama2) and other tools to un-minify Javascript code." とある。JsDeObsBench は GPT-4o・Mixtral・Llama・DeepSeek-Coder などを、難読化解除タスクで評価するリーダーボードである。

〔補足〕humanify は AST でトークン境界を保ちながら、識別子ごとにLLMへ「この変数の意味ある名前は？」と問うアプローチ。難読化の「意味復元（リネーム）」に強い一方、構造変換（制御フロー平坦化解除など）は扱わない。そこは webcrack / Restringer などのAST変換ツールと組み合わせる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: LLMでJSをun-minifyする実プロンプト（humanify著者ブログ） — https://thejunkland.com/blog/using-llms-to-reverse-javascript-minification.html
> **なぜ**: egress proxyでブロック（EGRESS_BLOCKED）され自動取得できなかった。以下は二次情報にもとづく要約である。
> **読みどころ**:
> 1. AST でトークン境界を保ったまま、識別子ごとにLLMへ「意味のある名前は何か」を問う具体的プロンプトの文面。
> 2. 名前の衝突回避・スコープ整合をどう担保するか（一括リネームの適用順）。
> 3. ChatGPT と llama2 など複数モデルでの結果差。
> 4. 構造変換（CFF解除）は扱わず「意味復元（リネーム）」に特化する設計思想。
> **代替手段**: humanify の実装リポジトリ `https://github.com/jehna/humanify` の README／`src` を読めば、プロンプトとパイプラインの実体を確認できる。

---

## 8. AST を基盤にした自作トランスフォーム

既製ツールで解けない難読化に当たったら、自分で変換を書く。その基盤が **AST（抽象構文木, Abstract Syntax Tree）**である。ASTとは、ソースコードを「構文の木構造」として表したデータのこと。たとえば `a + b` は「加算ノードの下に `a` と `b` がぶら下がる木」になる。難読化解除とは、この木を安全に書き換えて出力し直す作業だと捉えると見通しがよくなる。

### 基本フロー

```
コード
  │  パース（acorn / Babel / esprima）
  ▼
AST（木構造）
  │  変換（@babel/traverse の visitor で書き換え）
  ▼
書き換え後のAST
  │  出力（recast / astring / escodegen）
  ▼
読めるコード
```

gist が挙げる主なAST基盤ツールは次のとおり。

| ツール | URL | 役割（逐語ベース） |
|-----|-----|-----|
| astexplorer | https://astexplorer.net/ | 各パーサのAST可視化。変換を書く前の必須ツール |
| acorn | https://github.com/acornjs/acorn | 小さく高速なJSパーサ |
| Babel | https://babeljs.io/ | AST変換の主力（@babel/traverse でノードを走査） |
| tree-sitter | https://tree-sitter.github.io/tree-sitter/ | インクリメンタルなパース基盤 |
| esprima | https://github.com/jquery/esprima | 汎用解析用パーサ |
| espree | https://github.com/eslint/espree | Acorn上に作られたEsprima互換パーサ |
| eslint-scope | https://github.com/eslint/eslint-scope | スコープ解析器 |
| astring | https://github.com/davidbonnet/astring | ESTree準拠ASTからのコード生成 |
| recast | https://github.com/benjamn/recast | 元の整形を保ったまま改変ノードだけ出力 |
| estraverse | https://github.com/estools/estraverse | AST走査 |
| escodegen | https://github.com/estools/escodegen | コード生成 |
| esmangle | https://github.com/estools/esmangle | ミニファイア |
| shift-ast | https://shift-ast.org/ | ECMAScript向けAST仕様 |
| swc | https://swc.rs/ | Rust製の高速ツール群 |
| esbuild | https://esbuild.github.io/ | Go製バンドラ／ミニファイア |
| putout | https://github.com/coderaiser/putout | プラグイン式リンタ兼変換ツール |
| oxc | https://github.com/oxc-project/oxc | 高速ツール群（"Parser is 2x faster than SWC"） |
| jscodeshift | https://github.com/facebook/jscodeshift | codemod ツールキット |
| ast-grep | https://github.com/ast-grep/ast-grep | Rust製の構造検索・書き換えCLI |
| semantic | https://github.com/github/semantic | 多言語の解析・比較 |
| jalangi2 | https://github.com/Samsung/jalangi2 | JS動的解析フレームワーク（後述のconcolic実行に対応） |

`recast` の「元の整形を保ったまま改変ノードだけ出力」は特に重要である。難読化解除では「怪しい箇所だけ直して、あとは触らない」ことが多く、全体を再整形すると差分が読みにくくなるからだ。まずは **astexplorer** で対象コードのASTを眺め、書き換えたいノードの型を特定するところから始めるのが定石である。

### エディタ／その他の基盤

gist は、解析ツールそのものではないが、自作ツールやWebベースの解析UIを組むときに土台になる基盤も挙げている。

| ツール | URL | 役割（逐語ベース） |
|-----|-----|-----|
| CodeMirror | https://codemirror.net/ | ブラウザ組み込み用のコードエディタ部品 |
| monaco-editor | https://microsoft.github.io/monaco-editor/ | VS Code と同じエンジンのWebエディタ部品 |
| TypeScript | https://www.typescriptlang.org/ | 型付きJavaScript。コンパイラAPIは解析にも使える |
| rome | https://rome.tools/ | "Unified toolchain for JavaScript, TypeScript, JSON, Markdown, CSS"（JS/TS/JSON/Markdown/CSSを扱う統合ツールチェーン） |

de4js のようなブラウザ内解析UIを自作したくなったら、コード表示部に **CodeMirror** や **monaco-editor** を使うのが定番である。**TypeScript** のコンパイラAPI（型情報つきのAST）や、**rome** のような統合ツールチェーンは、パーサ・整形・リンタを一式まとめて扱いたい場合の選択肢になる。

〔補足〕表の最後にある **jalangi2** は「concolic（コンコリック）実行」に対応する。**concolic実行**とは、具体的な値での実行（concrete）と、値を記号のまま扱うシンボリック実行（symbolic）を組み合わせた動的解析手法のこと。両者の頭をつなげて "concolic" と呼ぶ。プログラムを実際に走らせつつ、通った分岐の条件を記号式として集めるので、VM型や動的に組み立てられる難読化のように「静的にASTを眺めるだけでは追えない」コードの挙動を、実行時の観察から解きほぐすのに役立つ。

---

## 9. Synchrony ―― obfuscator.io専用クリーナーの確定情報

de4js READMEに載る Synchrony は、一次リポジトリを当たると URL・使い方が更新されている。以下は公式リポジトリ `https://github.com/relative/synchrony` から取得した確定情報である。

- 逐語: **"javascript cleaner & deobfuscator (primarily javascript-obfuscator/obfuscator.io)."**
- 主対象: **javascript-obfuscator（obfuscator.io）** の出力。
- 難読化解除パス（README記載範囲）: 文字列配列（string array）の自動デコード、**制御フロー平坦化（control flow flattening）の巻き戻し**、デッドコード除去、変数名のアンマングル。

インストールと実行は次のとおり。パッケージ名が `deobfuscator` である点に注意。

```bash
npm install --global deobfuscator
synchrony deobfuscate ./obfuscated.js
```

結果は `script.cleaned.js` に出力される。インストール不要のWeb版は `https://deobfuscate.relative.im`。

〔補足〕de4js READMEでは URL が `github.com/uwu/synchrony`、原文タイポ "Kavascript" と記録されていた。現行の正リポジトリは `github.com/relative/synchrony`、Web版 `deobfuscate.relative.im` なので、読者はこちらを参照する。

---

## 10. React Native バンドルの逆コンパイル

モバイルアプリ（React Native製）を解析するときは専用ツールがある。`react-native-decompiler` は公式リポジトリ `https://github.com/numandev1/react-native-decompiler` で確認できる。

- 逐語: **"A CLI for React Native that allows you to decompile JS code of Android and IOS."**
- 対象入力: `index.android.bundle`（Android）、`main.jsbundle`（iOS）、および Webpack バンドル。単一バンドルとアンバンドル済みモジュールフォルダの両方に対応。
- **制限**: 暗号化／バイナリバンドル（Facebook・Instagram 等が使うもの）は非対応。Hermes バイトコード（`.hbc`）そのものではなく、プレーンJS/Metro バンドル向け（Hermes バイトコードは別途 `hermes-dec` 系が必要）。
- 主な機能: コンパイル生成物の除去で可読性向上、タガー／エディタ／デコンパイラのプラグイン機構、APK/IPA展開ワークフロー対応。

インストールと基本使用は次のとおり。

```bash
npx react-native-decompiler
npm i -g react-native-decompiler
```

```bash
npx react-native-decompiler -i ./index.android.bundle -o ./output
rnd -i ./index.android.bundle -o ./output
```

主要オプション: `-i` 入力（必須）／`-o` 出力（必須）／`-e` 特定モジュールIDのみ／`--es6` ES6モジュール構文へ変換／`--noEslint` ESLint処理をスキップ／`--prettier` Prettier整形制御。

---

## 11. ソースマップからの復元 ―― 最短の難読化解除

### 仕組み

**ソースマップ（source map）**とは、ミニファイ・変換後のコードと、元のコードの対応関係を記録したファイル（`*.js.map`）のこと。ブラウザの開発者ツールが「変換後のコードでも元の行番号を表示する」ために使う。

本番環境にこの `.js.map` がうっかり残っていると、そこから**元のディレクトリ構造・変数名・コメントまで丸ごと復元できる**。これは難読化解除というより「そもそも難読化前のコードが手に入る」状態で、バグバウンティでは最短ルートになりやすい。

| ツール | URL | 説明（逐語） |
|-----|-----|-----|
| source-map | https://github.com/mozilla/source-map | "Consume and generate source maps" |
| **unwebpack-sourcemap** | https://github.com/Strarsis/unwebpack-sourcemap | "Restore files from webpack bundles using source maps" |
| **sourcemapper** | https://github.com/denandz/sourcemapper | "Extract JavaScript source maps and use them to recover original code" |

### 攻撃者はどこを突くか／どう守るか

診断者は、対象JSの末尾にある `//# sourceMappingURL=...` コメントや、`app.js.map` のような推測パスを試して `.js.map` を探す。見つかれば unwebpack-sourcemap / sourcemapper で元ツリーを復元し、隠しAPIエンドポイントや秘密キーを探す。

防御側は、本番ビルドからソースマップを配布しない（または認証の裏に置く）ことで、この情報漏洩を塞ぐ。

---

## 12. 差分・解析補助ツールとDOM XSS発見

gist は解析を助ける周辺ツールも挙げる。特にセキュリティ寄りのものを押さえる。

| ツール | URL | 説明（逐語） |
|-----|-----|-----|
| CyberChef | https://github.com/gchq/CyberChef | "The Cyber Swiss Army Knife - a web app for encryption, encoding, compression and data analysis"（GCHQ製） |
| BC Detect | https://www.blueclosure.com/product/bc-detect | "Analyzes and automatically discovers DOM Based Cross Site Scripting issues" |
| joern | https://joern.io/ | "The Bug Hunter's Workbench. Uncover attack surface and vulnerabilities using interactive code analysis" |
| difftastic | https://github.com/Wilfred/difftastic | "A structural diff tool that compares files based on their syntax" |
| delta | https://github.com/dandavison/delta | "A syntax-highlighting pager for git, diff, and grep output"（git/diff/grepの出力を色付きで見やすくするページャ） |
| prettydiff | https://github.com/prettydiff/prettydiff | "Beautifier and language aware code comparison tool for many languages"（整形と言語を理解したコード比較） |
| astii | https://github.com/Vunovati/astii | "A JavaScript AST-aware diff and patch toolset" |
| stack-graphs | https://github.com/github/stack-graphs | "A Rust library for building and querying stack graphs"（スコープ解決グラフの構築・照会。名前の定義がどこかを追う「名前解決」に使う） |
| speedscope | https://github.com/jlfwong/speedscope | "Interactive flamegraph visualization" |

CyberChef は JSFuck・URLエンコード・Base64などのエンコード／復号を手早く試すのに向く。BC Detect は DOM based XSS を自動発見するツール、joern は「コードプロパティグラフ」で攻撃面と脆弱性を探すワークベンチである。難読化解除で読めるようにしたコードを、これらで sink 追跡する流れになる。

### 差分ツールの使い分け

難読化解除は「少し書き換えては元と見比べる」作業の連続なので、差分（diff）ツールが解析効率を大きく左右する。**delta** は git や grep の出力にシンタックスハイライトを付けて読みやすくするページャ。**difftastic** と **astii** は行単位ではなく**構文（AST）単位**で差分を取るため、整形やリネームで行がずれても「本当に変わった箇所」だけを浮かび上がらせられる。**prettydiff** は整形しながら言語を理解して比較するツールである。**stack-graphs** は GitHub 製の「スコープ解決グラフ」ライブラリで、ある名前（変数・関数）の定義がどこにあるかを追う名前解決に使い、リネームや呼び出し追跡の基盤になる。

---

## 13. 制御フロー平坦化（CFF）とVM型難読化

もっとも手強いのが**制御フロー平坦化（Control Flow Flattening, CFF）**と**VM型（仮想化）難読化**である。ここは概念の理解にとどめ、具体手順は原典に委ねる。

### CFFの構造

CFFは、元のネストした制御構造（`if` の中の `for` など）を、**状態変数（state）＋ `while` ＋ 各基本ブロックを case に持つ大きな `switch`（ディスパッチャループ）**に平坦化する。元のプログラムは失われておらず、ネスト構文の代わりに「状態機械の辺（edge）」として表現されているだけである。

```
元:  if(x){A}else{B}; C

CFF後（イメージ）:
  state = 0;
  while(true){
    switch(state){
      case 0: if(x) state=1; else state=2; break;
      case 1: A; state=3; break;
      case 2: B; state=3; break;
      case 3: C; return;
    }
  }
```

### 解除の基本戦略と順序

obfuscator.io は主難読化（CFF）を守るために、二次難読化（文字列暗号化・デッドコード等）を重ねる。したがって解除は順序が大切で、**まず二次難読化を削り（文字列復元・定数畳み込み／伝播）、その後 CFF 本体を攻める**。

アンフラット化の手順は、Babel でASTを書き換える形になる。ディスパッチャを読んで初期状態を特定 → 各 case を走査し「どのブロックを実行し、次にどの状態をセットするか」を記録して制御フローグラフ（辺集合）を再構築 → 得た辺から通常の `if/else`・ループとして再出力（re-emit）する。

### VM型（仮想化）難読化

VM型は、ロジックを**バイトコード配列＋ディスパッチャ（インタプリタ）**として再エンコードする形式。解析は「インタプリタ（VMハンドラ）の意味を特定 → バイトコードをそのセマンティクスで再解釈 → 等価なJSへ戻す」流れになる。anti-bot 保護（Akamai / PerimeterX / DataDome 等）で多用され、動的解析（jalangi2 等）やハンドラ単位のセマンティクス復元と併用する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: 制御フロー平坦化解除／VM devirtualization の具体手順（trickster.dev / eybisi.run / pnfsoftware.com / blog.crawlex.net の各記事）
> **なぜ**: trickster.dev・crawlex.net などが egress proxyでブロックされ、検索要旨のみ取得済み。以下は二次情報にもとづく要約である。
> **読みどころ**:
> 1. ディスパッチャ（state変数＋while＋switch）の見分け方と、初期状態・遷移の読み取り方。
> 2. Babel の visitor / path.replaceWith を使った case→通常制御構造への再出力コード。
> 3. 文字列復元・定数畳み込み／伝播を「先に」済ませてから CFF に着手する順序。
> 4. VM型（バイトコード＋インタプリタ）の devirtualization: ハンドラ意味の特定と再解釈。
> 5. anti-bot（Akamai / PerimeterX / DataDome）実サンプルでの適用例。
> **代替手段**: webcrack `https://github.com/j4k0xb/webcrack` と Restringer `https://github.com/PerimeterX/restringer` の各リポジトリ内 transforms は、CFF解除・文字列復元の実装そのものなので、ブログが読めない場合の一次実装リファレンスになる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: 0xdevalias ツール総覧gist — https://gist.github.com/0xdevalias/d8b743efb82c0e9406fc69da0d6c6581
> **なぜ**: gist rawが proxy 403、WebFetchも長大ゆえ一部圧縮された。以下は取得できた範囲の要約である。
> **読みどころ**:
> 1. react-native-decompiler / Hermes バイトコード系、synchrony の個別解説節、制御フロー平坦化解除・VM devirtualization の具体手順を原典で確認する。
> 2. 0xdevalias 本人の「My ChatGPT Research / Conversations」節にあるLLM活用の実プロンプト・試行録を読む（本ノートでは全文取得不可）。
> 3. gist は継続更新されるため、webcrack / wakaru / humanify の最新推奨ワークフローと新規追加ツールを確認する。
> 4. 併載のdeepdive（`chrome-devtools-sources-extension.md`, `fingerprinting-minified-javascript-libraries.md`）へのリンクを辿る。
> **代替手段**: 同種のまとめ gist `https://gist.github.com/mswell/6ae7910e20f002bddeeab63633578e49`（実在確認済み）。

---

## 14. 難読化タイプ → 推奨ツール対応表

〔補足（上記出典に基づく整理）〕実務で「まずどれを使うか」を判断するための早見表。

| 難読化タイプ | 特徴 | 推奨ツール |
|-----|-----|-----|
| eval/Packer 系（Dean Edwards packer, WiseLoop） | `eval` で展開 | de4js「Eval」/「Packer」、js-beautify のアンパック |
| 配列参照置換系（Javascript Obfuscator, Free JS Obfuscator） | 配列に文字列を退避 | de4js「Array」 |
| obfuscator.io（javascript-obfuscator） | 文字列配列＋シャッフル＋CFF | **webcrack（第一選択）**、Restringer、Synchrony、wakaru（de4jsは一部のみ） |
| JSFuck / JJencode / AAencode / _Number / URL encode | エソテリックエンコード | de4js の各専用アンパッカー、CyberChef |
| 中国系（Sojson v4/v5/Premium, JSjiami） | 独自エンコード | JSDec、JS Deobfuscate（js-deobfuscate） |
| webpack/browserify/parcel バンドル | 複数モジュールを束ねる | debundle / retidy / wakaru / webpack-unpack、最短は**ソースマップ復元**（unwebpack-sourcemap, sourcemapper） |
| 意味復元（変数リネーム） | 名前が失われている | JSNice、humanify（LLM）、wakaru の smart rename |
| 自作トランスフォーム基盤 | 既製で解けない場合 | astexplorer でAST観察 → Babel（@babel/traverse）で変換 → recast/astring で出力 |

---

## 手を動かす

1. **de4js を開いて総当たりする。** ブラウザで `https://lelinhtinh.github.io/de4js/` を開く。難読化されたJSを左ペインに貼り、アンパッカー種別ドロップダウン（Eval / Array / Packer / JSFuck …）を順に試して、どれで可読化されるか観察する。まず「Beautify」だけで足りるかを確認し、足りなければアンパックを試す。
2. **エソテリックエンコードを試す。** `https://utf-8.jp/public/aaencode.html` などで作ったAAencode文字列を de4js の AAencode で戻す。CyberChef（`https://gchq.github.io/CyberChef/`）でも URLエンコードやBase64を戻して比較する。
3. **obfuscator.io の出力を webcrack で解く。** `https://obfuscator.io/` で自分のサンプルコードを難読化し、その出力を webcrack のWeb版 `https://webcrack.netlify.app/` に貼って、de4js との解け方の差を見る。
4. **Synchrony をローカルで動かす。** `npm install --global deobfuscator` を実行し、`synchrony deobfuscate ./obfuscated.js` で `script.cleaned.js` を得る。
5. **ソースマップを探す。** 対象JSの末尾に `//# sourceMappingURL=` があるか確認し、`.js.map` が本番に残っていれば sourcemapper（`https://github.com/denandz/sourcemapper`）で元コードを復元する。
6. **AST を眺める。** `https://astexplorer.net/` に難読化コードを貼り、書き換えたいノードの型（`CallExpression` など）を特定する。ここが自作トランスフォームの出発点になる。

## つまずきポイント

- **de4js の変数リネーム（Unreadable）は既定で無効。** helper（`de4js_helper.user.js`）を入れないと有効化されず、しかも jsnice.org と通信するので**オフラインでは動かない**。「オフライン動作」なのは整形・アンパックまで。
- **de4js は obfuscator.io の全ケースに対応しない。** READMEも "_but not all cases_" と明記する。obfuscator.io 出力は webcrack / Restringer / Synchrony を主軸にする。
- **中国系難読化（Sojson, JSjiami）は de4js 本体の対象外。** Related projects の JSDec・JS Deobfuscate を使う。
- **Synchrony はパッケージ名とリポジトリに注意。** インストールは `npm install --global deobfuscator`（パッケージ名 `deobfuscator`）、正リポジトリは `github.com/relative/synchrony`。de4js README の `uwu/synchrony` は古い。
- **react-native-decompiler は Hermes バイトコード（`.hbc`）や暗号化バンドルには非対応。** プレーンJS/Metroバンドル向け。Hermes は別途 `hermes-dec` 系が必要。
- **CFF・VM型は自動ツールで一発では解けないことが多い。** 二次難読化（文字列暗号化・デッドコード）を先に削り、その後CFF本体を攻める順序が重要。

## この節のまとめ

- de4js は、ブラウザ上で動くオフライン対応のJavaScript難読化解除・アンパッカーで、Eval・Array・Packer・JSFuck・JJencode・AAencode など多数の形式に対応する。
- de4js の変数リネーム（Unreadable）は既定で無効で、helper のインストールとjsnice.org通信が必要、オフラインでは動かない。
- de4js は Docker（`docker-compose up`、`http://localhost:4000/de4js/`）や Jekyll でセルフホストできる。
- de4js が対応しない中国系難読化（Sojson, JSjiami）は Related projects の JSDec・JS Deobfuscate が担当する。
- obfuscator.io の難読化には webcrack（第一選択）、Restringer、Synchrony、wakaru を使う。
- humanify は LLM で変数名を人間可読に復元するが、構造変換（CFF解除）は扱わない。
- 難読化解除の基盤は AST で、astexplorer で観察 → Babel で変換 → recast/astring で出力するのが定石。
- Synchrony は `npm install --global deobfuscator`／`synchrony deobfuscate`、正リポジトリは `github.com/relative/synchrony`。
- React Native バンドルは react-native-decompiler で逆コンパイルするが、Hermes バイトコードや暗号化バンドルは非対応。
- 本番に残った `.js.map`（ソースマップ）を unwebpack-sourcemap / sourcemapper で復元するのが、最短の「難読化解除」になりやすい。
- 制御フロー平坦化（CFF）は状態変数＋while＋switch のディスパッチャループで、二次難読化を先に削ってから本体を攻める。
- VM型難読化はバイトコード＋インタプリタ形式で、ハンドラの意味を特定して再解釈する。anti-bot保護で多用される。
- 難読化解除で読めるようにしたコードは、BC Detect・joern などで sink 追跡し、DOM XSS などの脆弱性発見につなげる。

## 理解度チェック

1. de4js の「Unreadable（変数リネーム）」が既定で無効なのはなぜか。
   ▶ 答え: 変数名の復元に JS Nice（jsnice.org）のデータを使う必要があり、これはブラウザ内のJavaScriptだけでは実現できないため。有効化には UserScript `de4js_helper.user.js` のインストールが必要で、オフラインでは動かない。

2. obfuscator.io で難読化されたコードを解くとき、de4js を第一選択にしない方がよいのはなぜか。
   ▶ 答え: de4js は obfuscator.io の全ケースには対応しない（READMEも "not all cases" と明記）。webcrack・Restringer・Synchrony・wakaru を主軸にする。

3. 中国系難読化（Sojson v5, JSjiami）は de4js 本体で解けるか。解けない場合は何を使うか。
   ▶ 答え: de4js 本体の直接対応外。Related projects の JSDec（sojson v4/Premium/v5対応）や JS Deobfuscate（JSjiami, Sojson対応）を使う。

4. 本番環境で「最短の難読化解除」になり得るのは何を見つけたときか。
   ▶ 答え: ソースマップ（`.js.map`）。unwebpack-sourcemap / sourcemapper で元のディレクトリ構造・変数名・コメントまで復元でき、隠しAPIエンドポイントや秘密キーの発見につながる。

5. 制御フロー平坦化（CFF）とはどういう構造か。解除はどういう順序で進めるか。
   ▶ 答え: 元のネスト制御構造を、状態変数＋`while`＋各ブロックをcaseに持つ大きな`switch`（ディスパッチャループ）に平坦化したもの。まず二次難読化（文字列復元・定数畳み込み／伝播）を削り、その後CFF本体をアンフラット化する。

6. humanify は難読化解除のうち何が得意で、何を扱わないか。
   ▶ 答え: LLM で変数名を人間可読に復元する「意味復元（リネーム）」が得意。構造変換（CFF解除など）は扱わず、そこは webcrack / Restringer 等のAST変換ツールと組み合わせる。

7. 自作トランスフォームを書くとき、最初に使うべきツールは何か。
   ▶ 答え: astexplorer（`https://astexplorer.net/`）。対象コードのASTを可視化し、書き換えたいノードの型を特定してから Babel で変換を書く。

8. Synchrony をインストールするコマンドと、正しいリポジトリはどれか。
   ▶ 答え: `npm install --global deobfuscator`（パッケージ名は `deobfuscator`）。正リポジトリは `github.com/relative/synchrony`、Web版は `deobfuscate.relative.im`。de4js README の `uwu/synchrony` は古い。

## 出典

- https://lelinhtinh.github.io/de4js/ （およびそのGitHub README: https://github.com/lelinhtinh/de4js ）
- https://gist.github.com/0xdevalias/d8b743efb82c0e9406fc69da0d6c6581
- https://github.com/relative/synchrony
- https://github.com/numandev1/react-native-decompiler
- https://github.com/j4k0xb/webcrack
- https://github.com/pionxzh/wakaru
- https://github.com/PerimeterX/restringer
- https://github.com/jehna/humanify
- https://thejunkland.com/blog/using-llms-to-reverse-javascript-minification.html
- https://astexplorer.net/
- https://github.com/Strarsis/unwebpack-sourcemap
- https://github.com/denandz/sourcemapper
- https://gist.github.com/mswell/6ae7910e20f002bddeeab63633578e49

<!-- sources: https://lelinhtinh.github.io/de4js/, https://github.com/lelinhtinh/de4js, https://gist.github.com/0xdevalias/d8b743efb82c0e9406fc69da0d6c6581, https://github.com/relative/synchrony, https://github.com/numandev1/react-native-decompiler, https://github.com/j4k0xb/webcrack, https://github.com/pionxzh/wakaru, https://github.com/PerimeterX/restringer, https://github.com/jehna/humanify, https://thejunkland.com/blog/using-llms-to-reverse-javascript-minification.html, https://astexplorer.net/, https://github.com/Strarsis/unwebpack-sourcemap, https://github.com/denandz/sourcemapper -->
<!-- terms: 難読化, ミニファイ, 難読化解除, de4js, パッカー, JSFuck, JJencode, AAencode, エソテリックエンコード, UserScript, JS Nice, Jekyll, webcrack, wakaru, Restringer, Synchrony, humanify, JsDeObsBench, AST, Babel, recast, astexplorer, ソースマップ, unwebpack-sourcemap, sourcemapper, 制御フロー平坦化, VM型難読化, devirtualization, ディスパッチャ, DOM XSS, sink, react-native-decompiler, Hermes バイトコード, Sojson, JSjiami, CyberChef, joern, BC Detect -->
<!-- self-read: https://lelinhtinh.github.io/de4js/ | サイト側の制限（egress proxyでブロック）。UIボタンの逐語ラベルのみ未取得 -->
<!-- self-read: https://thejunkland.com/blog/using-llms-to-reverse-javascript-minification.html | egress proxyでブロック（EGRESS_BLOCKED） -->
<!-- self-read: https://gist.github.com/0xdevalias/d8b743efb82c0e9406fc69da0d6c6581 | gist rawが proxy 403、WebFetchも長大ゆえ一部圧縮 -->
<!-- self-read: https://www.trickster.dev/post/javascript-ast-manipulation-with-babel-reducing-nestedness-unflattening-the-cfg/ | trickster.dev・crawlex.net が egress proxyでブロック、検索要旨のみ取得 -->
