# 第4章 自動化基盤の構築


## nuclei入門：YAMLベース脆弱性スキャナの基礎

### この章で学ぶこと

バグバウンティやセキュリティ診断を「自動化基盤」に載せるとき、真っ先に検討すべきツールが **nuclei** です。nucleiは、ProjectDiscoveryが開発したオープンソースの脆弱性スキャナで、検出ロジックをYAML形式の「テンプレート」として定義し、そのテンプレートに従ってリクエストを送信し、レスポンスをパターンマッチングして脆弱性・構成ミス・機微情報の露出などを検出します。単発のスキャナとして使うだけでなく、「一度見つけた脆弱性パターンをテンプレート化し、数千のターゲットに再現性高く展開する」という発想がnucleiの核心であり、この再利用性こそが自動化基盤における価値の源泉です。

本節では、nucleiの内部の仕組み、基本的な使い方、テンプレートのYAML構造、マッチャー（matcher, レスポンスが条件を満たすかを判定する仕組み）とエクストラクター（extractor, レスポンスから値を抜き出して後続処理に渡す仕組み）の書き方を、原典のコード例を引用しながら解説します。次節以降で扱うカスタムテンプレート実践やOOB（Out-of-Band, 即時応答のない盲目的な検出手法）連携の土台となる内容です。

### nucleiとは何か、なぜ強力なのか

nucleiは「fast, template based vulnerability scanner」として公式に説明されており、以下の特徴を持ちます。

- シンプルなYAML形式で検出シナリオ（テンプレート）を記述・共有できる
- 世界中のセキュリティ専門家が数千のテンプレートをコミュニティに提供している（`nuclei-templates`リポジトリ）
- 誤検知（false positive）を減らすための「実世界を模したリクエスト」の送信機構を持つ
- 高速な並列スキャンが可能で、大規模なターゲット群への一括適用に向く
- CI/CDパイプラインに組み込んで継続的にスキャンできる

> 出典: ProjectDiscovery nuclei GitHub本体 — https://github.com/projectdiscovery/nuclei

重要なのは、nucleiが「汎用的な脆弱性判定AI」ではなく、**あくまでテンプレートに書かれたリクエストとマッチ条件を機械的に実行するだけのエンジン**だという点です。検出力はテンプレートの質に比例します。既製のテンプレート集をそのまま流すだけでは「よくある構成ミス・既知CVE」しか拾えず、逆にいえば、カスタムテンプレートを書ける人がnucleiの真価を引き出せます（この点は次項で詳述します）。

### インストールと基本コマンド

nucleiはGo言語製のCLIツールで、Go 1.24.2以上の環境であれば以下でインストールできます（2026年時点の公式リポジトリの記載に基づく。Goのバージョン要件はリリースごとに引き上げられるため、実行時は必ず公式READMEの最新要件を確認してください）。

```bash
go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest
```

`v3`というメジャーバージョンがパスに含まれていることに注意してください。nucleiはv2からv3への移行でテンプレート構文やDSL(Domain Specific Language, テンプレート内で条件式を書くための専用のミニ言語)の一部仕様が変わっており、古い記事のテンプレート例がそのまま動かないことがあります。本節のコード例はv3系のドキュメント・ブログ記事から採取したものです。

基本的な実行例は次の通りです。

```bash
# 単一ターゲットのスキャン
nuclei -target https://example.com

# 複数ターゲット(リスト)のスキャン
nuclei -list urls.txt

# ネットワーク(CIDR)全体のスキャン
nuclei -target 192.168.1.0/24

# 自作テンプレートを指定して実行
nuclei -u https://example.com -t /path/to/your-template.yaml
```

> 出典: ProjectDiscovery nuclei GitHub本体 — https://github.com/projectdiscovery/nuclei

**なぜ`-list`のような一括指定が重要か**: nucleiの設計思想は「1つのテンプレートを大量のターゲットに適用する」ことにあります。個々のURLに対して手動でリクエストを送るのではなく、ターゲットリストとテンプレート(またはテンプレート集)の直積(デカルト積)を高並列に処理するアーキテクチャになっているため、スコープ内資産が多いプログラムほど効果を発揮します。ただし、この特性は裏を返せば「無許可の大量スキャン」を極めて容易にしてしまうため、実行前に必ずスコープ内資産であることを確認し、対象プログラムのレート制限・スキャン許可ポリシーに従う必要があります。許可のない本番環境や第三者サービスへの一括スキャンは行ってはいけません。

nucleiが対応するプロトコル(検出対象の通信方式)は、HTTP、DNS、TCP、SSL/TLS、WHOIS、WebSocket、さらにJavaScript実行やヘッドレスブラウザ(headless)、コード実行(code)ベースの検出まで多岐にわたります。これにより、単純なHTTPレスポンス検査だけでなく、DNSレコードの誤設定検査やTLS証明書の問題、SPA(シングルページアプリケーション)上でのみ発火するクライアントサイドの問題まで、幅広い検出シナリオを1つのエンジンで扱えます。

### テンプレートの最小構造

nucleiテンプレートは、次の4要素を骨格として持ちます。

> "Templates need to contain some essential information that can be summarized as: Template id, Template info, What data to send to the remote host, Instructions on how to analyze the response"

つまり「①テンプレートの識別子、②メタ情報、③何を送るか、④応答をどう判定するか」の4点です。最小限の実例として、公開されている`.htpasswd`ファイル露出を検出するテンプレートを見てみます。

```yaml
id: htpasswd

info:
  name: Detect exposed .htpasswd files
  author: geeknik
  severity: info
  tags: config,exposure

requests:
  - method: GET
    path:
      - "{{BaseURL}}/.htpasswd"

    matchers-condition: and
    matchers:
      - type: word
        words:
          - ":{SHA}"
          - ":$apr1$"
          - ":$2y$"
        condition: or

      - type: status
        status:
          - 200
```

> 出典: The Ultimate Guide to Finding Bugs With Nuclei — https://projectdiscovery.io/blog/ultimate-nuclei-guide

このテンプレートの動きを仕組みレベルで分解すると次のようになります。

- `id`: テンプレート同士を一意に識別するキー。スキャン結果のレポートやワークフローからの参照に使われるため、スペースを含まない短い英数字が推奨されます。
- `info`: 人間向けのメタデータ。`severity`(深刻度: info/low/medium/high/critical)は後述するレポーティングやトリアージの優先順位付けに直結し、`tags`は大量のテンプレートから特定カテゴリ(例: `exposure`, `cve`, `misconfig`)だけを`-tags`オプションで絞り込む際のフィルタキーになります。
- `requests`: 実際に送信するHTTPリクエストの定義。`{{BaseURL}}`はテンプレートエンジンが実行時にターゲットのベースURLへ置換する変数(プレースホルダ)です。これにより1つのテンプレートを任意のターゲットに使い回せます。
- `matchers`: レスポンスに対する判定条件。`matchers-condition: and`は「複数あるmatchersブロックを全てANDで満たす必要がある」ことを示し、この例では「`.htpasswd`特有のハッシュ形式の文字列が本文に含まれる」かつ「ステータスコードが200」の両方が真のときのみ検出成立とします。`type: word`のmatcher内部では`condition: or`が指定されており、3つの文字列パターンのうちいずれか1つが一致すればこのmatcherブロック自体はtrueになります。

**なぜこの二段階の条件(matchers内はOR、matchers間はAND)が重要か**: `.htpasswd`ファイルは存在してもコンテンツが空だったり、Webサーバがカスタム404ページを返すのにステータスが200になる、といった誤検知源が多数あります。「ファイルらしき内容が含まれる」ことと「HTTPステータスが正常応答である」ことの両方を要求することで、単純な文字列一致だけよりも誤検知率を大きく下げられます。これは「実世界を模したリクエストとマッチ条件で誤検知を最小化する」というnucleiの設計思想そのものの具体例です。

### matcherの種類とDSL

nucleiのmatcherにはいくつかの型があり、単純な文字列一致から複雑な論理式まで表現できます。

```yaml
matchers:
  - type: word
    words:
      - 'User-agent:'
      - 'Disallow:'
  - type: dsl
    dsl:
      - "len(body)>=140 && status_code==200"
```

> 出典: Bugcrowd "The Ultimate Beginner's Guide to Nuclei" — https://www.bugcrowd.com/blog/the-ultimate-beginners-guide-to-nuclei/

主なmatcherタイプは次の通りです。

| type | 判定内容 |
|---|---|
| `status` | HTTPステータスコードの一致 |
| `word` | 本文やヘッダ中の特定文字列の有無 |
| `regex` | 正規表現によるパターン一致 |
| `dsl` | DSL式による動的・複合条件の評価 |
| `xpath` | HTML/XML構造からの要素抽出・一致判定 |

このうち`dsl`は特に強力です。DSLはnuclei独自の軽量な式言語で、`len(body) > 109`のような長さ比較や、`contains(body,'MM Wiki Version')`のような文字列包含判定、論理演算子(`&&`, `||`)を組み合わせられます。**なぜDSLが必要か**: word matcherやregex matcherは「単一の条件」を表現するのに向きますが、「本文が140文字以上、かつステータスが200」のような複合条件や、後述する複数リクエストにまたがる条件(`body_1`, `body_5`のようにリクエスト番号でレスポンスを参照する)を表現するには、より柔軟な式評価エンジンが必要になります。DSLはこの隙間を埋めるための仕組みです。

### extractorによる値の抽出と再利用

多くの脆弱性検出は「1回のリクエストで完結しない」ことがあります。例えばCSRFトークンを取得してからログインし、ログイン後のセッションで初めて到達できるエンドポイントを叩く、といった多段階の検証が必要な場合です。nucleiはこれを`extractors`と`internal: true`の組み合わせで実現します。

```yaml
extractors:
  - type: regex
    name: csrftoken
    part: body
    internal: true  # 後続リクエストで使用
    group: 1
    regex:
      - 'csrftoken" value="([a-f0-9]{10})'
```

抽出した値は、後続のリクエストブロック内で`{{csrftoken}}`のように変数として参照できます。

```yaml
- |
  POST {{Path}}/backup_db.php HTTP/1.1
  Host: {{Hostname}}
  Content-Type: application/x-www-form-urlencoded

  backup_name=test&csrftoken={{csrftoken}}
```

> 出典: The Ultimate Guide to Finding Bugs With Nuclei — https://projectdiscovery.io/blog/ultimate-nuclei-guide

**仕組みとしてのポイント**: `internal: true`が指定されたextractorは、スキャン結果として画面に表示されるのではなく、テンプレート実行エンジン内部の変数プールに格納されるだけになります。これにより、「レスポンス本文から正規表現でCSRFトークンを抜き出し、次のリクエストのボディに埋め込む」という、通常はブラウザやスクリプトで手動実装するようなステートフルな処理を、YAML定義だけで表現できます。`xpath`型のextractorも同様の目的で使え、HTMLのDOM構造をXPathで指定して特定要素の属性値(`attribute: value`)を取り出せます。

