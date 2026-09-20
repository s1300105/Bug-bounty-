## 方法論アーカイブと発展トレーニング

Reconの学習は、あるところで「新しいツールを覚える」フェーズを卒業する。次に必要になるのは、**先行研究者が何を考えてその順番で手を動かしていたのか**という意思決定のフレームを取り込むことだ。ツール名は3年で入れ替わるが、「どの入力からどの出力を作り、何を根拠に次の一手を決めるか」という構造は10年単位で生き残る。

本節では、方法論のアーカイブ（歴代スライド・講演の集積）と、体系化されたフルトレーニング（TBHM）、そして最新（2025年）のパイプライン講座という3つの資料を、**「陳腐化する部分」と「陳腐化しない部分」に切り分けながら**読む方法を扱う。

> 本節は防御・学習目的の解説である。紹介するコマンド例は、自分が管理する環境、または対象プログラムが明示的に能動テストを許可した範囲でのみ実行すること。実在サービスや本番環境への無許可の検証は行わない。また本節は特定のラボの攻略手順を扱わない。

---

### 1. Bug Hunter Handbook「Presentations」——方法論アーカイブの構造

Bug Hunter Handbook の Presentations ページは、Bug Bounty黎明期（2017年前後）から2020年頃までの方法論スライド／講演を集めたリンク集である。単なるブックマークに見えるが、**並べて読むと「方法論の系譜」が見える**という点に教材としての価値がある。

#### 1-1. 収録されている資料（原典の一覧）

ページ本体のテーブルには、次の資料が収録されている。

| # | タイトル | URL |
|---|---|---|
| 1 | BUG BOUNTY FUNSHOP | `https://docs.google.com/presentation/d/1cpcxEBEb0dyXwRqSWQ6bknJS-PQO_e242Dioy9SU2Io/edit` |
| 2 | Bug Hunting Methodology | `https://blog.usejournal.com/bug-hunting-methodology-part-1-91295b2d2066` |
| 3 | It is little things - Nahamsec | `https://docs.google.com/presentation/d/1xgvEScGZ_ukNY0rmfKz1JN0sn-CgZY_rTp2B_SZvijk/edit` |
| 4 | Recon-1 | `https://bugbountytuts.files.wordpress.com/2019/01/dirty-recon-1.pdf` |
| 5 | All in one Recon | `https://drive.google.com/file/d/1uBTra6_jwhLnZALJVp9hmHaty2pBBUH2/view` |
| 6 | Automation for Bughunters（mhmdiaa） | `https://speakerdeck.com/mhmdiaa/automation-for-bug-hunters` |
| 7 | Passivish Recon（TomNomNom） | `https://tomnomnom.com/talks/passiveish.pdf` |
| 8 | Automating Application Security Bug Hunting（BSidesSF 2019） | `https://static.sched.com/hosted_files/bsidessf2019/65/...pdf` |
| 9 | BugBounty automation（ZeroNights 2018） | `https://2018.zeronights.ru/wp-content/uploads/materials/4%20ZN2018%20WV%20-%20BugBounty%20automation.pdf` |
| 10 | Automating Web Application Bug Hunting（Jerry Gamblin / Jonathan Cran） | `https://www.youtube.com/watch?v=12gtkYbMGd4` |
| 11 | Work Smarter, Not Harder | `https://vavkamil.cz/wp-content/uploads/2019/05/ctjb_2019_bugbounty.pdf` |
| 12 | Automating-the-recon-process | `https://null.community/event_sessions/2618-automating-the-recon-process` |
| 13 | Scrutiny on the bug bounty | `https://docs.google.com/presentation/d/1PCnjzCeklOeGMoWiE2IUzlRGOBxNp8K5hLQuvBNzrFY/edit` |
| 14 | Bug Bounties With Bash（TomNomNom） | `https://tomnomnom.com/talks/bash-bug-bounty.pdf` |
| 15 | ekoparty 2017 - the bug hunters methodology | `https://www.slideshare.net/bugcrowd/ekoparty-2017-the-bug-hunters-methodology` |

さらに **TBHM（The Bug Hunter's Methodology, Jason Haddix）の歴代版**が版ごとに列挙されている。ここが本ページの中核である。

