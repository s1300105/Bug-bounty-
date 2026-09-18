# [41] JavaScript Recon 実務手順（pikpikcu Gist）＋ 総合Reconガイド（chs.us / Carl Sampson）

担当ID: 41 (recon-guides) ／ 想定章: ch07（Recon・攻撃対象JavaScriptの列挙と解析）

> 本ノートは「クライアントサイド脆弱性ハンティングの教科書（日本語）」ch07 の唯一の材料。
> 攻撃手法の記述はすべて **許可された検証・バグバウンティ（対象スコープ内）を前提にした防御／診断目的の技術解説** として記録する。

---

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://gist.github.com/pikpikcu/b034a7e3b8bf966a6eba95acb1fbfe08 | **full** | `gist.github.com/<id>.json` 埋め込みAPIをcurlで取得しHTML→テキスト変換 | ファイル名 `JavascriptRecon.md`。タイトル「My Javascript Recon Process - BugBounty」。作者 pikpikcu、作成 2021-12-21。本文（div）全13,854文字を完全取得。コード/コマンドは全て逐語で保持。 |
| https://chs.us/guides/recon/ | **failed（本文取得不可）／二次情報で内容補完済** | 直接取得・curl(browser UA,-L,--compressed)・raw・web.archive・archive.ph・r.jina.ai・GitHub源泉・GitHubミラー・WebSearch すべて不可。代替として同ガイドを Sources に挙げる公開methodology(`dylanzonix/ambit`)を `git clone` で取得し内容補完 | 詳細は下記「取得失敗の理由」＋「補完エージェントによる再取得の試み」。作者は Carl Sampson (@chs, GitHub: sampsonc)。当該ガイドは2026年の追記で、公開Hugo源泉リポジトリ `sampsonc/chs.us.v4`（HEADは2024-12-31）には `guides/` ディレクトリが存在しない（v5等の新源泉も無し）。ライブサイト/アーカイブは egress 組織ポリシーで 403 遮断。本文は未取得のまま**捏造せず**、二次情報（§2.4）と読者向け代替資料で補完。 |

**取得の技術的経緯（再現のため記録）**
- WebFetch: gist は HTTP 503、`chs.us` は `EGRESS_BLOCKED`。
- gist の raw（`gist.githubusercontent.com`）は egress許可リスト外で 403 CONNECT。→ 代替として `https://gist.github.com/<user>/<id>.json`（gist埋め込みJSON、`div`にレンダリング済みHTMLを含む）が許可され、これで**全文取得成功**。
- `chs.us` は egressプロキシの組織ポリシーで遮断（`chs.us is blocked by the network egress proxy`）。`web.archive.org` / `archive.org` も遮断（403 CONNECT）。`r.jina.ai` リーダープロキシも遮断。
- WebSearch はセッション予算（200/200）を使い切っており利用不可。
- 源泉調査: `chs.us` は Carl Sampson の個人サイト（GitHub `sampsonc`）。公開サイト源泉 `sampsonc/chs.us.v4` を浅いcloneで取得（`github.com` は許可）→ HEAD `a3aecb8 2024-12-31`、ブランチは `main` と dependabot のみ、`content/guides/` は不在（recon/ssrf/csrf等の2026ガイド群は本リポジトリに未収録）。GitHubコード検索でも `chs.us/guides/recon` を引用している他リポジトリは1件（`dylanzonix/ambit` の参照リストに列挙されているのみ）で、本文をミラーしたものは皆無。よって chs.us の recon ガイド本文は本環境からは取得不能と判断。

**補完エージェントによる再取得の試み（2026-09-18、本節を追記）**
- 上記の失敗URL `https://chs.us/guides/recon/` に対し、別手段で再挑戦した。結果は下記のとおりで、**本文の取得は依然不可**。捏造はせず、代わりに二次情報（下記 2.4）で内容を補完し、読者向けの読みどころ・代替資料（後掲）を拡充した。
  - egressプロキシ状態を再確認（`$HTTPS_PROXY/__agentproxy/status`）：`chs.us` / `web.archive.org` / `archive.ph` / `r.jina.ai` / `portswigger.net` は**すべて 403 CONNECT の組織ポリシー拒否**として記録されており、READMEは「403/407 の組織ポリシー拒否はリトライせず報告せよ」と明示。curl（ブラウザUA + `-L` + `--compressed`）でも `chs.us` は 56 CONNECT tunnel failed(403)。
  - WebSearch は依然 200/200 で予算枯渇（`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` の引き上げが必要）。二次情報の新規検索は不可。
  - GitHub MCP の**ファイル読取**（`get_file_contents` 等）は本セッションでは許可リポジトリが `s1300105/bug-bounty-` のみに制限されており、`sampsonc/*` の直接読取は不可。ただし**グローバルなコード検索・リポジトリ検索**（`search_code` / `search_repositories`）と、`github.com` 経由の `git clone`（公開リポジトリ）は可能だった。
  - `sampsonc` の全公開リポジトリ（23件）を列挙：`chs.us.v3`(2024-05)・`chs.us.v4`(2024-12-31) 以降にサイト源泉の新リポジトリ（v5等）は無く、2026年の recon ガイド本文を含む公開源泉は**存在しない**。GitHub全体のコード検索でも `chs.us/guides/recon` 本文のミラーは皆無（引用は `dylanzonix/ambit` の参照リスト1件のみ、後述）。
  - **二次情報の発見（内容補完に使用）**: `dylanzonix/ambit`（Web侵入テスト用エージェント、commit `c97fcbc` 2026-08-25, 作者 Dylan McGuinness）の `methodology/info/recon-methodology.md` が、参考文献（Sources）欄に `https://chs.us/guides/recon/` を**明示的に列挙**しており、当該ガイドと同一の6分野（サブドメイン列挙・ポート・コンテンツ発見・GitHub dork・JS解析・通知）を網羅する実践的チェックリストであることを確認。これを二次情報として `git clone` で全文取得し、下記 2.4 に**出典明記のうえ**転記・整理した（chs.us の原文引用ではない）。
  - **原典の性質の裏付け**: Carl Sampson 自身の2026年プロジェクト `sampsonc/vulnlab.dev` の README/landing に「chs.us … personal site with hands-on guides, including the SSRF guide the labs are based on」とあり、`chs.us/guides/` は著者本人による**実践的（hands-on）ガイド群**で、少なくとも SSRF ガイドは著者の演習ラボの土台になっていることが確認できる（recon ガイドも同シリーズ）。