### マルチステップ検証テンプレートの実例

CSRFトークンの抽出と複数リクエストの連鎖を組み合わせた、より実践的な例として、認証付きRCE(Remote Code Execution, リモートからの任意コード実行)を検出するテンプレートが公開されています。

```yaml
id: mmwiki-rce

info:
    name: MM Wiki DB Backup Remote Code Execution
    author: me
    severity: critical
    description: Detect MM Wiki database backup RCE vulnerability

requests:
  - raw:
    - |
      GET {{Path}} HTTP/1.1
      Host: {{Hostname}}

    - |
      POST {{Path}}/register.php HTTP/1.1
      Host: {{Hostname}}
      Content-Type: application/x-www-form-urlencoded

      username=65aca3e27440558a&password=65aca3e27440558a

    - |
      POST {{Path}}/login.php HTTP/1.1
      Host: {{Hostname}}
      Content-Type: application/x-www-form-urlencoded

      username=65aca3e27440558a&password=65aca3e27440558a

    - |
      GET {{Path}}/backup_db.php HTTP/1.1
      Host: {{Hostname}}

    - |
      POST {{Path}}/backup_db.php HTTP/1.1
      Host: {{Hostname}}
      Content-Type: application/x-www-form-urlencoded

      backup_name=test123456&submit=Create+Backup&csrftoken={{csrftoken}}

    redirects: true
    cookie-reuse: true
    extractors:
      - type: regex
        name: csrftoken
        part: body
        internal: true
        group: 1
        regex:
          - 'csrftoken" value="([a-f0-9]{10})'
    req-condition: true
    matchers:
      - type: dsl
        dsl:
          - "contains(body_1,'MM Wiki Version')"
          - "contains(body_5,'downloadbackup.php?f=dbbackup-')"
        condition: and
```

> 出典: The Ultimate Guide to Finding Bugs With Nuclei — https://projectdiscovery.io/blog/ultimate-nuclei-guide

このテンプレートで押さえておくべき仕組みは3点です。

1. **`raw`モードによるリクエスト連鎖**: `method`/`path`形式ではなく、生のHTTPリクエスト文字列をそのまま複数個並べることで、レジスタ登録→ログイン→バックアップ機能へのアクセス、という一連の操作フローを1テンプレート内で表現しています。`cookie-reuse: true`により、1つ目のリクエストで発行されたSet-Cookieが後続リクエストに自動的に引き継がれ、ブラウザのセッション挙動を模倣します。
2. **`req-condition: true`とインデックス付き変数**: 通常のmatcherは最後のレスポンスだけを見ますが、`req-condition: true`を指定すると、DSL式の中で`body_1`(1番目のリクエストのレスポンス本文)、`body_5`(5番目のリクエストのレスポンス本文)のように、リクエスト単位でレスポンスを参照できるようになります。「複数のリクエスト/レスポンスにまたがる条件を論理式として組み合わせられる」という原文の説明の通り、これによって「最初のレスポンスにアプリケーション固有の文字列が含まれ、かつ最後のレスポンスにバックアップファイルへのリンクが含まれる」という、多段階の証跡を1つの判定式にまとめられます。
3. **クリティカルな重要度の妥当性**: `severity: critical`は、この検出が単なる情報露出ではなく実際のコード実行につながることを示しています。severityの選定はテンプレート作成者の裁量に委ねられますが、実際の影響(この場合はRCE)と釣り合った深刻度を設定することが、後段のトリアージ・レポーティングの精度に直結します。

なお、このような多段階の認証・登録処理を伴うテンプレートを実際のスコープ内資産に対して実行する際は、テスト用アカウントの作成やバックアップファイルの生成など、対象システムに副作用を及ぼす操作が含まれる可能性があるため、プログラムの許可範囲とルール・オブ・エンゲージメント(ROE)を必ず確認してから実行してください。許可のない環境に対してこの種の破壊的・副作用のあるリクエストを送ってはいけません。

### ファジングとペイロード注入

nucleiは固定のリクエストを送るだけでなく、ワードリストを使ったファジング(fuzzing, 多数の入力パターンを機械的に試す手法)にも対応しています。

```yaml
id: my-test-nuclei-template

info:
    name: X Debug header fuzzing
    author: me
    severity: info

requests:
  - raw:
      - |
        GET / HTTP/1.1
        Host: {{Hostname}}
        x-{{fuzz}}-debug: 1

    payloads:
        fuzz: /var/tmp/fuzz.txt
    attack: batteringram
    redirects: true
    stop-at-first-match: false
    matchers:
      - type: dsl
        dsl:
          - "len(body) > 109"
```

> 出典: The Ultimate Guide to Finding Bugs With Nuclei — https://projectdiscovery.io/blog/ultimate-nuclei-guide

`payloads`で指定したワードリストファイルの各行が`{{fuzz}}`という変数に順次代入され、リクエストが繰り返し送信されます。`attack`キーは複数のペイロード変数がある場合の組み合わせ方を制御するモードで、次の3種類があります。

- **batteringram**: 1つのペイロードリストを、テンプレート内のすべての注入ポイントに同時に適用する
- **pitchfork**: 複数のペイロードリストを、同じインデックス同士で並列に1行ずつ組み合わせる
- **clusterbomb**: 複数のペイロードリストの全組み合わせ(直積)を総当たりで試す

**なぜモード選択が重要か**: `clusterbomb`は網羅性が高い一方でリクエスト数が組み合わせ爆発的に増え、対象サーバへの負荷やレート制限抵触のリスクが高まります。逆に`pitchfork`はリクエスト数を抑えつつ、あらかじめ関連付けられたペイロードの組(例: ユーザー名とパスワードのペア)を効率よく試せます。テンプレート設計時には、検出したい脆弱性の性質とターゲットへの負荷のバランスを見て攻撃モードを選ぶ必要があります。

### ワークフローによる条件分岐スキャン

単一テンプレートだけでなく、複数テンプレートを条件分岐でつなげる「workflows」という仕組みもあります。

```yaml
workflows:
  - template: technologies/tech-detect.yaml
    matchers:
      - name: wordpress
        subtemplates:
          - template: cves/CVE-2019-6715.yaml
          - template: cves/CVE-2019-9978.yaml
          - tags: wordpress
```

> 出典: The Ultimate Guide to Finding Bugs With Nuclei — https://projectdiscovery.io/blog/ultimate-nuclei-guide

これは「まず技術スタック検出テンプレートを実行し、対象がWordPressだと判定された場合にのみ、WordPress固有のCVEテンプレート群を追加実行する」というフィンガープリンティング駆動のスキャン戦略です。**なぜこれが効率的か**: すべてのターゲットに全テンプレートを無差別に投げるのではなく、まず軽量な技術検出で対象の性質を絞り込み、該当する場合にのみ重いテンプレート群を実行することで、無駄なリクエスト数を削減し、スキャン全体の実行時間と対象への負荷を抑えられます。これは自動化基盤を大規模運用する上で欠かせない考え方です。

### Interactshによるblind脆弱性検出

即座にレスポンスへ結果が現れないタイプの脆弱性(blind SQLインジェクション、blind SSRF、非同期のコマンドインジェクションなど)は、通常のmatcherだけでは検出できません。nucleiはProjectDiscoveryが提供するOOB(Out-of-Band)インタラクション追跡サービス「Interactsh」と統合されており、外部からのDNS/HTTPコールバックを検出トリガーに使えます。

```yaml
- |
  POST {{Path}}/backup_db.php HTTP/1.1
  Host: {{Hostname}}
  Content-Type: application/x-www-form-urlencoded

  backup_name=test;curl+{{interactsh-url}};echo&csrftoken={{csrftoken}}

matchers:
  - type: word
    part: interactsh_protocol
    words:
      - "http"
```

> 出典: The Ultimate Guide to Finding Bugs With Nuclei — https://projectdiscovery.io/blog/ultimate-nuclei-guide

**仕組み**: `{{interactsh-url}}`はテンプレート実行時に、nucleiが自動生成する一意なInteractshドメイン(例: `abc123.oast.pro`のような形式)に置換されます。このペイロードがターゲットのサーバサイドで実行され(この例では`curl`コマンドとしてOSコマンドインジェクションが成立した場合)、対象サーバから当該ドメインへDNSクエリまたはHTTPリクエストが飛べば、Interactshのリスナーがそれを捕捉します。matcher側では`part: interactsh_protocol`を指定し、実際にどのプロトコル(http/dns)でコールバックが観測されたかを判定条件にすることで、「レスポンス本文には何も現れないが、確かにサーバサイドでコマンドが実行された」ことを間接的に証明できます。

Bugcrowdの解説記事も同様に、Interactshとの統合によって「即座のレスポンスがない脆弱性」の発見が可能になる点を強調しており、blind SQLインジェクションやDNS exfiltration(データのDNSクエリ経由での外部送出)の検出にこの仕組みが使われるとしています。

> 出典: Bugcrowd "The Ultimate Beginner's Guide to Nuclei" — https://www.bugcrowd.com/blog/the-ultimate-beginners-guide-to-nuclei/

この種のOOBペイロードを含むテンプレートは、対象システムに実際のコマンド実行を引き起こす可能性があるため、スコープ内であっても本番データの破壊や意図しない副作用を招かないよう、ペイロードの内容(`echo`で即座に無害化する、書き込み系コマンドを避けるなど)を慎重に設計する必要があります。許可のない対象や、影響範囲が読めないペイロードを本番環境に投げてはいけません。

### テンプレートのデバッグとバリデーション

自作テンプレートは、実際にスキャンへ投入する前に構文検証しておくべきです。

```bash
# YAML構文とスキーマの妥当性チェック
nuclei -validate -t my-template.yaml

# 実際の送受信内容を確認しながらデバッグ実行
nuclei -u target.site -t my-template.yaml -debug
```

> 出典: The Ultimate Guide to Finding Bugs With Nuclei — https://projectdiscovery.io/blog/ultimate-nuclei-guide

`-debug`オプションは送信した生リクエストと受信した生レスポンスを標準出力に表示するため、matcherが意図通りに一致しない場合の原因切り分け(正規表現のエスケープミス、`part`の指定間違い、ヘッダの大文字小文字の違いなど)に必須のワークフローです。テンプレート開発は「書いて即座に大量スキャンに投入する」のではなく、まず単一の検証済みターゲット(自分の管理下にあるラボ環境や、許可を得た検証環境)に対して`-debug`付きで動作確認し、`-validate`で構文エラーがないことを確認してから、スコープ内資産への本番スキャンに移行するという段階的な手順を踏むべきです。