| 版 | 内容・位置づけ | URL |
|---|---|---|
| v1 | 原典 "How Do I shot Web?"（PDF、jhaddix/tbhm リポジトリ） | `https://github.com/jhaddix/tbhm/blob/master/How%20Do%20I%20shot%20Web-.pdf` |
| v2.0 | Google Slides版 | `https://docs.google.com/presentation/d/1p8QiqbGndcEx1gm4_d3ne2fqeTqCTurTC77Lxe82zLY/edit` |
| v2.1 | Nullcon Goa 2018 版PDF | `https://nullcon.net/website/archives/pdf/goa-2018/jason-tbhm2.pdf` |
| v3 | Google Slides版 | `https://docs.google.com/presentation/d/1R-3eqlt31sL7_rj2f1_vGEqqb7hcx4vxX_L7E23lJVo/edit` |
| v4 | Google Drive PDF | `https://drive.google.com/file/d/1aG_qqRvNW-s5_8vvPk5rJiMSMeNL2uY9/view` |
| v4 Recon | v4のRecon特化版スライド | `https://docs.google.com/presentation/d/1MWWXXRvvesWL8V-GiwGssvg4iDM58_RMeI_SZ65VXwQ/edit` |
| 動画 | TBHM Video | `https://www.youtube.com/watch?v=gIz_yn0Uvb8` |

加えて **VirSecCon 2020** のスライド8本（うち `erbbysam` の "Trials, Tribulations & VHost Misconfigurations"、`tomnomnom.com/talks/bug-bounties-with-bash-virsec.pdf` など）と、**NahamCon** の埋め込み動画（`https://www.youtube.com/watch?v=MYsUhAgSgwc`）が続く。

> 出典: Bug Hunter Handbook — Presentations — https://gowthams.gitbook.io/bughunter-handbook/presentations

#### 1-2. 系譜として読む：3本の流れ

この一覧は、無秩序に見えて実は3つの流れが並走している。

1. **「方法論の体系化」の流れ**（ekoparty 2017 → TBHM v1〜v4 → v4 Recon）
   スコープ定義・資産発見・列挙・アプリ解析という**段階分け**そのものを発明していった系列。v1（"How Do I Shot Web?"）は「web hackingの総覧」だったが、v4でついに *Recon編* が独立したスライドに切り出された。これは、資産発見が「準備作業」から「独立した専門領域」へ昇格した瞬間を示す歴史的マーカーである。
2. **「自動化」の流れ**（Automation for Bug Hunters / ZeroNights 2018 BugBounty automation / Automating the recon process / BSidesSF 2019）
   ツールを繋いで回す発想。ここで確立した「1行1レコード＋パイプ＋差分検知」という設計が、のちのProjectDiscoveryツール群の入出力契約へ直結する。
3. **「シェル職人芸」の流れ**（TomNomNom: Passiveish / Bug Bounties With Bash）
   汎用ツールを作らず、`grep` `sort -u` `comm` `xargs -P` といったUnix標準コマンドで組む思想。**「パッシブ寄り（passiveish）」**という発想——つまり対象に直接パケットを送らずにどこまで情報が取れるかを最大化し、能動的な操作は最後に最小限だけ行う——は、スコープ遵守と検知回避の両面で今も有効な原則である。

#### 1-3. アーカイブ資料を扱うときの実務的注意（リンク腐食）

この種のリンク集は、**リンク腐食（link rot）**が最大の敵になる。Google Slides はオーナーが共有設定を変えれば即座に閲覧不能になり、カンファレンスサイト（ZeroNights 2018、Nullcon archives 等）はドメインごと消えることがある。有用な資料に出会ったら、その場で保全する習慣を持つ。

```bash
# 1) 現時点の版をWayback Machineに保存要求し、保存先URLを記録する
#    （save/ エンドポイントはアーカイブ後、Location か本文中に保存URLを返す）
curl -sS -I "https://web.archive.org/save/https://tomnomnom.com/talks/passiveish.pdf" \
  | grep -i '^content-location\|^location'

# 2) 手元にも原本を確保し、内容ハッシュを控える（後で「同じ版か」を判定できる）
curl -sSL -o passiveish.pdf "https://tomnomnom.com/talks/passiveish.pdf"
shasum -a 256 passiveish.pdf | tee passiveish.pdf.sha256
```