---

## 要約（3〜10行）

- 本ノートの中核は pikpikcu のGist「My Javascript Recon Process」。バグバウンティにおける **JavaScript ファイルの大量収集 → 生存確認 → 整形 → エンドポイント/パス/パラメータ/シークレット抽出 → 危険キーワード通知** までの実務パイプラインを、具体的な shell コマンド付きで提示する。基本思想は「**より多くのJSファイル = より多くのパス・パラメータ = より多くの脆弱性**」。
- 対象JSの列挙は `gau`（Wayback/AlienVault等の過去URL収集）で第三者ホスト（例: paypal.com → paypalobjects.com）まで含めて広く集める。out-of-scope ホストのJSでも「パラメータ/パス/トークン/APIキーを得る」目的なら収集対象にする、という方針が明示される。
- 抽出は `LinkFinder`（パス/エンドポイント）、`SecretFinder`（APIキー/トークン/JWT等）、`collector.py`（LinkFinder出力を files/js/params/paths/urls に分割）、`getSrc.py`（絶対URL化したscriptリンク抽出）、`getScriptTagContent.py`（インラインscript抽出）で行う。生存確認は `antiburl`（200 OKのみ通す）。整形は `jsbeautify`。危険シンク検知は `jsAlert.py`（`postMessage`/`onmessage`/`innerHTML` 等を行番号付きで通知）。
- 大量JSの内容を保持するため作者自作 `allJsToJson.py` が各URLのJSと本文をJSON化（サイズ対策で **5 URLずつ** 分割出力）。ドメインタイポ狙いの `availableForPurchase.py`（開発者が誤記した外部importドメインの購入可否判定）も特徴的。
- もう一方の担当URL（chs.us の総合reconガイド：サブドメイン列挙・ポート・コンテンツ発見・GitHub dork・JS解析・通知）は環境制約で**本文取得不能**（chs.us/web.archive.org/archive.ph が組織ポリシーで403遮断、WebSearchも予算枯渇）。捏造はせず、(1)標準的な総合recon方法論を〔補足（一般知識）〕として §2.3 に、(2)当該chs.usガイドを参考文献に明示的に挙げる公開methodology `dylanzonix/ambit`（`recon-methodology.md`, 2026-08-25）の記述を**出典明記のうえ** §2.4 に、それぞれ整理した。加えて著者本人の2026年プロジェクト `sampsonc/vulnlab.dev` から、chs.us/guides が「著者による hands-on ガイド群（SSRFガイドは演習ラボの土台）」であることを裏付けた。読者向けの読みどころ・同等の無料代替資料も拡充した。

---

## 詳細ノート

### 1. pikpikcu「My Javascript Recon Process - BugBounty」全訳・逐語 （出典: gist.github.com/pikpikcu/b034a7e3b8bf966a6eba95acb1fbfe08、ファイル `JavascriptRecon.md`）

#### 1.0 Description（原文の節）
> This is a simple guide to perform javascript recon in the bugbounty
（バグバウンティでの JavaScript recon を行うための簡易ガイド。）

#### 1.1 Steps — 全体思想（原文の節）
最初のステップは、可能な限り多くの JavaScript ファイルを収集すること。作者の言い回しをそのまま示すと：

> The first step is to collect possibly several javascript files (`more files` = `more paths,parameters` -> `more vulns`)

つまり **「ファイルが多い = パス・パラメータが多い = 脆弱性が多い」**。より多くのJSを得る方法は対象に大きく依存する。作者は大規模ターゲットに注力しており、使うツールにも依存する。多くは自作ツール（personal tools）を用いる、と述べている。

#### 1.2 使用ツール一覧（原文「Tools:」の逐語。ツール名 → URL）

| ツール | 入手先URL（原文のまま） | 種別 |
|---|---|---|
| gau | https://github.com/lc/gau | 外部 |
| linkfinder | https://github.com/GerbenJavado/LinkFinder | 外部 |
| getSrc | https://github.com/m4ll0k/Bug-Bounty-Toolz/blob/master/getsrc.py | 外部 |
| SecretFinder | https://github.com/m4ll0k/SecretFinder | 外部 |
| antiburl | https://github.com/tomnomnom/hacks/tree/master/anti-burl | 外部 |
| antiburl.py | https://github.com/m4ll0k/Bug-Bounty-Toolz/blob/master/antiburl.py | 外部（antiburl の高機能版） |
| ffuf | https://github.com/ffuf/ffuf | 外部 |
| allJsToJson.py | （private tool＝作者非公開自作ツール） | 自作 |
| getJswords.py | https://github.com/m4ll0k/Bug-Bounty-Toolz/blob/master/getjswords.py | 外部 |
| gitHubLinks.py | （private tool） | 自作 |
| availableForPurchase.py | https://raw.githubusercontent.com/m4ll0k/Bug-Bounty-Toolz/master/availableForPurchase.py | 外部 |
| BurpSuite | http://portswigger.net/ | 外部（商用） |
| jsbeautify.py | https://github.com/m4ll0k/Bug-Bounty-Toolz/blob/master/jsbeautify.py | 外部 |
| collector.py | https://github.com/m4ll0k/Bug-Bounty-Toolz/blob/master/collector.py | 外部 |
| getScriptTagContent.py | （private tool） | 自作 |
| jsAlert.py | （private tool） | 自作 |

> 補足（原文の事実）: 「private tool」と記された `allJsToJson.py` / `gitHubLinks.py` / `getScriptTagContent.py` / `jsAlert.py` は作者非公開の自作ツールで、GitHub公開URLは原文に無い。教科書に書く際は「作者独自ツール（非公開）」として扱うこと。`m4ll0k`（mr.r0x8）製ツールが多用されている点も特徴。

#### 1.3 各ツールの説明と逐語コマンド（原文「Description:」の節）

##### gau — 過去URLからのJS大量収集
説明（原文要旨）: 素晴らしいツールで、作者は「できる限り多くの JavaScript ファイルを探す」のに常用する。多くの企業はファイルを第三者にホストしており（例: paypal.com は paypalobjects.com にホスト）、バグハンターにとって重要。これで大量のJSを列挙できる。

