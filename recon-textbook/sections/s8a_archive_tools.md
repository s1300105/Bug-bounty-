## gau/waybackurlsによる履歴URL収集

### 8a.1 なぜ「過去のURL」が偵察の武器になるのか

Web偵察（recon）の多くは「今このサイトに何があるか」を調べる。しかし攻撃対象領域（attack surface：攻撃者が到達できる入口の総体）を最大化するには、「過去にこのサイトに何があったか」を掘ることも同じくらい重要になる。理由は次の通りである。

- 削除・改修されたエンドポイントは、削除後もアーカイブ側には残る。開発者は「もう使っていない」と思っていても、URLそのものはWayback MachineやCommon Crawlのインデックスに残存し続ける。
- 古いJavaScriptファイルには、現在のコードでは使われていないAPIエンドポイント、内部ホスト名、コメントアウトされたトークンなどが残っていることがある。
- URLに付与されたクエリパラメータ（`?redirect=`, `?file=`, `?id=`など）は、そのパラメータを受け取っていた機能の存在を示す「化石」であり、現在も同じパラメータ名がサーバ側で解釈されていれば、IDOR（Insecure Direct Object Reference：アクセス制御を経ずに他人のリソースIDを直接指定できてしまう不備）やSSRF、オープンリダイレクトなどの糸口になる。

これらを能動的にクロールせず、既に存在する第三者のアーカイブから「読み出すだけ」で収集できるのが本節の主題である。能動スキャンではないため対象サーバへの負荷がなく、静かで検出されにくい（passive recon：対象に直接パケットを送らない偵察）という利点がある。本節では、この目的に特化したツールである `gau`（Get All URLs）と、その先行ツールである `waybackurls`、および関連ツール `paramspider` を扱う。

> 本節は防御・防御的検証の学習を目的とする。実在の対象への無許可のスキャンや、取得した情報を用いた侵入行為は行ってはならない。自組織の資産や、明示的に許可を得たバグバウンティ対象に対してのみ利用すること。

### 8a.2 アーカイブの仕組み：4つのデータソース

`gau` は既定で4つのプロバイダから履歴URLを取得する。それぞれの仕組みを理解しておくと、なぜ結果に偏りが出るのか、なぜ複数ソースを併用すべきなのかが分かる。

#### Wayback Machine（archive.org）

Internet Archiveが運営する巨大なWebスナップショット保存庫。定期的なクローラがWebページを巡回し、HTMLだけでなく画像・JS・CSSなどのリソースURLも個別にキャプチャして保存する。任意のドメインについて、これまで観測された全URLを取得できる公開APIが **CDX API**（Capture inDeX API）である。`gau` や `waybackurls` は内部でこのCDX APIに対して次のようなクエリを投げている。

```
http://web.archive.org/cdx/search/cdx?url=*.example.com/*&output=json&fl=original&collapse=urlkey
```

- `url=*.example.com/*` … ワイルドカードでサブドメイン・パス全体を指定
- `output=json` … 結果をJSON配列で受け取る
- `fl=original` … 元URLのフィールドだけを取得（`fl`=fields）
- `collapse=urlkey` … 正規化されたURLキーで重複を圧縮する

この仕組み上、**Wayback Machineがそのページをクロールした時点でしか記録されない**。つまり「クロールされたことがある」ページしか出てこない。逆に、robots.txtでクローラを拒否していても、Wayback Machineは（近年は多くの場合）robots.txtを無視して保存する方針に変わっており、"隠したつもり" のパスがむしろ長期間アーカイブに残ることもある。

#### Common Crawl

非営利団体が数十億ページ規模でWebを定期クロールし、そのインデックスとWARC形式の生データを無料公開しているプロジェクト。Wayback Machineとは独立したクローラ群であり、クロール範囲・頻度が異なるため、Wayback Machineには無いURLがCommon Crawl側にだけ存在することがある。gauはCommon Crawlの公開インデックスAPI（`index.commoncrawl.org`）に対して該当ドメインのレコードを問い合わせる。

#### AlienVault OTX（Open Threat Exchange）

脅威インテリジェンス共有プラットフォーム。マルウェア解析やフィッシング調査の過程で観測された「あるドメインに関連するURL」がIndicator（脅威指標）として蓄積されている。したがってOTX由来のURLは、脆弱性を突かれた末に悪用されたパスや、フィッシングキットが模倣したパスが混ざっている可能性がある点が他の3ソースと性質が異なる。

#### URLScan.io

