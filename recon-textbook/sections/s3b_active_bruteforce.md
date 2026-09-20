## active列挙・大規模ブルートフォースとワイルドカード処理

前節までの passive 列挙（証明書透明性ログ、パッシブDNS、各種アグリゲータ）は「誰かが過去に観測した名前」しか返さない。裏返すと、**一度も公開されず・証明書も発行されず・外部から観測されたことのないホスト名**は原理的に出てこない。ここを埋めるのが active 列挙、すなわち「自分で名前を作って、自分でDNSに問い合わせて、存在するかを確かめる」手法である。

> 「passive DNS data doesn't give all the hosts/subdomains associated with our target」——この穴を埋めるためにDNSブルートフォースを行う、というのが sidxparab のガイドの出発点である。
>
> 出典: Subdomain Enumeration Guide — DNS Bruteforcing — https://sidxparab.gitbook.io/subdomain-enumeration-guide/active-enumeration/dns-bruteforcing

本節では、(1) 大量DNS解決がなぜ高速にできるのか、(2) リゾルバリストの品質がなぜ結果の正しさを左右するのか、(3) ワイルドカードDNSがなぜ大量の偽陽性を生み、どういう原理で除去できるのか、の3点を仕組みレベルで押さえる。なお本書は防御・自組織資産把握の目的で書かれている。実在サービスや本番環境への無許可の走査は行わないこと（大量DNSクエリはリゾルバ側・権威側双方への負荷であり、契約や法令に抵触しうる）。

---

### 1. active列挙の全体像：3つのフェーズ

active なサブドメイン発見は、ほぼ例外なく次の3フェーズに分解できる。

| フェーズ | やること | 代表ツール |
|---|---|---|
| 生成 | 候補ホスト名の文字列を作る（ワードリスト連結、permutation） | ワードリスト、`dnsgen` / `gotator` / `alterx` |
| 解決 | 候補を大量にDNS解決する | `massdns`, `puredns`, `shuffledns`, `dnsx` |
| 除去 | ワイルドカード由来の偽陽性・DNS汚染を落とす | `puredns` のワイルドカード検出＋trusted resolver検証 |

初学者がつまずくのは3番目である。1と2だけやると「10万件ヒットしました！」という出力が得られるが、その大半がワイルドカードレコードによる合成応答で、実在するホストは0件、ということが普通に起きる。**active列挙の品質＝偽陽性除去の品質**だと考えてよい。

---

### 2. なぜ「毎秒数千〜数万クエリ」が可能なのか（massdnsの原理）

OSの標準リゾルバAPI（`getaddrinfo(3)`）は、1問い合わせごとに送信→待機→受信を行う同期的なAPIで、並列化にはスレッド/プロセスを増やすしかない。数百万クエリには到底足りない。

massdns はこれを次の設計で突破する。

- **スタブリゾルバを自前実装する**。DNSメッセージ（RFC 1035形式）を自分で組み立て、生のUDPソケットで53番ポートへ送る。名前解決ライブラリを介さないので、1クエリあたりのコストはパケット1個分に落ちる。
- **非同期・ノンブロッキングI/O**。送信と受信を分離し、送りっぱなしにして応答が返ったものから処理する。未応答クエリは「送信済みテーブル（ハッシュマップ）」に保持し、DNSヘッダの16ビットID＋送信元ポート＋質問セクションで突き合わせる。同時未解決数（concurrency）は `-s` で制御する。
- **再帰は他人にやらせる**。massdns自身は再帰解決（ルート→TLD→権威をたどる処理）をしない。`-r resolvers.txt` で与えた**公開リゾルバ群**にRD（Recursion Desired）ビットを立てて投げ、キャッシュと再帰を肩代わりさせる。だからリゾルバの数だけ並列度と分散が稼げる。
- **リゾルバへのラウンドロビン**。クエリごとに宛先リゾルバを変えることで、単一リゾルバのレート制限（1IPあたり毎秒数十〜数百クエリで絞られることが多い）を回避しつつ全体スループットを出す。

典型的な呼び出しはこうなる（puredns は内部でおおよそこの形でmassdnsを起動する）。

