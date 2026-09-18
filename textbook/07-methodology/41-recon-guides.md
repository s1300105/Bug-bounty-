# JavaScript Recon の実務パイプライン ― JSファイルを大量に集めて脆弱性の入口を掘り出す

> **この節で分かること**
> - なぜバグバウンティで「JavaScriptファイルを大量に集めること」が脆弱性発見の起点になるのかを説明できる
> - `gau` によるJS収集から、生存確認・整形・エンドポイント/シークレット抽出・危険シンク通知までの一連のパイプラインを自分で組み立てられる
> - `LinkFinder` / `SecretFinder` / `collector.py` / `jsAlert.py` など各ツールの役割と、原文の逐語コマンドを説明できる
> - 誤記された外部importドメイン（タイポスクワッティング）を突く高インパクト経路の探し方を説明できる
> - 総合recon（サブドメイン列挙・ポート・コンテンツ発見・GitHub dork・JS解析・通知）の6分野と、それぞれで使う実在ツールを整理できる

**元資料**: https://gist.github.com/pikpikcu/b034a7e3b8bf966a6eba95acb1fbfe08 （原典取得済 / ファイル名 `JavascriptRecon.md`、作者 pikpikcu、2021-12-21）／ https://chs.us/guides/recon/ （原典は取得できず二次情報ベース）
**関連する節**: DOM based XSS の節、postMessage 脆弱性の節（本節の「危険シンク通知」が両者への橋渡しになる）

---

## 1. なぜ JavaScript を集めることが recon の中心なのか

### 1.1 「ファイルが多い＝脆弱性が多い」という基本思想

recon（recon＝reconnaissance の略で、攻撃対象の資産・エンドポイント・技術を事前に洗い出す「偵察」作業のこと）にはさまざまな切り口があるが、本節の中核であるpikpikcuのガイドは、その照準を **クライアントサイドのJavaScriptファイル** に定める。

作者はこの作業の狙いを一言でこう表現している。原文をそのまま示す。

```text
The first step is to collect possibly several javascript files (more files = more paths,parameters -> more vulns)
```

つまり **「ファイルが多い ＝ パス・パラメータが多い ＝ 脆弱性が多い」** という等式である。なぜこうなるのか。現代のWebアプリはロジックの多くをブラウザ側のJavaScriptに載せており、そのJS本文の中には、サーバのAPIエンドポイント、URLパス、リクエストパラメータ名、ときにはAPIキーやトークンまでが文字列として書き込まれている。だからJSを集めて中身を読むことは、アプリの「隠れた地図」を手に入れることに等しい。

### 1.2 設計意図 ― マップしなかった面はテストできない

recon全般に共通する考え方として、二次情報の総合reconドキュメントは次のように述べる（出典は §5 の `dylanzonix/ambit`）。要旨は「監査の前に、対象の到達可能な全コンポーネント・ID・エンドポイント・パラメータ・技術・データシンクを列挙せよ。**マップしなかった面はテストできず、未マップの面こそロジック/認可バグが潜む場所** である」。

JavaScript reconはこの「面を広げる」作業のうち、クライアント側に特化したものだと位置づけられる。リンクをたどるだけでは見えないAPIパスや、UIには現れない管理者向け機能への参照が、JSの中には残っていることが多い。

### 1.3 スコープ外ホストのJSも「情報源」としては集める

もう一つ、作者が明示している重要な方針がある。多くの企業は自社のJSを **第三者ホスト** に置いている（原文の例: `paypal.com` は `paypalobjects.com` にファイルをホストしている）。作者はこう書く。

```text
don't worry if where the files are hosted is out-of-scope, our intent is to enumerate js files to get more parameters,paths,tokens,apikey,..
```

つまり **ホスティング先がスコープ外でも、JSの列挙そのものは行う**。目的はあくまで「パラメータ・パス・トークン・APIキーという情報を得ること」だからである。

ただしここは初学者が最も誤解しやすい点なので釘を刺しておく。**「JSファイルを情報源として読むこと」と「そのホストにリクエストを投げて攻撃・検証すること」は別物** である。実際のリクエスト送信・脆弱性検証は、必ず自分のスコープ（許可された対象資産）の中に閉じて行う。本節の手法はすべて、許可された診断・バグバウンティのスコープ内、または自分で立てた検証環境を前提に読むこと。

---

## 2. 使用ツール一覧 ― 何が外部ツールで何が作者独自か

pikpikcuのガイドは、多くの工程を既存ツールと自作ツールの組み合わせで回す。原文「Tools:」に挙がったツールを、入手先URLと種別つきで一覧にする。

| ツール | 入手先URL（原文のまま） | 種別 |
|---|---|---|
| gau | https://github.com/lc/gau | 外部 |
| linkfinder | https://github.com/GerbenJavado/LinkFinder | 外部 |
| getSrc | https://github.com/m4ll0k/Bug-Bounty-Toolz/blob/master/getsrc.py | 外部 |
| SecretFinder | https://github.com/m4ll0k/SecretFinder | 外部 |
| antiburl | https://github.com/tomnomnom/hacks/tree/master/anti-burl | 外部 |
| antiburl.py | https://github.com/m4ll0k/Bug-Bounty-Toolz/blob/master/antiburl.py | 外部（高機能版） |
| ffuf | https://github.com/ffuf/ffuf | 外部 |
| allJsToJson.py | （private tool＝作者非公開） | 自作 |
| getJswords.py | https://github.com/m4ll0k/Bug-Bounty-Toolz/blob/master/getjswords.py | 外部 |
| gitHubLinks.py | （private tool） | 自作 |
| availableForPurchase.py | https://raw.githubusercontent.com/m4ll0k/Bug-Bounty-Toolz/master/availableForPurchase.py | 外部 |
| BurpSuite | http://portswigger.net/ | 外部（商用） |
| jsbeautify.py | https://github.com/m4ll0k/Bug-Bounty-Toolz/blob/master/jsbeautify.py | 外部 |
| collector.py | https://github.com/m4ll0k/Bug-Bounty-Toolz/blob/master/collector.py | 外部 |
| getScriptTagContent.py | （private tool） | 自作 |
| jsAlert.py | （private tool） | 自作 |

### 2.1 「private tool」＝作者非公開の自作ツール

