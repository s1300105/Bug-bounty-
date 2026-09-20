## TomNomNom流Unix哲学とデータ運用

### 9c.1 なぜ「小さなツール」が偵察を強くするのか

Recon（偵察）の自動化には二つの流派がある。ひとつは reconFTW や reNgine のように「全部入り」のフレームワークを回す流派。もうひとつが、Tom Hudson（ハンドルネーム **TomNomNom**）が体現する、**単機能のツールをパイプでつなぐ**流派である。後者はUnix哲学 —— "Do one thing and do it well"（ひとつのことだけをうまくやる）、"Write programs to work together"（プログラムは協調するように書く）、"Handle text streams, because that is a universal interface"（テキストストリームを扱え。それが普遍的なインタフェースだから）—— の直系である。

Daniel Miesslerはこの点を「discrete, Unixy tools are powerful because they can be combined in extraordinary ways（個別に切り出されたUnix的なツールは、とんでもない仕方で組み合わせられるから強力なのだ）」と要約している。重要なのは、これが単なる美学ではなく**偵察という問題領域に構造的に適合している**ことだ。

- 偵察のデータは本質的に**改行区切りのフラットなリスト**である（ドメイン1行、ホスト1行、URL1行）。JSONのような入れ子構造を必要としない。そのため `stdin`/`stdout` のテキストストリームが損失なく使える。
- 偵察は**同じ対象に何度も走らせる反復作業**である。よって「前回との差分」を扱う機構が中核になる。
- 偵察のワークフローは**人によって・対象によって違う**。フレームワークは他人の手順を押し付けるが、パイプラインは自分の手順を組み立てられる。

本節では、まず個々のツールが「何をしないか」まで含めて仕組みレベルで理解し、次にTomNomNom自身がShopifyのバグバウンティで見せた実演ノートから、**ファイルを状態（state）として運用するデータ運用の型**を抽出する。

> 本節は防御・学習目的で記述する。ここで扱うコマンドは、自組織の資産、または明示的に許可されたバグバウンティ対象に対してのみ実行すること。実在サービスへの無許可のスキャンや、レート制限を無視した大量リクエストは行ってはならない。

---

### 9c.2 ツール群の解剖 —— 「何をしないか」で設計されている

Miesslerのprimerが取り上げるのは `gf` / `httprobe` / `unfurl` / `meg` / `anew` / `waybackurls` の6本である。それぞれ原典のREADMEに当たって、動作原理まで踏み込む。

#### anew —— 「重複を落とす `tee -a`」が状態管理の中心になる

READMEの定義はこうだ。

> Append lines from stdin to a file, but only if they don't already appear in the file. Outputs new lines to `stdout` too, making it a bit like a `tee -a` that removes duplicates.
> （標準入力から来た行をファイルに追記する。ただしそのファイルにまだ存在しない行だけを。新しい行は標準出力にも出すので、重複を除去する `tee -a` のようなものになる。）

```
▶ cat things.txt
Zero
One
Two

▶ cat newthings.txt
One
Two
Three
Four

▶ cat newthings.txt | anew things.txt
Three
Four
```

**なぜこう動くのか**：`anew` は起動時に対象ファイルを1回読み込み、各行をハッシュ集合（Goの `map[string]bool`）に載せる。以降は標準入力を1行ずつ読み、集合に問い合わせて（平均O(1)）、無ければ①ファイルに追記し②標準出力にも書く。この設計から3つの性質が導かれる。

1. **順序が保存される**。`sort -u` と違って既存の並びを壊さない。偵察ファイルは「発見順＝時系列」になっているほうが後から追いやすい。
2. **ストリーミングで動く**。入力全体をメモリに溜めない（メモリ消費は既存ファイルのサイズにのみ比例する）。数百万行のURLリストでも詰まらない。
3. **標準出力が「差分」になる**。これが決定的に重要で、`anew` は追記ツールであると同時に**差分検出器**である。継続監視（Lv10）で「新しく出現したサブドメインだけを通知する」処理が、`| anew domains | notify` の1本で書けるのはこの性質のおかげだ。