### まとめ

nucleiは「YAMLで検出ロジックを記述し、大規模ターゲット群に再現性高く適用する」ことを目的としたスキャンエンジンです。本節で見たように、テンプレートは`id`/`info`/`requests`/`matchers`という最小骨格の上に、`extractors`による値の抽出・再利用、`req-condition`による複数リクエストの複合判定、`payloads`によるファジング、`workflows`による条件分岐、Interactshによるblind検出という機能を積み重ねることで、単純な既知パターン検出から、認証を伴う多段階の脆弱性検証まで表現できます。既製のコミュニティテンプレート集をそのまま流すだけでは得られない検出力は、こうしたカスタムテンプレートの設計能力から生まれます。次節では、このテンプレート機構を使って実際に自動化パイプラインへ組み込み、継続的な資産監視・差分検知の仕組みを構築する方法を扱います。

## カスタムnucleiテンプレートの設計（matcher/extractor/protocol）

前節では自動化基盤の全体像を扱った。本節はその中核部品である **nuclei** のカスタムテンプレート設計に踏み込む。nuclei は ProjectDiscovery が開発する脆弱性スキャナで、検査ロジックを YAML ファイル（＝テンプレート）として外部化しているのが最大の特徴だ。公式リポジトリには数千の既製テンプレートが同梱されているが、本節の主張は明快である。**「自分の観測結果を再利用可能なテンプレートに落とし込めるかどうか」が、単発のバグ発見者と、攻撃対象領域全体を継続監視できるハンターとを分ける**。

読者はすでに `nuclei -t` でスキャンを回す使い方は既知の水準にあるはずなので、本節は操作方法ではなく「テンプレートをどう設計すれば誤検知（false positive）を出さず、かつ自分の資産だけに効く検査を組めるか」という設計判断に焦点を当てる。

### なぜ既製テンプレートだけでは足りないのか

ProjectDiscovery のブログ記事は、タイトルからして「カスタムテンプレートを書かないなら損している」と断言している。その論拠を整理すると次の通りだ。

第一に、公開されている既製テンプレートは **全世界のハンターが同じものを回している**。人気プログラムに対しては、新しい CVE テンプレートが公開された瞬間に数百人が同時にスキャンを投げる。既製テンプレートで拾える表層的な脆弱性は、報告が重複（duplicate）扱いになりやすく、報奨金に結びつかない。差別化の源泉は「他人が持っていない検査ロジック」にある。

第二に、テンプレートは単なる CVE スキャナではなく、**自分の偵察・検証・回帰テストの各工程を自動化する汎用フレームワーク**として機能する。記事は用途を6つ挙げている。

1. **ターゲット特化スキャン（Targeted Scanning）**: 特定の技術スタックにだけ関連テンプレート群を当てる。
2. **カスタムレポーティング**: 検出結果を GitHub Issue などへ自動起票する。
3. **進化する脅威への追随**: 公開されたばかりの CVE を、公式テンプレートが整備される前に自作して先回りする。
4. **PoC（Proof of Concept）開発**: race condition のような込み入った検証をテンプレート化する。
5. **脆弱性の再検査（Retesting）**: 過去に見つけた脆弱性が本当に修正されたかを再確認する。
6. **回帰テスト（Regression Testing）**: CI/CD パイプラインに組み込み、新ビルドで既知の欠陥が再発していないかを毎回チェックする。

記事が示す最小のテンプレートは次の通りで、これが全ての土台になる。

```yaml
id: git-config

info:
  name: Git Config File
  author: Ice3man
  severity: medium
  description: Searches for the pattern /.git/config on passed URLs.

http:
  - method: GET
    path:
      - "{{BaseURL}}/.git/config"
    matchers:
      - type: word
        words:
          - "[core]"
```

このテンプレートは `{{BaseURL}}/.git/config` に GET を投げ、レスポンス本文に `[core]` という文字列（Git の設定ファイル冒頭に必ず現れるセクション名）があれば検出とみなす。ここで押さえるべき原理は、**nuclei のテンプレートは「リクエストを送る（protocol）」→「レスポンスの何を見るか（matcher）」→「そこから何を取り出すか（extractor）」という3層で構成される**という点だ。以降の各節はこの3層をそれぞれ深掘りする。

> 出典: If you're not writing custom Nuclei templates, you're missing out — https://projectdiscovery.io/blog/if-youre-not-writing-custom-nuclei-templates-youre-missing-out

### テンプレートの骨格（structure）と info ブロック

公式ドキュメントによれば、テンプレートは次の要素で構成される。

- **id**: テンプレートの一意な識別子。出力時のテンプレート名に使われるため、**スペースを含めてはならない**（出力パースを壊すため）。最大125文字。
- **info ブロック**: メタデータ。`name`（説明的な名前）、`author`、`severity`（重大度）、`description`、`reference`（外部資料へのリンク）、`tags`（`cve,rce` などの分類タグ）を含む。
- **protocol ブロック**: `http` / `dns` / `network` / `file` などプロトコル種別ごとのリクエスト定義。
- **matchers / extractors**: リクエスト定義の内側に置く判定・抽出ロジック。

info ブロックの実例は次の通り。

```yaml
info:
  name: Git Config File Detection Template
  author: Ice3man
  severity: medium
  description: Searches for the pattern /.git/config on passed URLs.
  reference: https://www.acunetix.com/vulnerabilities/web/git-repository-found/
  tags: git,config
```

ここで `severity` は `critical | high | medium | low | info` の5段階で、CVSS スコアと現実の影響度に基づいて決める。`tags` は後で `nuclei -tags cve,rce` のようにテンプレートを絞り込む際のフィルタキーになるため、`cve,cve2024,rce,apache,struts,ognl,kev` のように **年・脆弱性種別・ベンダ・コンポーネントを網羅的に**付けておくと後の運用が楽になる。

#### metadata による外部データベース連携

info の中にはさらに `metadata` を置ける。ここに検索エンジンのフィンガープリント（指紋クエリ）を書くと、Uncover などのツールと連携して「そもそも脆弱な製品が動いているホスト」を先に列挙できる。

```yaml
info:
  metadata:
    shodan-query: 'vuln:CVE-2021-26855'
```

`<engine>-query: '<query>'` という形式で、`shodan-query` / `fofa-query` などが使える。これは攻撃対象領域の絞り込みに直結する重要フィールドだが、本教科書のスコープ制約（防御目的・無許可検証の禁止）に従い、実運用では**自分に検証権限のある資産に対してのみ**用いること。

> 出典: Nuclei Template Structure（公式 docs）— https://docs.projectdiscovery.io/templates/structure

### 誤検知ゼロを狙う matcher 設計

matcher（マッチャー：レスポンスのどこを見て「検出」と判断するかの条件）は、テンプレートの品質を決める最重要部分だ。公式の作成ガイドは **「低〜ゼロ誤検知」** を繰り返し強調しており、その具体的な手法を整理する。

#### matcher の種類

| type | 用途 |
|------|------|
| `word` | 本文・ヘッダ内の**完全一致文字列**を探す。最も高速。 |
| `regex` | 正規表現によるパターン検出（バージョン範囲、例外メッセージなど）。 |
| `status` | HTTP ステータスコードの一致（例: 200）。 |
| `size` | レスポンスサイズの一致。 |
| `binary` | バイナリ列（16進）の一致。 |
| `dsl` | `status_code == 200 && contains(body, "...")` のような**複合条件式**。 |

#### 単一マッチャーが誤検知を生む理由

作成ガイドは「`error`・`admin`・`login` のような一般的な語を本文全体に対して単独マッチさせると、無害なシステムまで引っかかる」と明言している。理由は仕組みレベルで理解できる。Web アプリのレスポンス本文には、フレームワーク由来の汎用的なエラーページ、ナビゲーションメニューの「Admin」リンク、ログインフォームなどが**脆弱かどうかに関係なく**現れる。単一の緩い文字列一致は、こうしたノイズと本物の脆弱性の区別がつかない。

#### 多層検証（multi-layer verification）という原則

ガイドが推奨する誤検知回避の中核は、**3層の確認を `matchers-condition: and` で束ねる**ことだ。

1. **アプリ識別**: 対象が本当にその製品を動かしているか（バージョン文字列やバナーで確認）。
2. **バージョン検出**: regex で**脆弱なバージョン範囲**にだけマッチさせる（全バージョンが脆弱と仮定しない）。
3. **悪用の証明**: 実際に脆弱性が発火した証拠（一意なマーカー、特定の例外文字列など）を確認する。

`matchers-condition` には `and`（全マッチャーが真で検出）と `or`（いずれか1つで検出）がある。誤検知を抑えるなら基本は `and` だ。記事が引用する CVE-2023-32315（Openfire 管理コンソール認証バイパス）のテンプレートがこの思想を体現している。

```yaml
id: CVE-2023-32315

info:
  name: Administration Console Authentication Bypass in Openfire Console
  author: vsh00t
  severity: high

http:
  - raw:
      - |+
        GET /setup/setup-s/%u002e%u002e/%u002e%u002e/log.jsp HTTP/1.1
        Host: {{Hostname}}
        Origin: {{BaseURL}}
    unsafe: true
    matchers-condition: and
    matchers:
      - type: word
        part: body
        words:
          - "apache"
          - "java"
          - "openfire"
          - "jivesoftware"
        condition: and
      - type: status
        status:
          - 200
```

このテンプレートの設計を分解する。まず `part: body` は「本文を見る」という指定（`header` / `all` も指定可）。次に `words` に4語を並べ、`condition: and` を付けているため、**4語すべてが本文に含まれて初めて**この word マッチャーが真になる。さらに外側の `matchers-condition: and` により、word マッチャーと status マッチャー（200）の両方が真でなければ検出しない。つまり「本文に Openfire 特有の4語が揃い」かつ「ステータスが200」という二重の条件で、他製品や汎用エラーページを排除している。`apache`・`java`・`openfire`・`jivesoftware` という語群は、この製品のログ画面にしか同時には現れないため、識別子として機能する。

`raw:` は生の HTTP リクエストをそのまま書く記法で、パス中の `%u002e%u002e`（`..` のUnicodeエンコードによるパストラバーサルでWAF回避を狙う表現）のように、通常の `path:` では表現しづらい細工リクエストを送るときに使う。`unsafe: true` は Go 標準の HTTP クライアントによる正規化を回避し、書いたバイト列をそのまま送るための指定である。

#### negative matcher と internal matcher

`negative: true` を付けると「その条件が**偽**のとき検出」という反転になる。例えば「パッチ済みなら現れる文字列が**無い**ことを確認する」といった用途に使える。また `internal: true` を付けたマッチャーは出力には出さず、後続リクエストの条件分岐（多段テンプレート）にだけ使う内部フラグとして機能する。