```bash
# 候補名を標準入力から流し込み、Aレコードを公開リゾルバ群に問い合わせる
cat candidates.txt | massdns -r resolvers.txt -t A -o S -w massdns.txt
#  -r : リゾルバリスト（1行1 IP）
#  -t : クエリタイプ（A。ワイルドカード判定にもAのIPセットを使う）
#  -o S : simple text 形式（"name. A 1.2.3.4" 等、後段でgrepしやすい）
#  -w : 出力ファイル
```

**なぜ結果が「汚れる」のか**：UDPは再送・順序保証がなく、公開リゾルバ群には壊れた実装・広告挿入・検閲・NXDOMAINハイジャック（存在しない名前に自社の広告サーバIPを返す）を行うものが混ざる。massdns自体はこれを是正しない。だから後段のフィルタが要る。puredns の紹介で「SERVFAIL時に再試行する（most tools don't）」点が評価されるのも、UDP＋公開リゾルバという不安定な土台の上で取りこぼしを減らすためである。

> 出典: Subdomain Enumeration Guide — DNS Bruteforcing — https://sidxparab.gitbook.io/subdomain-enumeration-guide/active-enumeration/dns-bruteforcing

---

### 3. リゾルバリスト：結果の正しさを決める最重要パラメータ

「リゾルバ（resolver）」とは、こちらの問い合わせを受けて再帰的に名前解決を代行し、答えを返すDNSサーバのことである。公開リゾルバ（public resolver）はインターネット上の誰でも使えるもので、数万台が公開されている。

しかし**公開リゾルバの質はバラバラである**。puredns の作者は、検閲を行う国のリゾルバ（例として中国が挙げられている）を避けるよう明示している。理由は直感と逆で重要だ——汚染されたリゾルバは偽の答えを返すだけでなく、**後段の検証で「一致しない」と判定され、本物のサブドメインを取りこぼす（filter out legitimate subdomains）方向にも働く**。ノイズは単に増えるのではなく、真陽性を削る。

対策は2種類のリストを使い分けることである。

- **public resolvers**：大量解決フェーズ用。数千〜数万台。速度と分散のために使う。
- **trusted resolvers**：検証フェーズ用。Google（8.8.8.8 / 8.8.4.4）やCloudflareなど、素性の明らかな少数。puredns のデフォルトのtrustedは `8.8.8.8` と `8.8.4.4` で、作者は「広範なテストの結果この2つが最良だった。変更するなら結果を慎重に検証せよ」と書いている。

リストの入手は2通り。

```bash
# (a) 自分で検証して作る（公開リゾルバの生リストを叩いて、正答するものだけ残す）
dnsvalidator -tL https://public-dns.info/nameservers.txt -threads 100 -o resolvers.txt

# (b) 常時検証されている出来合いのリストを使う
wget https://raw.githubusercontent.com/trickest/resolvers/main/resolvers.txt
```

`dnsvalidator` は、既知のドメインを問い合わせて期待どおりのIPが返るか、存在しない名前にNXDOMAINを返すか（＝NXDOMAINハイジャックをしていないか）を確認して、合格したリゾルバだけを残すツールである。これが「検証済みリゾルバリスト」の基本原理である。

#### trickest/resolvers の作り方（なぜ信頼できるのか）

trickest/resolvers は「最も網羅的な、信頼できるDNSリゾルバのリスト」を標榜し、CIワークフローが**常時（constantly）走り続けて**更新される。提供物は3種類。

| ファイル | 内容 | 用途 |
|---|---|---|
| `resolvers.txt` | IPアドレスのみ、1行1件 | ツールに直接食わせる大量解決用 |
| `resolvers-extended.txt` | 組織名・国・検証に通った回数などのメタ情報付き | 国や組織でフィルタしたいとき |
| `resolvers-trusted.txt` | Cloudflare / Google など素性の明らかな組織のものを厳選 | 結果の検証（比較基準）用 |

検証パイプラインは概ね次の多段構成である。