なぜハッシュまで取るのか。スライドは**同一URLのまま中身だけ差し替えられる**ことがあり、後日「自分が読んだのはどの版か」を証明できなくなるためである。教科書やノートに引用するときは、URLに加えて「取得日」と「SHA-256の先頭8桁」を添えておくと、再現性のある参照になる。

---

### 2. The Bug Hunter's Methodology フルトレーニング——カリキュラムの分解

> ⚠️ **未取得の資料**: 「The Bug Hunters Methodology full training（Class Central）」のページ本体は自動取得できませんでした（理由: サーバが HTTP 403 Forbidden を返し、ボット経由のアクセスを拒否したため）。以下のURLからご自身で直接ご覧ください: https://www.classcentral.com/course/youtube-the-bug-hunter-s-methodology-102530

ただし、同ページが掲載している**レッスン一覧（タイムスタンプ付き）**は検索経由で取得できたため、以下に再構成する。この講座は Jason Haddix による約2時間のフルトレーニング動画（YouTube配信をClass Centralがインデックス化したもの）で、構成は明確に **[MANUAL]（人間が判断する部分）** と **[AUTOMATION]（機械に任せる部分）** の二部制になっている。

| 区分 | レッスン | 開始位置 |
|---|---|---|
| MANUAL | Find root domain | 00:01:40 |
| MANUAL | Find sub-domains | 00:01:40 |
| MANUAL | Find acquisition domains | 00:05:40 |
| MANUAL | Find autonomous system numbers (ASNs) | 00:08:22 |
| MANUAL | ASN enumeration | 00:16:00 |
| MANUAL | Reverse WHOIS | 00:16:54 |
| MANUAL | AD/analytics relationships | 00:20:06 |
| MANUAL | Legal | 00:24:24 |
| MANUAL | SHODAN | 00:26:58 |
| AUTOMATION | Sub-domain enumeration | 00:27:57 |
| AUTOMATION | Sub-domain scrapping（scraping） | 00:40:12 |
| AUTOMATION | Questions/benchmarks | 01:08:32 |
| AUTOMATION | Sub-domain brute-force | 01:15:46 |
| AUTOMATION | Port analysis | 01:19:43 |
| AUTOMATION | Screenshots | 01:26:54 |
| AUTOMATION | Sub-domain takeover | 01:34:42 |
| AUTOMATION | Extending tools | 01:39:21 |
| AUTOMATION | Frameworks | 01:43:47 |

> 出典: Free Course: The Bug Hunter's Methodology（YouTube / Class Central） — https://www.classcentral.com/course/youtube-the-bug-hunter-s-methodology-102530

#### 2-1. この順番には必然性がある

カリキュラムを「章立て」としてではなく「**データフロー**」として読むと、設計意図が見えてくる。

- **root domain → sub-domains → acquisition domains → ASN**：これは*垂直*（1つの登録ドメインの下を掘る）から*水平*（組織が持つ別のドメイン群へ広げる）への拡張である。買収（acquisition）ドメインとASN（Autonomous System Number、BGPで経路広告を行う自律システムに割り当てられた番号）は、いずれも「同じ組織が支配する、別の名前空間／別のIP空間」を見つけるための手段だ。**DNS名から辿れない資産は、IP側（ASN → CIDR）から辿るしかない**——だからASNが早い段階に置かれている。
- **Reverse WHOIS / AD・analytics relationships**：登録者情報（組織名・メールアドレス）や、ページに埋め込まれた広告・解析タグ（例: Google Analytics のトラッキングID）を*共通キー*にして、別ドメインを相関させる手法。原理は単純で、**運用チームが同じなら同じ識別子を使い回す**という人間側の癖を突いている。技術的な穴ではなく運用上の痕跡を辿る点が重要で、だからこそDNS列挙では絶対に出てこない資産が出る。
- **Legal（00:24:24）が [MANUAL] の終盤に置かれている**：これは教材設計として極めて重要な配置である。資産を広げれば広げるほど「その資産は本当に対象組織のものか」「プログラムのスコープ内か」という帰属（attribution）と法的許諾の問題が急速に重くなる。**スコープ確認は自動化できない**ため、自動化パートに入る直前の関門として置かれている。クラウド共有基盤上のIPや、買収前の子会社資産は典型的な事故源である。
- **[AUTOMATION] へ移る境界（00:27:57）**：ここから先は「人間が判断した対象リストを、機械で網羅的に展開する」フェーズになる。列挙 → スクレイピング → ブルートフォース → ポート解析 → スクリーンショット → テイクオーバー判定、と**出力が次の入力になる直列構造**をとる。