#### 誤検知対策のチェックリスト

ガイドが挙げる検証項目を要約する。

- 脆弱なインスタンスで確かに検出できる。
- パッチ済みバージョンで誤検知しない。
- 類似の別ベンダ製品で誤検知しない。
- 汎用エラーページで発火しない。
- `nuclei -validate -t template.yaml` で YAML 構文が通る。
- **ハニーポット耐性**: わざと脆弱に見せかける罠に引っかからない matcher 設計にする。

> 出典: Nuclei Templates — TEMPLATE-CREATION-GUIDE.md（公式）— https://github.com/projectdiscovery/nuclei-templates/blob/main/TEMPLATE-CREATION-GUIDE.md

### extractor による証拠抽出と多段連携

extractor（エクストラクタ：レスポンスから特定のデータを取り出す仕組み）は、matcher が「検出した／しない」を返すのに対し、「**具体的に何が返ってきたか**」を抜き出す。バージョン番号、トークン、内部 IP などを結果に残せるため、報告書の証拠（PoC）として、また多段テンプレートでの値の受け渡しとして重要だ。

```yaml
extractors:
  - type: regex
    name: version
    regex:
      - 'Version: ([0-9\.]+)'
    group: 1
```

この例は本文中の `Version: 1.2.3` のような箇所から、正規表現のキャプチャグループ（`group: 1` は括弧で囲んだ1番目の部分）だけを取り出し、`version` という名前で出力する。extractor の主な種類は以下の通り。

- `regex`: 正規表現による抽出。`group` でキャプチャ位置を指定。
- `kval`: ヘッダやクッキーの `key: value` から値を取り出す（例: `Server` ヘッダ）。
- `json`: JSON レスポンスから JQ 相当の式で抽出。
- `xpath`: HTML/XML から XPath で抽出。
- `dsl`: DSL 式で計算・整形した値を抽出。

extractor に `internal: true` を付けると、**その値を出力せず、同一テンプレート内の後続リクエストへ変数として引き渡せる**。これは多段の検査（例: 1回目でCSRFトークンを抜き、2回目のリクエストに埋め込む）で不可欠だ。抜いた値は後続で `{{変数名}}` として参照できる。この「レスポンスの一部を次のリクエストに動的に注入する」仕組みが、単純なスキャナと nuclei テンプレートを分ける表現力の源泉である。

### protocol ブロックと変数・ペイロード

`http` 以外にも `dns`（DNS レコード検査）、`network`（生 TCP/UDP）、`file`（ローカルファイル走査）、`headless`（ヘッドレスブラウザによる DOM 操作）などのプロトコルが選べる。protocol ブロックの中でリクエストを組み立てる際に使う要素を整理する。

#### 変数（variables）とペイロード（payloads）

```yaml
variables:
  username: "admin"
  payload: "{{rand_base(8)}}"

payloads:
  payload:
    - "1' OR '1'='1"
    - "1' UNION SELECT version()--"
```

`variables` はテンプレート内で固定的に使う値やヘルパー関数（`rand_base(8)` は8文字のランダム英数字を生成）を定義する。`{{rand_base(8)}}` のようなランダムマーカーは RCE 検証の定石で、**「自分が送った一意な文字列がレスポンスに反映されれば、コマンドが実際に実行された証拠になる」**という原理で使う。固定文字列だとキャッシュや偶然の一致で誤検知するが、毎回ランダムなら偶然の一致は事実上起きない。

`payloads` は攻撃ペイロードのリストで、`attack: batteringram/pitchfork/clusterbomb`（Burp Intruder と同じ攻撃モード）と組み合わせて総当たり的に注入できる。

#### 変数展開の仕組み

`{{BaseURL}}`・`{{Hostname}}` などは nuclei が実行時に対象 URL から埋める予約変数だ。`{{BaseURL}}` はスキームからパスまでの完全な URL、`{{Hostname}}` はホスト名（＋ポート）を指す。テンプレートエンジンはリクエスト送信の直前にこれらを文字列置換するため、1つのテンプレートを任意の対象へ使い回せる。

#### stop-at-first-match と self-contained

`stop-at-first-match: true` を付けると、複数パスを列挙している場合に最初に一致した時点でそのテンプレートの実行を打ち切る（無駄なリクエストを減らす最適化）。`self-contained: true` は、対象 URL に依存せず**テンプレート自身が完結して外部ホストにアクセスする**タイプ（例: SSRF 検証で自前のコールバックサーバを叩く）に使う指定である。

> 出典: Nuclei Template Structure（公式 docs）— https://docs.projectdiscovery.io/templates/structure

### ワークフローによるターゲット特化スキャン

個々のテンプレートを賢く連鎖させるのが **workflow**（ワークフロー）だ。記事の例を見る。

```yaml
id: nginx-workflow

info:
  name: Nginx workflow
  author: harsh
  description: A simple workflow that runs all Nginx related nuclei templates on a given target.

workflows:
  - template: http/technologies/nginx/nginx-detect.yaml
    subtemplates:
      - tags: nginx
```

このワークフローは、まず `nginx-detect.yaml` で対象が Nginx かどうかを判定し、**Nginx だと確認できた場合にだけ** `nginx` タグの付いたテンプレート群を実行する。ここが重要な設計判断で、闇雲に全テンプレートを全対象へ投げるのではなく、**「技術スタックを検出 → 該当する検査だけを条件付き実行」**という枝刈りを行う。これにより、リクエスト数を大幅に削減しつつ、対象と無関係なテンプレートによる誤検知やノイズを避けられる。大規模な攻撃対象領域を継続監視する際、この効率化がスキャン全体の実行時間と精度を左右する。

### CVE 先回りと回帰テストへの応用

記事が挙げる用途のうち、日々の運用で効くのが **CVE 先回り**と **回帰テスト**だ。

新しい CVE が公開されると、公式テンプレートが整備されるまでには時間差がある。その間に PoC を読み解いて自作テンプレートを書ければ、他のハンターより早く自分の監視対象へ検査を回せる。記事の race condition テンプレートは、この「PoC のテンプレート化」の好例だ。

```yaml
id: race-condition-testing

info:
  name: Race Condition testing
  author: pdteam
  severity: info

http:
  - raw:
      - |
        POST /coupons HTTP/1.1
        Host: {{Hostname}}
        Pragma: no-cache
        Cache-Control: no-cache, no-transform
        Cookie: user_session=42332423342987567896

        promo_code=20OFF

    race: true
    race_count: 10
    matchers:
      - type: status
        part: header
        status:
          - 200
```

`race: true` と `race_count: 10` は、**同一リクエストを10本、可能な限り同時に投げる**指定だ。仕組みとしては、nuclei がリクエストを事前に組み立てておき、最後の1バイトを保留した状態で10本を待機させ、一斉に送り切ることでサーバ側の「チェックと実行の間の隙間」（TOCTOU: Time-of-check to time-of-use）を突く。クーポン適用のような処理は「残数チェック → 適用」の2段階で、この間に並行リクエストが割り込むと、1回しか使えないはずのクーポンが複数回適用される、といった競合状態が発生しうる。単発リクエストでは再現できないこの種の欠陥を、テンプレート化して再現可能にしている点が肝要だ。

なお本教科書のスコープ制約に従い、上記のような状態を変更しうる（＝破壊的な副作用を持つ）検査は、**自分に明示的な検証権限がある環境に限って**実行すること。本番サービスや無許可の実在サービスへ competitively 投げてはならない。

回帰テストの側面では、`nuclei -validate` で構文検証した自作テンプレート群を CI/CD パイプラインに組み込み、新ビルドのたびに「過去に見つけて修正されたはずの脆弱性」が再発していないかを自動チェックする。これにより、修正の恒久性を機械的に保証できる。

> 出典: If you're not writing custom Nuclei templates, you're missing out — https://projectdiscovery.io/blog/if-youre-not-writing-custom-nuclei-templates-youre-missing-out

### 本節のまとめ

- nuclei テンプレートは **protocol（送る）→ matcher（見る）→ extractor（取り出す）** の3層で理解する。
- 誤検知回避の核心は **`matchers-condition: and` による多層検証**（アプリ識別・バージョン検出・悪用証明）で、汎用語の単一マッチは避ける。
- extractor の `internal: true` と変数展開により、レスポンスの一部を次のリクエストへ動的に渡す多段検査が組める。これが表現力の源泉。
- workflow で「技術検出 → 条件付き実行」の枝刈りを行い、大規模監視の効率と精度を両立させる。
- CVE 先回りと CI/CD 回帰テストにより、テンプレートは単なるスキャナから継続的な資産保護の仕組みへと発展する。
- すべての検査は、検証権限のある自分の資産に限定する（本番・無許可資産への破壊的検査は行わない）。

これらの設計原則を身につければ、既製テンプレートの重複競争から抜け出し、自分の観測を再利用可能な資産として蓄積できるようになる。

## 分散スキャン基盤（axiom）とVPS環境構築

大規模な偵察（recon）やスキャンを自分のノートPC1台で回すと、帯域・CPU・ソースIPのすべてがボトルネックになる。`axiom`は、この問題を「使い捨てのクラウドインスタンス群にスキャンを分散させる」ことで解決するオーケストレーションフレームワークである。本節では、axiomの内部構造（なぜ速いのか、どう壊れにくくしているのか）と、実運用でaxiomを載せるVPSコントローラ環境の作り方を、原典の記述に沿って解説する。

### axiomとは何か

axiom（作者: Ben Bidmead / pry0cc）は「everybody向けの動的インフラストラクチャフレームワーク」を自称するOSSで、nmap・ffuf・masscan・nuclei・meg・Amass・subfinder・nikto・sqlmap・CrackMapExec・wafw00f・httpx・dnsx・aquatone・Corsyなど60種類以上のツールをあらかじめ焼き込んだクラウドイメージ（axiomのビルド用語では「fleet」を構成するインスタンスの元になるスナップショット）を、DigitalOcean・IBM Cloud・Linode・Azure・AWSといった複数のクラウドプロバイダ上に一括で立ち上げ・削除できるようにする（GCPは記事執筆時点で部分実装）。対応OSはUbuntu、Kali、Debian、macOS、Arch Linux、Windows（WSL）。

> ⚠️ **バージョン注記**: axiom公式Wikiは「Axiom Classic」がメンテナンスモードに入り、後継の「Ax Framework」への移行が推奨されていると明記している。本節で説明するコマンド体系（`axiom-fleet`、`axiom-scan`等）はClassic系のものであり、SchneiderSecの記事（後述）が言う「Ax Framework」は同じ思想を引き継いだ後継系統を指す。新規に環境を作る場合は、公式リポジトリのREADMEで現行の推奨系統を必ず確認すること。

axiomが解決する課題は3つに整理できる。