サイトを実際にヘッドレスブラウザで開いてスクリーンショットとDOM・通信内容を記録する公開スキャンサービス。誰かがそのURLをURLScan.ioに投げて解析させた履歴があれば、そのURLと、そのページが読み込んだサブリソースのURLが検索APIから引き出せる。

これら4ソースは「クロール型（Wayback, Common Crawl）」と「投稿・観測型（OTX, URLScan）」に分類でき、性質が異なるため**複数プロバイダを併用するほど網羅性が上がる**。これが `--providers` オプションの存在理由である。

### 8a.3 `gau` の使い方

`gau`（"Get All URLs"）はGo言語製のCLIツールで、上記4ソースへの問い合わせを並列化・統合し、標準出力にURLの一覧を吐き出す。

```
gau example.com
```

これだけで、`example.com` に関して4ソース全てから収集した既知URLの一覧が得られる。実運用では、収集後にノイズを削って「使える」データに絞り込む工程が本質的に重要になる。以下は主要オプションである。

#### `--providers`：ソースの選択

```
gau example.com --providers wayback,commoncrawl
```

対象を明示的に指定する。全ソースを叩くと処理が遅くなり、OTX/URLScanはノイズ（脆弱性調査以外の観測データ）が多いこともあるため、目的に応じて絞る。例えば静的にJSファイルの棚卸しだけしたい場合はWayback + CommonCrawlの2つに絞るとレイテンシと結果の質が改善する。

#### `--subs`：サブドメインを含める

```
gau example.com --subs
```

対象ドメイン配下の全サブドメイン（`*.example.com`）のURLも収集対象に含める。単一ホストだけでなく組織全体の攻撃対象領域を俯瞰する際は、サブドメイン列挙（第2章で扱う `subfinder`/`amass` など）で得たリストと組み合わせて `--subs` を使うのが定石である。

#### `--fp`：パラメータの重複除去（fingerprint / false-positive削減）

```
gau example.com --fp
```

`--fp` は "remove different parameters of the same endpoint"（同一エンドポイントの異なるパラメータ値を除去する）機能である。実際のアーカイブデータには、同じエンドポイント・同じパラメータ名だが値だけが違うURLが大量に含まれる。

```
https://example.com/product?id=1023
https://example.com/product?id=1024
https://example.com/product?id=1025
...（何千件も続く）
```

これらは「エンドポイントの形」としては同一であり、脆弱性調査の観点では1件あれば十分な情報である。`--fp` はURLのパス＋パラメータ名の組み合わせをキーとして正規化し、1件に圧縮する。これにより、後段のスキャナ（`nuclei`, `ffuf` など）に渡す件数を大幅に削減しつつ、調査すべき「ユニークなエンドポイントの形」を漏らさず残せる。数万〜数十万件規模のアーカイブURLを人手で捌くのは非現実的なため、この重複除去は実務上ほぼ必須の工程である。

#### `--from` / `--to`：日付での絞り込み

```
gau example.com --from 202001 --to 202312
```

`--from`／`--to` はいずれも `YYYYMM` 形式で、アーカイブされた時期（キャプチャ日時）の範囲を指定する。用途は主に2つある。

1. 「最近追加されたエンドポイントだけ」を見たい場合（`--from` を直近の日付にする）。
2. 「古い、忘れられた機能」を狙う場合（`--to` を数年前にして、現行のコードベースには存在しないが当時は存在した機能を掘る）。特にレガシーなAPIバージョン（`/api/v1/`など）や、廃止されたログイン画面はこの手法で見つかることが多い。

#### その他の実務向けオプション

| オプション | 説明 |
|---|---|
| `--blacklist` | 除外する拡張子を指定する（`png,jpg,gif,css` など）。静的アセットは脆弱性調査上のノイズになりやすいため事前に除外する |
| `--json` | 出力をJSON形式にする。パイプラインの後続処理（`jq` 等）で扱いやすくする |
| `--threads` | 並列ワーカー数。大量ドメインを一括処理する際のスループットに影響 |
| `--timeout` | 各HTTPリクエストのタイムアウト秒数 |

#### 実務ワンライナー例

```
gau example.com --subs --providers wayback,commoncrawl --blacklist png,jpg,gif,css --fp
```

複数ソースからサブドメインも含めて収集し、静的アセットを除外し、パラメータ変動を正規化する。これが日常的な偵察の出発点となる典型的な一行である。

> 出典: Trickest「gau」ツールページ — https://trickest.com/tools/gau