フラグは2つだけ。`-d`（dry-run：標準出力には出すがファイルは書き換えない）と `-q`（quiet：ファイルには追記するが標準出力には何も出さない）。なお新しい行は標準出力に出るので、`cat newthings.txt | anew things.txt > added-lines.txt` のように「今回増えた分」をそのままファイルに落とせる。

#### httprobe —— 生きているホストを絞る

```
▶ cat domains.txt | httprobe
http://example.com
http://example.net
https://example.com
```

ドメインのリストを受け取り、HTTP（80番）とHTTPS（443番）に接続を試み、**応答したものだけをスキーム付きURLとして出力する**。内部ではワーカプール（既定20並列）を作り、各ワーカがTCP接続→（HTTPSならTLSハンドシェイク）→HTTPリクエストを行う。

主要フラグと、それぞれが効く理由：

| フラグ | 意味 | なぜ必要か |
|---|---|---|
| `-c <n>` | 並列数（既定20） | 待ち時間の大半はネットワークI/O。並列数を上げると総時間はほぼ線形に短縮されるが、対象側への負荷も線形に増える |
| `-t <ms>` | タイムアウト（ミリ秒） | 応答しないホストに張り付くと全体が詰まる。既定より短くすると速いが取りこぼす |
| `-p <proto:port>` | 追加プローブ（例 `-p http:81 -p https:8443`） | 管理画面や開発用サービスは非標準ポートに載っていることが多い |
| `-s` | 既定の80/443を試さない | `-p` で指定した非標準ポートだけを狙うとき |
| `--prefer-https` | HTTPSが通ったらHTTPは試さない | 同一ホストについて2行出るのを防ぎ、**リクエスト数をほぼ半減**させる |

`--prefer-https` は地味に見えて、後段のパイプライン全体の入力量を半分にする。1ホストにつき `http://` と `https://` の2行が下流に流れると、`meg` や `waybackurls` の処理量も倍になるからだ。

#### waybackurls —— アーカイブを「押す」のではなく「読む」

```
▶ cat domains.txt | waybackurls > urls
```

ドメインを受け取り、Wayback Machineが `*.domain` について保持している既知URLを列挙する。対象サーバには一切リクエストを送らない passive recon（受動偵察）である。内部ではInternet ArchiveのCDX API（Capture inDeX API）を叩いている。mhmdiaa氏の `waybackurls.py` に着想を得たツールだと原典に明記がある。

#### unfurl —— URLを部品に分解する

URLを構造として扱うための唯一の道具。`domains` / `paths` / `keys` / `values` / `keypairs` / `apexes` / `json` / `format` といったモードがあり、`-u`（`--unique`）は全モードで重複を落とす。

```
▶ echo https://sub.example.com/users?id=123&name=Sam | unfurl domains
sub.example.com

▶ cat urls.txt | unfurl keys          # クエリパラメータ名だけを抽出
▶ cat urls.txt | unfurl -u apexes     # ユニークなapexドメイン（example.com）だけ
▶ cat urls.txt | unfurl format %d%p   # ドメイン＋パス
```

`format` モードの書式指定子は次の通り（原典README）：`%s` scheme、`%d` domain、`%S` subdomain、`%r` root、`%t` TLD、`%P` port、`%p` path、`%e` extension、`%q` query string、`%f` fragment、`%a` authority、`%@`（userinfo があれば `@`）、`%:`（portがあれば `:`）、`%?`（queryがあれば `?`）、`%#`（fragmentがあれば `#`）、`%%`（リテラルの `%`）。

**なぜ `sed` や正規表現ではなく `unfurl` なのか**：URLのパースは正規表現で書くと必ずどこかで壊れる（ポート付き、userinfo付き、IPv6リテラル `http://[::1]:8080/`、パーセントエンコードされたパスなど）。`unfurl` はGo標準の `net/url` パーサを使うため、**ブラウザやサーバ側の実装に近い解釈**になる。偵察データの正規化で正規表現の自作パーサを使うのは、静かな取りこぼしの温床である。