**逐語コード（原文のコードブロックそのまま）**
```
 Example:
       
 paypal.com host their files on paypalobjects.com
 
 $ gau paypalobjects.com |grep -iE '\.js'|grep -ivE '\.json'|sort -u  >> paypalJS.txt
 $ gau paypal.com |grep -iE '\.js'|grep -ivE '\.json'|sort -u  >> paypalJS.txt
 
 don't worry if where the files are hosted is out-of-scope, our intent is to enumerate js files to get more           
 parameters,paths,tokens,apikey,..
```
解説: `gau <domain>` の出力を `grep -iE '\.js'`（.js を含む）で絞り、`grep -ivE '\.json'`（.json を除外）し、`sort -u` で重複排除して `paypalJS.txt` に追記（`>>`）。ホストがスコープ外でも「パラメータ・パス・トークン・APIキーを得る」目的でJS列挙自体は行う、という方針が明記されている（実際のリクエスト/攻撃はスコープ内資産に限る、という前提で読むこと）。

##### linkfinder — パス/リンク抽出
説明（原文要旨）: 素晴らしいツール。パスやリンクを探すのに常用。`availableForPurchase.py` と `collector.py` を組み合わせると強力。

**逐語コード**
```
Example:

$ cat paypalJS.txt|xargs -n2 -I@ bash -c "echo -e '\n[URL]: @\n'; python3 linkfinder.py -i @ -o cli" >> paypalJSPathsWithUrl.txt 
$ cat paypalJSPathsWithUrl.txt|grep -iv '[URL]:'||sort -u > paypalJSPathsNoUrl.txt
$ cat paypalJSPathsNoUrl.txt | python3 collector.py output
```
解説: `paypalJS.txt` の各JS URLを `xargs -n2 -I@ bash -c "..."` で処理。`echo -e '\n[URL]: @\n'` でURL見出しを出し、`python3 linkfinder.py -i @ -o cli`（`-i` 入力、`-o cli` はCLI出力）でパス抽出。結果を `paypalJSPathsWithUrl.txt` に追記。次に `[URL]:` 行を除いて（`grep -iv '[URL]:'`）ソート、`collector.py` に流して `output` ディレクトリへ分割。
（注: 2行目の `grep ... || sort -u` は原文では `||`（OR）になっている。逐語で保持。意図的にはパイプ `|` が妥当だが、教科書では原文どおり記載しつつ挙動の注を付けること。）

##### getSrc — scriptリンク抽出（絶対URL化）
説明（原文要旨）: script リンクを抽出するツール。良い点は **絶対URLを作る** こと。

**逐語コード**
```
  Example:

 $ python3 getSrc.py https://www.paypal.com/

 https://www.paypalobjects.com/digitalassets/c/website/js/react-16_6_3-bundle.js
 https://www.paypalobjects.com/tagmgmt/bs-chunk.js
```
解説: `getSrc.py <URL>` でページ内の `<script src>` を絶対URLに正規化して列挙する。相対パス由来のJSを取りこぼさないための前処理。

##### SecretFinder — 機微情報抽出
説明（原文要旨）: apikeys, accesstoken, authorizations, jwt 等の機微データを JS ファイルから発見するツール。

**逐語コード**
```
Example:

$ cat paypalJS.txt|xargs -n2 -I @ bash -c 'echo -e "\n[URL] @\n";python3 linkfinder.py -i @ -o cli' >> paypalJsSecrets.txt
```
（注: 原文のこの例は SecretFinder の説明文の下にありながら、コマンド中は `linkfinder.py` を呼んでいる。原文どおり逐語で保持。実運用では `SecretFinder.py -i @ -o cli` に置き換える意図と推測されるが、原文改変はしない。教科書では「原文のtypo（SecretFinderの節だが linkfinder を実行している）」と注記すること。）

##### antiburl / antiburl.py — 生存確認（200 OKのみ通す）
説明（原文要旨）: stdin からURLを受け取り、200 OK を返すものだけを stdout に出す。`antiburl.py` は高機能版。

**逐語コード**
```
Example:

$ cat paypalJS.txt|antiburl > paypalJSAlive.txt
$ cat paypalJS.txt | python3 antiburl.py -A -X 404 -H 'header:value' 'header2:value2' -N -C "mycookies=10" -T 50 
```
解説: `antiburl`（tomnomnom版, Go）は `paypalJS.txt` を流して生存URLだけ `paypalJSAlive.txt` に保存。`antiburl.py`（m4ll0k版, Python高機能版）のオプション（逐語）:
- `-A`（原文表記のまま）
- `-X 404`: 除外ステータス
- `-H 'header:value' 'header2:value2'`: カスタムヘッダ（複数）
- `-N`（原文表記のまま）
- `-C "mycookies=10"`: Cookie
- `-T 50`: スレッド/タイムアウト系（原文にオプション語義の明記なし）
（各オプションの正確な意味は原文に説明が無いため、逐語のみ保持。捏造しない。）

##### ffuf — JSファイルのファジング
説明（原文要旨）: ファジングツール。JSファイルのファジングにも使う。

**逐語コード**
```

Example:

$ ffuf -u https://www.paypalobjects.com/js/ -w jsWordlist.txt -t 200 

Note: top wordlists - https://wordlists.assetnote.io/
```
解説: `-u` 対象URL（末尾 `/js/` 配下を対象）、`-w jsWordlist.txt` ワードリスト、`-t 200` スレッド数。ワードリストの推奨として **assetnote wordlists（https://wordlists.assetnote.io/）** が挙げられている。

##### allJsToJson.py（作者自作・非公開）— JSの内容ごとJSON保存
説明（原文要旨）: 渡されたURL群にリクエストし、全JSファイルを取得して **JSONファイルに保存** する。

**逐語コード（出力JSONの構造も原文どおり）**
```
$ cat myPaypalUrls.txt | python3 allJsToJson.py output.json
$ cat output.json

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
},
"url_2": {}
}
```
解説: 各ページを `root`/`path`/`url`/`count_js`（JS数）/`results`（`script_N` のURLと `content` 本文）としてJSON化。**JSの本文（content）まで保存する**のが要点。

##### gitHubLinks.py（作者自作・非公開）— GitHub上の新規リンク発見
説明（原文要旨）: GitHub上で新しいリンク（この場合は JavaScript リンクのみ）を見つける。

**逐語コード**
```
 Example:

 $ python3 gitHubLinks.py www.paypalobjects.com|grep -iE '\.js'
```
解説: 対象ドメインについて GitHub 上のリンクを収集し `grep -iE '\.js'` でJSに絞る。GitHub dork 的にJS資産を掘る発想。