1. **並列度の壁**: 1台のマシンでは、数百万ドメイン規模の名前解決やHTTPプロービングは現実的な時間で終わらない。
2. **ソースIPの偏り**: 単一IPから大量のリクエストを送るとレート制限やブロックに遭いやすい（本節はあくまで許可されたスコープ内での偵察を前提とする）。
3. **環境の使い捨て性**: 調査用のツール群を毎回手動でセットアップするのは非効率であり、スナップショット化して即座に複製・破棄できる方が運用上安全（漏洩時の被害範囲を限定できる）でもある。

> 出典: axiom (pry0cc/axiom) GitHub README — https://github.com/pry0cc/axiom

### 主要コマンド群とアーキテクチャ

axiomは「コントローラ」と呼べる1台のホスト（自分のVPSやローカル機）に`interact/`配下のシェルスクリプト群をインストールし、そこからクラウドAPI経由でインスタンス（axiomは`fleet`という単位でこれをグルーピングする）を操作する構成をとる。コントローラ自身はスキャンを実行しない。あくまで指揮役であり、実際の負荷は使い捨てインスタンス側にかかる。

主なコマンドは次の通り。

| コマンド | 役割 |
|---|---|
| `axiom-configure` | 初回セットアップ。クラウドAPIキー、SSH鍵、デフォルトリージョン等を`axiom.json`に書き込む |
| `axiom-build` | ツール群を積んだベースイメージ（スナップショット）を構築する |
| `axiom-init <name>` | 単一インスタンスを起動する |
| `axiom-fleet <prefix> -i <数>` | 複数インスタンスを一括起動し、`<prefix>01`, `<prefix>02`…と命名してフリートを組む |
| `axiom-scan` | フリートに入力を分割配布し、モジュールで指定されたコマンドを並列実行し、結果をマージする |
| `axiom-exec` | フリート（または単一インスタンス）に任意コマンドを実行する |
| `axiom-ssh` | 指定インスタンスにSSH（または`mosh`）で接続する |
| `axiom-ls` | 稼働中インスタンスやスナップショット一覧を表示する |
| `axiom-rm` | インスタンスを削除する（ワイルドカード指定も可） |
| `axiom-backup` | 稼働中インスタンスの状態をスナップショットとして保存する |

`axiom-init`の主なオプションは `--deploy <profile>`（起動後にプロファイルを適用）、`--region`、`--image`、`--size`（VMサイズ）、`--shell`（起動後すぐ接続）、`--restore <backup>`（過去のバックアップから復元）である。`axiom-fleet`はリージョン分散にも対応しており、たとえば以下のように書くとラウンドロビンで4リージョンに10台を振り分ける。

```bash
axiom-fleet testy -i=10 --regions nyc1,lon1,ams3,fra1
```

**なぜリージョン分散が意味を持つのか**: 単一リージョンに全インスタンスを集中させると、そのリージョンの帯域・出口ゲートウェイに負荷が集中し、また対象側のWAF/CDNが「同一ASN・近いIPレンジからの一斉アクセス」をレート制限・ブロックしやすい。複数リージョン（＝複数のIPレンジ・ASN）に分散させることで、1回のスキャンあたりの実効スループットを安定させられる。

`axiom-exec`には`--tmux <session>`オプションがあり、フリート全体に対して実行したコマンドをtmuxのデタッチ可能なセッションの中で走らせられる。SSH接続が切れても処理が止まらない点が実運用上重要になる（後述のtmux運用とも直結する）。

> 出典: A Quickstart Guide — axiom Wiki — https://github.com/pry0cc/axiom/wiki/A-Quickstart-Guide

### axiom-scanの仕組み: なぜ「600万ドメインを5分」で解けるのか

axiomの心臓部は`axiom-scan`である。公式説明によれば、その処理は次の3段階で構成される。

1. **入力の分割とアップロード**: ユーザーが渡したターゲットリスト（ドメインやURLの一覧ファイル）、ワードリスト、設定ファイルを、稼働中の全インスタンスに分割してアップロードする。たとえば1,000,000行のリストを100インスタンスに配れば、各インスタンスは10,000行だけを処理すればよい。
2. **モジュール定義コマンドの並列実行**: axiomは「モジュール」という仕組みでツールごとの実行コマンドをテンプレート化しており（`axiom-scan`が呼び出すツール名をサブコマンドとして受け取る）、全インスタンスで同一コマンドを同時に走らせる。
3. **結果のダウンロードとマージ**: 各インスタンスが出力したファイルを回収し、1つの結果ファイルに統合する。

この「分割→並列実行→マージ」というモデルにより、理論上の総処理時間は「1台あたりの処理時間 ÷ インスタンス台数」に近づく（ネットワークI/Oやマージのオーバーヘッド分だけ実際は上振れする）。作者のデモ「6 million domains in 5 minutes with 100 instances」は、この分割効果を端的に示す数字であり、単純計算では1台なら500分（約8.3時間）かかる処理を、100台の並列化によって1/100近くまで短縮している。ここで重要なのは、axiom自体が新しいスキャンアルゴリズムを発明しているわけではなく、既存ツール（DNS名前解決なら`dnsx`や`massdns`など）を「横に並べて同時に走らせる配線」を自動化している点である。つまりaxiomの価値は、スキャンロジックそのものよりも、インスタンスのプロビジョニング・入力分割・結果回収という定型作業の自動化にある。

axiom-scanの一般的な呼び出し形は次の形をとる（モジュール名とツール固有オプションを渡す）。

```bash
axiom-scan targets.txt -m nuclei -o results.txt
axiom-scan subdomains.txt -m httpx -silent -o live_hosts.txt
```

**なぜこの書式なのか**: axiomは「入力ファイル」「モジュール名（`-m`）」「出力先（`-o`）」を共通インターフェースとして固定し、モジュール側（`modules/`配下の定義）で実際のツールコマンドやフラグを吸収する設計になっている。これにより、利用者はツールごとの分散実行スクリプトを毎回書く必要がなく、モジュールを切り替えるだけで別ツールを同じ分散基盤に載せ替えられる。新しいツールを対応させたい場合も、モジュール定義を1つ追加すれば済む拡張性を持つ。

> 出典: axiom (pry0cc/axiom) GitHub — 0 Installation / Videos and Write-Ups Wiki — https://github.com/pry0cc/axiom/wiki/0-Installation, https://github.com/pry0cc/axiom/wiki/Videos-and-Write-Ups

### インストールと初期セットアップ

axiom Wikiのインストールページによれば、セットアップ方法は3通りある。

1. **Docker利用**: Ubuntuコンテナ内で設定とビルドを自動実行する。
2. **イージーインストール（推奨）**: 以下のワンライナーで自動セットアップする。
   ```bash
   bash <(curl -s https://raw.githubusercontent.com/pry0cc/axiom/master/interact/axiom-configure)
   ```
3. **手動インストール**: リポジトリをgit cloneし、`axiom-configure`を個別に実行する。

必須の依存関係として、クラウドプロバイダのAPIキー（DigitalOceanなら「Personal Access Token」）、パスフレーズなしを推奨されるSSH鍵ペア、`git`・`curl`・`ruby`・`jq`（1.6系で検証済み）・`packer`（v1.5.6で検証済み）・`doctl`（DigitalOcean CLI）・`Interlace`・`rsync`・`lsb_release`・`fzf`が要求される。

**なぜSSH鍵にパスフレーズを付けないことが推奨されるのか**: `axiom-exec`や`axiom-scan`は多数のインスタンスに対して非対話的にSSH接続を繰り返す。パスフレーズ付きの鍵だと、ssh-agentへの登録が切れた場合に大量の接続がまとめて失敗し、自動化が止まる。運用上の利便性のためにパスフレーズを外す代わりに、鍵そのものの保管（コントローラのディスク暗号化、アクセス権限の限定）を別途強化する必要がある——これは典型的な「利便性とリスクのトレードオフ」であり、コントローラVPSを踏み台にされた場合の被害範囲を広げる要因にもなるため、コントローラのSSH公開鍵認証・ファイアウォール設定は厳格に保つべきである（本書のスコープはあくまで防御目的であり、許可された自分自身の検証環境・スコープ内資産に対してのみaxiomを用いること）。

初期化に失敗した場合の典型的なトラブルシュートとして、`axiom.json`が見つからないときは`axiom-account-setup`を再実行し、ログインエラー時はSSH鍵を`~/.ssh/`配下に正しく配置した上で`axiom.json`内の`sshkey`値を更新し、`axiom-build`でイメージを再構築する、という手順がWikiに記載されている。

> 出典: 0 Installation — axiom Wiki — https://github.com/pry0cc/axiom/wiki/0-Installation

### コミュニティのユースケース（Videos and Write-Ups）

axiom公式Wikiの「Videos and Write-Ups」ページは、作者自身や利用者が公開した実践例へのリンク集であり、axiomがどのような文脈で使われているかの実例集として有用である。代表的なものを挙げる。

- **NahamCon 2021 – Introduction to Axiom: The Dynamic Infrastructure Framework**（pry0cc, NahamSec）: axiomの設計思想の紹介。
- **Live Recon and Distributed Recon Automation Using Axiom with @pry0cc**（NahamSec × pry0cc の配信）: axiomの安定性向上の優先度や、今後の拡張方針として「ワードリストのシャーディング（分割配布）」が議論されている。具体的には、単一ホストに対して複数インスタンスから`ffuf`を分担実行するために、DNSレコード列挙のようなワードリストベースの処理を複数ボックスに分割する仕組みや、マルチリージョン・マルチクラウドでのフリート展開によるカバレッジ拡大が検討課題として挙げられていた（2021年4月28日公開）。
- **Axiom Demo – Resolving 6 million domains in 5 minutes with 100 instances**（pry0cc）: 前述の並列化効果を示すデモ。
- **Distributed Bug Bounty Hunting using Axiom / How to run subfinder with Axiom**（PhilippeDelteil, Medium）: `subfinder`をaxiom経由で分散実行する具体的な手順を扱う実践記事。
- **Mass Hunting for Misconfigured S3 Buckets**（ott3rly, infosecwriteups「The Power of AXIOM」シリーズPart 5）: axiomで集めたドメイン群から誤設定S3バケットを大量検出する応用例。
- **Using Axiom to Send Burp Suite Requests to Alternating Proxies**（james1052）: axiomのインスタンス群をBurp Suiteの上流プロキシとして輪番で使う手法。

これらの実例に共通するのは、axiom自体は「並列実行の配線」に徹し、実際の探索ロジック（サブドメイン列挙、S3バケット探索、プロキシ振り分けなど）は既存ツールやユーザー独自のスクリプトに委ねている点である。axiomの学習効率を上げる近道は、まず小規模なフリート（2〜3台）で単一モジュール（例: `httpx`）を回し、分割・マージの挙動を体感してから、モジュールの自作やマルチリージョン化に進むことである。