#### gf —— grepのパターンに名前を付ける

TomNomNom自身が動機をこう書いている。複雑なパターンを毎回手打ちすると打ち間違えるし、「結果がゼロなのは本当に無いからか、パターンをミスったからか」が分からなくなる。

```
▶ grep -HnrE '(\$_(POST|GET|COOKIE|REQUEST|SERVER|FILES)|php://(input|stdin))' *
```

これが `gf php-sources` の一言になる。定義は `~/.gf/` に小さなJSONファイルとして置く（バージョン管理できるのが狙い）。

```json
▶ cat ~/.gf/php-sources.json
{
    "flags": "-HnrE",
    "pattern": "(\\$_(POST|GET|COOKIE|REQUEST|SERVER|FILES)|php://(input|stdin))"
}
```

長くなるときは `patterns` 配列に分割できる。

```json
▶ cat ~/.gf/php-sources-multiple.json
{
    "flags": "-HnrE",
    "patterns": [
        "\\$_(POST|GET|COOKIE|REQUEST|SERVER|FILES)",
        "php://(input|stdin)"
    ]
}
```

コマンドラインからパターンを保存する `-save` もある。

```
▶ gf -save php-serialized -HnrE '(a:[0-9]+:{|O:[0-9]+:"|s:[0-9]+:")'
```

さらに `engine` キーで grep 以外の検索エンジンに差し替えられる（例：the silver searcher）。その際、エンジンごとにフラグ体系が違う点に注意が必要である——下の例では `ag` に無い `E` フラグを外している。

```json
{
  "engine": "ag",
  "flags": "-Hanr",
  "pattern": "([^A-Z0-9]|^)(AKIA|A3T|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{12,}"
}
```

補完スクリプト（`gf-completion.bash` / `.zsh` / `.fish`）を `source` すると、`gf <tab>` でパターン名が一覧される。zsh（特にoh-my-zsh）では `gf` が `git fetch` のエイリアスになっていることがあるため、`unalias gf` かリネームが必要、と原典が注意している。

#### meg —— 「速く、かつ行儀よく」を両立させる設計

`meg` は多数のホスト×多数のパスを取得するツールだが、その**巡回順序**が設計の核心である。

> It can be used to fetch many paths for many hosts; fetching one path for all hosts before moving on to the next path and repeating.
> （多数のホストに対し多数のパスを取得できる。ひとつのパスを全ホストぶん取得してから次のパスへ移り、それを繰り返す。）

つまり「ホストAに全パス→ホストBに全パス」ではなく「全ホストに `/robots.txt`→全ホストに `/package.json`」と**列方向に**回す。結果として、こちらは常時20並列で走っていながら、**個々のホストから見れば5秒に1リクエスト**（`-d` の既定値5000ms）でしかない。スループットとレート制限を同時に満たす、順序だけで解いた綺麗な設計である。

```
▶ meg --verbose paths hosts
out/example.com/45ed6f717d44385c5e9c539b0ad8dc71771780e0 http://example.com/robots.txt (404 Not Found)
...
```

引数を省略すると、パスは `./paths`、ホストは `./hosts`、出力先は `./out` が既定になる。保存されるのは**生のリクエストとレスポンス全文**で、ファイル名はURLのSHA-1ハッシュ、`./out/index` が対応表になる。

```
▶ head -n 20 ./out/example.com/45ed6f717d44385c5e9c539b0ad8dc71771780e0
http://example.com/robots.txt

> GET /robots.txt HTTP/1.1
> Host: example.com

< HTTP/1.1 404 Not Found
< Server: ECS (lga/13A2)
< Content-Type: text/*
...
```

