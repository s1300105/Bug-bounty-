# 第7章 OSINT・GitHub・クラウド資産のRecon


## GitHub Reconと漏洩シークレット探索

### この節で学ぶこと

現代のソフトウェア開発では、コード・設定・CI/CD の定義がすべて Git リポジトリの中に集約され、その多くが GitHub 上で公開される。ここに Recon（偵察）の観点での落とし穴がある。開発者は「動かすために一時的に」ハードコードした API キーや、`.gitignore` に入れ忘れた `.env` ファイル、あるいは削除したつもりの認証情報を、**気づかないまま世界中に公開**してしまう。GitGuardian の集計によれば、2024 年だけで数百万件のシークレットが GitHub 上に露出した。

本節が扱うのは、こうした**漏洩シークレット（leaked secret、本来は秘密にすべき認証情報が公開された状態）**を体系的に探し出す技術と、その根底にある「なぜ Git ではデータが消えないのか」という仕組みである。攻撃者はこれを悪用して単独で P1（最重要度）の報告に持ち込む。だからこそ**防御側は「自組織のコードから何が見えているか」を同じ手法で把握し、露出を先回りして塞ぐ**必要がある。

> **スコープの注意（本書共通）**: 本節はあくまで**防御・自組織および許可されたバグバウンティ対象の資産棚卸し**を目的とする。実在する第三者サービスや本番環境への無許可の検証、発見した認証情報を使った侵入的なアクセス（ログイン試行・データ取得・破壊的操作）は扱わない。発見したシークレットの「有効性の確認」は、後述するとおり原則として非侵入的な範囲・プログラムのポリシーの範囲に限る。

学ぶ内容は次の 4 つの柱に整理できる。

1. **なぜシークレットが GitHub に残り続けるのか**（Git の内部構造、Code Search のインデックス範囲）
2. **GitHub Dorking**（検索演算子を組み合わせて狙い撃ちする技術）
3. **削除されたはずのデータの復元**（コミット履歴・削除されたフォーク・dangling blob）
4. **ツールによる自動化と組織横断スキャン**（TruffleHog / Gitleaks / GitHound など）

---

### なぜシークレットは「消したつもり」でも残るのか

この節全体の核心となる原理を最初に押さえる。GitHub recon が成立するのは、次の 2 つの性質があるからだ。

#### 原理1: Git はコンテンツを追記型で永久に保持する

Git は「ファイルの現在の状態」を保存しているのではなく、**すべての変更を snapshot（スナップショット）として blob オブジェクトに保存し、それらをコミットのグラフとして連結**している。ここが決定的に重要だ。あるコミットで `config.php` にパスワードを書き込み、次のコミットでそれを削除しても、**最初のコミットが指していた blob オブジェクトは `.git` の中にそのまま残る**。履歴を辿れば誰でも読める。

OSINT Team のガイドはこの性質を次のように端的にまとめている。

> Git はデフォルトでは、履歴を意図的に書き換えない限りすべてを永久に追跡する。開発者は次のコミットでハードコードしたパスワードを削除できるが、元のバージョンはコミット履歴の中に依然として残っている。

> 出典: GitHub Dorking: A Complete Guide for Bug Bounty Hunters and Penetration Testers（Yamini Yadav / OSINT Team） — https://osintteam.blog/github-dorking-a-complete-guide-for-bug-bounty-hunters-and-penetration-testers-b9f8e784e29b

つまり「最新版のコードだけ見て安全だと判断する」のは誤りで、**履歴（history）を丸ごと走査**しなければ漏洩は見つからない。この性質があるからこそ、後述の TruffleHog / Gitleaks / GitHound はいずれも `--history` 相当の機能を第一級で備えている。

なぜ削除しても消えないのか、を Git の内部でもう一段深掘りすると次のようになる。

- Git のオブジェクトはハッシュ（SHA-1／SHA-256）で内容アドレス指定されている。ファイルの中身が 1 バイトでも違えば別の blob になる。
- コミットを削除・巻き戻しても、そのコミットや blob は即座に消えるのではなく、**どのブランチからも参照されない「dangling（宙ぶらり）」オブジェクト**として残る。`git gc`（ガベージコレクション）が走り、かつ猶予期間（デフォルトで到達不能オブジェクトは 2 週間）を過ぎて初めて回収候補になる。
- ローカルで消えても、GitHub 側のサーバはさらに寛容で、後述する **CFOR（Cross-Fork Object Reference）**により、フォークネットワーク全体でオブジェクトが共有・保持される。

#### 原理2: GitHub Code Search がインデックスするのは「デフォルトブランチだけ」

もう一つの盲点は、GitHub の検索エンジン（Code Search）が索引化する範囲が限定的なことだ。HackTricks は次の「落とし穴（gotcha）」を明示している。

> - GitHub Code Search はデフォルトブランチのみをインデックスする。デフォルト以外のブランチは直接調べるか、クローンして確認する。
> - Git 履歴全体や他のブランチ／タグ（クローンして gitleaks / trufflehog でスキャンする。GitHub 検索はインデックス済みのコンテンツしかカバーしない）。
> - GitHub 検索は文書化されたサイズ上限を超えるファイルを除外し、網羅的ではない。徹底するにはローカルにクローンしてシークレットスキャナでスキャンする。

> 出典: HackTricks「Github Dorks & Leaks」 — https://blog.1nf1n1ty.team/hacktricks/generic-methodologies-and-resources/external-recon-methodology/github-leaked-secrets

この帰結が実務上とても重要だ。

- **Web の検索 UI／API に出てこない=安全、ではない。** feature ブランチ、タグ、大きすぎるファイル、履歴の奥にある削除済みコミットは検索に出ない。**クローンしてローカルでスキャンする**工程が別途必須になる。
- 逆に言えば、防御側が「検索で自組織のキーが出ないから大丈夫」と考えるのは危険で、履歴・非デフォルトブランチまで走査するツールで確認する必要がある。

さらに HackTricks は、検索経路によって機能差があることも指摘している。

> GitHub の Code Search UI は正規表現（regex）をサポートするが、REST/API 経路（`gh search code` を含む）はレガシーエンジンを使い、正規表現機能を公開していない。正規表現クエリには UI を使うほうがよい。

> 出典: 同上（HackTricks「Github Dorks & Leaks」）

したがって、`/NRAK-/` のような正規表現を使ったパターンマッチは **Web UI（github.com/search?type=code）** で、機械的な大量クエリは **API/CLI** で、と使い分けることになる。

---

### GitHub Dorking の基礎: 検索演算子を武器にする

「GitHub Dorking（GitHub ドーキング）」とは、Google Dorking の GitHub 版である。ここでの「dork（ドーク）」とは、**通常のキーワード検索では表に出てこない情報を、検索エンジンの高度な演算子を組み合わせて狙い撃ちで掘り出すための検索クエリ**を指す。対象が Web ページではなく「ソースコード・コミット・ファイルパス」である点が Google Dorking との違いだ。

OSINT Team のガイドは、GitHub の現行検索が次の qualifier（修飾子＝検索を絞り込む演算子）をサポートすると整理している。

- `repo:` — 特定のリポジトリに限定（例: `repo:owner/name`）
- `org:` — 特定の Organization（組織アカウント）配下に限定
- `user:` — 特定ユーザーの所有物に限定
- `language:` — プログラミング言語で絞り込み（例: `language:python`）
- `path:` — ファイルパスで絞り込み（`filename:` の後継で、Code Search UI では `path:**/name` 形式）
- `symbol:` — 関数名・クラス名などのコードシンボルで検索
- `content:` — ファイルの内容で検索

これらは単体で使うより、**論理演算子（boolean operator）で組み合わせて「絞り込む」**ことに真価がある。ここが初心者と熟練者の最大の差になる。

#### まず「ファイル名／拡張子」で当たりをつける

漏洩は特定の種類のファイルに集中する。HackTricks が列挙している dork のうち、ファイル名・拡張子ベースのものは、**そもそも秘密を含みやすいファイルを狙い撃つ**発想だ。代表例を原典から引用する（いずれも github.com/search に入力する検索クエリ）。

```text
filename:.env DB_USERNAME NOT homestead
filename:.git-credentials
filename:.npmrc _auth
filename:.dockercfg auth
filename:wp-config.php
filename:id_rsa or filename:id_dsa
filename:credentials aws_access_key_id
filename:.s3cfg
filename:settings.py SECRET_KEY
extension:pem private
extension:sql mysql dump password
extension:json googleusercontent client_secret
```

> 出典: HackTricks「Github Dorks & Leaks」 — https://blog.1nf1n1ty.team/hacktricks/generic-methodologies-and-resources/external-recon-methodology/github-leaked-secrets

**なぜこれらが効くのか**を 1 つずつ理解しておくと応用が利く。

