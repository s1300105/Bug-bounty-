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