1. 10種類ほどのソース（公開DNSリスト、コミュニティ提供リスト等）を集約
2. 重複排除
3. `dnsvalidator` を複数インスタンス並列で走らせて検証
4. **2周目の検証**を回して偽陽性（たまたま一度だけ通ったもの）を落とす
5. APNIC の whois API で各IPの所有組織を引き当て、メタ情報を付与
6. 全サイクルを通じた「検証通過回数」を記録

ポイントは4と6である。DNSリゾルバは瞬間的な負荷や経路障害で一時的に応答しないことがあるため、**単発の検証は偽陽性・偽陰性の両方を生む**。複数回の検証と通過回数の記録により、「安定して正しく答えるリゾルバ」を統計的に選別できる。extended 版の回数を閾値でフィルタして自前の高品質リストを作る、という運用が可能になっているのはこのためだ。

> 出典: Trickest resolvers — https://github.com/trickest/resolvers

**運用上の注意（2026年時点）**：この手のリストは日々中身が入れ替わる。数か月前にダウンロードした `resolvers.txt` を使い回すと、死んだリゾルバへの送信が増えてタイムアウト待ちでスループットが落ち、かつ取りこぼしが増える。**実行の都度取り直す**のが原則である。

---

### 4. puredns：3ステップのパイプライン

puredns（d3mondev、Go製、現行は v2 系。ビルドに Go 1.19 以降が必要）は、「massdns で速く引く」ことと「結果を信用しない」ことを1本のパイプラインにまとめたツールである。自己紹介はこうだ——*"resolve thousands of DNS queries per second using massdns and a list of public DNS resolvers"*、そのうえで**ワイルドカード由来の偽陽性とDNS汚染を除去する**。

#### インストール

```bash
# 前提: massdns バイナリ
git clone https://github.com/blechschmidt/massdns.git
cd massdns && make && sudo make install

# puredns 本体
go install github.com/d3mondev/puredns/v2@latest
```

#### 処理の3ステップ（README の "How it works"）

1. **Mass resolve using public DNS servers**
   候補ドメインを標準入力経由で massdns に流し込み、公開リゾルバ群で一括解決する。既定では入力を**小文字化し、`[a-z0-9.-]` の文字だけを許容するサニタイズ**を行う（`--skip-sanitize` で無効化可能）。
   *なぜサニタイズするのか*：ワードリストやpermutationツールの出力には、制御文字・全角・`_`・先頭末尾のハイフンなど、DNSの慣用的な文字集合から外れたものが混ざる。これをそのまま massdns に渡すとパースエラーやクエリの無駄撃ちになる。なお `_` はDNSプロトコル上は合法（`_dmarc` など）なので、サービスレコード類を狙う場合はサニタイズの挙動に注意が必要である。

2. **Wildcard detection**
   ステップ1の massdns 出力を**DNSキャッシュとして再利用**し、クエリ数を最小化しながらワイルドカードのルート（`*.store.example.com` のような catch-all の根っこ）を特定し、そこから合成された偽エントリを落とす。必要に応じてキャッシュの内容を trusted resolver で裏取りする。`--skip-wildcard` で省略可。

3. **Validation**
   残った結果を、**trusted resolvers（既定 8.8.8.8 / 8.8.4.4）で引き直す**。公開リゾルバのDNS汚染（poisoning）や誤答で混入した名前をここで落とす。trusted 側のレート制限に当たらないよう、**意図的に低速**で実行される（`--rate-limit-trusted` で調整）。`--skip-validation` で省略可。

この「速い経路で広く集め、遅い経路で狭く確かめる」という二層構造が puredns の設計思想である。速度と正確性はトレードオフだが、対象を段階的に絞ることで両立させている。

#### 基本コマンド

```bash
# サブドメインのブルートフォース（ワードリスト × 対象ドメイン）
puredns bruteforce wordlist.txt example.com -r resolvers.txt -w output.txt

# 複数ドメインを対象に
puredns bruteforce all.txt -d domains.txt

# 既存の名前リストをただ解決する（permutationツールの出力を検証する用途）
puredns resolve domains.txt
cat domains.txt | puredns resolve
cat domains.txt | puredns resolve -q | httprobe   # -q は結果のみ出力（パイプ用）

# 3種の成果物を全部残す
puredns resolve domains.txt --write valid_domains.txt \
                            --write-wildcards wildcards.txt \
                            --write-massdns massdns.txt
```