- `filename:.env` — `.env` は環境変数（DB のユーザー名・パスワード、API キーなど）を定義するファイルで、本来 `.gitignore` で除外すべきもの。`NOT homestead` を付けているのは、Laravel の Homestead というローカル開発環境がサンプル `.env` を大量に含み、それが**ノイズ（無関係な大量ヒット）**になるからだ。「本物の漏洩」に近づけるための除外条件である。
- `filename:.git-credentials` — Git が認証情報をキャッシュするファイル。URL 埋め込み形式（`https://user:token@host`）でトークンがそのまま入っていることがある。
- `filename:id_rsa` — SSH の秘密鍵ファイルの標準名。秘密鍵の漏洩はサーバへの直接侵入につながりうる最重要級の露出。
- `extension:pem private` — `.pem` は証明書・秘密鍵の格納形式。`private` という語を併記することで、`PRIVATE KEY` を含む本物の鍵ファイルに寄せている。
- `filename:settings.py SECRET_KEY` — Django の設定ファイル。`SECRET_KEY` はセッション署名などに使われ、漏れるとセッション偽造等につながる。

#### 「トークンのプレフィックス」で狙う（2024〜2025 の最新形）

多くのクラウド／SaaS は、発行するトークンに**固定のプレフィックス（接頭辞）**を付けている。これは本来、GitHub 側の secret scanning（自動検出）を助けるための設計だが、Recon 側から見れば「この文字列を検索すれば本物のトークンだけが引っかかる」という強力な指標になる。HackTricks が挙げる「モダンなトークン向けの更新済み dork」を引用する。

```text
GitHub トークン: ghp_  gho_  ghu_  ghs_  ghr_  github_pat_
Slack トークン:   xoxb-  xoxp-  xoxa-  xoxs-  xoxc-  xoxe-
クラウド／汎用:
  AWS_ACCESS_KEY_ID   AWS_SECRET_ACCESS_KEY   aws_session_token
  GOOGLE_API_KEY      AZURE_TENANT_ID          AZURE_CLIENT_SECRET
  OPENAI_API_KEY      ANTHROPIC_API_KEY
```

> 出典: HackTricks「Github Dorks & Leaks」 — https://blog.1nf1n1ty.team/hacktricks/generic-methodologies-and-resources/external-recon-methodology/github-leaked-secrets

**なぜプレフィックスで探すのが効率的か**: 例えば `ghp_` は GitHub の Personal Access Token（PAT、個人用アクセストークン）の接頭辞。ランダムな英数字の中にこの 4 文字が現れる確率は低いので、`ghp_` を含む行はほぼ確実に「本物の PAT の形をしたもの」になる。AWS のアクセスキー ID が `AKIA` で始まるのも同じ理由で、後述の `AKIA amazonaws.com` という dork が成立する。

> **時事性の注意**: トークン形式はベンダーの仕様変更で変わる。上記は 2024〜2025 時点の形式。GitHub の PAT は 2021 年以降 `ghp_`（classic）や `github_pat_`（fine-grained）形式に移行した。新しい SaaS のトークン形式は都度、ベンダーのドキュメントで確認すること。

#### 環境変数名・認証キーワードで探す

サービス固有のプレフィックスを持たない汎用的な秘密は、**変数名やキーワード**で探す。HackTricks の dork リストの一部を引用する。

```text
HEROKU_API_KEY language:json
HEROKU_API_KEY language:shell
SECRET_KEY_BASE=
WORDPRESS_DB_PASSWORD=
shodan_api_key language:python
org:Target "AWS_ACCESS_KEY_ID"
org:Target "S3_SECRET_ACCESS_KEY"
org:Target "bucket_name"
```

> 出典: HackTricks「Github Dorks & Leaks」 — https://blog.1nf1n1ty.team/hacktricks/generic-methodologies-and-resources/external-recon-methodology/github-leaked-secrets

ここで `org:Target` の `Target` を自組織名（または許可された対象の Organization 名）に置き換えて使う。`language:json` のように言語を絞ると、「その変数名が JSON の設定ファイルに書かれているケース」だけに寄せられ、ノイズが減る。`SECRET_KEY_BASE=` のように **末尾に `=` を付ける**のは、「変数への代入の右辺に実値が続いている行」を狙うテクニックだ（環境変数名の言及だけの文書を除外しやすい）。

---

### 熟練者の dorking: 「狙い撃ち」と「ノイズ除去」

ここからが GitHub recon で最も差がつく部分である。Tillson Galloway（GitHound の作者）は「多くのガイドは dork の一覧を提供するが、**どう使えば効果的か**を語るものは少ない。dork リストを盲目的に使うと、膨大な誤検知とスコープ外のヒットを生む」と指摘し、5 年間の実践から得た 2 つの原則を挙げている。

> 出典: You're using dorks wrong: How to improve your GitHub dorks to find in-scope leaks faster（Tillson Galloway / GitHound Explore） — https://githoundexplore.com/blog/bug-bounty-recon-with-github-dorks

#### 原則1: 内部サブドメイン（internal subdomain）を軸にした conjunctive query

Galloway が「最も効果的」と断言するテクニックが、**内部サブドメインを見つけ、それを検索の軸にする**やり方だ。理由は明快で、`repo:` や `org:` に紐づく「公式に対象と関連づいたリポジトリ」は、いまやバグバウンティハンターに監視され尽くしていて（over-subscribed）成果が出にくい。一方、**社員が個人アカウントに push した秘密や、フォーク・ミラー・アーカイブに残った秘密**は、対象の Organization に紐づかないため見逃されやすい。そこを拾うには「対象に固有だが GitHub アカウントには紐づかない指標」が要る。それが内部ドメインだ。

彼の実例（Uber は公開バグバウンティプログラムを持つ）を引用する。

```text
"uberinternal.com"
```

> Uber が内部サービスに `uberinternal.com` を使っていると分かっているなら、`"uberinternal.com"` を検索して Uber の漏洩シークレットを探せる。Uber 以外の従業員がこのドメインを使っている可能性は低いので、ヒットした漏洩シークレットがスコープ内である良い兆候になる。

**なぜ有効か**: 内部専用ドメイン名は、その組織の関係者しか書かない。だから `"uberinternal.com"` を含むコードは、リポジトリの所有者が誰であろうと（個人アカウントであっても）「Uber 関連」である可能性が高い。これを**論理積（conjunctive、AND 結合）**でファイルタイプ条件と組み合わせると、精度がさらに上がる。Galloway の実例クエリ（GitHub Code Search API 形式）:

```text
filename:.dockercfg auth "uberinternal.com"
filename:.ipynb "hackerone.net"
filename:.env "AWS_SECRET"
```

> 出典: 同上（You're using dorks wrong… / GitHound Explore）

1 つ目は「Docker のレジストリ認証情報ファイルで、かつ auth を含み、かつ Uber 内部ドメインが登場するもの」に限定している。3 条件の AND なので、当たればほぼ本物・ほぼスコープ内、という質の高いヒットになる。2 つ目は Jupyter Notebook（`.ipynb`、データ分析でよく使われ、実行結果に秘密が焼き込まれがち）を HackerOne の内部ドメインで絞ったもの。

> **UI と API のクエリ差**: GitHound Explore のツールは、Code Search API 形式の `filename:X` を、Code Search UI 形式では `path:**/X` に自動変換して表示する。これは前述の「UI と API でエンジンが違う」問題への実務的な対応で、同じ意図のクエリでも入力先によって書き方を変える必要があることを示している。

#### 原則2: `NOT` 演算子でノイズ源（death star repo）を除外する

dork は放っておくと膨大な誤検知を生む。Galloway は、その最大の発生源が**シークレットスキャナ自身のテストデータ**だと指摘する。

> dork はしばしばノイジーだ。私の経験では、シークレットスキャンツールのテストが、このノイズの一般的な発生源になっている。私たちはこれを「death star（デス・スター）」リポジトリと呼ぶ。膨大な数の結果を生成するからだ。GitHub Code Search は 100 件に制限されているので、これらのリポジトリを検索から除外することが、スコープ内の秘密を見つけるうえで決定的に重要になる。

> 出典: 同上（You're using dorks wrong… / GitHound Explore）

ここに Code Search の構造的な制約が絡む。**Code Search は 1 クエリあたり最大 100 件しか返さない。**もし `git-hound` や `noseyparker` のテストフィクスチャ（意図的に大量のダミー秘密を含むリポジトリ）が上位を埋めてしまえば、本物の漏洩は 100 件の枠に入らず永久に見えない。だから `NOT` で潰す。実例:

```text
"staging.halcorp.biz" NOT repo:reddelexc/hackerone-reports
AKIA amazonaws.com NOT repo:tillson/git-hound NOT praetorian-inc/noseyparker
```

> 出典: 同上（You're using dorks wrong… / GitHound Explore）

1 つ目は「HackerOne の過去レポートを集めたリポジトリ（過去に報告された漏洩がそのまま載っているのでヒットしてしまう）」を除外。2 つ目は AWS アクセスキー（`AKIA`）を探しつつ、GitHound と Nosey Parker のテストデータを除外している。Galloway は「対象によっては、10〜15 個ものリポジトリを除外して初めて、スコープ内の漏洩を見つけて報奨金を得られたこともある」と述べている。**ノイズ除去は付随作業ではなく、勝敗を決める本作業**だという教訓だ。