上の表で `allJsToJson.py` / `gitHubLinks.py` / `getScriptTagContent.py` / `jsAlert.py` の4つは「private tool」と記されており、**作者が非公開にしている独自ツール** である。GitHubの公開URLは原文に存在しない。したがって読者はこれらをそのまま入手できるわけではないが、**やっていることは単純なので自作できる**（各節でその中身を説明する）。

なお `m4ll0k`（ハンドル mr.r0x8）製のツール群（Bug-Bounty-Toolz, SecretFinder）が多用されているのがこのガイドの特徴である。

---

## 3. パイプラインの各段階 ― 逐語コマンドで追う

ここからは、実際に打つコマンドを **原文のまま** 示しながら、収集→生存確認→整形→抽出→高インパクト経路→危険シンク通知→ファジング→スケールの順に説明する。

### 3.1 収集 ― gau で過去URLからJSを大量に集める

`gau`（Get All URLs）とは、Wayback Machine や AlienVault OTX など過去のURLアーカイブから、対象ドメインに紐づくURLを一括収集するツールのこと。ここからJSファイルだけを絞り込む。

```bash
gau paypalobjects.com | grep -iE '\.js' | grep -ivE '\.json' | sort -u >> paypalJS.txt
gau paypal.com        | grep -iE '\.js' | grep -ivE '\.json' | sort -u >> paypalJS.txt
```

コマンドを分解すると、`gau <domain>` の出力を、`grep -iE '\.js'` で「.js を含む行」に絞り、`grep -ivE '\.json'`（`-v` は反転マッチ）で「.json を除外」し、`sort -u` で重複を落として `paypalJS.txt` に **追記**（`>>`）している。第三者ホスト（paypalobjects.com）と本体（paypal.com）の両方を対象にしている点が、§1.3の方針の実装である。

### 3.2 収集の補助 ― getSrc / getScriptTagContent / gitHubLinks

`gau` は過去URL由来なので、いま生きているページの `<script src>` を取りこぼすことがある。それを補うのが `getSrc.py` である。良い点は **相対パスを絶対URLに正規化する** こと。

```bash
python3 getSrc.py https://www.paypal.com/
```

```text
https://www.paypalobjects.com/digitalassets/c/website/js/react-16_6_3-bundle.js
https://www.paypalobjects.com/tagmgmt/bs-chunk.js
```

インラインの `<script>...</script>` の中身（外部ファイルになっていないJS）を拾うのが作者自作の `getScriptTagContent.py` である。

```bash
cat "https://www.google.com/" | python3 getScriptTagContent.py
```
```text
function()/**/...
```

さらに、GitHub上に落ちている対象ドメイン関連のリンクからJSを掘るのが自作の `gitHubLinks.py`。GitHub dork（後述 §5(d)）の考え方をJSリンクに特化させたものである。

```bash
python3 gitHubLinks.py www.paypalobjects.com | grep -iE '\.js'
```

### 3.3 生存確認 ― antiburl で「200 OK」だけ通す

集めたURLには、すでに消えたJSや404が混ざる。`antiburl` は stdin からURLを受け取り、**HTTP 200 OK を返すものだけを stdout に出す** ツールである。生きたJSだけに後続処理を絞れる。

```bash
cat paypalJS.txt | antiburl > paypalJSAlive.txt
cat paypalJS.txt | python3 antiburl.py -A -X 404 -H 'header:value' 'header2:value2' -N -C "mycookies=10" -T 50
```

1行目は tomnomnom版（Go製）の `antiburl`。2行目は m4ll0k版（Python製の高機能版）`antiburl.py` で、原文に現れるオプションは次のとおり。

| オプション | 原文での意味 |
|---|---|
| `-A` | （原文に語義の明記なし。逐語保持） |
| `-X 404` | 除外するステータスコード |
| `-H 'header:value' ...` | カスタムヘッダ（複数指定可） |
| `-N` | （原文に語義の明記なし。逐語保持） |
| `-C "mycookies=10"` | Cookie |
| `-T 50` | スレッド/タイムアウト系（原文に明記なし） |

`-A` `-N` `-T` の正確な意味は原文に説明がないため、ここでは逐語のみ示す（推測で埋めない）。ツールの `--help` で自分で確認すること。

### 3.4 整形 ― jsbeautify で1行JSを人間が読める形に

本番のJSは圧縮・難読化されて1行に潰れていることが多い。`jsbeautify`（JavaScript Beautify）は、それを可読な形に整形する。手動解析用のファイルとして保存する。

```bash
python3 jsbeautify https://www.paypalobject.com/test.js paypal/manualAnalyzis.js
```

第1引数が対象JSのURL、第2引数が整形結果の保存先（`paypal/manualAnalyzis.js`＝手動解析用ファイル）である。

### 3.5 抽出① ― LinkFinder でパス/エンドポイントを取り出す

`LinkFinder` は、JSファイル中に埋め込まれたパスやリンク（＝APIエンドポイントの候補）を正規表現で抜き出すツールである。`collector.py` と組み合わせると強力になる。

```bash
cat paypalJS.txt | xargs -n2 -I@ bash -c "echo -e '\n[URL]: @\n'; python3 linkfinder.py -i @ -o cli" >> paypalJSPathsWithUrl.txt
cat paypalJSPathsWithUrl.txt | grep -iv '[URL]:' || sort -u > paypalJSPathsNoUrl.txt
cat paypalJSPathsNoUrl.txt | python3 collector.py output
```

1行目は、`paypalJS.txt` の各JS URLを `xargs` で1つずつ処理する。`echo -e '\n[URL]: @\n'` でどのURL由来かの見出しを出し、`python3 linkfinder.py -i @ -o cli`（`-i` が入力、`-o cli` がCLIへの出力）でパスを抽出、結果を追記している。2行目で `[URL]:` 見出し行を除き、3行目で `collector.py` に流して `output/` ディレクトリへ分割する。

> **原文の注意点**: 2行目は原文では `grep -iv '[URL]:' || sort -u` と、パイプ `|` ではなく **OR演算子 `||`** になっている。挙動としてはパイプが妥当だが、ここでは原文どおり載せる。自分で使うときは `|` に直すのが意図に合う。

### 3.6 抽出② ― collector.py で5分類に振り分ける

`collector.py` は LinkFinder の標準出力を受け取り、種類ごとにファイルへ振り分ける。