`--write-massdns` の生出力を残すのは実務上とても重要だ。A レコードだけでなく **CNAME の連鎖**が入っているため、後からサブドメインテイクオーバー候補（CNAME先が失効ドメイン）や、共通の外部SaaSにぶら下がっている資産の棚卸しに使い回せる。同じ走査を二度やらないで済む＝相手への負荷も減る。

#### リゾルバの探索順とフラグ

puredns はリゾルバを次の順で探す。明示指定がなければ (1)(2) が public、(3) が trusted として扱われる。

1. カレントディレクトリの `resolvers.txt`
2. `~/.config/puredns/resolvers.txt`
3. `~/.config/puredns/resolvers-trusted.txt`

| フラグ | 既定 | 意味・使いどころ |
|---|---|---|
| `-r`, `--resolvers` | 上記探索順 | 大量解決用の公開リゾルバリスト |
| `--resolvers-trusted` | 8.8.8.8, 8.8.4.4 | 検証用の信頼リゾルバ |
| `-w`, `--write` | — | 有効ドメインの出力先 |
| `--write-wildcards` | — | 検出したワイルドカードのルートを出力 |
| `--write-massdns` | — | massdns の生出力（A/CNAME）を保存 |
| `-q` | off | 結果のみ標準出力（パイプライン用） |
| `--wildcard-tests` | 3 | ワイルドカード判定に投げるクエリ数 |
| `--wildcard-batch` | — | ワイルドカード検出をバッチ処理（メモリ対策） |
| `--rate-limit-trusted` | — | trusted リゾルバへの送信レート |
| `-l` | — | 公開リゾルバへの全体レート制限（毎秒クエリ数） |
| `--skip-sanitize` / `--skip-wildcard` / `--skip-validation` | off | 各ステップの省略 |
| `--bin` | PATH上のmassdns | massdns バイナリの場所を明示 |

> 出典: puredns (d3mondev) — https://github.com/d3mondev/puredns

---

### 5. ワイルドカードDNSの原理（ここが本節の核心）

#### 5.1 プロトコル上、何が起きているのか

ワイルドカードレコードとは、「存在しない名前への問い合わせにマッチする」レコードである。ゾーンファイルにこう書く。

```zone
; example.com. のゾーン（説明用の架空ゾーン）
example.com.        300 IN A     203.0.113.10
www.example.com.    300 IN A     203.0.113.10
*.example.com.      300 IN A     203.0.113.99      ; ← ワイルドカード
shop.example.com.   300 IN A     203.0.113.20
```

RFC 1034 / RFC 4592 が定める権威サーバの挙動はこうだ。問い合わせ名に**完全一致するノードが無い**場合、権威サーバはその名前の「closest encloser（最も近い先祖ノード）」を求め、その直下にワイルドカードラベル `*` があれば、**問い合わせ名そのものを所有者名として持つレコードを合成して（synthesized answer）**返す。応答コードは NXDOMAIN ではなく **NOERROR**、ANSWER セクションにレコードが1件入る。

結果として起きることが、ブルートフォースにとって致命的である。

```text
$ dig +short kljhsdf87q3rjkhsdf.example.com   →  203.0.113.99
$ dig +short totally-made-up-name.example.com →  203.0.113.99
$ dig +short admin.example.com                →  203.0.113.99
```

**どんなデタラメな名前もIPを返す**。つまり「解決できた＝存在する」という前提が崩れ、ワードリスト100万行なら100万件がヒットする。上の例で `admin.example.com` は実在しないのに、実在するように見える。これが偽陽性の正体だ。

押さえるべき細部が4つある。