**なぜ生で保存するのか**：これがデータ運用上の最重要ポイントである。取得時に「何を探すか」を決めてしまうと、後から別の観点で見たくなったときに再取得が要る。生で持っておけば、以後の分析は全て `grep` で済む。ネットワークは高価、ディスクは安価、という非対称性に賭けた設計だ。

```
▶ grep -Hnri '< Server:' out/
```

主なオプション：`-c/--concurrency`（既定20）、`-d/--delay`（同一ホストへの間隔ms、既定5000）、`-H/--header`（任意ヘッダ付与）、`-s/--savestatus`（指定ステータスのみ保存）、`-X/--method`、`-r/--rawhttp`。原典は delay を下げる前の注意を明記している——「**before reducing the delay, ensure that you have permission to make large volumes of requests to the hosts you're targeting**（delayを下げる前に、対象ホストへ大量のリクエストを送る許可があることを確認せよ）」。

`-r/--rawhttp` は、Goの標準HTTPクライアントが弾いてしまう不正なリクエスト（例：壊れたパーセントエンコード `/%%0a0afoo:bar`）を送るための実験的モードで、`tomnomnom/rawhttp` ライブラリを使う。検証をほぼ行わない代わりに chunked transfer encoding 未対応などの制約がある。

#### qsreplace —— リクエスト数を「組み合わせ」の単位で畳む

primerには含まれないが、同じ設計思想の重要ツールなので併せて押さえる。URLを受け取り、全クエリ値を指定値に置換し、**ホストとパスごとに、クエリパラメータの組み合わせが同じものは1回しか出力しない**。

```
▶ cat urls.txt
https://example.com/path?one=1&two=2
https://example.com/path?two=2&one=1
https://example.com/pathtwo?two=2&one=1
https://example.net/a/path?two=2&one=1

▶ cat urls.txt | qsreplace newval
https://example.com/path?one=newval&two=newval
https://example.com/pathtwo?one=newval&two=newval
https://example.net/a/path?one=newval&two=newval
```

1行目と2行目は**パラメータの順序が違うだけ**で、サーバ側から見れば同じエンドポイント・同じパラメータ集合である。`qsreplace` はキーをソートして正規化するため、この重複が畳まれる。値を渡さない `-a`（append）単独指定なら、値を壊さずに重複だけを落とせる。

```
▶ cat urls.txt | qsreplace -a
https://example.com/path?one=1&two=2
https://example.com/pathtwo?one=1&two=2
https://example.net/a/path?one=1&two=2
```

アーカイブ由来のURLリストは同一エンドポイントの値違いが数千行並ぶのが普通なので、この一段を挟むだけで後段のリクエスト数が桁で落ちる。**「対象に優しくする」ことが、そのまま「自分の待ち時間を減らす」ことと一致する**のがこの種のツールの美点である。

> 出典: A TomNomNom Recon Tools Primer — https://danielmiessler.com/blog/a-tomnomnom-tools-primer
> （各ツールの仕様・コード例は原典READMEに当たって補足した：anew/httprobe/waybackurls/unfurl/gf/meg/qsreplace、いずれも https://github.com/tomnomnom/ 配下）

---

### 9c.3 Shopify実演に見る「ファイルを状態として運用する」型

TomNomNomがShopifyのバグバウンティプログラムで行ったライブ偵察の実演ノートには、ツールの使い方そのものより価値の高い**データ運用の型**が記録されている。

#### 台帳ファイルの三層構造

実演で彼が保持していたファイルは、粒度の違う三層になっている。

```
wildcards  →  domains  →  hosts
（スコープ）  （名前解決候補）  （生きているURL）
```

まずプログラムのスコープにあるワイルドカードを `wildcards` に手で書き出す。そこから：

```bash
cat wildcards | assetfinder --subs-only | anew domains
```

`assetfinder --subs-only` がサブドメインを吐き、`anew domains` が**既に知っているものを除いて** `domains` に追記する。次に生死確認：

```bash
cat domains | httprobe -c 80 --prefer-https | anew hosts
```