```bash
python3 linkfinder.py -i https://www.test.com/a.js -o cli | python3 collector.py output
ls output
```
```text
files.txt	js.txt		params.txt	paths.txt	urls.txt
```

生成される5ファイルの意味は次のとおり。**この段階でパラメータとパスが一覧化される** ので、後続のパラメータ発見・エンドポイント発見にそのまま使える。

| ファイル | 中身 |
|---|---|
| `files.txt` | 参照されているファイル |
| `js.txt` | 追加で見つかったJSファイル（収集の再帰入力になる） |
| `params.txt` | パラメータ名の一覧 |
| `paths.txt` | パス/エンドポイントの一覧 |
| `urls.txt` | 外部URLを含むURL一覧 |

### 3.7 抽出③ ― SecretFinder で機微情報を探す

`SecretFinder` は、APIキー・アクセストークン・認可情報・JWT（JSON Web Token）などの機微データをJSから発見するツールである。

```bash
cat paypalJS.txt | xargs -n2 -I @ bash -c 'echo -e "\n[URL] @\n";python3 linkfinder.py -i @ -o cli' >> paypalJsSecrets.txt
```

> **原文のtypoに注意**: この例は SecretFinder の説明の下にあるのに、コマンド中では `linkfinder.py` を呼んでいる。原文どおり逐語で載せているが、意図としては `SecretFinder.py -i @ -o cli` に置き換えるべき箇所である（原文改変はしないが、自分で使うときは直す）。

### 3.8 抽出④ ― getJSWords でワードリストを作る

`getJSWords.py` は、JavaScriptの予約語（`function` などの言語キーワード）を除いた、JSファイル中の全単語（識別子・文字列）を取り出す。

```bash
python3 getjswords.py https://www.google.com/test.js
```
```text
word
word1
...
```

こうして得た単語は、後続のファジング（§3.11）で使う **カスタムワードリスト** の素材になる。対象アプリ固有の命名規則に沿った当たりやすい辞書ができる。

---

## 4. 高インパクト経路と危険シンク ― ここが脆弱性に直結する

### 4.1 タイポスクワッティング ― availableForPurchase.py

開発者は不注意で外部importのドメインを **誤記** することがある（例: `googleapis` を `gooogleapis` とタイプミス）。もしその誤記ドメインが未登録なら、攻撃者がそれを購入して、企業サイトに任意のJavaScriptを配信できてしまう。これは非常にインパクトの高い経路である（タイポスクワッティング／依存混乱の入口）。

`availableForPurchase.py` は、あるドメインが購入可能かを調べる。LinkFinder と collector と組み合わせると強力になる。

```bash
cat paypalJS.txt | xargs -I @ bash -c 'python3 linkfinder.py -i @ -o cli' | python3 collector.py output
cat output/urls.txt | python3 availableForPurchase.py
```
```text
[NO]  www.googleapis.com 
[YES] www.gooogleapis.com
```

`[NO]` は登録済み（購入不可）、`[YES]` はタイポで未登録（購入可能＝乗っ取りの余地あり）を意味する。`[YES]` が出たドメインが、実際に対象サイトのJSからimportされているなら、そこは重大な報告対象になり得る。

**守る側の視点**: 外部importドメインの綴りをレビューで機械的に検証する、Subresource Integrity（SRI＝読み込む外部リソースのハッシュを固定し、改ざんされたら実行しない仕組み）を付ける、依存の許可リストを持つ、などが対策になる。

### 4.2 危険シンク通知 ― jsAlert.py

`jsAlert.py`（作者自作）は、JSの中に `postMessage` / `onmessage` / `innerHTML` などの **興味深いキーワード** があれば、行番号つきで通知するツールである。

```bash
cat myjslist.txt | python3 jsAlert.py
```
```text
[URL] https://..../test.js

line:16 - innerHTML

[URL] https://.../test1.js

line:3223 - onmessage
```

ここで検出されるキーワードは、クライアントサイド脆弱性に直結する。`innerHTML` はDOM based XSS のシンク（＝外部から来たデータが最終的に流れ込む危険な出力先）、`onmessage` / `postMessage` はクロスオリジンのメッセージング（別オリジン間でデータをやり取りする仕組み）で、ハンドラの検証が甘いと脆弱になる。

つまりこのステップが、reconと **DOM XSS の節・postMessage の節** をつなぐ橋渡しになる。行番号が出るので、`jsbeautify` で整形した該当行を直接読みにいける。自作ツールがなくても、実体は `grep -nE 'innerHTML|postMessage|onmessage|document\.write|eval'` のような正規表現マッチなので容易に代替できる。

### 4.3 script タグ間コンテンツを Burp で抜く

BurpSuite（商用のWebプロキシ/診断ツール）でも script タグ間のコンテンツを抽出できる。作者は通常 `getScriptTagContent.py` を使うが、抽出後は保存して LinkFinder にかける。

```bash
python3 linkfinder.py -i burpscriptscontent.txt -o cli
```

---

## 5. スケールとファジング ― 大量JSをどう回すか

### 5.1 ファジング ― ffuf で /js/ 配下を当てる

`ffuf`（Fuzz Faster U Fool）はファジングツールで、JSファイルのファジング（存在しそうなファイル名を辞書で総当りして発見すること）にも使う。

```bash
ffuf -u https://www.paypalobjects.com/js/ -w jsWordlist.txt -t 200
```

`-u` が対象URL（末尾 `/js/` 配下を狙う）、`-w` がワードリスト、`-t 200` がスレッド数である。原文はワードリストの推奨として **assetnote wordlists（https://wordlists.assetnote.io/）** を挙げている。

### 5.2 スケール ― allJsToJson.py でJS本文ごとJSON化

毎回大量のリクエストを投げ直すのは非効率である。作者はこれを自作の `allJsToJson.py` で解決している。渡したURL群にリクエストし、全JSファイルを **本文（content）ごとJSONに保存** する。

```bash
cat myPaypalUrls.txt | python3 allJsToJson.py output.json
cat output.json
```
```json
{
"url_1": {
   "root": "www.paypal.com",
   "path": "/us/home",
   "url": "https://www.paypa.com/us/home",
   "count_js": "4",
   "results": {
       "script_1": "https://www.paypalobjects.com/web/res/dc9/99e63da7c23f04e84d0e82bce06b5/js/config.js",
       "content": "function()/**/"
   }
}
}
```