#### 2-2. 「Questions/benchmarks」——この講座の思想的な核

注目すべきは、自動化パートの真ん中（01:08:32）に **Questions/benchmarks** が挟まっていることだ。ツールの使い方を並べる講座なら不要なセクションである。ここが入る理由は、**「どのサブドメイン列挙ツールが優れているか」を主観や流行ではなく計測で決める**という姿勢にある。

ベンチマークの基本形は、同じ入力に対して各ツールを走らせ、(a) ユニーク件数、(b) 他ツールにない固有の発見（unique contribution）、(c) 誤検出（解決しないホスト）の3軸で比較することだ。

```bash
# 前提: 自分が管理するドメイン、または能動的な列挙が明示的に許可された対象でのみ実行する
D=example.internal   # 自分の検証用ゾーン

# 各ツールの生出力を別ファイルに保存（比較可能にするため正規化: 小文字化 + 重複排除）
toolA -d "$D" | tr 'A-Z' 'a-z' | sort -u > a.txt
toolB -d "$D" | tr 'A-Z' 'a-z' | sort -u > b.txt

# 1) 件数
wc -l a.txt b.txt

# 2) Aだけが見つけたもの / Bだけが見つけたもの（comm は「ソート済み前提」で集合演算する）
comm -23 a.txt b.txt > only_a.txt
comm -13 a.txt b.txt > only_b.txt

# 3) 実在性の検証: 名前解決できたものだけを「真の発見」とみなす
cat a.txt b.txt | sort -u | dnsx -silent -a -resp-only >/dev/null
```

なぜ `sort -u` を先に通すのか。`comm` は**入力が辞書順にソート済みであることを前提に、2つのストリームを先頭から1行ずつ突き合わせる**アルゴリズムで動くため、未ソートのまま渡すと結果が静かに壊れる（エラーにならず、間違った差分が出る）。ここは初学者が最も踏みやすい罠である。また `tr 'A-Z' 'a-z'` を通すのは、DNS名が大小文字を区別しない（RFC 4343）一方で、ツールによっては CTログ由来の大文字混じりの名前をそのまま出力するため、正規化しないと「同じホストが2件」と数えられてしまうからだ。

**評価指標として件数だけを見てはいけない**理由も同じ文脈にある。ワイルドカードDNS（`*.example.com` が何を引いても同じIPを返す設定）が有効なゾーンでは、ブルートフォース系ツールが数万件の「解決するが実在しない」名前を吐く。したがって「解決したか」ではなく「**ワイルドカード応答と異なる結果を返したか**」で真偽を判定する必要がある。

#### 2-3. 「Extending tools」と「Frameworks」——最後の2章が意味するもの

末尾の2セクション（Extending tools 01:39:21 / Frameworks 01:43:47）は、この講座が単なるツール紹介で終わらないことを示している。

- **Extending tools**：既存ツールを「使う」のではなく「延長する」。具体的には、ツールの出力形式（JSON Lines等）を解釈して自分の判断ロジックを後段に足す、ワードリストを対象固有の語彙で育てる、テンプレート／シグネチャを自作する、といった行為を指す。**他のハンターと同じツールを同じ設定で回している限り、発見も他人と同じになる**——差別化の源泉がここにあるという主張である。
- **Frameworks**：個別ツールをオーケストレーションする枠組み（実行順序、再実行、差分管理、通知）へ移行する段階。本教科書のLv9（自動化）・Lv10（継続監視）に直結する。

#### 2-4. 陳腐化への注意——固有名詞は置換表で読む

この講座はTBHM v3〜v4期（おおむね2018〜2020年）の内容である。**構造（段階分けと判断基準）は現在も有効だが、登場するツール名の一部は保守停止・置換されている**。読むときは、以下のように「役割」に翻訳して受け取るとよい（2026年時点で一般的な選択肢を併記）。