同時接続80で、443または80に応答したものを `hosts` に貯める。`--prefer-https` はこの実演のために彼自身が `httprobe` に足した機能である。

**この三層が効く理由**：層ごとに「そこに入る条件」が明確で、かつ**前の層から次の層への変換が冪等（idempotent）**になっている。何度回しても `domains` や `hosts` は壊れず、増えるだけ。だから cron で毎日回しても、手で気まぐれに回しても、同じファイルに収束する。偵察を「実行するもの」から「保守するデータ」へ変える転換点がここにある。

#### `anew` を置く位置で、送信リクエスト数が変わる

実演で最も示唆的なのが、複数の列挙ツールを併用するときのパイプの組み方である。彼は `assetfinder` に加えて `findomain` も使う。

```bash
findomain -f wildcards | tee -a findomain.out
cat findomain.out | anew domains | httprobe -c 50 | anew hosts
```

ここで **`anew domains` を `httprobe` の前に置いている**ことが要点である。`findomain` の出力には、すでに `assetfinder` 経由で知っているドメインが大量に含まれる。もし

```bash
# 悪い例：既知のドメインまで全部プローブしてしまう
cat findomain.out | httprobe -c 50 | anew hosts
```

と書くと、既知ドメインにも改めてHTTP/HTTPS接続を張ってしまう。`anew` を前段に置けば、`httprobe` に流れるのは**今回はじめて見たドメインだけ**になる。ノイズ（＝対象への不要なトラフィック）を抑えるコツであり、同時に自分の実行時間も短くなる。

なお `anew` 以前、彼は `tee -a` を使っていた。「ドメインのファイルを持っていて、毎回重複排除するのが面倒だったから `anew` を作った」というのが誕生の経緯である。ツールが先にあったのではなく、**パイプラインの摩擦が先にあった**。

#### この型の落とし穴：`anew` は失敗を隠す

実演ノートの筆者は、この気持ちよいワークフローに率直な批判を添えている。要旨はこうだ——コマンドにタイプミスがあった、あるいはツールが処理できないエラーコードを受け取った等で `httprobe` が実質的に走らなかった場合、パイプラインはエラーを表に出さず、`anew` が「新しい行はありませんでした」という**正常時と見分けのつかない出力**を返してしまう。

**なぜそうなるのか（シェルの仕組み）**：POSIXシェルのパイプラインの終了ステータスは、既定では**最後のコマンドの終了ステータスだけ**である。途中の `httprobe` が非ゼロで死んでも、最後の `anew` が成功すればパイプライン全体は成功（0）を返す。自動化では致命的なので、スクリプト化する際は必ず次を入れる。

```bash
#!/bin/bash
set -euo pipefail
# -e        : コマンドが非ゼロで終了したら即座に停止
# -u        : 未定義変数の参照をエラーにする（タイポ対策）
# -o pipefail: パイプライン中のどれかが失敗したら、全体を失敗にする
```

加えて、各段の**行数を記録して異常を検知する**のが実務的である。

```bash
before=$(wc -l < hosts)
cat domains | httprobe -c 80 --prefer-https | anew hosts
after=$(wc -l < hosts)
echo "hosts: ${before} -> ${after}"
```

「昨日は1200行だったのに今日は0行増えた」ではなく「昨日は1200行だったのに今日は全体が0行になった」を検知できる形にしておく。**差分ベースの自動化は、壊れたときに静かに壊れる**——これがLv9のパイプライン化で最も踏みやすい地雷である。

#### 低テクなデータクレンジング

列挙ツールの出力には `-cisco.shopify.com` のように先頭にゴミ文字が付いた行や、`*.shopify.com` のようなワイルドカード行が混ざる。彼の対処は徹底して低テクだ——エディタ（Vim）で `:sort` してから `G` で末尾へ飛ぶ。ASCIIのソート順では記号が英数字より前（または後）に固まるので、**壊れた行が一箇所にまとまり、目視で一括削除できる**。なお `_dev.shopify.com` のようなアンダースコア始まりは正当なレコードであり得るので残す、という判断も記録されている。