1. **NXDOMAIN と NODATA の違い**。`*.example.com. IN A` しか無いゾーンに `AAAA` を問い合わせると、NOERROR かつ ANSWER 0件（NODATA）が返る。「Aは合成されるがAAAAは空」という挙動は、判定ロジックがクエリタイプを固定していないとブレる。だから多くのツールは A に固定して比較する。
2. **ワイルドカードは1ラベルだけにマッチするのではない**。`*.example.com` は、途中に実ノードが存在しない限り `a.b.c.example.com` のような深い名前にもマッチする（closest encloser が `example.com` のままだから）。一方、`shop.example.com` という実ノードがある場合、`x.shop.example.com` の closest encloser は `shop.example.com` になるため、`*.example.com` は**マッチしない**（`*.shop.example.com` が別途無ければ NXDOMAIN）。この非対称性が、後述の「ボトムアップ探索」が必要な理由である。
3. **ワイルドカードは任意の階層に置ける**。`*.example.com` が無くても `*.store.example.com` や `*.dev.eu.example.com` だけ存在する、という構成は普通にある。したがって「ルートドメインでランダム名を1回試してワイルドカードなし」と判定するのは誤りで、**各階層ごとに判定**しなければならない。puredns が `--write-wildcards` で出力するのが `*.store.yahoo.com` のような**ワイルドカードの「ルート」**であるのはこのためだ。
4. **CNAME ワイルドカードとロードバランシング**。`*.example.com. IN CNAME lb.cdn.example.net.` のような構成では、返るIPはCDNのGeoDNS/ラウンドロビンにより**問い合わせごとに変わる**。単純な「IPが同じなら偽陽性」判定はここで破綻する。

#### 5.2 素朴な検出法とその破れ方

多くのツールが最初に実装する素朴な方法はこうだ。

```bash
# 素朴なワイルドカード判定（不十分な例）
dig +short $(head -c 16 /dev/urandom | xxd -p).example.com
# → IPが返ればワイルドカードあり、NXDOMAINならなし
```

これが破れるケースを整理する。

- **ロードバランシング**：ランダム名が毎回違うIPを返すため、「ワイルドカードのIP集合」が1回の観測では確定しない。puredns の FAQ は *"I've seen domains with a lot of balancing take more than 50 queries to return results"* と述べ、`--wildcard-tests 50` のように**試行回数を増やす**ことを推奨している（既定は3）。原理的には、ランダム名を n 回引いて得たIPの和集合を「ワイルドカードIP集合」とみなす。n が小さいと集合が小さすぎ、本物の結果を誤って残す／逆に偽物を残すことになる。
- **多階層ワイルドカード**：ルートだけ見てもダメ。名前を右から左へ一段ずつ削りながら、各階層で判定する必要がある。
- **実ノードの陰に隠れた名前**：`*.example.com` がある環境でも、`www.example.com` のような**実在するレコード**は合成ではなく本物の応答である。ワイルドカードIPと**たまたま同じIP**を返す実ノード（例：同一のリバースプロキシに全部載っている構成）を機械的に捨てると、真陽性を失う。ここは原理的に曖昧で、A/CNAMEの一致だけでは判別できない場合がある（後続のHTTPレイヤの調査に回すのが実務的）。

#### 5.3 puredns のアプローチ

README が述べる要点は短いが本質的だ。「ワイルドカード検出アルゴリズムが massdns の結果ファイルから**すべてのワイルドカードサブドメインのルートを抽出**する。その際、**ステップ1のmassdns出力をDNSキャッシュとして使い、追加で投げるクエリ数を最小化する**。必要な場合はキャッシュの内容を trusted resolver で検証する」。

なぜこれが効くのかを分解すると：

- 100万件のブルートフォース結果に対して、ヒットした名前ごとに毎回ランダム名テストを投げていたら、クエリ数が数倍に膨れ上がる。しかし**ヒットした名前群の親階層は高々数百〜数千種類**しかない。だから「ワイルドカードのルート候補」の単位で判定すれば、追加クエリは劇的に減る。
- さらに、判定に必要な「この名前はどのIPを返したか」という情報は、**すでにステップ1の出力に入っている**。これをインメモリのキャッシュとして引けば、多くの照合はネットワークに出ずに済む。裏取りが必要な箇所だけ trusted resolver に投げる（公開リゾルバで裏取りすると、汚染された答えで判定がブレるため）。
- 判定結果は最終的に**ワイルドカードのルートの集合**として表現され、そのルート配下でIP集合が一致する名前は偽陽性として落とされる。`--write-wildcards` に出てくるのがこの集合である。