> ⚠️ **未取得の資料の補足**: 「Live Recon and Distributed Recon Automation Using Axiom」（YouTube, pry0cc × NahamSec）は動画の字幕・書き起こしを自動取得できませんでした（動画ページの本文にトランスクリプトが埋め込まれておらず、YouTube側の制約により本文抽出ができなかったため）。詳細は動画そのものをご覧ください: https://www.youtube.com/watch?v=tWml8Dy5RyM
> （以下は未取得資料の補足として一般知識に基づく解説です）配信内で言及されている「ワードリストのシャーディング」は、axiom-scanの入力分割の考え方を、DNSブルートフォースのような「1ターゲットに対して大量のワードリストを当てる」処理にも拡張しようという発想である。通常のaxiom-scanはターゲットリスト（行数）を分割するが、単一ターゲットに対する大量ワードリスト（例えばサブドメイン辞書数百万行）を複数インスタンスに分割して同時に投げれば、1ホストへのブルートフォースも並列化できる。ただし1つのターゲットに複数インスタンスから同時にリクエストが飛ぶ設計になるため、対象のレート制限・WAFにより敏感に配慮する必要がある。

> 出典: Videos and Write-Ups — axiom Wiki — https://github.com/pry0cc/axiom/wiki/Videos-and-Write-Ups

### VPSコントローラの構築（SchneiderSec「2026 Bug Bounty Setup」より）

axiomを走らせるコントローラ（＝インスタンス群を統括する母艦）自体も、クラウドVPS上に置くのが一般的である。SchneiderSecのブログ記事「2026 Bug Bounty Setup: Setting Up A Solid Foundation」は、この土台作りを扱っている。記事自身が明記する通り、この記事は「数回スキャンを回せば脆弱性が全部見つかる魔法の手順」ではなく、継続的な運用に耐える環境構築の共有である。

**VPSを使う理由**として、記事は次を挙げている。

- 自宅IPをターゲット側にブラックリストされるリスクを避けられる（IP保護）。
- どこからでもリモートアクセスできる。
- フリート構成により並列処理ができる。
- SSRFやOOB（Out-of-Band）検出用のコールバック受け口として使える。
- 速度面で自宅回線より有利。

**推奨スペック**は「最低4GB RAM、80GBディスク」。プロバイダ比較として次の数値が挙げられている。

| プロバイダ | 月額 | CPU種別 | vCPU | RAM | ディスク | 転送量 |
|---|---|---|---|---|---|---|
| DigitalOcean | $24.00 | 共有 | 2 | 4GB | 80GB | 4TB |
| Hetzner US CCX13 | $19.99 | 専有 | 2 | 8GB | 80GB | 変動 |
| Hetzner EU CCX13 | $18.49 | 専有 | 2 | 8GB | 80GB | 20TB |
| Hetzner US CPX31 | $24.99 | 共有 | 4 | 8GB | 160GB | 変動 |

記事は「CCX13はDigitalOceanと同程度以下の価格で2倍のRAMと専有CPU（dedicated CPU）が得られる」としてHetznerを推奨している。**なぜ専有CPUが重要なのか**: DigitalOceanの共有CPUプランは、同一物理ホスト上の他テナントとCPUリソースを取り合う（ノイジーネイバー問題）。axiomのようにフリート全体で大量の並列スキャンを回すワークロードは瞬間的にCPUを使い切るため、専有CPUの方がスループットが安定しやすい。

**SSH設定**（`~/.ssh/config`）の例として次が示されている。

```
Host droplet
        HostName <VPS IP>
        User <username>
        IdentityFile ~/.ssh/droplet_key
        IdentitiesOnly yes
```

`IdentitiesOnly yes`は、ssh-agentに登録された他の鍵を自動的に試させず、指定した`IdentityFile`だけを使わせる設定である。**なぜ必要か**: 複数の鍵をエージェントに登録していると、SSHサーバー側の`MaxAuthTries`（試行回数上限）を無駄に消費し、認証失敗としてログに残ったり、意図しない鍵で接続を試みてしまう。ポートフォワーディング（`LocalForward`）や接続の使い回し（`ControlMaster`）を追加すると、SSHトンネル経由でのローカルツール（Burpなど）連携や、接続の張り直しコストの削減ができる。

**tmux設定**（`.tmux.conf`）は次の通り。

```
setw -g mouse on
set -sg escape-time 500
set -g terminal-overrides ',*:smcup@:rmcup@'
```

- `setw -g mouse on`: マウスでのペイン切り替え・スクロールを有効化する。
- `set -sg escape-time 500`: Escキー入力後の待機時間を500msに延長する。デフォルトの短い待機時間だと、SSH越しの高レイテンシ環境でVim等のエスケープシーケンスが誤検出されることがあるため、この値を伸ばして安定させる。
- `terminal-overrides ',*:smcup@:rmcup@'`: 代替スクリーンバッファへの切り替え制御を無効化し、tmux終了後にターミナルの表示内容（スクロールバック）が消えずに残るようにする。

基本操作は `Ctrl+b c`（新規ウィンドウ）、`Ctrl+b n`/`Ctrl+b p`（次/前のウィンドウ）、`Ctrl+b d`（デタッチ）、再接続は`tmux -a`（attach）である。**なぜコントローラ運用にtmuxが必須なのか**: axiomの`axiom-fleet`や`axiom-scan`は数百万件規模の入力を処理するため実行時間が長くなりやすい。SSHセッションを閉じた瞬間にフォアグラウンドプロセスが`SIGHUP`で強制終了する仕組み上、tmux（またはscreen、`axiom-exec --tmux`）でセッションをデタッチ可能な状態にしておかないと、接続が切れるたびにスキャンが失われる。

**Ax Framework（axiom）**については、記事は「公式インストールガイドに従い、VPSコントローラ上でイージーインストールを使う」ことを推奨するのみで、具体的なコマンドの再掲はしていない（前述の`axiom-configure`ワンライナーが該当する）。

**Claude CodeなどAIツールの活用**については、記事は「ゲームチェンジャー」と位置づけつつ、具体的な運用フロー（プロンプト設計、自動化パイプラインへの組み込み方など）は「別記事で扱う」として詳細を保留している。現時点で読み取れるのは、コントローラVPS上にAIコーディングエージェントを導入し、収集した偵察データの一次トリアージや、スキャン結果からの脆弱性候補の絞り込みといった定型作業を支援させる方向性が想定されているという位置づけに留まる。

> ⚠️ **未取得の資料の補足**: SchneiderSecの記事のうち、Ax FrameworkのインストールコマンドおよびClaude Code連携の具体的手順は、記事本文に「詳細は別記事で扱う」として明記されておらず、自動取得でも本文中に見つかりませんでした。最新の手順は記事本体を直接ご参照ください: https://schneidersec.com/blog/2026-bug-bounty-setup-setting-up-a-solid-foundation/

> 出典: 2026 Bug Bounty Setup: Setting Up A Solid Foundation — SchneiderSec — https://schneidersec.com/blog/2026-bug-bounty-setup-setting-up-a-solid-foundation/

### 運用上の注意点とスコープ制約

分散スキャン基盤は強力であるがゆえに、誤用すれば許可されていない対象への意図しない負荷や、契約範囲外のIPレンジへのスキャンを引き起こしかねない。実運用では以下を徹底する。

- **スコープファイルの一元管理**: `axiom-scan`に渡すターゲットリストは、プログラムのスコープ定義（許可ドメイン・除外ドメイン）と機械的に突合してから使う。手作業でのコピペは対象外ドメインの混入事故につながる。
- **レート制御**: フリートの台数を増やすほど対象への同時接続数も増える。対象のインフラに配慮し、モジュール側のレート制限オプション（各ツールの`-rate`や`-c`相当）を必ず設定する。
- **クラウド破棄の徹底**: `axiom-rm`でスキャン後のインスタンスを速やかに削除し、収集データを積んだままのインスタンスを放置しない。放置されたインスタンスは攻撃対象として狙われるリスクや、クラウド破損時にデータが露出するリスクを生む。
- **クレデンシャル管理**: `axiom.json`やクラウドAPIキーはコントローラのローカルにしか存在しないよう、リポジトリやログへのコミットを避ける。

本節はあくまで防御・許可された検証の効率化を目的とした基盤構築の解説であり、実在サービスへの無許可スキャンやスコープ外資産への攻撃的検証を推奨するものではない。axiomの分散能力は、許可されたペネトレーションテストやバグバウンティプログラムのスコープ内で、偵察のスループットを上げるためにのみ用いるべきである。

## 継続監視・差分検知・通知パイプライン：出力でなく発見を生む自動化

自動化は「たくさんスキャンして大量の行を出力すること」だと誤解されがちだ。しかし出力（output）は成果ではない。成果とは**発見（finding）** — 「昨日まで存在しなかった攻撃面が今日出現した」「他の誰もまだ気づいていない構成が見えた」という、行動につながる情報だ。本節では、出力を垂れ流すだけの自動化と、発見を生む自動化の違いを、原理レベルとツール実装レベルの両方から解説する。中心となる部品は3つ — (1) 資産の**継続監視（continuous monitoring）**、(2) 前回結果との**差分検知（diff detection）**、(3) 差分だけを人間に届ける**通知パイプライン（notification pipeline）** である。

対象は防御・許可された自身の資産の監視を前提とする。実在サービスへの無許可検証や破壊的手順は本節では扱わない。ここで示すパイプラインは、自分が正当に権限を持つ資産（自社ドメイン、自分がスコープ内と確認済みのバグバウンティ対象）を対象に運用することを前提に読んでほしい。

### なぜ「reconの自動化」の大半は無意味なのか

2026年時点で、ほとんどのハンターのツールキットは似通っている。`subfinder` でサブドメインを列挙し、`httpx` で生存確認し、`nuclei` のテンプレートを流し、cron で回す。一見立派だが、この構成には致命的な欠陥がある — **一度きりの全量スキャンを繰り返しているだけ**で、「前と何が変わったか」を一切見ていない点だ。

> ⚠️ **未取得の資料**: 「Everyone Is Automating Bug Bounty Recon in 2026, Almost Nobody Is Automating the Right Things」(R.H Rizvi, Medium, 2026-06-11) は自動取得できませんでした（理由: Medium が HTTP 403 を返しブロック。ミラー(freedium)も DNS 解決不能）。以下のURLからご自身で直接ご覧ください: https://medium.com/@R.H_Rizvi/everyone-is-automating-bug-bounty-recon-in-2026-almost-nobody-is-automating-the-right-things-feafb1b500f2

検索経由で確認できた記事の主張の核は以下である。