各ページを `root`（ホスト）/ `path` / `url` / `count_js`（JS数）/ `results`（`script_N` のURLと `content` 本文）としてJSON化する。ポイントは **JSの本文まで保存する** こと。作者は運用上の注記でこう述べている。

```text
i solve this problem with allJsToJson, that keep me a content of all js files and their content, obviously the tool is made on purpose to process only 5 urls at a time because of the size of the file, every time it process 5 urls save the output .. output1.json, output2.json,...
```

要旨は、ファイルサイズの都合で **意図的に一度に5URLずつ** 処理し、`output1.json`, `output2.json`, ... と分割保存している、ということである。この保存済み `content` は、後述の「JS内容の差分監視」の素材にもなる。

### 5.3 パイプライン全体像

これまでのツールをreconの流れとして並べ直すと次のようになる。〔補足〕段階（フェーズ）という括り自体は本教科書による整理で、ツール名・役割は原文由来である。

```text
[1] 収集        gau <domain> | grep .js | grep -v .json | sort -u  →  *JS.txt
                 + getSrc.py（絶対URL化）/ getScriptTagContent.py（インライン）/ gitHubLinks.py
        │
[2] 生存確認    antiburl / antiburl.py（200 OKのみ）  →  *JSAlive.txt
        │
[3] 整形        jsbeautify（手動解析用に可読化）
        │
[4] 抽出        linkfinder → collector.py（files/js/params/paths/urls）
                 SecretFinder（APIキー/JWT）/ getJSWords.py（単語→辞書）
        │
[5] 高インパクト availableForPurchase.py（誤記importドメインの購入可否）
        │
[6] 危険シンク   jsAlert.py（innerHTML/postMessage/onmessage 行番号付き）→ DOM XSS/postMessage章へ
        │
[7] ファジング   ffuf -u .../js/ -w jsWordlist.txt -t 200（assetnote wordlists）
        │
[8] 保存/スケール allJsToJson.py（JS本文ごとJSON、5URL単位で outputN.json）
```

### 5.4 原文の関連リンク

原文末尾の「Other Resources」には次が挙げられている。

```text
- https://bhattsameer.github.io/2021/01/01/client-side-encryption-bypass-part-1.html
- https://developers.google.com/web/tools/chrome-devtools/javascript
- https://www.youtube.com/watch?v=FTeE3OrTNoA&ab_channel=HackerOne
```

順に、クライアントサイド暗号化バイパス Part1、Chrome DevTools のJavaScriptガイド、HackerOne のYouTube動画である。

---

## 6. 総合Recon の全体像 ― JS解析はどこに位置づくか

JavaScript reconは、より大きな「総合recon」の一分野である。もう一つの担当元資料である Carl Sampson（ハンドル @chs, GitHub `sampsonc`）の総合reconガイド（`chs.us/guides/recon/`）は、**サブドメイン列挙・ポート・コンテンツ発見・GitHub dork・JS解析・通知** の6分野を扱うとされる。ただし本文は本教科書の執筆環境から取得できなかった（理由は下記ブロック参照）。

以下 §6 は chs.us の原文引用ではない。同ガイドが到達不能だったため、(1) 総合reconの標準構成を〔補足（一般知識）〕として、(2) chs.us の recon ガイドを **参考文献として明示的に引用している** 別の公開methodology（`dylanzonix/ambit` の `recon-methodology.md`, commit `c97fcbc`, 2026-08-25, 作者 Dylan McGuinness）の記述を出典明記のうえ、整理したものである。実在するツール名はこの二次情報に基づく。**これらを「chs.us が書いていること」として引用してはならない。**

> ### 📌 ここは自分で開いて読んでください
> **資料**: 総合Reconガイド（Carl Sampson） — https://chs.us/guides/recon/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側/組織のegress（外向き通信）ポリシーで `chs.us` および web.archive.org が403遮断。著者の公開Hugo源泉リポジトリ `sampsonc/chs.us.v4`（HEAD 2024-12-31）にも当該2026年ガイドは未収録で、GitHub上に本文ミラーも無し）。以下の記述は二次情報・検索結果の引用断片にもとづく要約である。
> **読みどころ**: 
> 1. サブドメイン列挙の実コマンド ― パッシブ（subfinder/amass/crt.sh）とアクティブ（puredns+massdns等）をどの順序で、どのリゾルバ/ワードリストで回しているか
> 2. ポート→コンテンツ発見への橋渡し ― naabu/masscan→httpx→ffuf/feroxbuster の具体オプション
> 3. GitHub dork の具体クエリ ― どの qualifier（`org:`/`filename:`/`extension:`）とどの自動化ツール（trufflehog/gitleaks）を推奨しているか
> 4. JS解析の位置づけ ― 本節第1〜5章（pikpikcu）と重なる LinkFinder/SecretFinder/subjs 等を、著者がどの段階に組み込んでいるか
> 5. 通知・継続recon（notifications）の仕組み ― notify + anew + cron/CI による差分監視・新規資産アラート。ここが総合reconの肝
> 6. 著者の他ガイド（ssrf/csrf/idor/authz）との相互リンク ― recon成果を各脆弱性ガイドへどう接続しているか
> **代替手段**: 一般の読者環境ならブラウザで直接 https://chs.us/guides/recon/ に到達できるはず。到達不能なら Wayback Machine（https://web.archive.org/web/2024/https://chs.us/guides/recon/ ）。同等の無料資料は §8 の出典リストに列挙した。

### 6.1 6分野と実在ツールの対応表

〔補足（一般知識）〕chs.us が扱うとされる6分野に、広く使われている実在ツールを対応させる。