概念を擬似コードで示す（実装そのものではなく、上記の説明から導かれる動作モデル）。

```text
# 入力: massdns の結果 R（name → {A/CNAMEの集合}）
cache ← R                                # 追加クエリを減らすためのDNSキャッシュ
wildcard_roots ← {}

for name in R:
    # 右から左へ、親を一段ずつ辿る（ボトムアップ）
    for parent in ancestors(name):       # a.b.example.com → b.example.com → example.com
        if parent already classified: continue
        ips ← {}
        repeat wildcard_tests times:     # 既定3、LBが強ければ50+
            ips ∪= lookup(random_label + "." + parent, via=cache or trusted)
        if ips ≠ ∅:
            wildcard_roots += parent
            wildcard_ips[parent] ← ips   # 合成応答のIP集合

# 偽陽性除去
for name in R:
    root ← nearest wildcard root above name
    if root exists and ips(name) ⊆ wildcard_ips[root]:
        drop name                        # ワイルドカードで合成された可能性が高い
```

**ここで理解しておくべきトレードオフ**：`⊆` 判定は保守的にも攻撃的にもできる。集合が完全一致したときだけ落とせば取りこぼしは減るが偽陽性が残り、部分一致で落とせば逆になる。`--wildcard-tests` を増やすことは `wildcard_ips` の集合を実態に近づける行為であり、LBの効いたゾーンで判定が安定する理由はここにある。puredns の CHANGELOG でも「ワイルドカード判定ロジックの偽陽性修正」が繰り返し入っており、**この部分は本質的に発見的（ヒューリスティック）**であることを意識しておきたい。

#### 5.4 NXDOMAIN なのに CNAME がある——テイクオーバーの種

puredns の FAQ に「なぜ全部のドメインがIPに解決されないのか」という項がある。答えは *"Sometimes, those NXDOMAIN answers have valid CNAME records that point to expired domains"* ——**NXDOMAINの応答の中に、失効ドメインを指すCNAMEが残っている**ことがある、というものだ。

```bash
dig @8.8.8.8 CNAME sub.example.com
# 応答が NXDOMAIN でも、ANSWER セクションに CNAME が入っていることがある
```

原理はこうだ。`sub.example.com. IN CNAME bucket.example-cloud.net.` というレコードが自ゾーンに存在し、CNAME先の `example-cloud.net` 側でその名前が消えている場合、リゾルバはCNAMEを辿った先で NXDOMAIN を得る。最終的なRCODEは NXDOMAIN だが、**辿った途中のCNAMEはANSWERに含まれる**。これが「dangling CNAME」で、サブドメインテイクオーバー（指し先のリソースを第三者が取得して、正規ドメイン上でコンテンツを配信できてしまう）の典型的な前兆である。

防御側の運用としては、**自組織のゾーンに対して定期的にCNAMEの指し先が生きているかを検査する**（自ゾーンなので正当な検査である）のが正解で、`--write-massdns` の生出力はまさにその入力になる。

> 出典: puredns (d3mondev) — https://github.com/d3mondev/puredns

---

### 6. ワードリスト：規模の選択とその根拠

生成フェーズの質は、最終的な発見数を線形以上に左右する。ガイドが挙げる主要なリストは次の通り。

| ワードリスト | 規模 | 出自・性格 |
|---|---|---|
| Assetnote `best-dns-wordlist.txt` | 約900万行 | 実測データ由来。「最良のサブドメインブルートフォース用」と紹介される。VPS向け |
| n0kovo `n0kovo_subdomains_huge.txt` | 約300万行 | **TLS証明書のスキャン結果から構築**（実在した名前の分布を反映） |
| six2dez の小型リスト | 約10.2万行 | 個人PCでも回せる規模 |
| jhaddix `all.txt` | 約200万行 | 古典。puredns のREADMEからもリンクされている |