Codelivly のガイドも同じ発想を「検証（validation）」の側面から補強しており、発見した文字列がテスト値やダミー値でないか、周辺のコード文脈・コミット作者・タイムスタンプを確認してから扱うべきだとしている。

> 出典: GitHub Recon: The Underrated Technique（Codelivly） — https://codelivly.com/github-recon-the-underrated-technique

---

### 削除されたはずのデータを復元する

「原理1」で述べた Git の追記型構造を、Recon の攻めの技術に転じたのがこの領域だ。Tillson Galloway のチェックリストは、ここに 2 つの独立した技術を挙げている。

#### CFOR（Cross-Fork Object Reference）: 削除されたフォークのコミット

> あまり知られていないトリックの一つが、リポジトリの削除されたフォークのデータを確認することだ。誰かが公開リポジトリをフォークし、いくつかコミットを追加し（たとえば API キーをハードコードして）、その後フォークを削除しても、それらのコミットは消えていない――**コミットハッシュを知っていれば、元のリポジトリ経由で依然としてアクセスできる**。この挙動は Cross-Fork Object Reference（CFOR）と呼ばれる。

> 出典: The 2025 GitHub Recon Checklist for Bug Bounty Hunters（Tillson Galloway） — https://githoundexplore.com/blog/github-recon-checklist

**なぜアクセスできるのか（仕組み）**: GitHub は、あるリポジトリとその全フォークを「フォークネットワーク（fork network）」という 1 つの共有オブジェクトストアで管理している。ストレージ効率のため、フォーク間で共通の Git オブジェクトを重複保存しないのだ。この結果、フォークを削除しても、そのフォークだけに存在したコミットのオブジェクトは**フォークネットワークの共有ストアに残り**、`https://github.com/<元のリポジトリ>/commit/<コミットSHA>` の形で誰でも到達できてしまう。つまり「削除」は UI 上の参照を消すだけで、オブジェクトそのものは消えていない。

これを自動で掘るのが TruffleHog の `--object-discovery` モードだ。Galloway のチェックリストに載る実コマンド:

```bash
trufflehog github-experimental --repo <repo> --object-discovery
```

このモードは、フォークネットワークに存在しうるコミットオブジェクトを列挙し、削除済みフォーク由来の秘密まで走査する。Galloway は、この種の「宙ぶらりのオブジェクト（dangling blob）」から、あるハンターが最近 65,000 ドルを得た事例を紹介している（Sharon Brizinov の "How I made $64k from deleted files" のケース）。

#### コミット履歴・dangling blob の直接調査

フォークに限らず、**同一リポジトリの履歴からの復元**も基本技術だ。開発者は最新版から秘密を消しても、履歴には残る（原理1）。Galloway が挙げる手作業のコマンド:

```bash
git fsck --lost-found
```

`git fsck`（file system check）は Git オブジェクトデータベースの整合性を検査するコマンドで、`--lost-found` を付けると、**どのブランチ・タグからも参照されていない到達不能オブジェクト（dangling commit / dangling blob）**を `.git/lost-found/` に書き出す。ここに、削除されたブランチの先端コミットや、`git commit --amend`・`git rebase` で「なかったこと」にされたコミットが現れる。関連して `git log`（履歴閲覧）で過去コミットの差分に秘密が入っていないかを追う。

HackTricks も同じ原則を「ヒント」として述べている。

> Git 履歴には、削除された秘密を捕まえるため、`git log -p --all` を解析するスキャナを優先せよ。

> 出典: HackTricks「Github Dorks & Leaks」 — https://blog.1nf1n1ty.team/hacktricks/generic-methodologies-and-resources/external-recon-methodology/github-leaked-secrets

`git log -p --all` の `-p` はパッチ（差分）表示、`--all` は全ブランチ・全参照を対象にする指定。つまり「全ての参照の、全てのコミットの差分」を舐めることで、途中で追加され途中で削除された秘密も差分として検出できる。

---

### GitHub Actions（CI/CD）とワークフローログ

漏洩はソースコードだけでなく、**CI/CD パイプラインの定義とその実行ログ**にも潜む。Galloway のチェックリストより:

> ターゲットが GitHub Actions（GitHub の CI/CD パイプライン）を使っているなら、そこも機微情報の供給源になりうる。`.github/workflows/` の YAML ワークフローファイルには、開発者が不注意だと、ハードコードされた認証情報・トークン・キーが含まれていることがある。GitHub の暗号化シークレット機能を使っていても、扱い方次第で情報が漏れることがある（たとえばログへの出力が過剰な場合）。

> 出典: The 2025 GitHub Recon Checklist for Bug Bounty Hunters（Tillson Galloway） — https://githoundexplore.com/blog/github-recon-checklist

これを探す dork:

```text
path:.github/workflows/
```

**なぜログにまで注意するのか（仕組み）**: GitHub Actions は、`secrets.*` として登録された値がログに出力されると自動でマスキング（`***` に置換）する。しかしマスキングは「登録済みシークレットの文字列と完全一致する出力」にしか効かない。ツールが**加工した形（base64 化、JSON への埋め込み、部分文字列）**でクレデンシャルを吐くと、マスキングをすり抜けてログに平文で残る。Galloway が例に挙げる 2024 年の **LeakyCLI** 問題は、まさに一部の CLI ツール（AWS/GCP のコマンドラインツール）がビルドログに認証情報をエコーし、GitHub のマスキングを回避してしまった事例だ。

HackTricks も、Actions のログとアーティファクト（成果物）が読み取り権限で閲覧・ダウンロード可能で、シークレットの秘匿は保証されないと明記している。防御側の教訓は「シークレットをマスキング頼みにせず、そもそもログに出さない・デバッグ出力を本番で無効化する」ことだ。

---

### 開発者アカウントへのピボット（横展開）

Organization の公式リポジトリだけを見るのは片手落ちだ、というのが Galloway の 6 番目のチェック項目である。

> 開発者はコミットで企業のメールアドレスを使ったり、個人リポジトリで内部プロジェクト名に言及したりすることが多い。バグバウンティハンターは主要なコントリビューターを特定し、その活動にピボット（軸足を移して横展開）すべきだ。従業員の GitHub ハンドルを（コミットや組織のメンバー一覧から）見つけたら、そのプロフィールと他のリポジトリを調べる。従業員の個人プロジェクトが会社に不利に使える情報を漏らしていることがある。

> 出典: The 2025 GitHub Recon Checklist for Bug Bounty Hunters（Tillson Galloway） — https://githoundexplore.com/blog/github-recon-checklist

コミットに紐づくメールアドレスを一覧化する実コマンド:

```bash
git log --pretty=format:'%ae' | sort -u
```

`--pretty=format:'%ae'` は各コミットの author email（作者のメールアドレス）だけを出力する指定、`sort -u` で重複を除いてユニーク化する。これで「このリポジトリに関わった人物のメール一覧」が得られ、`@company.com` のような企業ドメインが混ざっていれば、その人物の個人アカウントを辿る起点になる。個人アカウントには、業務コードの断片（社内 API エンドポイント、テスト用の鍵）が混入していることがある。**この「人を軸にした横展開」は、資産（リポジトリ）を軸にした探索では絶対に届かない領域を拾う。**

Codelivly も同じ発想を「Developer Mapping（開発者マッピング）」「Timeline Analysis（コミット履歴の時系列分析）」「Fork Mining（フォークと古いブランチの発掘）」として体系化しており、複数リポジトリ・個人アカウント間でコントリビューターを相関させることを勧めている。

> 出典: GitHub Recon: The Underrated Technique（Codelivly） — https://codelivly.com/github-recon-the-underrated-technique

---

### ツールによる自動化と組織横断スキャン

手作業の dorking と、ツールによる網羅スキャンは補完関係にある。前者は「GitHub 全体から、対象に紐づかない漏洩まで拾う」広さ、後者は「特定の対象を履歴の奥まで漏れなく舐める」深さに強い。主要ツールを役割で整理する。

#### 主要ツールの棲み分け

- **TruffleHog（v3）** — 高エントロピー文字列（ランダムに見える=秘密らしい文字列）とパターンで検出し、**多くの認証情報の有効性をライブで検証（verify）**できる点が特徴。GitHub の Organization、Issue/PR、Gist、Wiki まで走査対象にできる。削除フォークや履歴に強い。
- **Gitleaks** — パターンデータベース（正規表現のルールセット）でリポジトリ・ディレクトリ・アーカイブを走査する定番。履歴全体のスキャンに対応。
- **GitHound（git-hound）** — 他ツールと異なり、**GitHub Code Search API を使って GitHub 全体から**秘密を狩る。対象の秘密が「対象と紐づかない無関係なリポジトリ」に流れ着いても、内部ドメイン名などのキーワードで見つけ出せる。文脈依存のパターンマッチ、コミット履歴チェック、エントロピーチェック、base64 デコードを行う。
- **その他**: ggshield（GitGuardian CLI）、detect-secrets（Yelp、混入防止＝予防側）、git-secrets（AWS Labs、コミット前フック）、Titus（Nosey Parker の後継）、GitDorker（dork の自動実行）など。