| 分野 | 主なツール（実在） |
|---|---|
| (a) サブドメイン列挙 | `amass enum -passive` / `subfinder` / `assetfinder` / `findomain` / crt.sh / `puredns`（massdnsラッパ）/ `dnsx` / `shuffledns` / `gotator`・`dnsgen`・`altdns`（パーミュテーション）/ `httpx`（生存確認）/ `anew`（差分蓄積） |
| (b) ポートスキャン | `naabu` / `masscan`（高速発見）/ `nmap -sV`（サービス特定）→ `httpx` で再確認 / `ffuf -H 'Host: FUZZ.target.com'`・`gobuster vhost`（VHOST列挙） |
| (c) コンテンツ発見 | `ffuf` / `feroxbuster` / `gobuster` / `dirsearch` / `gau`・`waybackurls`・`katana`・`gospider`・`hakrawler`（過去URL・クロール）/ `paramspider`・`arjun`・`x8`（パラメータ発見）/ SecLists・assetnote wordlists |
| (d) GitHub dork | `org:`/`filename:`/`extension:` qualifier / `github-search`・`trufflehog`・`gitleaks`・`gitrob`・`git-hound`。目的は漏洩APIキー・認証情報・内部ホスト名・S3バケット |
| (e) JS解析 | `subjs`・`getJS`・`gau|grep .js`（収集）/ `LinkFinder`・`xnLinkFinder`・`katana -jc`（抽出）/ `SecretFinder`・`trufflehog`・`mantra`（シークレット）/ `js-beautify`（整形）/ `innerHTML`/`document.write`/`eval`/`postMessage` の grep（危険シンク） |
| (g) 技術フィンガープリント | `whatweb -a3` / Wappalyzer（`wappalyzer-next`）/ `httpx -tech-detect` / Cookie名でのスタック判別（`PHPSESSID`/`JSESSIONID`/`ASP.NET_SessionId`/`laravel_session`）/ WAF検知 `wafw00f` / CMSスキャナ `wpscan`・`joomscan`・`droopescan`・`CMSeeK` |
| (f) 通知・自動化 | エンドツーエンド枠組 `reconftw`・`osmedeus`・`reNgine`・`BBOT`（再帰）/ マップ後 `nuclei -t exposures/,misconfiguration/` / `notify`（Slack/Discord/Telegram/webhook）/ `anew`（新規行のみ）＋ `cron`/GitHub Actions で定期実行 → 新規サブドメイン・新規JS・JS内容変化を検知（下記 6.5 で詳説） |

### 6.2 スコープ確定・資産発見 ― 総合reconの「最初の前段」

〔補足・二次情報（出典: `dylanzonix/ambit`）〕サブドメイン列挙より前に、**そもそもどこまでが対象なのか**を確定させ、対象組織の保有資産を洗い出す段がある。これは §1.3 で述べた「スコープ内資産の中で検証する」という原則を、recon の起点として具体化するものである。

- **スコープ確認を最初に**: HackerOne/Bugcrowd のスコープ定義を `bounty-targets-data`（各プログラムのin-scope一覧をまとめた公開データ）や `chaos-data.projectdiscovery.io` から取得し、**in-scope のホスト/IP/ワイルドカードのみ**触る。ここを外すと規約違反になる。
- **ASN発見**（ASN＝Autonomous System Number, 組織が保有するIPアドレス群の識別番号）: `whois -h whois.radb.net`、bgp.he.net、`amass intel -asn <ASN>` で組織保有CIDR（IPアドレス範囲）を把握する。
- **Reverse WHOIS**（逆引きWHOIS＝登録者情報から同一組織の別ドメインを探す手法）: ViewDNS / Whoxy（`whoxyrm`）で、登録者メールや組織名から兄弟apexドメイン（同じ組織が持つ別の最上位ドメイン）を発見する。
- `nmap -sL <CIDR>` でPTR（逆引きDNS）を列挙（プローブは投げない）。CDNとオリジンの範囲分類は `kaeferjaeger.gay` のCDNリスト＋`cdncheck`/`mapcidr`。
- **資産検索エンジン横断**: Shodan/Censys/ZoomEye/FOFA（`fofax`）/Netlas/FullHunt/SecurityTrails を `uncover`（複数エンジンを一括で叩くラッパ）でピボット（ある手掛かりから別の資産へ辿ること）する。コード検索 `publicwww.com`/NerdyData/grep.app では、解析ID・APIキー・固有文字列から他ホストやリポジトリを芋づる式に発見できる。

### 6.3 サブドメイン列挙の主要成果物 ― dangling record とテイクオーバー

〔二次情報（出典: `dylanzonix/ambit`）〕サブドメイン列挙は §6.1(a) のツールをパッシブ→アクティブの順に回すのが基本だが、その**成果物として直接ひとつの脆弱性クラスに繋がる**ものがある。それがDNSレコード検査から見つかる **dangling record（宙ぶらりんのレコード）** である。

各サブドメインのDNSレコード（CNAME/SPF/MX/TXT/DMARC）を `dig any` などで検査すると、たとえば CNAME が「すでに解約されたクラウドサービスのホスト名」を指したまま残っていることがある。これが dangling record で、**サブドメインテイクオーバー**（Subdomain Takeover＝攻撃者がその指し先サービスを自分の名前で取り直し、対象のサブドメイン上に任意コンテンツを載せる攻撃）の糸口になる。列挙して終わりにせず、レコードの指し先が生きているかまで確認するのが要点である。

### 6.4 技術フィンガープリント ― 相手のスタックを特定する

〔二次情報（出典: `dylanzonix/ambit`。WSTG-INFO-02/08/09/10 に対応）〕技術フィンガープリント（technology fingerprinting＝対象がどのサーバ・言語・フレームワーク・CMSで動いているかを推定すること）は、後続のコンテンツ発見や既知脆弱性の当たりを付けるための土台になる。

- **バナー/ヘッダ**: `Server` / `X-Powered-By` / `X-AspNet-Version` / `X-Generator` / `Via` / `X-Runtime` を `curl -sI` で確認。ヘッダの順序・大文字小文字・空白の癖や既定エラーページの見た目でも Apache / nginx / IIS を識別できる。
- **自動判別**: `whatweb -a3`、Wappalyzer（`wappalyzer-next`）、`httpx -tech-detect`、`chameleon`。
- **Cookie名でのスタック判別**: セッションCookieの名前は言語・フレームワークごとに既定値がある。次が代表例。

| Cookie名 | 推定されるスタック |
|---|---|
| `PHPSESSID` | PHP |
| `JSESSIONID` | Java（サーブレット/JSP） |
| `ASP.NET_SessionId` | ASP.NET |
| `laravel_session` | Laravel（PHPフレームワーク） |

- **既定パス**: スタック別の既定パス（`/wp-login.php`, `/administrator`, `/actuator`, `/_next/`）の存在で製品を推定。
- **CMSスキャナ**: `wpscan`（WordPress）/ `joomscan`（Joomla）/ `droopescan`（Drupal）/ `CMSeeK`。
- **WAF検知**（WAF＝Web Application Firewall, 攻撃リクエストを遮断する防御機構）: `wafw00f` / `nmap --script http-waf-detect` でWAFの有無・種類を推定する。

