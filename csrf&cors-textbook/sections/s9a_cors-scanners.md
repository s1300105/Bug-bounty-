## CORS誤設定スキャナ

CORS(Cross-Origin Resource Sharing、オリジン間リソース共有)の誤設定は、`Access-Control-Allow-Origin`ヘッダーの値やロジックの実装ミスによって生まれる。これは目視での確認が難しく、対象が数十〜数百万ドメインに及ぶ場合は自動化ツールが不可欠になる。本節では、実務・研究の両面で参照されることが多い4つのCORS誤設定スキャナを取り上げ、それぞれが「何を」「どうやって」検出しているのかを、内部ロジックの仕組みとともに解説する。どのツールも共通して、複数の`Origin`ヘッダー値を変化させながらリクエストを送り、レスポンスの`Access-Control-Allow-Origin`(以下ACAO)と`Access-Control-Allow-Credentials`(以下ACAC)がどう応答するかを観測する、という基本原理に立脚している。これらのテスト自体は読み取り専用のHTTPリクエストであり、対象サーバーへの書き込みや破壊的操作を伴わない点は覚えておくとよい。

### なぜCORS誤設定はツールでの網羅検査が必要なのか

CORSの検証ロジックは、多くの場合サーバー側で「リクエストのOriginヘッダーを何らかの条件でホワイトリスト判定し、条件を満たせばそのOrigin値をそのままACAOに反映する」という自前実装になっている。この自前実装には典型的なバグパターンが存在し、後述する各スキャナはそのパターンを網羅的にOriginへ差し込んで送信することで、実装のミスを機械的にあぶり出す。

- **オリジン反射(origin reflection)**: 送ってきたOriginをそのまま無条件にACAOへコピーする実装。`Origin: https://evil.com` → `Access-Control-Allow-Origin: https://evil.com`となり、任意のオリジンが許可されてしまう。
- **前方一致・後方一致の誤り(prefix/suffix match)**: `example.com`を含むかどうかだけで判定するような雑な文字列マッチ実装は、`example.com.evil.com`(前方一致=prefix match、正規のドメインが先頭にあるため人間には信頼できそうに見える)や`evilexample.com`(後方一致=suffix match、ドット抜けでサブストリング的に一致してしまう)を許可してしまう。
- **ドットのエスケープ漏れ(not escape dot)**: `example.com`を許可するために書いた正規表現が`example\.com`ではなく`example.com`のままだと、正規表現上の`.`は「任意の1文字」を意味するため、`exampleAcom`のような文字列にもマッチしてしまう。
- **nullオリジンの信頼(trust null)**: サンドボックス化されたiframe(`sandbox`属性でoriginを持たない)やローカルファイル(`file://`)から送られる`Origin: null`をホワイトリストに含めてしまう実装ミス。攻撃者はsandbox化したiframeを用意するだけで`null`オリジンを生成でき、任意のページから偽装攻撃が可能になる。
- **サブドメイン無条件許可(trust any subdomain)**: `*.example.com`のような正規表現で全サブドメインを許可すると、そのサブドメインの1つにXSSやサブドメインテイクオーバーが存在すれば、そこを踏み台にメインドメインの認証情報付きリソースへアクセスできてしまう。
- **HTTPがHTTPSを信頼する(HTTPS trust HTTP)**: `https://example.com`が`http://example.com`からのOriginを許可すると、中間者攻撃(MITM)によってHTTP側の通信を書き換えられた場合に、HTTPS側の機微なリソースへアクセスされ得る。

これらはいずれも「なぜ危険か」を理解するには、ブラウザの同一オリジンポリシー(SOP)とCORSがどちらも「Originヘッダーの値をサーバーが信頼して初めて」機能する仕組みであることを踏まえる必要がある。ブラウザ自体はACAOの値を検証するだけで、その値が妥当かどうかの判断はサーバー側の実装に完全に委ねられている。したがって誤設定の検出は「様々なOrigin値を送ってサーバーの応答ロジックを外部から推測する」というブラックボックステストにならざるを得ず、それゆえに自動スキャナが有効に機能する領域となっている。

---

### Corsy(Python、軽量CORS誤設定スキャナ)

Corsyは`s0md3v`(sqlmapやXSStrikeの作者としても知られる)によって作られた、依存関係が`requests`ライブラリのみという非常に軽量なPython製CORSスキャナである。単一ツールとして「既知のCORS誤設定を網羅的にスキャンする」ことに特化している。