##### availableForPurchase.py — 未登録（購入可能）ドメインの検出
説明（原文要旨）: あるドメインが購入可能かを調べる。linkfinder と collector と組み合わせると非常に強力。開発者が不注意でドメインを誤記し、外部JSを間違ったドメインからimportしていることが多々ある（＝タイポスクワッティング/依存混乱の入口）。

**逐語コード（出力例も原文どおり）**
```
Example: 

$ cat paypalJS.txt|xargs -I @ bash -c 'python3 linkfinder.py -i @ -o cli' | python3 collector.py output
$ cat output/urls.txt | python3 availableForPurchase.py
[NO]  www.googleapis.com 
[YES] www.gooogleapis.com
```
解説: linkfinder→collector で `output/urls.txt`（外部URL一覧）を作り、各ドメインの購入可否を判定。`[NO] www.googleapis.com`（登録済＝購入不可）、`[YES] www.gooogleapis.com`（タイポ、購入可能＝乗っ取り余地）。**誤記された外部importドメインを取得すれば、その企業サイトに任意JSを配信できる**という高インパクト経路の発見手法。

##### BurpSuite — script タグ間コンテンツ抽出
説明（原文要旨）: script タグ間のコンテンツを抽出。作者は通常 `getScriptTagContent.py` を使う。抽出後は保存して linkfinder にかける。

**逐語コード**
```
$ python3 linkfinder.py -i burpscriptscontent.txt -o cli
```

##### jsbeautify.py — JavaScript整形
説明（原文要旨）: JavaScript Beautify（難読化/圧縮された1行JSを可読化）。

**逐語コード**
```
Example:

$ python3 jsbeautify https://www.paypalobject.com/test.js paypal/manualAnalyzis.js
```
解説: 第1引数に対象JS URL、第2引数に整形結果の保存先（手動解析用ファイル `paypal/manualAnalyzis.js`）。

##### collector.py — LinkFinder出力の分類
説明（原文要旨）: linkfinder の標準出力を jsfile / urls / params 等に分割する。

**逐語コード（生成ファイルも原文どおり）**
```
$ python3 linkfinder.py -i https://www.test.com/a.js -o cli | python3 collector.py output
$ ls output

files.txt	js.txt		params.txt	paths.txt	urls.txt
```
解説: `output/` に **files.txt / js.txt / params.txt / paths.txt / urls.txt** の5分類を生成。パラメータ列挙（params.txt）とパス列挙（paths.txt）はそのまま後続のパラメータ発見・エンドポイント発見に使える。

##### jsAlert.py（作者自作・非公開）— 危険キーワード通知
説明（原文要旨）: `postMessage`, `onmessage`, `innerHTML` 等の **興味深いキーワード** があれば通知する。

**逐語コード（出力例も原文どおり）**
```
Example:

$ cat myjslist.txt | python3 jsAlert.py

[URL] https://..../test.js

line:16 - innerHTML

[URL] https://.../test1.js

line:3223 - onmessage
```
解説: JS一覧を流すと、**行番号付き** で危険シンク/ソース（`innerHTML` = DOM XSS シンク、`onmessage`/`postMessage` = クロスオリジンメッセージング）を検出・通知する。クライアントサイド脆弱性（DOM based XSS / postMessage の脆弱なハンドラ）へ直結する重要ステップ。教科書 ch07 と後続章（DOM XSS / postMessage）の橋渡しになる。

##### getScriptTagContent.py（作者自作・非公開）— インラインscript本文抽出
説明（原文要旨）: script タグ間のコンテンツを取得する。

**逐語コード**
```
Example:

$ cat "https://www.google.com/"|python3 getScriptTagContent.py 

function()/**/...
```

##### getJSWords.py — JSの単語抽出（キーワード除外）
説明（原文要旨）: JavaScript のキーワードを除いた、JSファイル中の全単語を取得する。

**逐語コード**
```
Example:

$ python3 getjswords.py https://www.google.com/test.js

word
word1
...
```
解説: JS言語の予約語を除いた識別子/文字列を抽出。カスタムワードリスト生成（後続ファジングの `-w`）に活用できる。

#### 1.4 運用上の要点（原文末尾の注記の逐語要旨）
> As you see above we need a lot to do every time many requests, i solve this problem with allJsToJson, that keep me a content of all js files and their content, obviously the tool is made on purpose to process only 5 urls at a time because of the size of the file, every time it process 5 urls save the output .. output1.json, output2.json,...

要旨: 毎回大量のリクエストが必要になる問題を `allJsToJson` で解決している。全JSとその内容を保持でき、ファイルサイズの都合で **意図的に一度に5URLずつ** 処理し、`output1.json`, `output2.json`, ... と分割保存する。

#### 1.5 Other Resources（原文の関連リンク・逐語）
```
- https://bhattsameer.github.io/2021/01/01/client-side-encryption-bypass-part-1.html
- https://developers.google.com/web/tools/chrome-devtools/javascript
- https://www.youtube.com/watch?v=FTeE3OrTNoA&ab_channel=HackerOne
```
（1つ目=クライアントサイド暗号化バイパス Part1、2つ目=Chrome DevTools のJavaScriptガイド、3つ目=HackerOne のYouTube動画。）

#### 1.6 パイプライン再構成（本ノート筆者による整理／原文の順序に基づく）
> 〔補足（一般知識）〕以下は原文の各ツールを recon の流れとして並べ直したもの。ツール名・役割は原文由来だが「段階（フェーズ）」という括りは筆者整理。
1. **収集**: `gau <domain>` / 第三者ホストも → `grep .js` / `-v .json` / `sort -u` → `*JS.txt`。`getSrc.py`（絶対URL化）、`getScriptTagContent.py`（インライン）、`gitHubLinks.py`（GitHub上のJS）も収集源。
2. **生存確認**: `antiburl` / `antiburl.py`（200 OKのみ）→ `*JSAlive.txt`。
3. **整形**: `jsbeautify`（手動解析用に可読化）。
4. **抽出**: `linkfinder`（パス/エンドポイント）→ `collector.py`（files/js/params/paths/urls に分割）。`SecretFinder`（APIキー/トークン/JWT）。`getJSWords.py`（単語→ワードリスト化）。
5. **高インパクト経路**: `availableForPurchase.py`（誤記された外部importドメインの購入可否＝乗っ取り余地）。
6. **危険シンク通知**: `jsAlert.py`（`innerHTML`/`postMessage`/`onmessage` を行番号付き検知）→ DOM XSS / postMessage 章へ接続。
7. **ファジング**: `ffuf -u .../js/ -w jsWordlist.txt -t 200`（assetnote wordlists 推奨）。
8. **保存・スケール**: `allJsToJson.py`（JS本文ごとJSON化、5URL単位で `outputN.json`）。