*なぜ「証明書から作ったリスト」が強いのか*：ランダムな英単語より、**人間が実際に付けた名前**のほうが当たる。TLS証明書のCN/SANは公開されており、そこに現れるラベル（`api`, `stg2`, `vpn-tokyo`, `k8s-prod` など）を頻度順に並べれば、現実の命名慣習の分布そのものになる。これは統計的な事前分布を使った探索であり、辞書攻撃一般と同じ原理である。

**実務上の階層戦略**：

1. まず10万行級で回し、ヒット傾向（命名規則、環境接尾辞、番号付け）を観察する
2. 観察結果から対象特化の語彙を作る（`-dev`, `-stg`, `jp-`, `v2` など）
3. そのうえで数百万行級を回す。ただし**時間・帯域・相手側負荷が跳ね上がる**ことを理解して、必要性を正当化できるときだけ
4. 発見した二段目のドメイン（`dev.example.com`）に対して、同じワードリストを再帰的に適用する（ワイルドカード判定も階層ごとにやり直す必要がある）

なお permutation（`dnsgen` / `gotator` / `alterx` などで既知の名前から変形を大量生成する手法）は、生成フェーズの別技法として次節で扱う。生成された候補の**検証**はここで述べたのと同じパイプライン（`puredns resolve`）に乗せるのが定石である。

> 出典: Subdomain Enumeration Guide — DNS Bruteforcing — https://sidxparab.gitbook.io/subdomain-enumeration-guide/active-enumeration/dns-bruteforcing

---

### 7. 運用：メモリ・帯域・レート制限

大規模ブルートフォースは、失敗のほとんどが「対象の問題」ではなく「自分の環境の問題」で起きる。

#### メモリ枯渇

puredns はワイルドカード検出のために**DNS応答のキャッシュをメモリに保持する**（第5.3節参照）。数億件を一度に食わせるとOOMで落ちる。対策はバッチ化。

```bash
puredns bruteforce huge-wordlist.txt example.com --wildcard-batch 1000000
```

目安は **RAM 1GBあたり100万〜200万サブドメイン**。低スペックVPSでクラッシュする場合はまずこのフラグを疑う。バッチを分けると、バッチ境界をまたぐワイルドカード判定の情報が共有されないぶん精度が若干落ちうるので、可能なら実メモリを増やすほうがよい。

#### 帯域とレート制限

```bash
puredns bruteforce wordlist.txt example.com -l 5000          # 公開リゾルバ全体で毎秒5000クエリ
puredns resolve domains.txt --rate-limit-trusted 100          # trusted側は低速に
```

ガイドは毎秒2,000〜10,000程度を目安として挙げている。**なぜ絞るのか**を理解しておくこと。

- DNSクエリは小さいが、毎秒1万クエリは概ね数Mbpsのパケットレートになり、家庭回線やVPSの pps 上限、NAT/ステートフルFWのセッションテーブルを先に壊す（UDPの「疑似セッション」が数万並ぶ）
- ISPやVPS事業者がDNS増幅攻撃と誤認して遮断することがある
- 相手の権威DNSサーバに対する実質的な負荷になる。**許可された範囲でのみ、かつ控えめに**が原則

#### 重複とスコープ外

puredns は**重複を除去しない**。入力は `sort -u` で整えること。また、壊れた公開リゾルバが無関係なドメインを返すことがあり、ツール側はそれをフィルタしない。出力を**自分のスコープ（対象ドメインのサフィックス）でgrepし直す**のは利用者の責任である。

```bash
sort -u candidates.txt -o candidates.txt
puredns resolve candidates.txt -q | grep -E '\.example\.com$' | sort -u > in-scope.txt
```

---

### 8. 代替ツールと使い分け

| ツール | 位置づけ |
|---|---|
| `massdns` | 土台。速いが偽陽性除去をしない。自前でフィルタを書くなら直接使う |
| `puredns` | massdns + ワイルドカード検出 + trusted検証。**正確性重視の既定選択** |
| `shuffledns` (ProjectDiscovery) | massdns のGoラッパー。ワイルドカード除去あり。PD系のパイプライン（`subfinder | shuffledns | httpx`）に馴染む |
| `dnsx` (ProjectDiscovery) | 純Go実装のリゾルバ。massdns不要で導入が楽、A/CNAME/PTR等の多様なクエリやワイルドカードフィルタに対応。単体の巨大ブルートフォースより「既知リストの解決とレコード取得」に向く |