- 本当のボトルネックは**ツールの速度ではなく、「どこを見るか」と「見たときに何を認識できるか」**だった。より速いスキャナを買っても、見る場所と読解力が同じなら成果は増えない。
- 標準的な recon パイプライン（subfinder → httpx → nuclei → cron）は、そのままでは「低い果実（low-hanging CVE）」しか拾えない。しかもその CVE は、3週間前に他の自動スキャナがすでに拾って報告済みだ。つまり**遅れて同じものを見つける機械**にしかなっていない。
- 「正しく自動化すべきもの」として記事が挙げるのは、(a) **新規サブドメインの監視**（一度の列挙ではなく、時系列で「今日新しく現れたホスト」を検出する）、(b) **差分アラート**（前回との差分だけを通知する）、(c) **fingerprint 駆動の優先順位付け**（検出した技術スタック・バージョン・構成に基づいて、どこを先に調べるかを機械が並べ替える）である。

> （以下は未取得資料の補足として一般知識に基づく解説です）この主張が正しい理由は、**攻撃面の価値は「新しさ」と「独占性」に強く相関する**からだ。あるサブドメインが半年前から存在するなら、すでに何百人ものハンターと自動スキャナが叩いている。逆に、企業が昨夜デプロイしたばかりのステージング環境や、買収に伴って追加された新ドメインは、まだ誰も見ていない。全量スキャンを毎回眺めても「新しさ」は見えない。**前回のスナップショットとの差分を取って初めて「新しさ」が浮かび上がる**。だから差分検知が recon 自動化の中核になる。

#### 「出力」と「発見」を分けるアーキテクチャ

この観点を設計に落とすと、パイプラインは2層に分かれる。

1. **収集層（全量・冪等）**: `subfinder`/`assetfinder` → `httprobe`/`httpx` → `waybackurls` などで、対象の**現在の全状態**を毎回丸ごと取得する。ここは何度実行しても同じ結果になる（冪等）ように作る。
2. **差分・通知層（増分・状態あり）**: 収集層の結果を「これまでに見た集合」と突き合わせ、**新規行だけ**を取り出して通知する。ここは前回状態を永続化して初めて機能する（状態あり）。

多くの人が作るのは収集層だけで、差分・通知層が欠けている。だから「毎朝1万行のログが届くが、そのうち何が新しいのか分からない」状態に陥る。以降で、この2層を TomNomNom 系ツールで具体的に組む。

### TomNomNom のツール哲学：小さな Unix フィルタを stdin/stdout でつなぐ

TomNomNom（Tom Hudson, 英ヨークシャー在住のオープンソースツール作者）の一連のツールは、いずれも**「標準入力(stdin)から1行ずつ受け取り、加工して標準出力(stdout)に1行ずつ出す」だけの単機能フィルタ**として設計されている。これは古典的な Unix 哲学 — 「一つのことをうまくやるプログラムを、パイプ `|` でつなぐ」 — の忠実な実践だ。この設計が差分検知・通知パイプラインに決定的に向いている理由を、各ツールを見ながら説明する。

> 出典: TomNomNom GitHub プロフィール — https://github.com/tomnomnom

代表的なリポジトリ（2026年時点、括弧内は概算スター数）:

| ツール | 役割 | 概算スター |
|---|---|---|
| `gron` | JSON を grep 可能な平坦形式に変換 | 14.5k |
| `waybackurls` | Wayback Machine が知る全 URL をドメインから取得 | 4.6k |
| `assetfinder` | 関連ドメイン・サブドメインを発見 | 3.7k |
| `httprobe` | ドメイン一覧に対し稼働中の HTTP/HTTPS を探索 | 3.1k |
| `gf` | grep のラッパー。定義済みパターンで「探すべきもの」を探す | 2.1k |
| `unfurl` | URL を部品（ドメイン/パス/クエリキー等）に分解・整形 | — |
| `meg` | 多数ホストに対し多数パスを、サーバに優しく並列取得 | — |
| `anew` | stdin の行を、重複を除いてファイルに追記（新規行だけ stdout） | — |

### 差分検知の心臓部：`anew`

パイプライン全体で最も重要なのに最も地味なのが `anew` だ。動作は単純で、**「stdin の各行を、指定ファイルにまだ無ければ追記し、かつ新規だった行だけを stdout に出す」**。`tee -a`（追記しつつ表示）に似ているが、**重複を排除する**点が決定的に違う。

> 出典: tomnomnom/anew README — https://github.com/tomnomnom/anew

README の例をそのまま示す。既存の `things.txt`:

```
Zero
One
Two
```

新しい入力 `newthings.txt`:

```
One
Two
Three
Four
```

実行すると:

```
$ cat newthings.txt | anew things.txt
Three
Four
```

**なぜこの2行だけが出力されるのか。** `anew` は追記先ファイル `things.txt` の既存内容を集合（set）としてメモリに読み込み、stdin の各行がその集合に含まれるか判定する。`One`/`Two` は既に存在するので黙って捨てられ、ファイルにも追記されない。`Three`/`Four` は未知なのでファイルに追記され、同時に stdout にも出る。**この「新規だった行だけが stdout に流れる」性質こそが差分検知の本体**だ。stdout に何か出れば「変化があった」、何も出なければ「変化なし」を意味する。

主なフラグ:

- `-d`（dry-run）: ファイルに追記せず、新規行を stdout に出すだけ。「もし実行したら何が新規か」を壊さず確認できる。
- `-q`（quiet）: ファイルに追記するが stdout には出さない。初回にベースラインを作るときなど、通知を出したくない場合に使う。

新規行を別ファイルに保存する定番:

```
cat newthings.txt | anew things.txt > added-lines.txt
```

**継続監視への応用がここで見える。** サブドメイン一覧を毎日 `anew subs-all.txt` に通す。初日は全件が新規（=全部 stdout に出る）だが、`-q` でベースラインを黙って作れば通知は出ない。翌日以降、`subfinder` の出力を同じ `subs-all.txt` に `anew` で通すと、**stdout には「昨日まで存在しなかった新規サブドメイン」だけが流れる**。これがそのまま「今日調べるべき最優先ターゲット」になる。全量スキャンを差分監視に変える魔法は、この1コマンドで完結する。

```bash
# 毎日 cron で実行する監視の骨格（自身の資産に対して）
subfinder -d example.com -silent \
  | httprobe \
  | anew ~/monitor/example.com/live-hosts.txt
# → stdout には「新しく生存が確認できたホスト」だけが流れる
```

### 収集層のツール

#### `assetfinder` / `waybackurls`：攻撃面を広く集める

`assetfinder` は与えたドメインに関連するドメイン・サブドメインを、複数の公開ソース（証明書透明性ログ、各種 DNS データセット等）から集める。`waybackurls` は Wayback Machine（インターネットアーカイブ）が記録している、そのドメインの**過去の全 URL** を吐き出す。

`waybackurls` が価値を持つ理由は、**古い URL ほど脆弱な傾向がある**からだ。過去に存在したがリンクが消えたエンドポイント（旧 API、デバッグページ、廃止予定だが動いている機能）は、現在のサイトをクロールしても見つからないが、アーカイブには残っている。これらは「メンテされていない＝壊れている」可能性が高い。NahamSec × TomNomNom のライブ recon 動画でも、この「歴史的データは古いものほど脆弱で、追加情報も得られるので価値が高い」という点が強調されている。

> ⚠️ **未取得の資料**: 「Live Recon and Automation on Shopify's Bug Bounty Program with @TomNomNomDotCom」(NahamSec, YouTube, 2021-04-19) は自動取得できませんでした（理由: YouTube 本体は動的レンダリングで本文抽出不可、要約ミラー(eightify)も HTTP 403）。以下のURLからご自身で直接ご覧ください: https://www.youtube.com/watch?v=SYExiynPEKM

> （以下は未取得資料の補足として、動画作者の告知・検索要約と一般知識に基づく解説です）この動画で TomNomNom が実演したのは、まさに本節のパイプライン思想そのものだ。動画作者(NahamSec)自身の告知によれば、使用ツールは **assetfinder / meg / httprobe / fff / gf** など。流れは概ね「`assetfinder` で資産を広げる → `httprobe` で生きているホストに絞る → `meg` で多数ホスト×多数パスを一括取得しローカルに保存 → `gf` で保存済みレスポンスから興味深いパターン（機微なキーワード等）を grep で拾う」という、収集→保存→パターン抽出のパイプラインである。ポイントは、**一度取得したものをローカルに保存し、後から何度でも grep し直せる**構造にしていること。ネットワークアクセス（コスト・レート制限・相手への負荷）は一度で済ませ、分析は手元で反復する。

> 出典: NahamSec による動画告知（使用ツール一覧）— https://twitter.com/NahamSec/status/1384185778301853699

#### `httprobe`：生きているホストだけに絞る

`httprobe` は stdin のドメイン一覧を受け取り、HTTP(80)/HTTPS(443) で応答するものだけを `http(s)://host` の形で stdout に出す。列挙されたサブドメインの大半は DNS はあっても Web サーバは動いていない。ここで絞ることで、後段の負荷と誤検知を減らす。

> 出典: tomnomnom/httprobe README — https://github.com/tomnomnom/httprobe

```bash
cat domains.txt | httprobe
# 既定ポート以外も探る
cat domains.txt | httprobe -p http:81 -p https:8443
# 並列数と timeout（ミリ秒）
cat domains.txt | httprobe -c 50 -t 20000
# HTTPS が通れば HTTP を省略（重複を減らす）
cat domains.txt | httprobe --prefer-https
```

主フラグ: `-c`（並列数）、`-t`（timeout ミリ秒）、`-p protocol:port`（追加プローブ）、`-s`（既定プローブを無効化し `-p` 指定のみ）、`--prefer-https`。**`--prefer-https` を使う理由**は、同一ホストが http/https 両方で応答するとき、下流で「同じサイトを2回」扱ってしまう重複を減らせるからだ。差分監視では重複は偽の「新規」を生む雑音になるため、入り口で抑えるほど後が楽になる。

#### `meg`：多数ホスト × 多数パスを「サーバに優しく」取得する

`meg` は「パス一覧(`./paths`)」と「ホスト一覧(`./hosts`)」を受け取り、全ホストに対して各パスを取得し、結果を `./out` にインデックス付きで保存する。設計上の肝は**取得順序**で、「あるパスを全ホストに投げ終えてから次のパスへ進む」。これにより、**同一ホストへの連続アクセスを避け、1台のサーバに負荷が集中しない**。

> 出典: tomnomnom/meg README — https://github.com/tomnomnom/meg

主フラグ: `-c`（並列数, 既定20）、`-d`（**同一ホスト**への次リクエストまでの遅延ミリ秒, 既定5000）、`-H`（追加ヘッダ）、`-s`（保存対象を HTTP ステータスで絞る）、`-X`（HTTP メソッド, 既定 GET）、`-r`（rawhttp で非標準リクエスト）。

