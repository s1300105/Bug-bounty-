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