### 8a.4 収集後のワークフロー：生URLを「使える情報」に変換する

`gau` 単体は「URLの列」を吐くだけであり、それ自体は脆弱性ではない。実務での価値は、後続のフィルタリング・グレッピング・スキャナ連携によって生まれる。ここではMedium記事「GAU FOR RECON」（x86ciPher, felixmelvinchitechi）で紹介されている典型的な使い方の流れを解説する。

#### ① 生存確認（live URLのフィルタリング）

アーカイブされたURLの大半は既に404や別コンテンツに置き換わっている。`httpx`（プロジェクトk本文の別章で扱うHTTPプロービングツール）などにパイプすることで、現在も200系のレスポンスを返す「生きている」URLだけに絞り込む。

```
cat urls.txt | httpx -silent -mc 200,301,302
```

#### ② 拡張子・パスキーワードでのグレップ

過去に存在したファイルの痕跡は、パスやファイル名から強く推測できる。バックアップファイル、設定ファイル、内部管理画面などは特徴的な語を含むことが多い。

```
cat urls.txt | grep -E '\.(env|git|bak|zip|sql|log)$|/(admin|config|backup|internal)/'
```

`.js` ファイルに限定して抜き出し、後述のパラメータ抽出や、ソースコード中のエンドポイント文字列（`fetch("/api/...")`など）の探索に使うのも定番の流れである。

```
cat urls.txt | grep -E '\.js$'
```

#### ③ パラメータの抽出とファジング候補化

URLに含まれるクエリパラメータ名（`?redirect=`, `?url=`, `?file=`, `?next=` など）は、対象アプリケーションが受け付ける入力の種類を教えてくれる。パラメータ名だけを抜き出し、既知の脆弱パターン（オープンリダイレクト、SSRF、パストラバーサルなど）に合致しそうな名前を優先的に精査する。この工程を専用に行うツールが `paramspider` である（後述8a.6）。

#### ④ スキャナへの受け渡し

生存確認とノイズ除去を終えたURLリストは、`nuclei`（テンプレート駆動の脆弱性スキャナ）や `ffuf`（ディレクトリ/パラメータブルートフォースツール、いずれも別章で詳述）に渡すことで、既知の脆弱性シグネチャや追加パラメータの発見を自動化できる。

```
cat live_urls.txt | nuclei -t exposures/ -t misconfiguration/
```

> ⚠️ **未取得の資料に関する注記**: Medium記事「GAU FOR RECON」（x86ciPher / felixmelvinchitechi, https://medium.com/@felixmelvinchitechi/gau-for-recon-91f8b331293d）は自動取得ツールでは直接本文を取得できませんでした（理由: サーバがHTTP 403 Forbiddenを返し、egress制限とみられる）。上記①〜④の内容は、同記事に関する検索結果の要約（記事が明示する「Recon → 生存確認 → `.js`/`api`/`admin`/`config`/`backup`/`.env`/`.git`等のグレップ → パラメータ抽出 → nuclei/ffuf連携」という流れ）に基づき、専門知識で補って構成したものです。正確な文面・コード例は、上記URLからご自身で直接ご確認ください。
> 出典: 「GAU FOR RECON」x86ciPher（felixmelvinchitechi） — https://medium.com/@felixmelvinchitechi/gau-for-recon-91f8b331293d

### 8a.5 `waybackurls`：gauの先行ツールとしての位置づけ

`gau` が登場する前から広く使われていたのが、Tom Hudson（tomnomnom）作の `waybackurls` である。仕組みは基本的に上述のWayback MachineのCDX APIを叩くだけの単機能ツールで、`gau` はこれを内部的に拡張し、複数プロバイダに対応させた後継的な位置づけにある。

```
echo example.com | waybackurls
```

`waybackurls` はWayback Machine単独の結果しか返さないため、Common Crawl由来の情報が欲しい場合や複数プロバイダを一括で扱いたい場合は `gau` の方が効率的である。とはいえ「Wayback Machineだけで十分な軽量な調査」や、他ツールとの組み合わせで既に使い慣れたパイプラインがある現場では、依然として `waybackurls` は使われ続けている。両者はコマンドの入出力形式（改行区切りのプレーンテキストURLリスト）が似ているため、相互に差し替え可能な構成でパイプラインを組んでおくと運用上の柔軟性が高い。

### 8a.6 `paramspider`：パラメータ抽出への特化