正規表現で「正しい行」を定義しようとすると必ず境界例で取りこぼす。ソートして端に寄せて目で見る、というのは、**データ量が数千行のうちは人間の目が最も安価で確実なフィルタである**という現実的な判断である。

#### 漏斗（funnel）としてのパイプライン

同じノートには、アーカイブ由来URLを段階的に絞る一般的な型も記録されている。実測として、あるホストでWayback由来の136件のリンクに `gf` パターンを適用したところ36件まで減ったが、単純に `grep '='`（クエリパラメータを持つURL）で絞ったほうが**より多く**残った、という観察がある。

**なぜこうなるのか**：`gf` のパターンは「よくある脆弱パラメータ名」のホワイトリストに近い。ヒット率は高いが、**命名が独特なパラメータを丸ごと捨ててしまう**。逆に `grep '='` は再現率（recall）が高く、精度（precision）が低い。どちらが正しいかは目的次第で、「まず広く取り、後段で絞る」のがパイプラインの作法である。典型的な絞り込みの段は次のように積む。

```
アーカイブURL
  → grep '='          … パラメータを持つものだけ（再現率重視）
  → egrep -iv '\.(jpg|jpeg|gif|css|tif|png|ttf|woff|woff2|ico|svg)$'
                       … 静的アセットを除外（サーバ側で解釈されない拡張子）
  → qsreplace -a       … ホスト×パス×パラメータ集合の重複を畳む
  → （ここではじめて能動的な確認を行う）
```

`egrep -iv` で画像やフォントを落とすのは、これらが通常テンプレートエンジンやアプリケーションロジックを通らず、静的配信されるためである。**「サーバ側で入力として解釈され得るものだけを残す」**という原理で絞っている。

最終段の能動的な確認は、必ず**許可された対象に対してのみ**、かつレート制限を守って行う。本書ではこれ以上の具体的な攻撃手順は扱わない。

> 出典: Live Recon and Automation on Shopify's Bug Bounty Program with @TomNomNom（The Top Hacker Methodologies & Tools Notes、実演ノートPDF） — https://bibliography.mk.iq/files/pdf1737733544.pdf

---

### 9c.4 ProjectDiscovery系ツールとの接続点

> ⚠️ **未取得の資料**: NahamSec「Free Recon Course and Methodology For Bug Bounty Hunters」（動画）は自動取得できませんでした（理由: YouTubeのページから字幕・本文テキストを抽出できず、フッタのナビゲーションのみが返ったため）。以下のURLからご自身で直接ご覧ください: https://www.youtube.com/watch?v=evyxNUzl-HA

動画そのものは取得できなかったが、共同制作者であるProjectDiscoveryが公表した内容紹介から、扱われているパイプラインの骨格は確認できた（2025年9月22日公開、ProjectDiscovery公式告知 2025年9月23日）。内容は、VPS上に偵察用マシンを構築し、Goインストーラで ProjectDiscovery のツール群を導入・管理したうえで、次の連鎖を組むというものである。

```
Subfinder → AlterX → DNSX → Naabu → HTTPX → Katana
```

（以下は未取得資料の補足として一般知識に基づく解説です）

この連鎖は、9c.2〜9c.3で見たTomNomNomのパイプラインと**同じ形をしている**。対応を取ると理解が早い。

| 役割 | TomNomNom系 | ProjectDiscovery系 |
|---|---|---|
| サブドメイン列挙 | `assetfinder --subs-only` | `subfinder` |
| 名前の変異生成 | （`dnsgen` 等の外部ツール） | `alterx` |
| DNS解決の確認 | （`filter-resolved`） | `dnsx` |
| ポート走査 | （なし／`nmap` 併用） | `naabu` |
| HTTP生死確認 | `httprobe` | `httpx` |
| クロール・URL収集 | `waybackurls` + `meg` | `katana` |
| 差分の蓄積 | `anew` | `anew`（そのまま使う） |