> 出典: The 2025 GitHub Recon Checklist（Tillson Galloway, https://githoundexplore.com/blog/github-recon-checklist）／ HackTricks「Github Dorks & Leaks」（https://blog.1nf1n1ty.team/hacktricks/generic-methodologies-and-resources/external-recon-methodology/github-leaked-secrets）

#### 実コマンド例（HackTricks より）

シークレットの探索先は「デフォルトブランチのコードだけ」ではないことを、コマンドの形でも押さえる。

TruffleHog で Organization 全体を、Wiki・Issue コメント・PR コメント・Gist コメントまで含めて走査し、**検証済み（verified）**のものだけに絞る:

```bash
export GITHUB_TOKEN=<token>
trufflehog github --org Target --results=verified \
  --include-wikis --issue-comments --pr-comments --gist-comments
```

`--results=verified` は、検出した認証情報のうち「実際に有効だと確認できたもの」だけを出す指定で、誤検知（無効・失効済みの文字列）を大幅に減らす。ただし「検証」は当該サービスへの軽量な API 呼び出しを伴うため、**許可された対象・プログラムのポリシー範囲内**でのみ行うこと（本書のスコープ制約）。

Gitleaks を Organization の全リポジトリに対して回す（浅いクローン→ディレクトリスキャン）:

```bash
gh repo list Target --limit 1000 --json nameWithOwner,url \
| jq -r '.[].url' | while read -r r; do
  tmp=$(mktemp -d); git clone --depth 1 "$r" "$tmp" && \
  gitleaks dir -v "$tmp" || true; rm -rf "$tmp";
done
```

`gh repo list` で対象組織のリポジトリ URL を列挙し、1 つずつ一時ディレクトリに `--depth 1`（最新コミットのみの浅いクローン）で取得して `gitleaks dir` にかけている。履歴まで見たい場合は浅いクローンをやめ、`gitleaks git -v --log-opts="--all" <repo>` を使う（`--log-opts="--all"` で全参照の履歴を対象化。原理1・`git log -p --all` の考え方と対応）。

ggshield でクイックにスキャン:

```bash
# 現在の作業ツリー
ggshield secret scan path -r .
# リポジトリの Git 履歴全体
ggshield secret scan repo <path-or-url>
```

> 出典: HackTricks「Github Dorks & Leaks」 — https://blog.1nf1n1ty.team/hacktricks/generic-methodologies-and-resources/external-recon-methodology/github-leaked-secrets

Codelivly も同種のワンショット例（`gitleaks detect --source=<repo>`、`trufflehog <repo>`、`gh search code --query="filename:.env org:<org>"`）を示しており、GitHub REST API の `/orgs/{org}/repos`（リポジトリ列挙）や `/search/code`（コード検索）を使ったプログラム的な収集も提示している。ただし前述のとおり、API 経路（`gh search code` 含む）は正規表現非対応で、Code Search のインデックス範囲（デフォルトブランチ・サイズ上限内）に限られる点に注意する。

> 出典: GitHub Recon: The Underrated Technique（Codelivly） — https://codelivly.com/github-recon-the-underrated-technique

> ⚠️ **未取得の資料**: 「GitHub Dorking: A Complete Guide for Bug Bounty Hunters and Penetration Testers（OSINT Team）」は自動取得できませんでした（理由: Cloudflare のボット保護により本文 HTTP 403、直接本文抽出に失敗）。要点は検索結果のメタ情報から補い、本文に反映しています。詳細はご自身で直接ご覧ください: https://osintteam.blog/github-dorking-a-complete-guide-for-bug-bounty-hunters-and-penetration-testers-b9f8e784e29b
>
> （以下は未取得資料の補足として一般知識に基づく解説です）このガイドの核心は本節で引用した 2 点――(1) Git は履歴を意図的に書き換えない限り全てを永久保持する、(2) 現行の GitHub 検索は `repo:` `org:` `user:` `language:` `path:` `symbol:` `content:` の qualifier をサポートする――に集約される。実務では、`org:` で自組織に絞った検索を起点にしつつ、本節で扱った「内部ドメイン軸の conjunctive query」と「`NOT` によるノイズ除去」を重ねると、スコープ内の実害ある漏洩に最短で到達できる。

---

### 防御側の要点（この節のまとめ）

攻撃者の手順を理解する目的は、**先回りして塞ぐ**ことにある。本節の技術を防御に翻訳すると次のようになる。

- **履歴を前提に対策する**: 一度 push された秘密は「削除」では消えない（CFOR・dangling blob）。漏洩したら**コードから消すのではなく、まず該当クレデンシャルをローテーション（無効化・再発行）する**のが唯一確実な対応。`git filter-repo` 等での履歴書き換えは補助にすぎない。
- **予防を CI に組み込む**: git-secrets / detect-secrets / ggshield をコミット前フックや CI に入れ、**秘密が push される前**に止める。GitHub の push protection（secret scanning）も有効化する。
- **`.env`・鍵・CI 定義を疑う**: `.gitignore` の徹底、`.github/workflows/` のハードコード排除、Actions ログへのクレデンシャル出力の抑止（マスキングに依存しない）。
- **自組織を攻撃者視点で継続監視する**: `org:自社` を軸にした dorking、内部ドメインを軸にした横断検索、コミットメール経由の従業員個人アカウントの点検を、**定期的に**回す。単発ではなく継続監視にすることで、新たな漏洩を早期に検知できる。

GitHub recon の本質は、「Git はデータを消さない」という一点に尽きる。この原理を攻撃者が知っている以上、防御側は**露出しうる全経路（履歴・フォーク・ログ・個人アカウント）を同じ解像度で把握し、露出の芽を発生源で断つ**ことが求められる。

## クラウド資産発見とmisconfiguration

Recon（偵察）の対象は、もはやドメインとIPアドレスだけではない。現代の組織はコード・データ・計算資源の多くをAWS・Azure・GCPといったパブリッククラウドに載せており、それらの「クラウド資産（cloud asset）」——S3バケット、Blobコンテナ、Cloud Storageバケット、サーバーレス関数、コンテナレジストリなど——は、伝統的なポートスキャンやサブドメイン列挙とは別の方法で発見される。この節では、クラウド資産をどう体系的に発見し、そこに頻出する**設定ミス（misconfiguration）**——「デフォルトのまま／公開範囲を広げすぎたまま放置された結果、意図せず外部から到達・読み取り可能になっている状態」——がなぜ生まれ、防御側がどう塞ぐべきかを、原理レベルで解説する。

本節はあくまで**防御目的**で書く。列挙・監査の技術は、自組織の資産棚卸し（アセットインベントリ）と露出の自己点検にそのまま使えるものであり、実在他者の本番環境への無許可検証や、データ改変・削除といった破壊的手順は扱わない。

### なぜクラウド資産は「別枠のRecon」を要するのか

伝統的な外部Reconは「対象のIPレンジ／ドメインを起点に、そこにぶら下がるホストとサービスを見つける」という前提に立つ。しかしクラウドストレージの多くは、対象組織のIPレンジにも、対象のドメインにも属さない。たとえばAWS S3のバケットは既定で `https://<バケット名>.s3.amazonaws.com/` や `https://<バケット名>.s3.<リージョン>.amazonaws.com/` という**グローバルに共有された名前空間**上のURLでアクセスされる。バケット名はAWS全体で一意（GCPのCloud Storageも同様にグローバル一意）であり、これは裏を返せば「名前さえ当てれば、対象のネットワークに一切触れずに、名前空間側から資産の存在を確認できる」ことを意味する。

この構造上の帰結が、クラウド資産Reconの中心的手法である**名前推測（permutation／mutation 列挙）**だ。対象のブランド名・製品名・組織名（例: `acme`, `acme-corp`, `acmeapp`）に、`-dev`, `-prod`, `-backup`, `-assets`, `-static`, `-logs` といった慣用の接頭辞・接尾辞を機械的に掛け合わせ、生成した候補名がグローバル名前空間に実在するかを問い合わせる。ネットワーク的に対象へ触れないため、この一次探索は「対象システムへの侵入」ではなく「公開名前空間への問い合わせ」に近い。ただし、見つかったバケットの中身を読む・書くといった操作は権限と許諾の問題に直結するため、防御的文脈では「自組織名で生成した候補が公開状態になっていないかの点検」に限定して用いるべきである。

もう一つの重要な入口が**DNS**である。組織がクラウドサービスをカスタムドメインで公開する際、`assets.example.com` のようなサブドメインの **CNAMEレコード**が、`example-assets.s3.amazonaws.com` や CloudFront ディストリビューション（`d123.cloudfront.net`）、Azure Blob（`example.blob.core.windows.net`）へ直接向いていることが多い。したがってサブドメイン列挙（本書の第2〜3章で扱ったCT・ブルートフォース・パーミュテーション）でCNAMEの終端を辿るだけで、対象が使っているクラウドサービスとバケット名が芋づる式に判明する。CNAMEの終端がすでに削除されたバケットを指し続けている場合は「サブドメインテイクオーバー（未使用のクラウド資源を第三者が同名で作り直して乗っ取る）」の温床にもなるため、DNSとクラウド資産の対応関係の棚卸しは防御上きわめて重要だ。