### 6.5 通知・自動化・継続recon ― 総合reconの肝

〔二次情報（出典: `dylanzonix/ambit`）＋一般知識〕総合reconで最も価値を生むのは、一度きりで終わらせず **差分を継続的に検知する** 仕組みである。

**エンドツーエンドのreconフレームワーク**（列挙〜httpx〜JS抽出〜通知を丸ごと束ねる自動化基盤）としては `reconftw` / `osmedeus` / `reNgine` / `BBOT`（再帰的に資産を辿る）がある。個別ツールを自分でパイプするのに慣れたら、これらで全体を回すと抜けが減る。

マップし終えた資産には `nuclei -t exposures/,misconfiguration/`（既知の露出・設定ミスをテンプレートで一括検査するスキャナ）をかけ、低コストで拾える露出を洗う。

差分監視の**具体的な検知対象と用途**は次のとおり。ここが「継続recon」の中身である。

| 検知する差分 | 使うもの | 何に使うか |
|---|---|---|
| 新規サブドメイン | `subfinder`→`anew`＋cron/CI | 新しい攻撃面が生えた瞬間に触りにいく |
| 新規JSファイル | `gau|grep .js`→`anew` | 新機能・新エンドポイントの手掛かり |
| JS内容の変化 | `allJsToJson.py` が保存する `content` を定期取得しdiff | 追加されたエンドポイント・シークルットを捕捉 |

`anew`（新規行のみ追記するツール）で差分だけを抽出し、`notify`（Slack/Discord/Telegram/webhook へ結果を送るツール）でアラートを飛ばす。JS内容の差分については、§5.2 の `allJsToJson.py` が本文（`content`）ごと保存している点を思い出してほしい。この保存済み `content` こそが、前回と今回を突き合わせる **diff の素材** になる。

**OOB（Out-Of-Band）基盤の事前準備**（OOB＝リクエストの応答本文ではなく、外部への通信の有無で脆弱性を判定する手法）: SSRFやブラインド系の検証に備え、`interactsh` / Burp Collaborator / `ceye.io` / `canarytokens` を監査の**前に**用意しておく。

**カバレッジ台帳**: `(identity, host, endpoint, param)` の組でマップ済み/未テストを管理し、recon がどこまで飽和したかを判定する。「未マップの面こそバグが潜む」（§1.2）を運用に落とす仕組みである。

### 6.6 クラウド/ストレージ/VCS露出

〔二次情報（出典: `dylanzonix/ambit`）〕GitHub dork（§6.1(d)）を、クラウドストレージやバージョン管理システム（VCS＝Gitなどソース履歴を管理する仕組み）の露出まで広げる分野である。

- **`.git` 露出**: `/.git/HEAD`・`/.git/config` が見えたら `git-dumper`/`GitTools` で全ソース＋履歴＋シークレットを復元できる。他に `/.svn/entries`、`/.env`、`/config.json`、`/web.config`、`/.DS_Store`。
- **S3/GCS/Azureバケット推測**（バケット＝クラウド上のオブジェクトストレージの入れ物）: `cloud_enum -k <keyword>`、`bucket-stream`、`buckets.grayhatwarfare.com`（公開バケットの検索サービス）、`aws s3 ls s3://bucket --no-sign-request`（認証なしで中身が見えれば権限設定ミス）。JS/HTML中のバケット名を `s3.amazonaws.com` / `.blob.core.windows.net` / `storage.googleapis.com` でgrepする。
- **依存混乱**（dependency confusion＝社内向けの非公開パッケージ名と同名のものを公開レジストリに置き、ビルドに紛れ込ませる攻撃）: `confused` / `nodep` で候補を洗う。
- **クラウドIMDS SSRF**（IMDS＝クラウドVMのメタデータサービス。`169.254.169.254` に置かれ、SSRFで叩くと一時認証情報が漏れうる）: 標的メモとして `169.254.169.254` を控えておく。

### 6.7 防御シグナル ― recon中に記録すべき兆候

〔二次情報（出典: `dylanzonix/ambit`）〕recon は攻撃面を広げるだけでなく、**相手の防御の癖**を観測する場でもある。次の兆候は独立して記録する価値がある。

- **ワイルドカードDNS/ソフト404**（ソフト404＝存在しないページなのにHTTP 200を返す挙動）: ランダムなパスでベースラインを1回取得し、サイズ/ハッシュでフィルタする。ステータスコードだけを判定基準にしない。
- **攻撃的WAF/レート制限（403/429）**: スロットリング（速度を落とす）やUA/IP回転で回避を検討しつつ、**パス正規化のギャップ**を突く。同じ `/admin` でもサーバやWAFの正規化のズレで通ることがある。例: `//admin`, `/./admin`, `/%2e/admin`, `/Admin`, 末尾に `%20`/`%09`/`;` を付ける。
- `Server`/バージョンヘッダを消し、CSPを付け、ソースマップを出していない対象は**成熟している**と読める。その場合は挙動のフィンガープリントやID別のレスポンスdiffに頼る。

### 6.8 判明している事実（源泉調査から／捏造なし）

サイト `chs.us` の著者は Carl Sampson（ハンドル @chs, GitHub `sampsonc`, 連絡先 chs@chs.us）。Burp拡張（AuthHeaderUpdater, HeaderUpdater, PassiveSearch, Perfmon など）や `PwnedCheck`、`csp_toolkit` を公開しているAppSec研究者である。`chs.us/guides/` 配下には recon 以外に ssrf, csrf, authentication, business-logic-flaws, idor, fuzzing, mobile, supply-chain, authz などの体系的ガイドが2026年時点で存在する（他リポジトリからの参照リンクで確認）。著者本人の2026年プロジェクト `sampsonc/vulnlab.dev` の記述から、これらは「著者による hands-on（実践的）ガイド群で、少なくともSSRFガイドは著者の演習ラボの土台」であることが裏付けられている。

### 6.3 二次情報が補う「pikpikcuガイドに無い」高価値手法

`dylanzonix/ambit` の recon-methodology から、本節第1〜5章では触れられていない、特に価値の高い手法をいくつか挙げる（出典明記のうえの補足）。