重要なのは、**ProjectDiscoveryのツール群も例外なく「stdinを読んでstdoutに改行区切りで書く」規約を守っている**ことだ。だからこそ `anew` や `unfurl` や `qsreplace` といったTomNomNom製の部品が、そのまま両者の接着剤として機能する。ツール実装が別のプロジェクトでも、**インタフェースが同じなら組み替えられる**——これがUnix哲学の実用的な配当である。

```bash
# 二つのエコシステムを混ぜた例（許可された対象に対してのみ）
subfinder -d example.com -silent \
  | anew domains \
  | httpx -silent -title -tech-detect -status-code \
  | anew hosts.txt
```

ただし `httpx`（ProjectDiscovery）は既定でURL以外の付帯情報（タイトル、技術スタック、ステータスコード）を同じ行に混ぜて出力するため、**そのまま次のツールにパイプするとURLとして解釈できなくなる**点に注意が必要である。付帯情報を出す段と、次段へ渡す段は分けるか、`unfurl` で正規化してから流す。「テキストストリームが普遍インタフェース」であることの裏返しとして、**1行のフォーマットを崩すツールがパイプラインの断絶点になる**。

なお、この種のマルチツール連鎖では「どのツールがどのポート・どのプロトコルに実際にパケットを送るか」を把握しておくこと。`subfinder` や `waybackurls` は passive（対象に触れない）だが、`dnsx` はDNSサーバに、`naabu` は対象のTCPポートに、`httpx`・`katana` は対象のWebサーバに直接到達する。**受動と能動の境界線がどこにあるかを言えない自動化は、許可範囲を越えるリスクがある。**

> 出典: Free Recon Course and Methodology For Bug Bounty Hunters（NahamSec × ProjectDiscovery、2025年9月22日） — https://www.youtube.com/watch?v=evyxNUzl-HA

---

### 9c.5 設計原則のまとめ —— 自分のパイプラインを組むときの指針

ここまでを、再利用できる原則に落とす。

1. **1行1レコード、改行区切りを守る**。これを破った瞬間にパイプが切れる。CSVやJSONを挟みたくなったら、`jq -r` や `unfurl` でその場でフラットに戻す。
2. **ファイルを状態として持ち、`anew` で育てる**。実行結果を上書きしない。追記して、差分を出力させる。「昨日との差」が自動的に手に入る構造にしておくと、Lv10の継続監視へそのまま延長できる。
3. **生データを保存し、分析は後から `grep` で何度でもやる**（`meg` の設計）。ネットワークは高価でディスクは安い。取得時に捨てた情報は二度と戻らない。
4. **`anew` は絞り込み段の「前」に置く**。既知のものを下流に流さないことが、対象への礼儀と自分の時間の両方を守る。
5. **正規表現を書く前に専用パーサを探す**。URLは `unfurl`、JSONは `jq`（または `gron`）。自作の正規表現パーサは静かに取りこぼす。
6. **必ず `set -euo pipefail` を書き、各段の行数をログに残す**。差分ベースの自動化は、壊れたとき「差分ゼロ」という正常に見える姿で壊れる。
7. **レート制御を後付けにしない**。`meg` のように巡回順序そのものでレートを解くか、`-d` / `-c` を明示的に設定する。「全力で叩いてから怒られる」は、防御側から見れば単なるDoSである。
8. **許可範囲をパイプラインの入口（`wildcards` ファイル）に固定する**。スコープの判断をパイプの途中に散らさない。入口のファイルが唯一の権限の source of truth になる。

#### 防御側（Blue Team）から見たとき

同じ道具立ては、そのまま自組織のアタックサーフェス管理（ASM）に使える。むしろそちらが本来の使い道である。