### AWS S3バケットのRecon——名前空間・ツール・ドーク

> ⚠️ **未取得の資料**: 「AWS Pentesting: S3 Bucket Recon（@ro0taddict / rodelllemit）」は自動取得できませんでした（理由: Medium が HTTP 403 を返し本文を取得できず。代替として WebSearch により記事の要約・引用を取得）。以下のURLからご自身で直接ご覧ください: https://rodelllemit.medium.com/aws-pentesting-s3-bucket-recon-6b906e7b6c86
>
> （以下は WebSearch で得た記事要約に、未取得部分を補うための一般知識に基づく解説を加えたものです）

S3バケットReconの基本は、前節で述べた**名前推測**を効率化する3系統のアプローチである。

#### 1. 専用ツールによる能動列挙（cloud_enum など）

記事では、S3をはじめとするクラウド資源の列挙に `cloud_enum`（後述）が中心ツールとして挙げられている。AWSのみに絞って走らせる典型例は次のとおり。

```sh
# キーワード flaws.cloud を起点に、Azure/GCP を無効化して AWS(S3) だけを列挙
cloud_enum -k flaws.cloud --disable-azure --disable-gcp
```

- **なぜこう書くのか**: `-k` で与えたキーワードにツール内蔵の変異語（`-dev`, `-backup` 等）を掛け合わせて候補バケット名を生成し、各候補の存在有無を確認する。`--disable-azure`/`--disable-gcp` で探索対象を絞ることで、無関係なプロバイダへの問い合わせを省き、S3に対する試行を高速化・低ノイズ化できる。`flaws.cloud` はクラウドセキュリティ学習用に公開されている**練習用**サービス名であり、こうした学習環境や自組織のキーワードに対して使うのが適切な使い方である。

#### 2. 既存インデックスの検索（GrayhatWarfare）

**GrayhatWarfare** は、インターネット上で公開状態になっているS3バケット・Azure Blob などを収集し、ファイル名で全文検索できるようにした**オンラインの索引データベース**である。記事の記述では「80,000以上のAWSバケット・Azure Blobを収録」とされる（収録件数は時期により大きく変動する）。防御側にとっての含意は明確で、「自組織のバケット名やファイル名（社名・製品コード・従業員名など）がこの索引にヒットしないか」を定期的にチェックすることが、露出の早期発見に直結する。自分で総当たりする前に、既に世界中がクロールして索引化した結果を引くのが最も効率的だ、という発想である。

#### 3. 検索エンジンのドーキング（Google Dork）

インデックスやツールを使わずとも、検索エンジンがクロールしてしまった公開バケットは**Googleドーク**（検索演算子を使った絞り込み）で洗い出せる。記事に挙げられた代表例は次のとおり。

```text
site:.s3.amazonaws.com "company"
site:s3.amazonaws.com "index of /"
s3 inurl:s3.amazonaws.com intitle:"AWS S3 Explorer"
```

- **なぜこう書くのか**: `site:` はドメイン（ここではS3のホスト名空間）に結果を限定する演算子。`"index of /"` は、ディレクトリリスティングが有効なバケットが返す**ディレクトリ一覧ページの定型文字列**で、これがインデックスされているバケットは中身が丸見えになっている可能性が高い。`intitle:"AWS S3 Explorer"` は、バケット閲覧用の静的ビューアが吐くページタイトルを狙う。いずれも「公開設定＋クローラ到達＋インデックス化」という3条件が揃った露出を、検索エンジン側の索引から拾い上げている。

なお、統計として「S3バケットを1つ以上持つ組織の36%が、少なくとも1つを公開読み取り可能に設定していた」という数字が引用されている。設定ミスがいかに普遍的かを示す数字であり、Reconの費用対効果が高い理由でもある。

##### バケット存在確認の内部挙動（原理）

名前候補が「実在するか」の判定は、HTTPレスポンスの差で行われる。存在しないバケット名にアクセスすると、S3は `NoSuchBucket` を含む XML と共に **HTTP 404** を返す。実在するが非公開のバケットは、匿名アクセスに対して **HTTP 403（AccessDenied）** を返す。公開かつリスト可能なバケットは、`ListBucketResult` の XML と共に **HTTP 200** を返す。つまり「404＝不在」「403＝実在するが権限なし」「200＝実在かつ公開」という3値を、レスポンスのステータスコードと本文から機械的に分類できる。列挙ツールが高速に多数の候補を捌けるのは、この単純な分類規則をHTTP問い合わせだけで適用しているからである。

匿名（無認証）でのアクセス可否を確認する際、`aws` CLI では `--no-sign-request` を付けて署名なしリクエストを送る（例: `aws s3 ls s3://<バケット名> --no-sign-request`）。防御側の点検としては、自組織のバケットに対してこれを実行し、匿名でリスト・取得が成功してしまわないかを確かめる用途で使う。

> 出典: AWS Pentesting: S3 Bucket Recon — https://rodelllemit.medium.com/aws-pentesting-s3-bucket-recon-6b906e7b6c86

### cloud_enum——マルチクラウド列挙ツールの仕組み

`cloud_enum`（initstring作）は、AWS・Azure・GCPの3クラウドにまたがる**公開資源のOSINT列挙**を1本で担うツールである。キーワードを起点に候補名を変異生成し、各プロバイダの名前空間へ問い合わせて「公開／保護／不在」を判定する。

#### 対応プロバイダと資源種別

READMEによれば、列挙対象は次のとおり。

- **AWS**: S3バケット（公開・保護の別）、AWSアプリケーション（WorkMail・WorkDocs・Connect）
- **Azure**: ストレージアカウントとBlobコンテナ、ホスト型データベース、仮想マシン、Webアプリ
- **GCP**: Cloud Storageバケット、Firebase Realtime Database、App Engineサイト、Cloud Functions、Firebaseアプリ

一つのキーワードから、これだけ多様なサービスの露出面を横断的に洗えるのが特徴だ。

#### インストールと基本実行

現行版は Python パッケージマネージャ `uv` を前提にしている（README記載。以前のバージョンでは `cloud_enum.py -k ...` という直接実行形式だった点に注意——記事中の `cloud_enum.py` 形式は旧来の呼び出し方）。

```sh
# 依存の同期
uv sync

# キーワードを指定して実行（-k は繰り返し指定可能）
uv run cloud_enum -k somecompany -k somecompany.io -k blockchaindoohickey -t 10
```

- **なぜこう書くのか**: `-k` を複数与えると、社名の表記ゆれやドメイン形（`somecompany` と `somecompany.io`）を同時に候補源にできる。`-t 10` はスレッド数（既定5）で、並列問い合わせ数を上げてスループットを稼ぐ。ただしスレッドを増やすほどDNS・HTTPの試行が増えるため、DNSサーバやネットワークへの負荷とのトレードオフになる。

#### 主なオプション（README）

| フラグ | 意味 |
|---|---|
| `-k KEYWORD` | 検索語（繰り返し指定可） |
| `-kf KEYFILE` | ファイルからキーワードを読み込む |
| `-m MUTATIONS` | 変異語リストを差し替え（既定 `enum_tools/fuzz.txt`） |
| `-b BRUTE` | Azure/GCP用のブルートフォース語リスト |
| `-t THREADS` | 並列スレッド数（既定5） |
| `-ns NAMESERVER` | 使用するDNSサーバを指定 |
| `-l LOGFILE` | 結果をファイルに追記 |
| `-f FORMAT` | 出力形式（text/json/csv） |
| `--disable-aws/azure/gcp` | 特定プロバイダをスキップ |
| `-qs, --quickscan` | 変異と二次スキャンを無効化して高速化 |

#### 内部メカニズム（なぜ動くか）

- **変異（mutation）**: キーワードに `-m` の語リスト（既定 `enum_tools/fuzz.txt`）の各語を接頭辞・接尾辞として結合し、候補名を大量生成する。前述した「名前空間がグローバル一意」という性質があるため、この総当たり的な候補生成が有効になる。
- **二次列挙（secondary enumeration）**: Azure Blobコンテナや GCP Cloud Functions のように、「まず親資源（ストレージアカウント／プロジェクト）を見つけ、その中の子資源（コンテナ名／関数名／リージョン）をさらに当てる」多段構造の資源では、追加のブルートフォースを行う。探索するリージョンの範囲は `azure_regions.py` / `gcp_regions.py` で調整できる。これは、単一のHTTP問い合わせでは判定しきれない資源に対し、階層をひとつ潜って再度名前推測を行う仕組みである。
- **quickscan (`-qs`)**: 変異と二次スキャンを止め、素のキーワードだけを1回ずつ確認する。大量対象のふるい分けや、負荷を抑えた一次点検に向く。