選択基準はシンプルで、**ワイルドカード除去の実装をどれだけ信用できるか**と**既存パイプラインとの相性**である。どれを使うにせよ、出力を鵜呑みにせず「ワイルドカードのルートを別ファイルに書き出して目視する」習慣を持つこと。

---

### 9. 防御側の視点：この手法から何を守るか

本節の内容は、攻撃手法であると同時に**自組織の外部露出を測る道具**でもある。防御担当が取るべき対応：

1. **自ゾーンに対する定期的なインベントリ化**。攻撃者が使うのと同じワードリストとツールを自分のゾーンに対して回し、「外部のDNSから見える名前」の一覧を作る。これは自社資産に対する正当な検査であり、最も費用対効果が高い。
2. **ワイルドカードレコードの是非を設計として決める**。ワイルドカードは攻撃者のブルートフォースを妨害する副作用がある一方、**任意の名前がサービスに到達する**ことを意味する。ホスト名ベースの仮想ホスト設定ミス（デフォルトvhostに落ちる）や、不要な内部サービスの露出、ホストヘッダ依存の脆弱性の温床になる。置くなら「その配下のアプリが未知のホスト名を受け取ったとき何を返すか」まで設計すること。
3. **dangling CNAME の監視**。CNAME先のリソース（クラウドのバケット、SaaSのテナント、旧CDN）が解約された瞬間にテイクオーバー可能になる。**リソース解約とDNSレコード削除をセットの手順にする**、そして定期検査で検出する。
4. **内部名を外部DNSに置かない**。`jenkins-internal.example.com` のような名前は、たとえプライベートIPを返していても、攻撃者に内部構成を教える。split-horizon DNS か内部専用ゾーンを使う。
5. **検知**。権威DNSのクエリログで、**NXDOMAIN率の急増**と**単位時間あたりのユニークQNAME数の急増**はブルートフォースの明確なシグナルである（第5.1節のとおり、ワイルドカードがあるゾーンではNXDOMAINが出ないので、代わりに「合成応答の件数」を見る）。ただし攻撃者は数千の公開リゾルバ経由で分散して来るため、**送信元IPでのレート制限はほぼ効かない**——見えるのはリゾルバのIPであって攻撃者のIPではない。QNAME側の異常検知に寄せるのが現実解である。
6. **証明書の発行方針**。TLS証明書のSANに内部名やステージング名を入れると、CTログ経由で恒久的に公開される（passive列挙の入力になる）。ワイルドカード証明書を使うか、内部名には内部CAを使う。

---

### 10. チェックリスト（まとめ）

- [ ] 対象は**許可された自組織資産または明示的に許可されたスコープ**か
- [ ] `resolvers.txt` は**今日取り直した**ものか（trickest/resolvers 等）
- [ ] 検閲国・不審なリゾルバを含んでいないか（取りこぼしの原因になる）
- [ ] trusted resolver は分離されているか（既定 8.8.8.8 / 8.8.4.4）
- [ ] 入力は `sort -u` 済みか（puredns は重複を除去しない）
- [ ] ワイルドカード判定は階層ごとに行われているか。`--write-wildcards` の中身を目視したか
- [ ] LBの強いゾーンで `--wildcard-tests` を上げたか（既定3 → 必要なら50+）
- [ ] メモリに対してバッチサイズは適切か（1GBあたり100万〜200万目安）
- [ ] レート制限をかけたか（目安 毎秒2,000〜10,000、相手と自分の回線の両方を守る）
- [ ] `--write-massdns` の生出力を保存したか（CNAME解析・再走査の回避のため）
- [ ] 出力をスコープのサフィックスでフィルタしたか

> 出典（本節全体）:
> - Subdomain Enumeration Guide — DNS Bruteforcing — https://sidxparab.gitbook.io/subdomain-enumeration-guide/active-enumeration/dns-bruteforcing
> - puredns (d3mondev) — https://github.com/d3mondev/puredns
> - Trickest resolvers — https://github.com/trickest/resolvers