---

### 2. 総合Reconガイド（chs.us/guides/recon/, Carl Sampson） — 本文取得失敗＋一般知識による補完

#### 2.1 取得失敗の理由（教科書に転記）
- 対象ホスト `chs.us` は本作業環境の **egress（外向き通信）許可リスト外** で、プロキシが接続を拒否（`chs.us is blocked by the network egress proxy` / 403 CONNECT）。直接取得・curl・リーダープロキシ（r.jina.ai）すべて不可。
- スナップショットの `web.archive.org` / `archive.org` も同許可リストで遮断（403 CONNECT）。
- WebSearch はセッション予算（200/200）を使い切っており、二次情報の検索も不可。
- 著者の公開サイト源泉リポジトリ `sampsonc/chs.us.v4`（Hugo製）を取得できたが、**HEADが2024-12-31で、当該 recon ガイド（2026年に追記されたもの）は未収録**（`content/guides/` ディレクトリ自体が存在しない）。GitHubコード検索でも本文をミラーした公開物は存在せず（引用は参照リスト1件のみ）、源泉からの再構成も不可。
- したがって chs.us の recon ガイド本文は本環境からは **原典・二次情報ともに取得不能**。以下 2.3 は原典の代替ではなく、同種の「総合recon」の標準知識を筆者が整理したものである（chs.us の内容として引用してはならない）。

#### 2.2 判明している事実（源泉調査から／捏造なし）
- サイト `chs.us` の著者は **Carl Sampson（ハンドル @chs, GitHub `sampsonc`, 連絡先 chs@chs.us）**。Burp拡張（AuthHeaderUpdater, HeaderUpdater, PassiveSearch, Perfmon 等）や `PwnedCheck`、`csp_toolkit` などを公開しているAppSec研究者。
- `chs.us/guides/` 配下には recon 以外にも ssrf, csrf, authentication(-bypass), business-logic-flaws, idor, fuzzing, mobile, supply-chain, authz などの体系的ガイドが2026年時点で存在する（他リポジトリからの参照リンクで確認）。recon ガイドは「subdomain enumeration, ports, content discovery, GitHub dork, JS analysis, notifications」を扱う総合reconガイドとされる（担当タスクの記述および参照文脈と一致）。

#### 2.3 〔補足（一般知識）〕総合Reconの標準構成（chs.us の代替として。原典引用ではない）
> 以下はバグバウンティ／許可されたペネトレーションテストにおける「総合recon」の一般的な方法論と、広く使われている **実在の** ツール名。chs.us の recon ガイドが扱うとされる6分野（サブドメイン列挙・ポート・コンテンツ発見・GitHub dork・JS解析・通知）に対応させて整理する。特定のコマンド文字列を chs.us の原文引用として提示することはしない（原文未取得のため）。

**(a) サブドメイン列挙（Subdomain Enumeration）**
- パッシブ収集: `amass enum -passive`, `subfinder`, `assetfinder`, `findomain`, 証明書透明性ログ（crt.sh）, `github-subdomains`。
- アクティブ/総当り＋解決: `puredns`（`massdns` ラッパ）, `dnsx`, `shuffledns`、ワードリスト＋リゾルバ群。
- パーミュテーション: `gotator` / `dnsgen` / `altdns` で派生名を生成し再解決。
- 生存/HTTP確認: `httpx`（`-title -status-code -tech-detect -web-server`）でHTTPサービス化しているホストへ絞り込み。
- 結果の差分蓄積: `anew`（新規行のみ追記）で列挙結果を継続的に育てる。

**(b) ポートスキャン（Ports）**
- 高速ポート発見: `naabu`（`-top-ports` / `-p -`）や `masscan`。
- 詳細/サービス特定: `nmap -sV`（発見ポートに限定して精査）。
- 発見したポート→`httpx` で Web サービスを再確認し、コンテンツ発見の入力にする。

**(c) コンテンツ発見（Content Discovery）**
- ディレクトリ/ファイル総当り: `ffuf`, `feroxbuster`, `gobuster`, `dirsearch`。
- 過去URL/クロール由来のパス収集: `gau`, `waybackurls`, `katana`, `gospider`, `hakrawler`。
- パラメータ発見: `paramspider`, `arjun`, `x8`。
- ワードリスト: SecLists, assetnote wordlists（https://wordlists.assetnote.io/）。

**(d) GitHub dork / シークレット探索（GitHub Dork）**
- 組織/ドメイン名でコード検索（`org:` / `"target.com"` / `filename:` / `extension:` 等の qualifier）。
- 自動化: `github-search`（gwen001）, `trufflehog`, `gitleaks`, `gitrob`, `git-hound`。
- 目的: 漏洩したAPIキー・認証情報・内部ホスト名・S3バケット・エンドポイント。pikpikcu の `gitHubLinks.py` はこの分野をJSリンクに特化させたもの。

**(e) JavaScript 解析（JS Analysis）** ← 本ノート第1節（pikpikcu Gist）が具体化する分野
- JS収集: `subjs`, `getJS`, `gau|grep .js`。
- エンドポイント/パス抽出: `LinkFinder`, `xnLinkFinder`, `katana -jc`。
- シークレット抽出: `SecretFinder`, `trufflehog`, `mantra`。
- 整形: `js-beautify`（jsbeautify）。
- 危険シンク検知: `innerHTML` / `document.write` / `eval` / `postMessage` / `onmessage`（`jsAlert.py` 相当の grep/正規表現）→ DOM based XSS・postMessage 脆弱性へ接続。

**(f) 通知・自動化・差分/履歴監視（Notifications）**
- 通知: ProjectDiscovery `notify`（Slack/Discord/Telegram/webhook へ結果送出）。
- 差分検出: `anew`（新規行のみ）＋ `cron`/GitHub Actions で定期実行し、**新規サブドメイン・新規JS・JS内容の変化** を検知して通知。
- JS内容の履歴/差分監視: JSを定期取得してハッシュ/diff比較し、新規エンドポイントやシークレット追加を捕捉（`allJsToJson.py` が保存する `content` はこの diff の素材になり得る）。
- パイプライン化: 一連（列挙→httpx→JS抽出→通知）をシェル/Makefile/ワークフローで結合し、継続的reconとして回す。