#### 検出項目とその仕組み

Corsyは1つのURLに対して、あらかじめ用意された複数パターンのOriginヘッダーを順番に送信し、返ってきたACAOヘッダーと比較する。実装されているテストは以下の11種類である。

| テスト名 | 送信するOriginの例 | 検出したい実装ミス |
|---|---|---|
| Pre-domain bypass | `https://example.com.evil.com` | 正規ドメインを先頭に置く前方一致バグ |
| Post-domain bypass | `https://evil.com.example.com`または`https://evilexample.com` | ドメイン名を含んでいれば許可してしまう後方・部分一致バグ |
| Backtick bypass | `` https://example.com`.evil.com `` | 一部言語・パーサでバッククォートがドメイン区切りとして誤解釈される挙動を突く |
| Null origin bypass | `null` | sandboxed iframe等が送るnullオリジンの無条件許可 |
| Unescaped dot bypass | `https://exampleXcom`(ドットの代わりに任意の1文字) | 正規表現の`.`エスケープ漏れ |
| Underscore bypass | `https://example_com`のような変則ホスト名 | ホスト名バリデーションの緩さを突く |
| Invalid value | 不正な形式のOrigin文字列 | エラーハンドリング不備でOriginがそのまま反映される |
| Wild card value | (Originを送らない、または任意の値) | `Access-Control-Allow-Origin: *`が単純に固定で返るケース |
| Origin reflection test | ランダムな第三者オリジン(例: `https://xyzcorsy.com`) | 無条件にOriginをそのまま反射しているか |
| Third party allowance test | `github.io`や`herokuapp.com`など著名なホスティングサービスのオリジン | 誰でも取得できるサブドメインを持つサードパーティを信頼しているか |
| HTTP allowance test | `http://example.com`(対象がHTTPSの場合) | HTTPSサイトがHTTPオリジンを信頼していないか |

すべてのテストでACACヘッダー(`Access-Control-Allow-Credentials: true`)も同時に確認しており、ACAOが任意オリジンを許可していても、ACACが`true`でなければCookieなどの認証情報を伴うリクエストは(ブラウザの仕様上)攻撃者から読み取れないため、実務上の深刻度判定に必須の情報として記録する。

#### 使い方

```
python3 corsy.py -u https://example.com
```

複数URLをファイルまたは標準入力から与えることもできる。

```
python3 corsy.py -i /path/urls.txt
cat urls.txt | python3 corsy.py
```

スレッド数(`-t`)、リクエスト間隔(`-d`、対象への負荷配慮やレート制限回避のため)、カスタムヘッダー(`--headers`、認証済みセッションでの検査に利用)、JSON出力(`-o`)、簡潔出力(`-q`)などのオプションを持つ。

```
python3 corsy.py -u https://example.com -t 20
python3 corsy.py -u https://example.com -d 2
python3 corsy.py -i /path/urls.txt -o /path/output.json
python3 corsy.py -u https://example.com --headers "User-Agent: GoogleBot\nCookie: SESSION=Hacked"
```

`--headers`でCookieを指定できる点は、認証が必要なエンドポイント配下のCORS設定(ログイン後のAPIなど)を検査する際に重要になる。未認証のトップページと、認証後のAPIエンドポイントとでCORSポリシーが異なって実装されているケースは実務上非常に多い。

> 出典: Corsy README — https://github.com/s0md3v/Corsy

---

### CORScanner(gevent高速・pip対応・ライブラリ利用可)

CORScannerは`chenjj`によるPython製ツールで、最大の特徴は並行処理に`gevent`(Pythonのグリーンスレッド/コルーチンライブラリで、I/O待機中に他のタスクへ処理を譲ることでOSスレッドより軽量に大量の同時接続を扱える)を採用している点である。これによりOSスレッド方式よりも少ないメモリ・CPUオーバーヘッドで、数百〜数千ドメイン規模の一括スキャンを高速に行える。このツールは学術的な裏付けも持ち、USENIX Security '18で発表された論文(大規模なCORS誤設定の実態調査)に基づいて実装されている点が他のツールと一線を画す。

#### 検出項目