- `anew` の差分出力は「**意図せず公開された新しいホスト**」の検知器になる。開発チームが立てたステージング環境が証明書透明性ログ経由で見えるようになった瞬間に通知が飛ぶ。
- `httprobe` / `httpx` の結果と、社内の資産台帳を `comm` や `grep -vxF -f` で突き合わせれば、**台帳に無いのにインターネットから生きて見えるホスト**（shadow IT）が落ちてくる。
- `meg` で保存した生レスポンス群を `grep` すれば、セキュリティヘッダの欠落や、想定外の `Server:` バナー露出を全社横断で棚卸しできる。

検知側の視点も持っておきたい。これらのツールのトラフィックは、ログ上では「短時間に多数の異なるホスト名へ向かう、User-Agentが既定値のままのリクエスト群」として見える。`meg` の「同一ホストには5秒に1回」という設計は、まさにこのパターンを単一ホストのログから見えにくくするものであり、**防御側は1ホストのログではなく、組織全体・エッジ全体を横断した相関で見る必要がある**ことを意味している。

---

### 9c.6 陳腐化への注記（2026年9月時点）

- **インストール方法**：Miesslerのprimer（執筆当時）では `go get -u github.com/tomnomnom/...` が示されているが、**`go get` によるバイナリのインストールはGo 1.17で非推奨化され、Go 1.18で廃止された**。現在は各ツールのREADMEが示す通り `go install github.com/tomnomnom/<tool>@latest` を使う。`gf` のREADMEなど一部は `go get -u` の記述が残っているので読み替えること。
- **`$GOPATH` 前提の記述**：`gf` のパターン例を `cp -r $GOPATH/src/github.com/tomnomnom/gf/examples ~/.gf` でコピーする手順は、`go install` を使うモジュール時代には `$GOPATH/src` が存在しないため成立しない。リポジトリを `git clone` して `examples/` をコピーする。
- **`gf` とzshのエイリアス衝突**：oh-my-zsh環境では `gf` が `git fetch` に割り当てられている。README記載の通り `unalias gf` するか、バイナリ側をリネームする。
- **`assetfinder` / `findomain`**：実演ノートはこの2本を併用しているが、passive列挙ツールは背後のデータソース（各種APIの無料枠・提供終了）に強く依存するため、**年単位で「よく効くツール」が入れ替わる**。パイプラインを特定ツールに固定せず、「列挙する段」「`anew` で溜める段」という役割で設計しておくと入れ替えが効く。
- **Wayback / Common Crawl 側のAPI**：`waybackurls` が依存するCDX APIはレート制限や可用性が変動する。取得失敗が空出力として返ると、`anew` の差分ゼロと見分けがつかない（9c.3の落とし穴と同じ構造）ので、終了ステータスと行数の両方を見ること。
- **ProjectDiscoveryの連鎖**：9c.4の `Subfinder → AlterX → DNSX → Naabu → HTTPX → Katana` は2025年9月時点の構成である。各ツールのフラグ（特に `httpx` の出力フォーマット系）はマイナーバージョンで変わることがあるため、スクリプト化する際は `-version` を記録に残しておく。

---

### 本節のまとめ

TomNomNomのツール群から学ぶべきものは、`anew` や `unfurl` の使い方そのものではない。**偵察を「実行するコマンド」ではなく「保守するデータセット」として設計する**という発想である。

- 単機能ツール × 改行区切りテキスト × パイプ、という組み合わせが、偵察データの性質（フラット・反復・個人差）に構造的に適合している。
- `anew` が持つ「追記器かつ差分検出器」という二面性が、その場限りのスキャンを継続監視へ橋渡しする。
- `meg` の巡回順序と `qsreplace` の正規化が示すように、**対象に優しくすることと効率的であることは、しばしば同じ設計から出てくる**。
- 差分ベースの自動化は静かに壊れる。`set -euo pipefail` と行数ログは飾りではなく必須部品である。

次節以降では、ここで組み上げたパイプラインを常時稼働させ、差分を通知として受け取る継続監視の実装へ進む。