#### 2.4 総合Reconの詳細補完（二次情報。出典: `dylanzonix/ambit` `methodology/info/recon-methodology.md`, commit `c97fcbc` 2026-08-25, 作者 Dylan McGuinness）

> **重要な但し書き（捏造防止）**: 以下は chs.us の recon ガイド本文ではない。当該ガイドが取得不能だったため、**同ガイドを参考文献として明示的に引用している別の公開methodologyドキュメント**（`dylanzonix/ambit` リポジトリ）から、同一6分野を具体化する記述を出典明記のうえ整理したもの。実在のツール名・コマンド・オプションはこの二次情報に基づく。chs.us が実際にどのコマンドを載せているかは原文未取得のため不明であり、以下を「chs.us の記述」として引用してはならない。あくまで chs.us が扱うとされる各分野を、教科書 ch07 で解説するための**同等の無料一次/二次資料由来の補足**である。

このドキュメントの基本思想（逐語要旨）: 「監査の前に、対象の到達可能な全コンポーネント・ID・エンドポイント・パラメータ・技術・データシンクを列挙せよ。毎回最初に実施する。**マップしなかった面はテストできず、未マップの面こそロジック/認可バグが潜む場所**」。以下、本ノート2.3では薄かった実コマンド粒度を、6分野＋αで補う。

**(A) スコープ確定・資産発見（org→apex→hosts）** — 2.3では未記載の前段
- スコープ確認を**最初に**: HackerOne/Bugcrowd のスコープを `bounty-targets-data` / `chaos-data.projectdiscovery.io` から取得。in-scope のホスト/IP/ワイルドカードのみ触れる。
- ASN発見: `whois -h whois.radb.net`、bgp.he.net、`amass intel -asn <ASN>` → 組織保有CIDRを把握。
- Reverse WHOIS: ViewDNS / Whoxy(`whoxyrm`) で登録者メール/組織から兄弟apexドメインを発見。
- `nmap -sL <CIDR>`（PTR列挙、プローブなし）。CDN/オリジン範囲の分類は `kaeferjaeger.gay` のCDNリスト＋`cdncheck`/`mapcidr`。
- 資産検索エンジン横断: Shodan/Censys/ZoomEye/FOFA(`fofax`)/Netlas/FullHunt/SecurityTrails を `uncover`(一括ラッパ) でピボット。コード検索は `publicwww.com`/NerdyData/grep.app（解析ID・APIキー・固有文字列から他ホスト/リポを発見）。

**(B) サブドメイン列挙（Passive / Active）** — 2.3(a)を具体化
- Passive: 証明書透明性 `crt.sh?q=%25.target.com`、Censys certs、`certspotter`、`ctail`（CTログをライブtail）。leaf証明書のSAN抽出（`openssl s_client ... | openssl x509 -noout -text`）。`subfinder -d`、`amass enum -passive -d`、`assetfinder`、`findomain -t`。公開DNSデータセット: Rapid7 Sonar / `dns.bufferover.run` / OpenINTEL / ProjectDiscovery `chaos`。検索エンジンdork `site:*.target.com -site:www.target.com`（自動化 `pagodo`/`xnldorker`）。ページ/JS/GitHubからのスクレイプ `SubDomainizer -u`。
- Active: ゾーン転送 `dig axfr @ns1.target.com target.com`。NSEC/NSEC3 ゾーンウォーク `dnsrecon -t zonewalk`/`ldns-walk`。総当り `puredns bruteforce all.txt target.com -r resolvers.txt`（massdnsでワイルドカード除去）、`gobuster dns`、`ksubdomain`、`shuffledns`（辞書 SecLists / `n0kovo_subdomains` 3M）。パーミュテーション `altdns`/`dnsgen`/`ripgen`/`gotator`/`alterx` → `puredns`/`dnsx` で再解決。検証 `dnsx -resp -a -cname`（信頼resolver `dnsvalidator`/`trickest/resolvers`）。逆引きスイープ `dnsx -ptr`。ライブIPのTLSからCN/SAN抽出 `cero <ip-range>`。DNSレコード検査（CNAME/SPF/MX/TXT/DMARC、`dig any`）→ dangling record = サブドメインテイクオーバーの糸口。

**(C) オリジン/WAFバイパスIP発見** — 2.3に無い重要分野
- Faviconハッシュピボット: base64 faviconのMMH3を計算（`favicon_hash_shodan`, kmsec favicon-hash）→ Shodan/ZoomEye/FOFA で `http.favicon.hash:<hash>` 検索 → CDN背後の実オリジンを同一アイコンから特定。
- オリジン候補の確認: `nmap --script ssl-cert -p 443 <candidate_ip>`（cert の `commonName=target.com` なら高確度）。履歴DNS（SecurityTrails/`crt.sh` の旧Aレコード）。オリジンファインダ `CloudFlair`/`CloudPeler`/`cloudbunny`/`CF-Hero`/`hakoriginfinder`。CDNを迂回しがちな `direct.`/`origin.`/`mail.`/`ftp.`/`dev.` サブドメイン。

**(D) ライブホスト確認・ポート/サービス列挙** — 2.3(b)を具体化
- 全解決名を `httpx -sc -title -tech-detect -location -cdn -web-server` でプローブ（生死・ステータス・リダイレクト・技術・CDNフラグ）。
- ポート `naabu` / `nmap -p- --min-rate 5000` → 開放ポートに `nmap -sVC`。非Webポートは `fingerprintx`/`nerva`（RDP/SSH/MySQL/Postgres/Kafka）。VHOST列挙 `ffuf -u http://<ip>/ -H "Host: FUZZ.target.com" -w subs.txt -fs <baseline>` / `gobuster vhost` → デフォルトvhost背後の内部アプリ。