```bash
meg /robots.txt          # 全ホストの /robots.txt を取得
meg -s 200 -X HEAD       # 200 応答だけ保存、HEAD で軽量に
meg -c 30 /              # 並列30でトップページ
```

**`-d 5000`(既定5秒)の意味を理解することが重要**だ。これは「同じホストに5秒間隔でしかアクセスしない」という礼儀の設定で、相手サーバへの過負荷（実質的な DoS）を避け、レート制限で BAN されるのも防ぐ。攻撃面を広げるほど「速く叩く誘惑」が増すが、`meg` は**広さ（多数ホスト）を並列で稼ぎ、深さ（同一ホスト連打）はわざと抑える**という賢い設計になっている。取得結果を `./out` に保存する点も重要で、これが「一度取得→手元で何度も分析」を可能にする。

#### `gf`：「探すべきもの」をパターンとして再利用する

`gf` は grep のラッパーで、**よく使う正規表現とフラグの組を名前付きパターンとして `~/.gf` に JSON で保存**しておき、`gf <name>` で呼び出せる。毎回長い正規表現を打つ代わりに、チームや自分の知見を「パターン資産」として蓄積・バージョン管理できる。

> 出典: tomnomnom/gf README — https://github.com/tomnomnom/gf

パターンファイルの形式（`~/.gf/php-sources.json` の例）:

```json
{
    "flags": "-HnrE",
    "pattern": "(\\$_(POST|GET|COOKIE|REQUEST|SERVER|FILES)|php://(input|stdin))"
}
```

複数パターンをまとめる場合:

```json
{
    "flags": "-HnrE",
    "patterns": [
        "\\$_(POST|GET|COOKIE|REQUEST|SERVER|FILES)",
        "php://(input|stdin)"
    ]
}
```

`engine` フィールドで grep 以外（例: `ag`）も指定でき、`-save` フラグで現在のコマンドラインからパターンファイルを自動生成できる。**なぜ JSON で外出しするのか** — 「何を探すか（＝どんな脆弱性の痕跡か）」という知識を、コマンド履歴に埋もれさせず、Git 管理できる再利用資産にするためだ。`meg` で保存したレスポンス群に対し `gf aws-keys` や `gf debug-pages` を流せば、収集済みの大量データから「興味深い痕跡」を機械的に何度でも掘り直せる。

#### `unfurl`：URL を部品に分解して監視対象を正規化する

`unfurl` は stdin の URL 群を、指定した部品（キー・値・ドメイン・パス・拡張子など）だけに整形して出す。差分監視では「URL 全体」ではなく「パラメータ名の集合」や「パスの集合」を監視したいことが多く、その正規化に使う。

> 出典: tomnomnom/unfurl README — https://github.com/tomnomnom/unfurl

主なモード: `keys`（クエリのキー）、`values`、`keypairs`、`domains`、`paths`、`apexes`（apex ドメイン）、`json`、`format`（自由整形）。`format` の主なディレクティブ: `%d`(ドメイン)、`%S`(サブドメイン)、`%r`(ルートドメイン)、`%t`(TLD)、`%p`(パス)、`%q`(クエリ)、`%s`(スキーム)、`%P`(ポート)。

```bash
cat urls.txt | unfurl keys                    # 全 URL のクエリキーだけ
cat urls.txt | unfurl format %s://%d%p?%q     # 正規化した形に再構成
cat urls.txt | unfurl --unique domains        # ドメインを重複排除
```

**応用例**: `waybackurls` で集めた大量 URL から `unfurl keys | sort -u` でパラメータ名の一覧を作り、これを `anew params.txt` に通せば「新しく登場したパラメータ名」を監視できる。新パラメータは新機能・新エンドポイントの兆候で、テスト対象として価値が高い。

### 通知パイプライン：差分だけを人間に届ける `notify`

差分検知で「新規行」を得たら、それを人間の目に届ける最後の一手が通知だ。ここでは ProjectDiscovery の `notify` を使う（TomNomNom 系の思想と同じく stdin を受けるフィルタとして振る舞う）。`notify` は stdin または `-data <file>` を読み、Slack / Discord / Telegram / Email / Microsoft Teams / Google Chat に投稿する。

> 出典: projectdiscovery/notify README — https://github.com/projectdiscovery/notify

設定ファイルは既定で `$HOME/.config/notify/provider-config.yaml`。プロバイダごとに必要な項目:

```yaml
slack:
  - id: "recon"
    slack_webhook_url: "https://hooks.slack.com/services/XXX/YYY/ZZZ"
    slack_channel: "recon-alerts"
    slack_username: "notify-bot"

discord:
  - id: "vulns"
    discord_webhook_url: "https://discord.com/api/webhooks/XXX/YYY"
    discord_channel: "findings"
    discord_username: "notify-bot"

telegram:
  - id: "recon"
    telegram_api_key: "<bot token>"
    telegram_chat_id: "<chat id>"
    telegram_parsemode: "Markdown"
```

主フラグ: `-bulk`（複数行を1メッセージにまとめて送る）、`-data`（入力ファイル）、`-id`（`recon,vulns` のように送信先 ID を選択）、`-provider`（`slack,telegram` のようにプラットフォーム選択）、`-silent`（余計な出力抑制）、`-char-limit`（1メッセージ最大文字数, 既定4000）、`-delay`（通知間の秒数）。

```bash
# ツール出力を直接パイプ
subfinder -d example.com | notify -bulk
# ファイルから特定プロバイダへ
notify -data new-hosts.txt -bulk -provider discord,slack
# 収集→生存確認→脆弱性テンプレ→通知の連結
subfinder -d example.com | httpx | nuclei -tags exposure | notify -bulk
```

**`-bulk` を使う理由と `-char-limit 4000` の意味**: 差分が一度に大量に出たとき、行ごとに通知すると数百通の連投になり、Slack/Discord のレート制限に当たり、人間も読めない。`-bulk` は複数行を1メッセージに束ねるが、各プラットフォームには1メッセージあたりの文字数上限（Slack/Discord とも概ね数千文字）があるため、`notify` は `-char-limit`(既定4000)で自動分割する。**通知は「量」ではなく「変化があった事実と、その内容」を届けるのが目的**なので、束ねて静かに届けるのが正しい。

### 3層を1本につなぐ：継続監視パイプラインの全体像

ここまでの部品を、cron で毎日回る1本のパイプラインに組む。**収集（冪等）→ 差分（`anew` が状態を持つ）→ 通知（差分があるときだけ発火）** という構造を、自分の資産に対して運用する。

```bash
#!/usr/bin/env bash
set -euo pipefail
DOMAIN="example.com"                 # 自分が権限を持つ資産のみ
BASE="$HOME/monitor/$DOMAIN"
mkdir -p "$BASE"

# 1) 収集層：現在の全生存ホストを取得（冪等）
#    2) 差分層：anew が「新規に現れたホスト」だけを stdout に流す
NEW_HOSTS="$(
  assetfinder --subs-only "$DOMAIN" \
    | httprobe --prefer-https -c 50 \
    | anew "$BASE/live-hosts.txt"
)"

# 3) 通知層：新規があったときだけ通知する（無ければ静か）
if [ -n "$NEW_HOSTS" ]; then
  printf '%s\n' "$NEW_HOSTS" \
    | notify -silent -bulk -id recon \
        -provider slack
fi

# 新規ホストがあれば、それだけを対象に軽い追加調査を回す（任意）
if [ -n "$NEW_HOSTS" ]; then
  printf '%s\n' "$NEW_HOSTS" \
    | waybackurls \
    | unfurl --unique keys \
    | anew "$BASE/params.txt" \
    | notify -silent -bulk -id recon -provider slack
fi
```

**この設計が「発見を生む」理由**を整理する。

- **冪等な収集 + 状態を持つ差分**の分離により、パイプライン全体は毎日同じコマンドで回せるのに、通知されるのは「昨日と違う部分」だけになる。ノイズが構造的に消える。
- **通知は差分があるときだけ発火する（`if [ -n "$NEW_HOSTS" ]`）**。「何も新しくない日は何も通知しない」— これが疲労を防ぎ、通知が来た＝必ず見る価値がある、という信頼を作る。通知を毎日出すと人はすぐ無視するようになる（アラート疲れ）。
- **新規ホストにだけ追加調査を集中**する。全量に毎回重い調査をかけるのではなく、「新しく現れた1〜2件」に `waybackurls`/`unfurl` を回す。相手への負荷も自分の計算量も最小で、かつ最も価値の高い（＝誰もまだ見ていない）対象に投資が向く。

#### 状態の持ち方に関する注意（陳腐化・堅牢性）

- 差分の要は `anew` が読む状態ファイル（`live-hosts.txt` など）だ。これを**消すと全件が再び「新規」になり、大量の誤通知が出る**。ベースライン構築時は `anew -q` で黙って作り、通知は翌日以降に限定する運用が安全。
- 状態ファイルは Git 管理すると変化の履歴を後から追える（`gf` のパターンと同様、知識資産として versioned にする発想）。
- ツールのバージョン差に注意。`assetfinder`/`httprobe`/`meg`/`gf`/`unfurl`/`anew` は本節執筆時点(2026年)の README に基づく。`assetfinder` は開発が緩やかで、`--subs-only` の挙動やデータソースは版により異なる。`notify` のフラグ(`-char-limit` 既定4000 等)や `provider-config.yaml` のスキーマも ProjectDiscovery 側で更新され得るので、運用前に手元の `--help` と設定例で確認すること。
- 相手サーバへの礼儀は自動化の前提だ。`meg -d`(既定5秒)や `httprobe`/`meg` の `-c`、`notify -delay` を過度に上げない。速度を求めて相手や自分のインフラを壊すのは、本節のスコープ（防御目的・無許可検証や破壊的手順を書かない）から外れる。

### まとめ：自動化の正しい問い

「何を自動化するか」ではなく、**「自動化の出力を見て、翌朝に取る行動が変わるか」**を問うべきだ。全量スキャンのログは行動を変えない（毎日同じだから）。しかし「昨日存在しなかったホストが1件現れた」という差分は、その日の最優先タスクを即座に決める。TomNomNom 系ツールの小さなフィルタ群 — 収集の `assetfinder`/`waybackurls`/`httprobe`/`meg`、抽出の `gf`/`unfurl`、そして差分検知の心臓 `anew` — を stdin/stdout で連結し、`notify` で差分だけを静かに届ける。この構造が、出力の洪水ではなく発見を生む自動化の骨格である。


---

[← 第3章 ワークフロー設計と時間管理](03-workflow-time-management.md) ・ [📖 目次](index.md) ・ [第5章 脆弱性ハンティングの実行戦略と連鎖 →](05-hunting-execution-chaining.md)