| 講座中の役割 | 当時よく使われたもの | 現在の代表例（2026年時点） |
|---|---|---|
| パッシブなサブドメイン列挙 | sublist3r 等 | `subfinder`、`amass`（intel/enum）、CTログ直接照会 |
| 名前のブルートフォース | massdns + ラッパ | `puredns`、`shuffledns`（内部でmassdns） |
| 順列生成 | altdns | `alterx`、`gotator` |
| HTTPプローブ | httprobe | `httpx`（ステータス・タイトル・技術検出まで一括） |
| スクリーンショット | EyeWitness、aquatone | `gowitness`、`httpx -screenshot` |
| ポート解析 | masscan → nmap | `naabu` → `nmap`（naabuで絞ってからnmapで詳細） |
| テイクオーバー判定 | tko-subs、subjack | `nuclei`（takeoverテンプレート群）、`dnsx` のCNAME確認併用 |

重要なのは、**置換表の右側もいずれ古くなる**という点だ。だから覚えるべきは「HTTPプローブという工程が必要である」という構造の方であり、実装は都度公式ドキュメントで最新の推奨を確認する。

---

### 3. NahamSec × ProjectDiscovery「Free Post Recon Course」——自動化から方法論へ

> ⚠️ **未取得の資料**: 「NahamSec × ProjectDiscovery『Free Post Recon Course』」（YouTube動画）は自動取得できませんでした（理由: YouTubeの動画ページは説明文・チャプター情報をJavaScriptで描画するため、テキスト取得ではフッタのみが返り、本文メタデータを抽出できなかった。テキスト抽出プロキシ経由の再取得も 401 で拒否された）。以下のURLからご自身で直接ご覧ください: https://www.youtube.com/watch?v=RYdTp4a9S34

公開情報から確認できた範囲は次の通りである。

- タイトル: **"Free Post Recon Course and Methodology For Bug Bounty Hunters"**（NahamSecチャンネル、**2025年11月24日**公開）。
- 同シリーズの前編にあたる **"Free Recon Course and Methodology For Bug Bounty Hunters"**（`https://www.youtube.com/watch?v=evyxNUzl-HA`）が存在し、本動画はその「Recon の後」を扱う続編という位置づけ。
- ProjectDiscovery公式が同シリーズについて告知した内容（2025年9月）では、ウォークスルーの骨子が次のように示されている——「**VPS上にrecon用マシンを構築し／Go製インストーラ（pdtm）でPDツール群を一括導入・更新し／Subfinder → AlterX → DNSX → Naabu → HTTPX → Katana と連結し／automation から methodology へ進む**」。

> 出典: Free Post Recon Course and Methodology For Bug Bounty Hunters（NahamSec, 2025-11-24） — https://www.youtube.com/watch?v=RYdTp4a9S34
> 出典（補助）: ProjectDiscovery 公式告知（2025-09） — https://x.com/pdiscoveryio/status/1970567801023721872

（以下は未取得資料の補足として一般知識に基づく解説です）

#### 3-1. 「automation → methodology」という言い回しの意味

この一句が、シリーズ全体のテーゼである。パイプラインを組めるようになった直後のハンターが必ず直面する壁は、「**動いている。大量に出力される。で、どれを見ればいいのか？**」という問題だ。Reconの成果物は往々にして数千行のホスト一覧になるが、脆弱性は人が触ったところからしか出ない。したがって Post-Recon の本質は**トリアージ（選別）**である。

実務的には、次の軸で優先度をつける考え方が一般的である。

1. **新しさ**：直近に初めて観測された資産（新規サブドメイン、新規証明書、新規JSバンドル）。運用が固まる前の期間は設定不備が残りやすく、かつ他のハンターがまだ見ていない。差分検知（`anew` 等）の出力がそのまま優先キューになる。
2. **非標準性**：組織の大多数のホストと**違う**もの。異なるHTTPサーバ、異なるフレームワーク、異なる認証方式、非標準ポート。標準テンプレートから外れたホストは、標準の防御（WAFルール、共通ミドルウェア）からも外れている確率が高い。
3. **機能密度**：ログイン後の機能が多い、ファイルアップロードがある、外部連携（OAuth、Webhook、SSO）がある。攻撃面は「エンドポイント数」ではなく「状態遷移の数」に比例する。
4. **周辺性**：ステージング／レガシー／買収由来のホスト。ただし**スコープ内であることの確認が必須**で、ここを省略した瞬間に、学習が違反行為に変わる。