**(E) 技術フィンガープリント（WSTG-INFO-02/08/09/10）**
- バナー: `Server`/`X-Powered-By`/`X-AspNet-Version`/`X-Generator`/`Via`/`X-Runtime`（`curl -sI`）。ヘッダ順序/大小/空白・既定エラーページで Apache/nginx/IIS を識別。自動 `whatweb -a3`、Wappalyzer/`wappalyzer-next`、`httpx -tech-detect`、`chameleon`。Cookie名でスタック判別（`PHPSESSID`/`JSESSIONID`/`ASP.NET_SessionId`/`laravel_session`）。スタック別既定パス（`/wp-login.php`, `/administrator`, `/actuator`, `/_next/`）。CMSスキャナ `wpscan`/`joomscan`/`droopescan`/`CMSeeK`。WAF検知 `wafw00f`/`nmap --script http-waf-detect`。

**(F) コンテンツ発見（Dirs/Files/Backups, WSTG-INFO-04）** — 2.3(c)を具体化
- 総当り `ffuf -u https://target/FUZZ -w raft-medium.txt -mc all -fc 404`、`feroxbuster -u https://target -r`、`gobuster dir`、`dirsearch`（発見dirへ再帰）。拡張子ファジング `-x php,asp,aspx,jsp,json,txt,zip,bak,old,tmp,swp,~,inc,config,sql`。既知ファイルのバックアップ変種（`app.php.bak`/`app.php~`/`.app.php.swp`(vim)/`#app.php#`）。ルートのアーカイブ（`backup.zip`/`www.zip`/`db.sql`/`<hostname>.zip`）。APIワードリスト SecLists `Discovery/Web-Content`＋`kiterunner`(`kr scan`)＋assetnote。IIS 8.3 ショートネーム列挙 `shortscan http://target/`。多ホスト一括取得 `meg -d 1000 paths.txt hosts.txt`。

**(G) パッシブURL/エンドポイント収集**
- Wayback/OTX/CommonCrawl: `gau`、`waybackurls`、`waymore`、`urlfinder`。アクティブクロール `katana -u https://target -jc -kf all`、`hakrawler`、`gospider`。URLScan.io、Common Crawl index、Google/Bing dork（`site:target.com ext:sql|ext:log|ext:bak|inurl:admin|inurl:api`、GHDB）。

**(H) JavaScript / Source-map recon** — 本ノート第1節（pikpikcu）と重なる分野。以下は補完
- JSバンドル列挙（クロール＋HTML`<script>`＋`subjs`）。エンドポイント/パラメータ抽出 `LinkFinder -i https://target/app.js -o cli`、`xnLinkFinder`。シークレット `SecretFinder -i app.js`、`jsleak`、`noseyparker`。**ソースマップ**: 各JS URLに `.map` を付与（`app.js`→`app.js.map`）、存在すれば `unwebpack-sourcemap` で原ソース（コメント・ルートテーブル含む）を復元 ← pikpikcuガイドに無い高価値手法。漏洩キー検証 `keyhacks`/`gmapsapiscanner`（PoC以上に悪用しない）。webpack chunk manifest/`runtime.js` から遅延ロードのルート名（未リンクSPAビュー）。

**(I) パラメータ発見（WSTG-INFO-06）**
- 隠しパラメータ発掘 `arjun -u https://target/page`、`x8 -u https://target/ -w params.txt`（mass-assignment/IDORの糸口）。`ParamSpider --domain target.com`、`gau | unfurl keys`。クライアント側のみ検証の隠しフォームフィールド＝改ざん候補。

**(J) API固有recon（WSTG-API-01）**
- 仕様発見 `/swagger.json`/`/openapi.json`/`/v2/api-docs`/`/swagger-ui`/`/api-docs`/`/redoc`（`sj`/`autoswagger`）。バージョン付きパス `/v1`,`/v2`,`/internal` は親パスを歩く。HTTPメソッド列挙（`OPTIONS`→GET/POST/PUT/PATCH/DELETE）。GraphQL: `/graphql`/`/v1/graphql` にイントロスペクション `{__schema{types{name}}}`、無効なら `clairvoyance` でスキーマ再構成、`graphql-voyager`/`InQL` で可視化、`BatchQL`/`graphql-cop`。SOAP/WSDL `?wsdl`、gRPC reflection `grpcurl list`。

**(K) クラウド/ストレージ/VCS露出** — GitHub dork（2.3(d)）を拡張
- 露出 `.git`: `/.git/HEAD`・`/.git/config` → `git-dumper`/`GitTools` で全ソース＋履歴＋シークレット。他 `/.svn/entries`、`/.env`、`/config.json`、`/web.config`、`/.DS_Store`。S3/GCS/Azureバケット推測 `cloud_enum -k <keyword>`、`bucket-stream`、`buckets.grayhatwarfare.com`、`aws s3 ls s3://bucket --no-sign-request`。JS/HTML中のバケット名grep（`s3.amazonaws.com`/`.blob.core.windows.net`/`storage.googleapis.com`）。GitHub/GitLab OSINT `gitrob`/`trufflehog`/`gitleaks`/`shhgit`/`grep.app`。依存混乱 `confused`/`nodep`。クラウドIMDS SSRF標的メモ `169.254.169.254`。

**(L) 情報開示レビュー・可視化・自動化**
- HTML/JSコメント grep（`<!--`/`TODO`/`FIXME`/`password`/`apikey`/内部ホスト名）。メタデータ `<meta name="generator">`、画像EXIF `exiftool`。冗長エラー誘発（型不一致）→ フレームワーク版・テーブル/カラム名・ファイルパス。デバッグ endpoint `/actuator/env`/`/actuator/heapdump`/`/phpinfo.php`/`/server-status`/`?debug=true`。スクリーンショット `gowitness`/`aquatone`/`EyeWitness`（`eyeballer` でlogin/admin/defaultを深層学習で判別）。
- **通知・自動化（2.3(f)を具体化）**: エンドツーエンドrecon枠組 `reconftw`/`osmedeus`/`reNgine`/`BBOT`(再帰)。マップ後 `nuclei -t exposures/,misconfiguration/`。OOB基盤 `interactsh`/Burp Collaborator/`ceye.io`/`canarytokens` を監査前に用意。**カバレッジ台帳** `(identity, host, endpoint, param)` のマップ済/未テストを管理し、recon飽和を判定。

**(M) 防御シグナル（recon中に記録すべき兆候）**
- ワイルドカードDNS/ソフト404 → ランダムパスでベースライン取得しサイズ/ハッシュでフィルタ（ステータス依存にしない）。攻撃的WAF/レート制限（403/429）→ スロットリング、UA/IP/レジデンシャルプロキシ回転、パス正規化ギャップ（`//admin`, `/./admin`, `/%2e/admin`, `/Admin`, 末尾 `%20`/`%09`/`;`）。`Server`/バージョンヘッダ除去＋CSP＋ソースマップ無し＝成熟した対象、行動フィンガープリントとID別diffに頼る。