- **ソースマップ復元**: 各JS URLに `.map` を付与（`app.js` → `app.js.map`）し、存在すれば `unwebpack-sourcemap` で元ソース（コメント・ルートテーブル含む）を復元する。pikpikcuガイドに無い高価値手法。
- **オリジンIP発見（WAFバイパス）**: base64 faviconのMMH3ハッシュを計算し、Shodan/ZoomEye/FOFA で `http.favicon.hash:<hash>` 検索 → CDN背後の実オリジンを同一アイコンから特定する。
- **API固有recon**: `/swagger.json` `/openapi.json` `/v2/api-docs` の探索、GraphQLのイントロスペクション `{__schema{types{name}}}`（無効なら `clairvoyance` でスキーマ再構成）。
- **VCS露出**: `/.git/HEAD` `/.git/config` が見えれば `git-dumper`/`GitTools` で全ソース＋履歴＋シークレットを復元。他に `/.env` `/.DS_Store`。
- **カバレッジ台帳**: `(identity, host, endpoint, param)` のマップ済/未テストを管理し、recon飽和を判定する。「未マップの面こそバグが潜む」を運用に落とす仕組み。

---

## 手を動かす

以下は自分で立てた検証環境、または許可されたスコープ内でのみ実行すること。

1. まず対象ドメインからJSを集める。`gau example.com | grep -iE '\.js' | grep -ivE '\.json' | sort -u >> targetJS.txt` を実行し、行数を `wc -l targetJS.txt` で確認する。
2. 生きているJSだけに絞る。`cat targetJS.txt | antiburl > targetJSAlive.txt`（antiburl が無ければ `httpx -mc 200 -l targetJS.txt` で代替できる）。
3. 難読化されたJSを1つ選び、`jsbeautify <URL> out.js` で整形して人間が読める形にする。
4. パスとパラメータを抜く。`python3 linkfinder.py -i <URL> -o cli | python3 collector.py output` を実行し、`ls output` で `params.txt` `paths.txt` が生成されたことを確認、中身を `cat output/paths.txt` で見る。
5. 機微情報を探す。`python3 SecretFinder.py -i <URL> -o cli` を実行し、APIキー・トークン・JWTらしき文字列が出ないか確認する（原文のtypoに引きずられず、SecretFinderの節では SecretFinder を呼ぶこと）。
6. 危険シンクを行番号つきで洗う。自作ツールの代わりに `curl -s <URL> | grep -nE 'innerHTML|document\.write|eval|postMessage|onmessage'` を実行し、ヒット行を整形済みJSで読みにいく。
7. 外部importドメインの綴りを確認する。`cat output/urls.txt` からホスト名を抜き、`availableForPurchase.py` で購入可能なタイポドメインが無いか調べる。
8. §6 の総合reconに広げるなら、まず `subfinder -d example.com | httpx -sc -title -tech-detect` でサブドメインと技術を可視化し、そこから各ホストのJS収集（1へ戻る）を回す。

## つまずきポイント

- **「JSを情報源として読む」と「そのホストへ攻撃する」の混同**。スコープ外ホストのJSは読んでよいが、リクエスト送信・脆弱性検証はスコープ内資産に限る。ここを混同すると規約違反になる。
- **原文の逐語コマンドにはtypoがある**。SecretFinderの節なのに `linkfinder.py` を呼んでいる例、LinkFinderの節で `grep ... || sort -u` と `||`（OR）になっている例。原文は改変せず載せるが、自分で使うときは意図（`SecretFinder.py`／パイプ `|`）に直す。
- **private tool は入手できない**。`allJsToJson.py` `gitHubLinks.py` `getScriptTagContent.py` `jsAlert.py` は作者非公開。ただし中身は単純（JSON保存・grep・タグ抽出・キーワードマッチ）なので、`grep -nE` や短いスクリプトで自作できる。
- **`-A` `-N` `-T` などオプションの意味を推測で埋めない**。原文に語義が無いオプションは `--help` で自分で確認する。
- **chs.us の内容を「chs.us が書いている」と引用しない**。§6 は原文未取得のため、標準知識と二次情報（ambit）による補完である。原典は必ず自分で開いて確認する（📌ブロック参照）。
- **JSを1回集めて終わりにしない**。アプリは更新される。`anew` ＋ cron/CI で差分監視し、新規JS・JS内容の変化を継続的に捕捉するのが総合reconの肝。

## この節のまとめ

- JavaScript reconの基本思想は「ファイルが多い＝パス・パラメータが多い＝脆弱性が多い」。JSはアプリの隠れた地図である。
- 「マップしなかった面はテストできない」。JS reconはクライアント側の攻撃面を広げる作業。
- スコープ外ホストのJSも情報源としては集めるが、リクエスト・検証はスコープ内に限る。
- 収集は `gau | grep .js | grep -v .json | sort -u`。第三者ホスト（例: paypalobjects.com）も対象にする。
- 収集の補助に `getSrc.py`（絶対URL化）、`getScriptTagContent.py`（インライン）、`gitHubLinks.py`（GitHub上のJS）。
- 生存確認は `antiburl`（200 OKのみ）、整形は `jsbeautify`。
- 抽出は `LinkFinder`（パス）→ `collector.py`（files/js/params/paths/urls の5分類）、`SecretFinder`（APIキー/JWT）、`getJSWords.py`（単語→辞書）。
- 高インパクト経路は `availableForPurchase.py`。誤記された外部importドメインが購入可能なら、任意JS配信の乗っ取り余地がある。
- 危険シンク通知 `jsAlert.py` は `innerHTML`/`postMessage`/`onmessage` を行番号付きで検出し、DOM XSS・postMessage章へ橋渡しする。
- ファジングは `ffuf -u .../js/ -w jsWordlist.txt -t 200`（assetnote wordlists 推奨）。
- 大量JSは `allJsToJson.py` で本文ごとJSON化。サイズ都合で5URLずつ `outputN.json` に分割保存し、差分監視の素材にする。
- 総合recon（chs.us）は6分野: サブドメイン列挙・ポート・コンテンツ発見・GitHub dork・JS解析・通知。JS解析はその一分野。
- 二次情報が補う高価値手法: ソースマップ復元（`.map`）、favicon ハッシュでのオリジンIP発見、`/swagger.json`・GraphQL introspection、`.git` 露出のダンプ。
- 原文の逐語コマンドにはtypoがあり、private toolは入手不可。中身は単純なので自作・代替できる。