#### 3-2. チェーンの各段が「何を捨てているか」で理解する

告知にある `Subfinder → AlterX → DNSX → Naabu → HTTPX → Katana` は、Lv9で扱ったパイプラインと同型だが、Post-Recon の視点で見ると**各段は「候補を増やす段」と「候補を捨てる段」が交互に並んでいる**ことがわかる。

```
Subfinder  : 増やす（受動ソースから既知の名前を集める）
AlterX     : 増やす（既知名の語彙から順列候補を生成する＝まだ存在しない名前も含む）
DNSX       : 捨てる（解決しない名前を落とす＝実在性フィルタ）
Naabu      : 捨てる／絞る（開いているポートだけを残す）
HTTPX      : 捨てる／属性付け（応答したものだけを残し、ステータス・タイトル・技術を付与）
Katana     : 増やす（1ホストの内部を展開してエンドポイント集合にする）
```

この「増やす／捨てる」の交互構造が重要なのは、**捨てる段を省くと次段の負荷が指数的に増える**からだ。AlterXは組み合わせ爆発を起こしうる（語彙数×位置×区切り文字）ため、DNSXによる実在性フィルタなしにNaabuへ流せば、存在しないホストに対する無意味なスキャンを大量に発生させる。これは自分のコストの問題であると同時に、**対象や第三者のネットワークに無用な負荷をかけない**という倫理・法務上の要請でもある。

なお、ProjectDiscoveryの告知文では "Naboo" と綴られているが、これはポートスキャナ **`naabu`** の誤記と解するのが自然である（同社ツール群に "naboo" という製品は存在しない）。原典の表記を引く際は、こうした綴りのゆれに注意されたい。

#### 3-3. VPS上に「recon box」を作る、の技術的な意味

講座が「VPS recon box」を前提に置くのは、単に手元PCを汚したくないからではない。主な理由は3つある。

1. **ネットワーク的な事情**：家庭用回線の動的IPから大量のDNSクエリやHTTPリクエストを出すと、ISP側のレート制限やDNSリゾルバの制限に当たる。またプロバイダの利用規約に抵触する可能性もある。
2. **長時間実行**：継続Recon（Lv10）はcron等で回し続けるものであり、ノートPCの電源状態に依存させられない。
3. **再現性**：ツール群を `pdtm` で一括導入・更新することで、「自分の環境でだけ動く」状態を避けられる。

```bash
# pdtm（ProjectDiscovery Tools Manager）で主要ツールを導入・更新する
# ※ 事前に Go のツールチェーンが必要。導入先は既定で ~/.pdtm/go/bin
pdtm -install-all        # 一括導入
pdtm -update-all         # 一括更新（バージョン揃えは再現性の前提）
pdtm -list               # 導入済みツールとバージョンの確認
```

なぜバージョンを揃えることが「方法論」の一部なのか。Reconは**前回との差分**に価値がある活動であり、ツールの挙動（既定のソース、既定の並列度、出力フォーマット）が知らぬ間に変わると、**資産が増減したのかツールが変わったのか区別できなくなる**。差分運用を採る以上、環境の固定はデータ品質そのものである。実務では、パイプラインの実行ログに `pdtm -list` の出力を一緒に記録しておくとよい。

---

### 4. アーカイブを「自分の型」に変換する発展トレーニング

資料を読むだけでは方法論は身につかない。ここでは、上記3資料を素材にした学習設計を示す。**いずれも自分が管理する環境、または明示的に許可された範囲でのみ実施すること。**

#### 4-1. 三層に分けてノートを取る

1本のスライド／動画を消費するとき、内容を次の3層に分解して記録する。