| 誤設定タイプ | 内容 |
|---|---|
| reflect_any_origin | Origin値を無条件に反映する |
| prefix_match | `example.com.evil.com`のような前方一致 |
| suffix_match | `evilexample.com`のような後方一致 |
| not_escape_dot | 正規表現のドットエスケープ漏れ |
| substring_match | `example.co`のような部分文字列一致 |
| trust_null | nullオリジンの信頼 |
| https_trust_http | HTTPSがHTTPを信頼する |
| trust_any_subdomain | 全サブドメインの無条件信頼 |
| custom_third_parties | `github.io`など誰でも取得できるサードパーティドメインの信頼 |
| special_characters_bypass | ブラウザやパーサの特殊文字処理の癖を悪用したバイパス |

Corsyのテスト項目とかなりの部分が重複しているが、これは両者とも「CORS誤設定の分類学」としてほぼ同じバグパターン集合(James Kettle氏らの研究に端を発する)を参照しているためである。複数のスキャナで結果を突き合わせる(クロスチェックする)ことで、単一ツールの実装バグによる誤検知・見落としを減らせる。

#### インストールと使い方

pipから直接インストールできる点がCorsyとの実務上の大きな違いである。

```bash
pip install corscanner
# または
pip install cors
```

ソースからのインストール:

```bash
git clone https://github.com/chenjj/CORScanner.git
sudo pip install -r requirements.txt
```

コマンドラインオプション:

| 短形 | 長形 | 説明 |
|---|---|---|
| -u | --url | 検査対象URL/ドメイン |
| -d | --headers | リクエストに追加するヘッダ |
| -i | --input | 複数ドメインのリストファイル |
| -t | --threads | 使用スレッド(gevent greenlet)数 |
| -o | --output | JSON形式での結果出力 |
| -v | --verbose | 詳細・リアルタイム表示 |
| -T | --timeout | タイムアウト秒数(デフォルト10秒) |
| -p | --proxy | プロキシ利用(Burp Suite等との連携に有用) |

```bash
python cors_scan.py -u example.com
python cors_scan.py -u example.com -v
python cors_scan.py -u example.com -o output_filename
python cors_scan.py -i top_100_domains.txt -t 100
python cors_scan.py -u example.com -p http://127.0.0.1:8080
python cors_scan.py -u example.com -p socks5://127.0.0.1:8080   # 別途 pip install PySocks が必要
python cors_scan.py -u example.com -d "Cookie: test"
```

`-p`でBurp SuiteなどのプロキシにトラフィックをルーティングできるためTLS証明書の内容やリクエスト/レスポンスの生ヘッダーを目視確認しながらスキャン結果を裏取りする、という使い方が実務では有効である。

#### ライブラリとしての利用

CORScannerはCLIツールであると同時に、Pythonコードへ直接組み込める設計になっている。

```python
from CORScanner.cors_scan import cors_check
ret = cors_check("https://www.instagram.com", None)
```

あるいは`cors`コマンドとしても呼び出せる。

```bash
cors -vu https://www.instagram.com
```

戻り値は辞書形式で、検査対象URL・誤設定タイプ・認証情報許可有無・使用したOrigin値・ステータスコードを含む。

```json
{'url': 'https://www.instagram.com', 'type': 'reflect_origin', 'credentials': 'false', 'origin': 'https://evil.com', 'status_code': 200}
```

`credentials`フィールドが独立して記録される設計は、前述の通り「ACAOが緩くてもACACが`false`なら深刻度が下がる」という判定ロジックをスクリプトから機械的に扱えるようにするためであり、大量スキャン結果をトリアージ(優先順位付け)する自動パイプラインに組み込みやすい。

> 出典: CORScanner README — https://github.com/chenjj/CORScanner

---

### CorsMe(Go製・ワイルドカード検出)

CorsMeは`Shivangx01b`によるGo言語製のスキャナで、"Cross Origin Resource Sharing MisConfiguration Scanner"の略。Go言語のgoroutine(軽量な並行処理単位)を活用しており、標準入力からURLのリストをパイプで渡す設計になっている点が、CorsyやCORScannerと使い勝手の面で異なる。

#### 検出項目

1. Reflect Origin checks(オリジン反射)
2. Prefix Match(前方一致)
3. Suffix Match(後方一致)
4. Not Escaped Dots(ドットエスケープ漏れ)
5. Null値(nullオリジン)
6. Third Parties(`github.io`や`repl.it`など既知の第三者ドメイン)
7. Special Characters(`}`や`(`などの特殊文字パターン)