## 理解度チェック

1. pikpikcuガイドの中核的な等式を書け。
   ▶ 答え: 「more files = more paths,parameters -> more vulns」（ファイルが多い＝パス・パラメータが多い＝脆弱性が多い）。
2. スコープ外ホストのJSを集めてよいのはなぜか。集めた後にやってはいけないことは何か。
   ▶ 答え: パラメータ・パス・トークン・APIキーという情報を得るため集める。ただしそのスコープ外ホストへリクエストを投げて攻撃・検証することはしない（検証はスコープ内資産に限る）。
3. `gau paypal.com | grep -iE '\.js' | grep -ivE '\.json' | sort -u` の各段は何をしているか。
   ▶ 答え: gauで過去URLを収集、`.js`を含む行に絞り、`.json`を除外し、重複を排除している。
4. `collector.py` が生成する5つのファイル名を挙げよ。
   ▶ 答え: files.txt / js.txt / params.txt / paths.txt / urls.txt。
5. `availableForPurchase.py` の出力 `[YES] www.gooogleapis.com` は何を意味し、なぜ危険か。
   ▶ 答え: そのタイポドメインが未登録＝購入可能。もし対象サイトのJSがそのドメインから何かをimportしていれば、攻撃者がドメインを取得して任意JSを配信でき、サイト乗っ取りにつながる。
6. `jsAlert.py` が通知する `innerHTML` と `postMessage`/`onmessage` は、それぞれどの脆弱性クラスに直結するか。
   ▶ 答え: `innerHTML` はDOM based XSS のシンク、`postMessage`/`onmessage` はクロスオリジンメッセージングの脆弱なハンドラ（postMessage脆弱性）。
7. `allJsToJson.py` が一度に5URLずつしか処理しない理由は何か。
   ▶ 答え: 保存するファイル（JS本文content込みのJSON）のサイズが大きくなるため、意図的に5URL単位で `output1.json`, `output2.json`... と分割保存している。
8. chs.us の総合reconガイドが扱う6分野を挙げよ。
   ▶ 答え: サブドメイン列挙・ポート・コンテンツ発見・GitHub dork・JS解析・通知（notifications）。
9. pikpikcuガイドに無く、二次情報（ambit）が補う高価値なJS手法を1つ挙げよ。
   ▶ 答え: ソースマップ復元（`app.js`→`app.js.map` を付けて `unwebpack-sourcemap` で元ソース復元）。ほかにfaviconハッシュでのオリジンIP発見、`.git`露出のダンプなど。
10. 原文のSecretFinderの例コマンドの問題点は何か。
   ▶ 答え: SecretFinderの節なのにコマンド中で `linkfinder.py` を呼んでいる（typo）。実運用では `SecretFinder.py -i @ -o cli` にすべき。

## 出典

- pikpikcu「My Javascript Recon Process - BugBounty」: https://gist.github.com/pikpikcu/b034a7e3b8bf966a6eba95acb1fbfe08
- Carl Sampson 総合Reconガイド（本文取得不可・要自読）: https://chs.us/guides/recon/
- 二次情報 methodology（chs.us を参照文献に挙げる）: https://github.com/dylanzonix/ambit → `methodology/info/recon-methodology.md`
- gau: https://github.com/lc/gau
- LinkFinder: https://github.com/GerbenJavado/LinkFinder
- SecretFinder / Bug-Bounty-Toolz: https://github.com/m4ll0k/SecretFinder ・ https://github.com/m4ll0k/Bug-Bounty-Toolz
- anti-burl: https://github.com/tomnomnom/hacks/tree/master/anti-burl
- ffuf: https://github.com/ffuf/ffuf
- ワードリスト: https://wordlists.assetnote.io/
- OWASP WSTG「Information Gathering」: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/
- OWASP WSTG「API Reconnaissance」: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/12-API_Testing/01-API_Reconnaissance
- The Hacker Recipes「Domains enumeration」: https://www.thehacker.recipes/web/recon/domains-enumeration
- ProjectDiscovery「Recon series 2」: https://projectdiscovery.io/blog/recon-series-2
- Vaadata「Subdomain enumeration techniques and tools」: https://www.vaadata.com/en/blog/subdomain-enumeration-techniques-and-tools/
- YesWeHack「Discover & map hidden endpoints and parameters」: https://www.yeswehack.com/learn-bug-bounty/discover-map-hidden-endpoints-parameters
- HackTricks「Pentesting Web」: https://book.hacktricks.wiki/en/network-services-pentesting/pentesting-web/index.html
- PortSwigger「Information disclosure」: https://portswigger.net/web-security/information-disclosure
- Web-Attack-Cheat-Sheet（riramar）: https://github.com/riramar/Web-Attack-Cheat-Sheet
- notify: https://github.com/projectdiscovery/notify ／ anew: https://github.com/tomnomnom/anew
- クライアントサイド暗号化バイパス Part1: https://bhattsameer.github.io/2021/01/01/client-side-encryption-bypass-part-1.html
- Chrome DevTools JavaScriptガイド: https://developers.google.com/web/tools/chrome-devtools/javascript
- HackerOne動画: https://www.youtube.com/watch?v=FTeE3OrTNoA

<!-- self-read: https://chs.us/guides/recon/ | サイト/組織のegressポリシーで403遮断・アーカイブも遮断・公開源泉に未収録のため本文取得不可、二次情報で補完 -->

<!-- sources: https://gist.github.com/pikpikcu/b034a7e3b8bf966a6eba95acb1fbfe08, https://chs.us/guides/recon/, https://github.com/dylanzonix/ambit, https://github.com/lc/gau, https://github.com/GerbenJavado/LinkFinder, https://github.com/m4ll0k/SecretFinder, https://github.com/m4ll0k/Bug-Bounty-Toolz, https://github.com/tomnomnom/hacks/tree/master/anti-burl, https://github.com/ffuf/ffuf, https://wordlists.assetnote.io/ -->
<!-- terms: JavaScript recon, gau, LinkFinder, SecretFinder, collector.py, antiburl, jsbeautify, availableForPurchase.py, jsAlert.py, allJsToJson.py, ffuf, DOM based XSS, postMessage, タイポスクワッティング, サブドメイン列挙, GitHub dork, ソースマップ, httpx, subfinder, notify, anew -->