防御側は、自組織名・製品名を `-k` に与えて `cloud_enum` を回すことで、「うっかり公開になっている自社バケット・Blob・関数」を攻撃者と同じ視点で棚卸しできる。出力を `-f json -l` で保存し、定期実行の差分を取れば、新規に露出した資産をアラート化する運用に組み込める。

> 出典: cloud_enum（initstring）— https://github.com/initstring/cloud_enum

### cloud_osint——クラウドOSINTリソースの体系

`cloud_osint`（7WaySecurity作）は、単一のツールではなく、**クラウドReconのためのドーク・ツール・手法を体系的にまとめたキュレーション集**である。AWS・Azure・GCPに加え、IBM Cloud・Oracle Cloudまで対象に含む点が広い。防御側にとっては「自組織がどのクラウドをどう使っているかに応じて、点検すべき露出面のチェックリスト」として使える。

#### 収録カテゴリ（README）

**検索テクニック**
- クラウドストレージのエンドポイントを狙うGoogleドーク（例: `site:blob.core.windows.net`——Azure Blobのホスト名空間に結果を限定）
- Shodanクエリ（`cloud.provider` や `cloud.service` で絞り込み——ホストがどのクラウドの何のサービスかで検索）
- 証明書透明性（CT）ログの検索（crt.sh・Censys経由——発行済み証明書からサブドメインとクラウド利用の痕跡を拾う）

**バケット／ストレージ発見ツール**
- **CloudEnum**（前述のマルチクラウド列挙）
- **S3Scanner**（AWSバケットのスキャンと**権限チェック**——匿名で読み書き・ACL取得が可能かを判定）
- **BucketLoot**（公開バケット内の**機微データ自動検査**——APIキーや資格情報の混入を走査）
- **GrayhatWarfare**（公開クラウドストレージの検索可能な索引）

**マルチクラウド・セキュリティ監査ツール**
- **ScoutSuite**（AWS/Azure/GCPの構成監査）
- **Prowler**（プロバイダ横断で300以上のセキュリティチェック）
- **Steampipe**（クラウド構成に対してSQLで問い合わせる）

**代表的なコマンド**
```sh
curl -s https://ip-ranges.amazonaws.com/ip-ranges.json | jq '.prefixes[]'
```
- **なぜこう書くのか**: AWSは自社の公開IPレンジを `ip-ranges.json` として公開している。`jq '.prefixes[]'` でその各プレフィックス（CIDRとリージョン・サービスの対応）を展開すると、「あるIPがAWSのどのサービス・リージョンに属すか」を判定でき、スキャン結果をクラウド帰属で仕分けできる。攻撃側の索敵にも使えるが、防御側では「自組織の外部露出IPがどのAWSサービス由来か」を機械的に分類する用途で有用だ。

#### 方法論フレームワーク

READMEは、**受動的Recon → インフラのマッピング → 資産発見 → 露出分析 → レポーティング**という段階的ワークフローを強調している。これは本書全体の思想——「まず触れずに観測し、対象像を組み立ててから、必要な確認を最小限に行う」——とも整合する。防御側の資産棚卸しも、この順序（まず公開情報とDNS/証明書からクラウド利用を把握し、次に露出面を列挙し、最後に設定を分析）で進めると漏れが少ない。

> 出典: cloud_osint（7WaySecurity）— https://github.com/7WaySecurity/cloud_osint

### クラウドmisconfigurationの3本柱と原理

> ⚠️ **未取得の資料**: 「A Bug Bounty Hunter's Guide to Cloud Misconfiguration（cocopelly255 / ToxSec）」は自動取得できませんでした（理由: Medium が HTTP 403 を返し本文を取得できず。代替として WebSearch により記事の要約・引用を取得）。以下のURLからご自身で直接ご覧ください: https://medium.com/@cocopelly255/a-bug-bounty-hunter-s-guide-to-cloud-misconfiguration-522db28ff93e
>
> （以下は WebSearch で得た記事要約に、未取得部分を補うための一般知識に基づく解説を加えたものです）

この記事は、クラウド設定ミスを **IAM（Identity and Access Management）**・**サーバーレス関数**・**公開ストレージ** の3本柱で整理する。Recon（資産発見）で見つけた資産が、なぜ・どのように危険になるのかを設定の側から説明するもので、前半までの「発見」の技術と対になる「なぜ問題か」の理解を与える。

#### 柱1: 公開ストレージ（Public Storage）

前述のとおり、S3・Azure Blob・GCSはグローバル名前空間上にあり、公開範囲を広げすぎると匿名で読める。記事は、クラウドの発見においてDNSのCNAMEがS3やCloudFrontを直接指すことが多い点、そして命名規則に対するパーミュテーション走査が公開バケット発見の標準手法である点を改めて強調する。防御の要は「バケット単位のACLではなく、アカウント全体の**パブリックアクセスブロック**を有効化する」「バケットポリシーで `Principal: "*"`（＝全員）を許可していないか監査する」ことにある。

#### 柱2: IAM——ワイルドカード権限の危険

記事の核心の一つが、**過度に広いIAMポリシー**の危険だ。ポリシーのアクション欄に `s3:*` のようなワイルドカードを書くことは、「そのサービスに対する実質的なroot権限」を与えるに等しい、と説明される。

```json
{
  "Effect": "Allow",
  "Action": "s3:*",
  "Resource": "*"
}
```

- **なぜ危険か**: `Action: "s3:*"` は `s3:GetObject`（読み取り）だけでなく `s3:PutObject`（書き込み）・`s3:DeleteObject`（削除）・`s3:PutBucketPolicy`（ポリシー改変）まで全て含む。さらに `Resource: "*"` は対象を全バケットに広げる。このポリシーを持つ資格情報が一つ漏れれば、攻撃者はデータの窃取だけでなく、上書き・削除・公開設定の改変まで実行できてしまう。IAMは「最小権限（least privilege）——必要なアクションを必要な資源に対してだけ許可する」が原則であり、ワイルドカードはその真逆にあたる。

#### 柱3: サーバーレスとSSRF経由のメタデータ窃取

記事は、**SSRF（Server-Side Request Forgery——サーバに任意の宛先へリクエストを送らせる脆弱性）**が、Webアプリの欠陥からクラウド基盤への横移動（ピボット）に化ける経路を説明する。鍵は**インスタンスメタデータサービス**である。

AWSでは、EC2インスタンス内部から `http://169.254.169.254/` という**リンクローカルアドレス**（そのホスト内・同一リンク上でのみ有効な特殊アドレス）にアクセスすると、インスタンスに紐づく情報——とりわけ、割り当てられたIAMロールの**一時的な資格情報**——が返る。

```text
http://169.254.169.254/latest/meta-data/iam/security-credentials/<ロール名>
```

- **なぜ危険か**: WebアプリにSSRFがあると、攻撃者はアプリ自身にこのURLへリクエストさせ、レスポンス（`AccessKeyId`・`SecretAccessKey`・`Token`を含むJSON）を盗める。得た一時資格情報でAWS APIを直接叩けば、アプリの権限（＝EC2ロールの権限）でクラウド操作ができてしまう。ここで柱2の「ワイルドカードIAM」が効いてくる——ロールが広い権限を持つほど、SSRF一発の被害が甚大になる。
- **防御（原理）**: AWSの **IMDSv2** は、メタデータ取得の前に PUT で**セッショントークン**を取得させ、以降のGETにそのトークンを必須とする。単純なGET型のSSRFではトークン取得の往復を成立させにくいため、素朴なSSRFからのメタデータ窃取を大幅に難しくする。IMDSv2の強制、ホップ数制限（`http-put-response-hop-limit`）、そしてEC2ロールの最小権限化が、この経路の主要な対策である。

#### 記事が挙げる主要ツール

- **ScoutSuite**: AWS/Azure/GCPの構成を読み取り、公開ストレージや過度なIAM等の設定ミスを一覧化する監査ツール。
- **Pacu**: AWSの**ポストエクスプロイト（侵入後）**フレームワーク。許可された演習・自組織の検証で、獲得した権限からどこまで到達できるかを評価する用途。
- **ネイティブCLI（`aws` / `gcloud` / `az`）**: 各クラウドの正規操作クライアント。構成確認や自己点検の基本。
- **シークレットスキャナ**: 公開バケットやリポジトリに混入したAPIキー・資格情報を検出する。

> 出典: A Bug Bounty Hunter's Guide to Cloud Misconfiguration — https://medium.com/@cocopelly255/a-bug-bounty-hunter-s-guide-to-cloud-misconfiguration-522db28ff93e

### 防御側への含意（まとめ）

本節で扱った発見手法と設定ミスの原理は、そのまま**自組織の防御チェックリスト**に裏返せる。