検出ロジックの分類は前述の2ツールとほぼ共通しているが、CorsMeの特徴はワイルドカード(`Access-Control-Allow-Origin: *`)の扱いにある。`*`は仕様上、認証情報(Cookie等)を伴うリクエストには使えない(ブラウザがACACの`true`と`*`の組み合わせを拒否する)ため、危険度が相対的に低いとみなされがちで、大量スキャン時にはノイズになりやすい。そこでCorsMeはデフォルトでワイルドカードの検出結果を非表示にし、`-wildcard`フラグを付けたときだけ出力対象に含める設計になっている。これは「大規模スキャンでは低リスクの大量ヒットを抑制し、まず高リスクな誤設定に注目させる」という実務上のトリアージ思想の表れである。

#### インストールと使い方

```
go get -u -v github.com/shivangx01b/CorsMe
```

```
echo "https://example.com" | ./CorsMe
cat http_https.txt | ./CorsMe -t 70
cat http_https.txt | ./CorsMe -t 70 -wildcard
cat http_https.txt | ./CorsMe -t 70 -header "Cookie: Session=12cbcx...."
cat http_https.txt | ./CorsMe -t 70 -method "POST"
cat http_https.txt | ./CorsMe -t 70 -output audit.logs
```

`-method`で検査に使うHTTPメソッドを変更できるのは、GETでは通常のシンプルリクエストとして扱われる一方、POSTなどではプリフライト(`OPTIONS`メソッドによる事前確認リクエスト)が絡む場合があり、実装によってプリフライト応答とシンプルリクエスト応答とでCORSポリシーの適用に差異が生じることがあるためである。この差異自体もしばしば誤設定の一形態になる。

リクエストに失敗したホストは`error_requests.txt`に記録され、大規模スキャンにおいて「生きていないホスト」と「CORS的に問題ないホスト」を区別できるようにしている。

サブドメイン列挙ツールと組み合わせた典型的な運用フローも公開されている。

```
subfinder -d hackerone.com -nW -silent | httprobe -c 70 -p 80,443,8080,8081,8089 | tee http_https.txt
cat http_https.txt | ./CorsMe -t 70
```

このパイプラインは「サブドメイン列挙(subfinder) → 生存確認とスキーム確定(httprobe) → CORS検査(CorsMe)」という、偵察(recon)からCORS検査までの標準的な流れを示しており、CorsMe自体は「大量のURLリストをどれだけ速く捌けるか」に特化して設計されていることが分かる。

> 出典: CorsMe README — https://github.com/Shivangx01b/CorsMe

---

### CORStest(RUB-NDS、developer backdoor/null等を検出)

CORStestはルール大学ボーフム(Ruhr University Bochum、RUB)のネットワーク・データセキュリティ研究グループ(NDS)が公開しているPython 3ツールで、他の3ツールと違い、学術研究(大規模なインターネット計測調査)のために書かれた経緯を持つ。挙動はシンプルで、特定の`Origin`ヘッダーを送信し`Access-Control-Allow-Origin`の応答を検査するという基本原理は共通だが、検出項目の切り口に研究的な視点が色濃く出ている。

#### 検出項目

| 項目 | 説明 |
|---|---|
| Developer backdoor | JSFiddleやCodePenなど、開発者が動作確認のために誤って許可リストへ残してしまった安全でないオンラインエディタ系オリジンの許可を検出する |
| Origin reflection | オリジンの単純反射(=全サイトからアクセス可能) |
| Null misconfiguration | サンドボックス化iframeが送る`null`オリジンの許可 |
| Pre-domain wildcard | 登録可能などんなドメインでも前方一致してしまう設定 |
| Post-domain wildcard | 対象ドメインを含む任意ドメイン(`domain.com.evil.com`)を許可する設定 |
| Subdomains allowed | サブドメイン全体を信頼する設定(サブドメインのXSSで悪用可能) |
| Non-ssl sites allowed | HTTPSリソースへのHTTPオリジンからのアクセスを許可(中間者攻撃のリスク) |
| Invalid CORS header | ワイルドカードの誤用やヘッダー形式自体の誤り |

「Developer backdoor」という項目名が示す通り、CORStestは単純な文字列パターンのバグだけでなく、「開発時にJSFiddle等のオンラインコードエディタからAPIを叩いて動作確認するために、`https://jsfiddle.net`のような外部オリジンを一時的にホワイトリストへ加え、そのまま本番に残してしまう」という運用ミスに着目している点が特徴的である。これは技術的な実装バグというより「開発プロセス上の人為的なうっかり」を検出する項目であり、他ツールにはあまり見られない視点である。