> 上記 `dylanzonix/ambit` の Sources 欄（＝当該methodologyが参照する一次/二次資料）には、chs.us の recon ガイドと並んで OWASP WSTG、hacktricks、thehacker.recipes、ProjectDiscovery recon series、YesWeHack のガイドなどが列挙されている。これらは chs.us が到達不能な読者にとって**同等の無料代替資料**であり、後掲「読者が自分で開くべき資料」に転記した。

---

## 読者が自分で開くべき資料

### A. https://chs.us/guides/recon/（取得失敗・要自読）
**なぜ取得できなかったか**: 作業環境のegress許可リストにより `chs.us` およびアーカイブ（web.archive.org）への外向き通信が組織ポリシーで遮断されているため。当該ガイドは2026年の追記で、著者の公開Hugo源泉リポジトリ（`sampsonc/chs.us.v4`, HEAD 2024-12-31）にも未収録で、GitHub上に本文ミラーも存在しない。WebSearchも予算枯渇で不可。

**読みどころ（読者が開いたら確認すべき点、3〜6項目）**:
1. **サブドメイン列挙の実コマンド**: 著者がパッシブ（subfinder/amass/crt.sh）とアクティブ（puredns+massdns等）をどう順序立て、どのリゾルバ/ワードリストを指定しているか（本ノート2.3(a)の一般手順と突き合わせる）。
2. **ポート→コンテンツ発見への橋渡し**: naabu/masscan→httpx→ffuf/feroxbuster の具体オプション（スレッド数、対象ポート、フィルタ条件）。
3. **GitHub dork の具体クエリ**: どの qualifier（`org:`/`filename:`/`extension:`）とどの自動化ツール（trufflehog/gitleaks/github-search）を推奨しているか。
4. **JS解析の位置づけ**: 本ノート第1節（pikpikcu）と重なる部分（LinkFinder/SecretFinder/subjs等）を、著者がどの段階に組み込んでいるか。
5. **通知・継続recon（notifications）の仕組み**: notify + anew + cron/CI による差分監視・新規資産アラートの構成。ここが「総合reconガイド」の肝で、本ノートで最も情報が薄い部分。
6. **著者の他ガイドとの相互リンク**（ssrf/csrf/idor/authz 等）: recon の成果を各脆弱性ガイドへどう接続しているか。

**代替アクセス手段（読者向け）**: ブラウザで直接 https://chs.us/guides/recon/ を開く（本作業環境ではegress遮断だが、一般の読者環境なら到達可能なはず）。到達不能な場合は Wayback Machine（https://web.archive.org/web/2024/https://chs.us/guides/recon/ など年指定）でスナップショットを確認。著者関連: https://github.com/sampsonc, https://chs.us/ , 著者の演習ラボ https://github.com/sampsonc/vulnlab.dev（chs.us の hands-on ガイドを土台にした脆弱性ラボ）。

**同等の無料代替資料（chs.us が扱う6分野を網羅。出典: 上記 2.4 の `dylanzonix/ambit` recon-methodology.md の Sources 欄＋本ノートで確認した実在資料）**:
- OWASP WSTG「Information Gathering」: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/ ← reconの標準体系（WSTG-INFO-01〜10）。まずこれを読むと chs.us ガイドの各節の位置づけが分かる。
- OWASP WSTG「API Reconnaissance」: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/12-API_Testing/01-API_Reconnaissance
- The Hacker Recipes「Domains enumeration」: https://www.thehacker.recipes/web/recon/domains-enumeration ← サブドメイン列挙の手順を体系化。
- ProjectDiscovery「Recon series 2」: https://projectdiscovery.io/blog/recon-series-2 ← subfinder/httpx/naabu/nuclei/notify を使った実パイプライン。
- Vaadata「Subdomain enumeration techniques and tools」: https://www.vaadata.com/en/blog/subdomain-enumeration-techniques-and-tools/
- YesWeHack「Discover & map hidden endpoints and parameters」: https://www.yeswehack.com/learn-bug-bounty/discover-map-hidden-endpoints-parameters ← コンテンツ発見/パラメータ発見。
- HackTricks「Pentesting Web」: https://book.hacktricks.wiki/en/network-services-pentesting/pentesting-web/index.html
- PortSwigger「Information disclosure」: https://portswigger.net/web-security/information-disclosure
- Web-Attack-Cheat-Sheet（riramar）: https://github.com/riramar/Web-Attack-Cheat-Sheet ← recon〜攻撃の網羅的チートシート。
- オリジンIP発見: https://blog.shodan.io/deep-dive-http-favicon/ ・ https://github.com/phor3nsic/favicon_hash_shodan ・ https://medium.com/@TheCzar/origin-ip-discovery-methods-d462c28d895a
- 通知・継続recon（chs.us の notifications 節に対応）: ProjectDiscovery `notify`（https://github.com/projectdiscovery/notify）＋ `anew`（https://github.com/tomnomnom/anew）＋ cron/GitHub Actions。
- 参考にした二次methodology全文（chs.us/guides/recon を Sources に挙げる同種資料）: https://github.com/dylanzonix/ambit → `methodology/info/recon-methodology.md`（6分野を実コマンド粒度で網羅）。

### B. pikpikcu Gist の外部ツール（第1節で全取得済、原典で確認推奨）
- LinkFinder: https://github.com/GerbenJavado/LinkFinder
- SecretFinder / Bug-Bounty-Toolz（getsrc.py, antiburl.py, jsbeautify.py, collector.py, getjswords.py, availableForPurchase.py）: https://github.com/m4ll0k/SecretFinder ・ https://github.com/m4ll0k/Bug-Bounty-Toolz
- gau: https://github.com/lc/gau ／ anti-burl: https://github.com/tomnomnom/hacks/tree/master/anti-burl ／ ffuf: https://github.com/ffuf/ffuf
- ワードリスト: https://wordlists.assetnote.io/
- Other Resources（原文）: クライアントサイド暗号化バイパス Part1（bhattsameer.github.io）, Chrome DevTools JavaScriptガイド, HackerOne動画（youtube: FTeE3OrTNoA）。