| 層 | 記録する内容 | 陳腐化の速さ |
|---|---|---|
| **原理層** | なぜその手法が成立するのか（DNSの挙動、CTログの公開性、BGPの経路広告、HTTPの応答特性、人間の運用上の癖） | 遅い（年単位で不変） |
| **判断層** | どの条件でどちらへ進むか（「解決しないならCNAMEを見る」「CDN配下なら直接スキャンしない」「スコープ外なら触らない」） | 中程度 |
| **実装層** | 具体的なコマンド、ツール名、オプション | 速い（半年〜2年） |

TBHMの [MANUAL] 部はほぼ原理層と判断層でできており、[AUTOMATION] 部は実装層の比率が高い。**実装層だけを写経すると、ツールが変わった瞬間に何も残らない**。逆に原理層を押さえていれば、新しいツールが出ても「これは既知のどの工程の置換か」で即座に位置づけられる。

#### 4-2. 「同じ入力・違う方法論」で自己ベンチマークを回す

TBHMの Questions/benchmarks の思想を、自分の学習に適用する。手順は単純で、**自分が管理する検証用ドメインに対して**、(a) 手作業中心の方法論、(b) パイプライン中心の方法論、の両方を実行し、結果の集合を比較する。

```bash
# 自分の検証用ゾーンに対してのみ実行すること
mkdir -p runs/$(date +%F) && cd runs/$(date +%F)

# 方法論Aの結果、方法論Bの結果をそれぞれ正規化して保存
sort -u manual.txt  > A.txt
sort -u pipeline.txt > B.txt

# 「手作業でしか出なかったもの」が、方法論の穴を示す
comm -23 A.txt B.txt | tee gap_of_pipeline.txt
# 「自動化でしか出なかったもの」が、手作業の限界を示す
comm -13 A.txt B.txt | tee gap_of_manual.txt
```

この差分ファイルこそが**あなた固有の学習教材**である。`gap_of_pipeline.txt` に載った資産は、「自動化に組み込めば次回から自動で取れるようになる項目」のリストに等しい。方法論の改善とは、この差分を毎回ゼロに近づけ、そのうえで新しい発見経路を足していく作業にほかならない。

#### 4-3. 歴史資料を読むときのチェックリスト

- [ ] **公開年を特定したか**（スライドの表紙、カンファレンス名、URL中の年に注目）。例: ZeroNights 2018、VirSecCon 2020。
- [ ] **登場ツールが現在も保守されているか**を確認したか（最終コミット日、READMEのdeprecation表記）。
- [ ] **前提が変わっていないか**を確認したか。特に、CTログの必須化・DNS over HTTPS の普及・CDN配置の一般化・WHOIS情報のGDPRによる匿名化（2018年以降、登録者個人情報が大幅に秘匿された）は、当時の手法の有効性を直接左右する。
- [ ] **法的・スコープ上の前提**が現在のプログラム規約と一致しているか。古い資料には、現在では許容されない能動的手法が含まれることがある。
- [ ] 資料を**保全**したか（Wayback保存 + ローカル保存 + 取得日の記録）。

---

### まとめ

- **Bug Hunter Handbook の Presentations** は、TBHM v1〜v4を含む方法論の系譜を一望できるアーカイブである。「体系化」「自動化」「シェル職人芸」という3つの流れとして読むと、現代のパイプライン設計の由来が理解できる。リンク腐食に備え、有用な資料は取得日とハッシュ付きで保全する。
- **TBHMフルトレーニング**の構成（[MANUAL] 9項目 → [AUTOMATION] 9項目）は、垂直→水平の資産拡大、スコープ確認という関門、そして機械による網羅展開、という必然的なデータフローを表している。中央に置かれた *Questions/benchmarks* が示す「ツール選定を計測で決める」姿勢が、この教材の思想的な核である。ツール名は置換表で読み替え、構造だけを取り込む。
- **NahamSec × ProjectDiscovery の Post Recon 講座**（2025年11月）は、「automation → methodology」——すなわちパイプラインの出力をどう選別し、どこに人間の時間を投じるかという問題を扱う。チェーンを「増やす段」と「捨てる段」の交互構造として理解することが、負荷・倫理・効率の3面で正しい運用につながる。
- 発展トレーニングの要諦は、資料を**原理層／判断層／実装層**に分解して記録し、自分の検証環境で「手作業 vs 自動化」の差分を測り続けることにある。差分が、次に自動化すべき工程を教えてくれる。