- **名前空間の露出を前提に設計する**: バケット・Blob・GCSは名前を当てられれば存在を確認される。名前に機密（内部プロジェクト名・顧客名）を含めない。存在確認自体は防げない前提で、**公開範囲の遮断**（AWSのパブリックアクセスブロック、Azureの匿名アクセス無効、GCSのuniform bucket-level access）を既定にする。
- **索引・ドークで自組織を先に探す**: GrayhatWarfareの検索やGoogleドーク（`site:.s3.amazonaws.com "自社名"`）を定期実行し、露出を攻撃者より先に見つける。CTログ監視でクラウド利用の新規サブドメインも追う。
- **DNSとクラウド資産の対応を棚卸す**: CNAMEの終端を定期確認し、削除済み資源を指す「宙吊りDNS」を除去してサブドメインテイクオーバーを防ぐ。
- **IAMは最小権限**: `Action: "*"` / `Resource: "*"` を監査で禁止し、ScoutSuite・Prowlerで継続的に検査する。資格情報の有効期間を短くし、ロールベースで発行する。
- **メタデータ経路を塞ぐ**: IMDSv2を強制し、EC2ロールの権限を絞る。アプリ層ではSSRFを塞ぎ、`169.254.169.254` を含む内部・リンクローカル宛先への発信をネットワークで遮断する。
- **列挙ツールを守りに使う**: `cloud_enum` を自組織キーワードで回し、`S3Scanner` で権限を、`BucketLoot` で機微データ混入を点検する。出力の差分をアラート化し、露出を継続監視する。

クラウド資産のReconが強力なのは、対象ネットワークに触れずとも、グローバル名前空間・DNS・検索索引という「外から見える構造」だけで資産と設定ミスが露出するからである。防御側は、その同じ構造を自分の視点で先回りして観測し、公開範囲・IAM・メタデータ経路という3つの要所を締めることで、Recon段階での露出そのものを最小化できる。

## Google dorkingとOSINT実践

これまでの節ではサブドメイン列挙やポートスキャンなど「能動的に対象へ触れる」偵察を扱ってきた。本節で扱う **OSINT（Open Source Intelligence、公開情報インテリジェンス）** と **Google dorking（Googleハッキング）** は対照的に、検索エンジンや第三者データベースが既に収集・キャッシュした情報を「読むだけ」で組織の外部攻撃面を洗い出す手法である。対象サーバーに一切パケットを送らずに済むため、法的リスクが低く、Recon(偵察)の最初の一歩として非常にコストパフォーマンスが良い。

### OSINTとは何か、Reconの中での位置づけ

OSINTは「公開されている情報を収集し、分析可能な形に整理して活用する手法」全般を指す。サイバーキルチェーン（攻撃者が偵察→武器化→配送→侵害→……という段階を踏むモデル）で言えば、最初の「偵察（Reconnaissance）」フェーズにそのまま対応する。攻撃者だけでなく防御側も同じ手法を使うことで、自組織が「攻撃者から見て何が見えているか」を把握できる。これは以下のような防御領域に直結する。

- **EASM（External Attack Surface Management、外部攻撃面管理）**: 自組織がインターネット上に公開しているIT資産（ドメイン、サブドメイン、IP、証明書、クラウドバケットなど）を継続的に洗い出し、管理下に置く活動。「自分たちが把握していない資産（シャドーIT）」を発見することが主目的。
- **ASD（Attack Surface Discovery、攻撃表面発見）**: 自社だけでなく、グループ会社・子会社・提携先などの関連組織まで対象を広げて、インターネットに公開されている資産を検出する活動。M&A後のセキュリティ統合や、サプライチェーンリスクの評価で重要になる。
- **CTI（Cyber Threat Intelligence、脅威インテリジェンス）**: ダークウェブや漏洩データベースなどを監視し、自組織に対する攻撃の兆候（認証情報の売買、標的化の議論など）を早期に検出する活動。
- **リスクレーティング**: 発見した資産・脆弱性を数値化・可視化し、優先度をつけて対処するための土台情報を作る活動。

> 出典: OWASP Kansai DAY 2025.09「OSINTにふれてみよう」 — https://speakerdeck.com/deka_morita/owasp-kansai-day-2025-dot-09-osintnihuretemiyou

これらはすべて「対象に直接アクセスしない」情報収集を土台にしており、Google dorkingやShodan/Censysのような第三者インデックスの活用がその中核技術になる。

### 法的・倫理的な前提（本節を通じて厳守すべき境界）

OSINTと呼ばれる手法自体は合法だが、そこから一歩踏み出すと違法行為になる境界がある。日本の文脈では特に以下が問題になりうる。

- ポートスキャンや脆弱性スキャンなど、対象へ直接パケットを送って応答を誘発する行為（不正アクセス禁止法に抵触する可能性がある）。
- 非公開情報に対して推測した認証情報でログインを試みる行為。
- 収集した個人情報・機密情報をそれ自体の目的以外（嫌がらせ、恐喝、転売など）に利用する行為。
- ウイルス作成・提供に関する規定（不正指令電磁的記録に関する罪）に触れるような、収集した情報を用いた攻撃ツールの作成・配布。

本節および本教科書全体は「自組織または許可を得た対象に対する防御目的の資産把握」を前提とし、実在サービス・本番環境への無許可の検証や、特定のラボ環境の攻略手順は扱わない。以下で紹介するツール・クエリは、事前に許可された対象、あるいは自分自身の資産・公開されたテスト用データに対してのみ使用すること。

> 出典: OWASP Kansai DAY 2025.09「OSINTにふれてみよう」 — https://speakerdeck.com/deka_morita/owasp-kansai-day-2025-dot-09-osintnihuretemiyou

### Google dorking（Googleハッキング）の仕組み

Google dorkingとは、Googleの検索演算子（オペレータ）を組み合わせて、通常の検索では埋もれてしまう「意図せず公開されてしまった」ページやファイルを掘り出す手法である。仕組みの核心は次の通り。

Googleのクローラは公開されているURLを巡回してインデックス（本文テキスト、タイトル、URL構造、レスポンスヘッダの一部などをまとめたデータベース）を作る。検索演算子はこのインデックスに対する「絞り込みフィルタ」であり、代表的なものは以下である。

| 演算子 | 意味 |
|---|---|
| `site:` | 指定ドメイン内のページに限定する |
| `inurl:` | URL文字列に指定語を含むページに限定する |
| `intitle:` | ページタイトルに指定語を含むページに限定する |
| `intext:` | 本文に指定語を含むページに限定する |
| `filetype:` | 指定の拡張子（pdf, xls, sql, envなど）のファイルに限定する |

これらを組み合わせると、「本来インターネットに公開する意図のなかった管理画面やファイルが、たまたまクロールされてインデックスに載ってしまった」ケースを効率的に発見できる。攻撃者はこれを悪用して次のURLパターンを狙う。

```
site:target.com inurl:admin
intitle:login site:website.com
intitle:/admin site:website.com
inurl:admin intitle:admin intext:admin
```

なぜこれで管理画面が見つかるのかというと、多くのCMSやフレームワークは管理画面のURLパスに `admin` という文字列を含める慣習があり（`/admin`, `/wp-admin` など）、かつログインページのタイトルタグに `Login` や `Admin` という単語を機械的に埋め込むことが多いためである。`inurl:admin` と `intitle:login` を `site:` と組み合わせることで、この慣習に依存したURL・タイトルのパターンマッチが成立する。さらに、`admin` 以外にも次のような代替語をキーワードに使うと発見率が上がる、と紹介されている。

```
administrator, debug, login, root, wp-login, master, superuser
```

これは、CMSやフレームワークごとに命名慣習が異なる（WordPressなら `wp-login.php`、汎用フレームワークなら `debug` や `master` を含む内部管理画面名を使うことがある、など）ためであり、辞書的に候補語を並べて機械的に試すのがdorkingの基本戦術になる。

> 出典: 10 Minute Bug Bounties: OSINT with Google Dorking, Censys and Shodan — https://codelivly.com/10-minute-bug-bounties-osint-with-google-dorking-censys-and-shodan/

防御側の観点では、これらのdorkを自組織のドメインに対して定期的に実行し、「意図せず公開されている管理画面やファイル」を自ら発見して`robots.txt`での除外・認証の追加・そもそも非公開ネットワークへの移設などの対策を取ることが、EASMの具体的な実践の一つになる。

### GHDB（Google Hacking Database）

Google dorkingを体系化したものが **GHDB（Google Hacking Database）** であり、脆弱なバージョン文字列、エラーメッセージ、デフォルトのファイル名など、機微な情報が漏れやすいパターンを集めたデータベースとして公開・更新されている。個々のdorkを自作する代わりに、GHDBに登録済みのdorkを自組織ドメインに対して実行することで、既知の漏洩パターン（例: 特定CMSの設定ファイルが誤ってWeb公開ディレクトリに置かれている、バックアップファイルの拡張子がインデックスされている等）を効率よく確認できる。

> 出典: OWASP Kansai DAY 2025.09「OSINTにふれてみよう」 — https://speakerdeck.com/deka_morita/owasp-kansai-day-2025-dot-09-osintnihuretemiyou

### Shodan・Censys：インターネット全体をスキャン済みのインデックスを検索する

