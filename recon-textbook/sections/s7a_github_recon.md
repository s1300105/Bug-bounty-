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