`gau`/`waybackurls` がURL全体を収集するのに対し、`paramspider` はアーカイブ済みURLおよびJSファイルから **クエリパラメータ名** を抽出することに特化したツールである。Medium記事「How I Use Wayback URLs, Gau & Paramspider to Supercharge Recon」（Sanskruti, @merida-）では、この3ツールを組み合わせた実践的なワークフローが紹介されている。

- **Wayback URLs**：Wayback Machineから対象ドメインの履歴URLを取得する最初のステップ。
- **Gau**：Wayback単独よりも広い範囲（Common Crawlなど複数ソース）から履歴URLを取得し、Waybackだけでは見つからないURLを補完する。
- **Paramspider**：収集したURL・JSファイルからパラメータ名を抜き出し、`?redirect_uri=` や `?next=` のようなリダイレクト系パラメータ、`?id=` のようなオブジェクト参照パラメータなど、脆弱性が発生しやすい入力ポイントの一覧を作る。

同記事では、この手順を通じて「2018年にアーカイブされ、現在も生きたままアクセス可能だった管理者ログインページ」を発見した例や、`redirect_uri` パラメータを起点にオープンリダイレクトの不備を指摘できた例が紹介されている。いずれも**能動的な攻撃コードを送り込む前の段階、すなわちアーカイブの読み出しと生存確認だけで攻撃対象領域の見落としが判明する**という、reconフェーズの価値を示す典型例である。

> ⚠️ **未取得の資料に関する注記**: Medium記事「How I Use Wayback URLs, Gau & Paramspider to Supercharge Recon」（Sanskruti, https://medium.com/@merida-/how-i-use-wayback-urls-gau-paramspider-to-supercharge-recon-1944105f5f7e）は自動取得ツールでは直接本文を取得できませんでした（理由: サーバがHTTP 403 Forbiddenを返し、egress制限とみられる）。上記の要約は検索結果に基づくものであり、詳細な体験談・コマンド例は上記URLからご自身で直接ご確認ください。
> 出典: 「How I Use Wayback URLs, Gau & Paramspider to Supercharge Recon」Sanskruti — https://medium.com/@merida-/how-i-use-wayback-urls-gau-paramspider-to-supercharge-recon-1944105f5f7e

### 8a.7 防御側の視点：アーカイブ由来の露出をどう抑えるか

本節はあくまで攻撃対象領域を把握するための調査手法の解説であり、実在サービスへの無許可の検証や破壊的操作を推奨するものではない。防御側の担当者にとって重要なのは、次のような対策である。

- **秘密情報をURLパスやクエリパラメータに含めない**。アーカイブは「そのURLが一度でも観測されれば」記録するため、APIキーやセッショントークンをURLに埋め込む設計は、たとえ後で機能を廃止してもアーカイブ経由で漏洩し続ける。
- **廃止したエンドポイントはサーバ側でも確実に無効化する**。「URLを消してリンクを外す」だけでは、直接アクセスされた場合に古い機能が動作したままというケースがある。認可チェックとルーティングの両方を確認し、廃止時にサーバ側の処理自体を削除・拒否する。
- **Wayback Machineの除外申請**を利用する。Internet Archiveは、ドメイン所有者からの適正な申請があれば特定URLのアーカイブ除外に対応する制度を持つ。機微な情報が意図せず公開されたページは、削除に加えてこの除外申請も検討する。
- **定期的な自己reconの実施**。自組織のドメインに対して`gau`/`waybackurls`を定期的に実行し、想定していないエンドポイントやパラメータがアーカイブされていないかを継続的に監視することは、攻撃者に先んじて自らの攻撃対象領域を把握する健全な防御運用である。

### 8a.8 バージョン・時期に関する補足

- `gau`（lc/gau, 現在はGitHub上で `lc/gau` として公開）はGo製で活発にメンテナンスされているツールであり、プロバイダ一覧やオプション名は将来のリリースで変更される可能性がある。本節で示したオプション（`--providers`, `--subs`, `--fp`, `--from`/`--to`, `--blacklist`, `--json`, `--threads`, `--timeout`）は2024年前後の版に基づくTrickestのツールページの記載に対応している。実際に使用する際は `gau -h` で手元のバージョンのオプション一覧を必ず確認すること。
- Wayback Machine・Common Crawl・OTX・URLScan.ioのAPI仕様（エンドポイントURL、クエリパラメータ名、レート制限）は各サービス側の都合で変更され得る。ツールがエラーを返す場合は、まず各サービスの公式ドキュメントで仕様変更が無いかを確認する。