Google dorkingが「Webページのテキスト」をインデックス対象にするのに対し、**Shodan** と **Censys** は「インターネット上の全IPアドレスに対して定期的にポートスキャン・バナー取得・TLS証明書取得を行い、その結果をインデックス化して検索可能にした」サービスである。仕組みとしては、これらのサービス自身が広範囲にスキャンを行い（利用者が直接スキャンするわけではない）、取得したバナー文字列・HTTPレスポンス・TLS証明書のSAN（Subject Alternative Name、証明書に紐づく追加のホスト名一覧）などを全文検索エンジンに投入している。利用者はこの「既にスキャンされ終わったデータ」に対して検索するだけなので、対象への直接アクセスは発生しない。これがOSINTとして扱われる理由である。

#### Censysの検索クエリ例

```
https.tls.version: "TLS 1.2" and parsed.names: "example.com"
```

これは、TLS 1.2で通信しているサーバーのうち、証明書のSAN（parsed.names）に`example.com`を含むものを検索するクエリである。古いTLSバージョンで稼働しているサーバーは、既知の暗号スイート脆弱性（BEASTやPOODLEなど、対象は主にTLS 1.0/1.1だが1.2でも設定不備が残るケースがある）の対象になりやすいため、防御側は自組織のドメインに紐づく証明書がどのTLSバージョンで稼働しているかを一覧化し、TLS 1.3への移行状況を確認する用途に使える。

期限切れ証明書を対象にした検索も紹介されている。ポート443（HTTPS標準ポート）で稼働しており、認証局（CA）が発行したものではない、あるいは有効期限が切れている証明書を持つホストを対象にする考え方である。証明書が期限切れのまま放置されているホストは、運用が形骸化している「忘れられた資産」である可能性が高く、EASMの観点で優先的に精査すべき対象になる。

```
protocols: "mongodb" and location.country_code: US
```

これは、MongoDBプロトコルで応答しているホストのうち、位置情報が米国であるものを検索するクエリである。MongoDBはデフォルト設定では認証なしでバインドされることがあり、インターネットに公開されたまま放置されると第三者に読み書きされてしまう。自組織のクラウド資産がこのクエリに引っかからないかを確認することは、データベースの公開範囲チェックそのものである。

> 出典: 10 Minute Bug Bounties: OSINT with Google Dorking, Censys and Shodan — https://codelivly.com/10-minute-bug-bounties-osint-with-google-dorking-censys-and-shodan/

#### Shodanの検索クエリ例

```
product:"IP camera" http.html:"Login" http.html:"password"
```

IPカメラ製品のうち、HTTPレスポンスのHTML本文に`Login`と`password`という文字列を含むホストを検索するクエリである。多くのIPカメラは初期設定のままインターネットに直接公開され、デフォルト認証情報（例: admin/admin）のまま運用されているケースが後を絶たない。`http.html` フィールドで検索できるのは、Shodanがバナー取得時にHTTPレスポンスボディの一部も保存しているためであり、ログインフォームの文言から製品・設定状態を推測できる。

Apache Struts脆弱性に関連する検索は、404エラーページの特徴的な文字列を持つサーバーを対象にする、という考え方が紹介されている。フレームワークやミドルウェアはエラーページにバージョン情報やスタックトレースの一部を出力してしまうことがあり、その文字列パターンをShodanのバナーデータから検索することで、パッチ未適用のバージョンが稼働しているホストを外形的に推測できる。これはバージョン依存の情報であるため、実際に運用する場合は対象ソフトウェアの最新のCVE情報と照合し、自組織のパッチ適用状況を必ず確認する必要がある。

```
"MongoDB Server Information" "Set-Cookie: mongo-express"
```

これは、MongoDBの管理UIである mongo-express が稼働していることを示すバナー文字列・Cookie名を検索するクエリである。mongo-expressはデフォルトで認証が無効、あるいは弱い認証情報で公開されがちなツールであり、これが外部から見えている場合はデータベース全体への読み書きアクセスを許してしまっている可能性が高い。

いずれの記事でも一貫して強調されているのは「必ず白帽子的な合法的な利用に限定すること」という前提である。ShodanやCensysで見つかったホストが自組織の資産でない場合、それに対してログインを試みたり設定を変更したりする行為は不正アクセスに該当する。

> 出典: 10 Minute Bug Bounties: OSINT with Google Dorking, Censys and Shodan — https://codelivly.com/10-minute-bug-bounties-osint-with-google-dorking-censys-and-shodan/

### OSINT Frameworkとその他の実践ツール

**OSINT Framework** は、1000以上の個別ツール・サービスへのリンクを30以上のカテゴリ（ドメイン調査、メールアドレス調査、画像調査、SNS調査など）に整理したマインドマップ形式のカタログである。個々の調査目的に応じて「まずどのツールを見ればよいか」を探す出発点として使う。カテゴリ横断で網羅的にツールを探索できる点が、単発のGoogle dorkingと異なる強みである。

ハンズオンで紹介された実践的な調査シナリオと対応ツールは次の通りである。

1. **個人情報漏洩調査**: Amazonの「欲しいものリスト」公開設定から個人情報が推測できるケース、**Have I Been Pwned?**（メールアドレスが既知の漏洩データベースに含まれているか確認するサービス）、ダークウェブ監視サービスの活用。
2. **Webサーバー設定確認**: **Security Headers**（`Content-Security-Policy`や`Strict-Transport-Security`などのセキュリティ関連HTTPレスポンスヘッダの設定状況を採点するサービス）、**Qualys SSL Labs**（TLS/SSLの構成強度・証明書チェーン・脆弱な暗号スイートの有無を診断するサービス）、サーバー証明書の検証。
3. **既知脆弱性調査**: CVE（Common Vulnerabilities and Exposures、個別の脆弱性に付与される識別番号）とCVSS（脆弱性の深刻度を数値化する指標）を軸に、Shodanで取得したバナー情報（ソフトウェア名・バージョン文字列）と照合して既知脆弱性の有無を推測する。
4. **オープンポート調査**: Telnet、RDP、FTPなど、平文通信や強力な管理権限を持つプロトコルが外部に開いていないかを確認し、**VirusTotal**や**GreyNoise**（そのIPが既知の悪性活動やスキャン活動に関連付けられていないかを確認するサービス）でブラックリスト照合を行う。
5. **IoT機器セキュリティ**: **Insecam**（設定不備で公開されているネットワークカメラの映像を集約するサイト）やデフォルトパスワードのままのIoT機器の発見。
6. **Google Hacking**: 前述のGHDBを用いた機微情報検索。

補助的に紹介されているツールとしては、**crt.sh**（証明書透明性ログ、Certificate Transparency Logを検索し、あるドメインに対して発行されたSSL/TLS証明書の履歴からサブドメインを推測できるサービス）、**DNS Dumpster**（DNSレコードとネットワークマッピングを可視化するサービス）、**Whois**（ドメイン登録情報の照会）、**Netcraft**（サイトのホスティング環境やSSL証明書の履歴調査）、**urlscan.io**（指定URLを実際にヘッドレスブラウザで開いて、通信先ドメイン・スクリーンショット・使用技術などを記録し検索可能にするサービス）がある。これらはいずれも「第三者が既に収集したデータを検索する」という点でGoogle dorkingやShodan/Censysと同じ設計思想に立っており、対象に直接アクセスせずに外部攻撃面を俯瞰できる。

> 出典: OWASP Kansai DAY 2025.09「OSINTにふれてみよう」 — https://speakerdeck.com/deka_morita/owasp-kansai-day-2025-dot-09-osintnihuretemiyou

### 防御側の実践への落とし込み

本節の内容をEASM/ASDの運用に落とし込むと、次のような継続的なチェックリストになる。

- 自組織ドメイン・関連組織ドメインに対してGHDB相当のdorkを定期実行し、意図しない公開ファイル・管理画面のインデックスを監視する。
- ShodanやCensysで自組織のIPレンジ・ドメインを検索し、想定外のポート・ミドルウェア（管理UI、データベースの直接公開など）が外部から見えていないかを確認する。
- crt.shなどの証明書透明性ログを監視し、自組織名義で見覚えのない証明書が発行されていないか（サブドメインの野良発行や乗っ取りの兆候）を確認する。
- Security HeadersやQualys SSL Labsで自組織の公開エンドポイントのTLS構成・セキュリティヘッダを定期的に採点し、劣化（古いTLSバージョンの残存、証明書の期限切れなど）を早期に検出する。

これらはいずれも対象への非破壊的なアクセス（第三者インデックスの検索や、自組織自身のエンドポイントへの通常アクセス）で完結するため、事前許可の取得コストが低く、Recon工程の中でも最も着手しやすい部類に入る。次節以降では、ここで洗い出した資産をもとに、より対象に踏み込んだ列挙・スキャン手法へと進んでいく。

---

[← 第6章 JavaScript Reconとクライアント資産](06-javascript-recon.md) ｜ [📖 目次](index.md) ｜ [第8章 歴史データ・アーカイブの活用 →](08-historical-data.md)