#### 使い方

```
usage: corstest.py [arguments] infile

positional arguments:
  infile         ドメイン/URLリスト含むファイル

optional arguments:
  -h, --help     ヘルプ表示
  -c name=value  全リクエストでクッキー送信
  -p processes   マルチプロセッシング(デフォルト: 32)
  -s             SSL/TLS強制
  -q             静寂モード(Allow-Credentialsのみ出力)
  -v             冗長出力
```

`-p`(プロセス数)がデフォルト32というのは、他ツールのスレッド数よりやや控えめであり、これは大規模なインターネット全体を対象にした学術計測を行う際に、対象サーバー・自環境双方への負荷を抑える設計判断とみられる。

#### 学術的な背景と評価結果

CORStestはJames Kettle氏(PortSwiggerの研究者)によるCORS誤設定の技術的研究(カンファレンス講演やブログ記事)を土台としており、RUB-NDSはこのツールを用いてAlexaトップ100万サイトを対象にした大規模計測を実施した。その結果、約3%のサイトが「メインページでCORSを有効化していた」と報告されている。良好な回線条件下でこの規模のスキャンには約14時間を要したとされ、大規模計測のスケール感(1サイトあたり数十ミリ秒〜数百ミリ秒のリクエストコストが数百万件積み重なる)を把握する参考値になる。

なお、この「3%」という数値やスキャン所要時間はスキャン実施当時(2016年前後、CORStestの公開時期に近い)の計測結果であり、現在のインターネット全体における誤設定率を直接示すものではない点には注意が必要である。CORSの啓発が進んだことで割合は変化している可能性があるが、個々のWebアプリケーションレベルでは依然としてCORS誤設定は頻出する脆弱性カテゴリであり続けている。

> 出典: CORStest README — https://github.com/RUB-NDS/CORStest

---

### 4ツールの比較と実務での使い分け

| ツール | 言語 | 並行処理方式 | 特色 |
|---|---|---|---|
| Corsy | Python | requests + マルチスレッド | 依存が少なく単体で軽量、11種の詳細なバイパスパターン |
| CORScanner | Python | gevent(グリーンスレッド) | pipインストール可、Pythonライブラリとしてスクリプトに組み込み可能、学術論文(USENIX Security '18)裏付け |
| CorsMe | Go | goroutine | 標準入力パイプ運用に最適化、ワイルドカード検出をオプトインで抑制、reconパイプライン組み込み前提 |
| CORStest | Python | multiprocessing | 「developer backdoor」など運用ミス視点の検出項目、大規模インターネット計測の実績 |

実務でのCORS診断では、単一のツールの結果を鵜呑みにせず、複数ツールでクロスチェックすることが推奨される。理由は、各ツールが実装しているテストOriginのバリエーションや、ACAO/ACACの組み合わせ判定ロジックに微妙な差異があり、片方でしか検出できない誤設定パターンが存在し得るためである。加えて、いずれのツールも「ACAOがOriginを反映しているかどうか」という静的なシグナルだけでは判定できないケースがある。例えば、認証が必要なエンドポイントは未認証状態でスキャンしてもCORSヘッダー自体が付与されない(認証エラーで別のレスポンスが返る)ことがあるため、Cookieやトークンをヘッダーオプション(`--headers`、`-d`、`-header`など各ツールが提供するカスタムヘッダー機能)で付与し、認証済みセッションとしてスキャンする運用が実務上重要になる。

これらのスキャナはいずれも読み取り専用のHTTPリクエスト(Originを変えたGET/OPTIONS等)を送るだけであり、対象への書き込みや状態変更を行うものではない。しかし、対象が自組織以外の資産である場合は、必ず事前に許可を得た範囲(バグバウンティプログラムのスコープ内、または自社所有の検証環境)でのみ実行すべきであり、無許可の本番環境や第三者サービスに対して大量リクエストを送るスキャンは避けるべきである。特にCORStestやCorsMeのような大規模一括スキャンを想定したツールは、スレッド数・プロセス数の設定次第で対象サーバーに意図せぬ高負荷をかけうるため、スコープ内であってもリクエスト間隔(Corsyの`-d`オプション等)や同時実行数を対象の許容範囲に合わせて調整することが望ましい。
