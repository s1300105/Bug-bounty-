## Orange Tsaiによる多重脆弱性チェーンでのRCE

この節では、台湾の著名なセキュリティ研究者 **Orange Tsai（黃泓瑞）** による2本の代表的な調査報告を教材として読み解く。いずれも「単体では致命的とは言えない小さな穴」を複数つなぎ合わせて（**チェーン**して）最終的にRCE（Remote Code Execution、遠隔コード実行）へ到達した実例であり、本書の主題である **「安全でないデシリアライゼーション（insecure deserialization）」** と **「SSTI/式言語インジェクション」** の双方が、現実の巨大サービスでどのように牙をむくかを示している。

- 記事1（2017年）は、**SSRF（Server-Side Request Forgery、サーバ側リクエスト偽造）→ プロトコルスマグリング → Ruby の `Marshal.load` による安全でないデシリアライゼーション**という流れで、GitHub Enterprise を root 権限で乗っ取った。これは本書の「デシリアライゼーション」側の集大成である。
- 記事2（2018年）は、**JBoss Seam フレームワークの式言語（EL, Expression Language）インジェクション**をチェーンし、Amazon の社内コラボレーションシステム（Nuxeo 製品）を認証なしで RCE に持ち込んだ。これは本書の「SSTI（サーバサイドテンプレート/式インジェクション）」側の代表例である。

> **本書のスコープに関する注意**：以下はすべて**防御・学習目的**の解説である。掲載する概念やペイロード断片は、脆弱性の原理と検知・防御ポイントを理解するためのものであり、実在サービスや本番環境への無許可の検証・攻撃に用いてはならない。既に修正済みの過去事例として、設計上の教訓を抽出する視点で読んでほしい。

---

### 記事1：GitHub Enterprise を SSRF チェーンから RCE へ（2017年）

#### 全体像 ― なぜ「チェーン」が必要だったのか

GitHub Enterprise（GHE）は、GitHub.com のオンプレミス版であり、暗号化された仮想アプライアンスとして顧客に配布される。Orange はこのアプライアンスのディスクを復号し、内部で動く **Ruby on Rails** 製アプリのソースコードを解析した。そのうえで、外部から到達できる入口（webhook 機能）を起点に、内部サービスへと段階的に潜り込んでいった。

到達したゴールは、Ruby の組み込みシリアライズ機構である **`Marshal.load`** に攻撃者が制御するバイト列を食わせること、である。`Marshal.load` は Java の `readObject()` や Python の `pickle.loads()` と同じく、**信頼できないデータを渡すと任意コード実行につながりうる**危険な「シンク（sink：入力が最終的に実行・解釈される到達点）」である。問題は、その `Marshal.load` へ至る入口が**外部から直接は触れない内部キャッシュ（Memcached）**だったことだ。そこで「外から内部キャッシュにデータを書き込む」ための道を、SSRF の多段チェーンで切り拓いた。

チェーンは大きく4段である。

1. **入口の SSRF**（IP 制限のバイパス）
2. **内部サービス Graphite での二段目 SSRF**
3. **Python `httplib` の CRLF インジェクション**によるプロトコルスマグリング
4. **Ruby `Marshal.load` の安全でないデシリアライゼーション**によるコード実行

#### 段①：webhook の IP 制限を `http://0/` でバイパス

GHE の webhook 機能（`https://<host>/<user>/<repo>/settings/hooks/new`）は、ユーザーが指定した URL へサーバがリクエストを送る典型的な SSRF 温床である。GHE は Ruby Gem **`faraday-restrict-ip-addresses`** を使い、内部 IP（127.0.0.1 など）宛のリクエストを**ブラックリスト方式**で弾いていた。

しかしブラックリスト方式は、IP 表記の多様性を突かれると容易に破れる。Orange が使ったバイパスは次の一行である。

```
http://0/
```

**なぜ通るのか**：Linux（正確には多くの POSIX ネットワークスタック）では、IPv4 アドレス `0.0.0.0`、そしてそれを短縮した数値 `0` が、名前解決や接続時に **localhost（127.0.0.1 相当）** として扱われる。ブラックリストは `127.0.0.1` や `localhost` という「見た目」を弾いていたが、`0` という数値表記を想定していなかった。RFC 3986 が許容する数珠繋ぎの IP 表記（10進数値、8進、16進など）は、パーサによって解釈が食い違うため、**ブラックリストでの SSRF 対策が本質的に脆い**ことを示す好例である。

> ここから得る防御教訓：**SSRF 対策はブラックリストではなくアローリスト（許可する宛先の明示）で行う**。さらに、名前解決後の実 IP をチェックし、`0.0.0.0/8`・`127.0.0.0/8`・`169.254.0.0/16`（リンクローカル、クラウドのメタデータ 169.254.169.254 を含む）・プライベートアドレス帯をすべて拒否する。表記正規化をパーサ任せにしない。

#### 段②：内部 Graphite サービスでの二段目 SSRF

段①で「内部 localhost に到達できる」状態になったが、webhook が送れるのは素朴な HTTP GET だけで、これ単体では大したことはできない。そこで Orange は、GHE が内部ポート **8000** で動かしていた統計可視化ツール **Graphite**（Python 製）に着目した。Graphite の `send_email` 機能は、URL パラメータを検証せずにサーバ側でリクエストを発行する、もう一つの SSRF ポイントだった。

```python
# webapps/graphite/composer/views.py（抜粋）
def send_email(request):
    recipients = request.GET['to'].split(',')
    url = request.GET['url']
    proto, server, path, query, frag = urlsplit(url)
    if query: path += '?' + query
    conn = HTTPConnection(server)
    conn.request('GET', path)
    # ...
```

`url` パラメータの `server` と `path` がそのまま `HTTPConnection` に渡る。段①の SSRF で `http://0:8000/composer/send_email?...` を叩けば、この二段目 SSRF を**内部から**起動できる。SSRF を SSRF で踏み台にする「二段ジャンプ」である。

#### 段③：Python `httplib` の CRLF インジェクションでプロトコルを密輸する

ここが技術的な核心である。二段目 SSRF を得ても、なお送れるのは「HTTP GET」だけに見える。しかし Orange は、Python 2 系の `httplib`（`HTTPConnection`）が **リクエストパスに含まれる CRLF（`\r\n`, `%0D%0A`）をエスケープせずそのまま送出する**欠陥を利用した。

```
http://0:8000/composer/send_email?to=orange@nogg&url=http://127.0.0.1:12345/%0D%0Ai_am_payload%0D%0AFoo:
```

**なぜ危険か**：多くのネットワークプロトコル（HTTP・Memcached・Redis・SMTP など）は **改行（CRLF）で命令やヘッダを区切る行指向プロトコル**である。パスに `%0D%0A`（改行）を注入できると、TCP ストリーム上に**攻撃者が任意の追加行を書き込める**。つまり、`HTTPConnection` は「HTTP を喋っているつもり」でも、接続先が **Memcached（ポート 11211）** や **Redis（ポート 6379）** なら、注入した行がそのままそれらのコマンドとして解釈される。これが**プロトコルスマグリング（protocol smuggling）**、あるいは CRLF injection による SSRF の武器化である。

これにより、外部の攻撃者は「内部の Memcached に任意のキーと値を SET する」能力を手に入れた。

> 防御教訓：**ユーザ入力をネットワーク層のパス・ホスト・ポートに素通しさせない**。URL パーサやHTTPクライアントが CRLF をどう扱うかを検証し、パスに制御文字が混入したら拒否する。内部サービス（Memcached/Redis）は**認証を有効化**し、ネットワークセグメンテーションで隔離する。

#### 段④：`Marshal.load` の安全でないデシリアライゼーションで root を取る

最後の一段が、本書の主題そのものである。GHE は Ruby Gem **`memcached`** を使ってオブジェクトをキャッシュしていた。この gem は、キャッシュから値を取り出すとき **`Marshal.load`（Ruby のバイナリデシリアライズ）で自動的にオブジェクトへ復元する**。段③で Memcached に任意バイト列を書き込めるようになった今、そこに**悪意あるシリアライズ済み Ruby オブジェクト**を仕込み、GHE が次にそのキャッシュを読んだ瞬間にデシリアライズを発火させれば、コード実行に至る。

Orange が用いたガジェット（デシリアライズ時に副作用として処理を実行させる既存クラスの連鎖）は、Rails/ActiveSupport に存在する定番の一つである。

```ruby
# ペイロードの骨子（Marshalバイナリを手組みしたもの）
# ActiveSupport::Deprecation::DeprecatedInstanceVariableProxy と ERB を悪用
payload = "\x04\x08" \
  + "o" + ":\x40ActiveSupport::Deprecation::DeprecatedInstanceVariableProxy" + "\x07" \
  + ":\x0e@instance" \
  + "o" + ":\x08ERB" + "\x07" \
  + ":\t@src" + Marshal.dump(code)[2..-1] \
  + ":\x0c@lineno" + "i\x00" \
  + ":\x0c@method" + ":\x0bresult"
```

**なぜ RCE になるのか（ガジェットチェーンの原理）**：

- `Marshal.load` は、シリアライズ列に記されたクラス名を見て**任意のクラスのインスタンスを（そのクラスがロード済みなら）復元**する。ここで復元されるのは攻撃者が選んだ `DeprecatedInstanceVariableProxy` である。
- `DeprecatedInstanceVariableProxy` は「非推奨のインスタンス変数へアクセスされたら警告を出しつつ、内部に保持した本来のオブジェクト（`@instance`）へ処理を委譲する」ためのプロキシである。この委譲の過程で、保持オブジェクトの `@method`（ここでは `result`）が**メソッド呼び出しとして起動される**。
- `@instance` に仕込まれているのは **`ERB`（Embedded Ruby）テンプレート**オブジェクトで、その `@src`（テンプレートのソース＝コンパイル済み Ruby コード）に攻撃者のコードが埋め込まれている。`ERB#result` が呼ばれると `@src` が**そのまま Ruby として評価**される。

つまり、「デシリアライズ → プロキシの委譲 → ERB のテンプレート評価」という**既存クラスだけを組み合わせた無害な部品の連鎖**が、最終的に任意 Ruby コード実行という凶器に変わる。これがガジェットチェーンの本質であり、`Marshal.load`／`readObject`／`pickle.loads` に信頼できないデータを渡してはならない根本理由である。

GHE の該当プロセスは root で動いていたため、最終的に `uid=0(root) gid=0(root)` でのコード実行が成立した。

> **この記事から抽出すべき教訓（防御視点）**
> 1. **信頼できないデータを `Marshal.load` へ渡さない**。キャッシュ・セッション・クッキーなど「内部だから安全」と思われがちな経路も、SSRF や注入で外部から汚染されうる。
> 2. **SSRF はブラックリストではなくアローリストで防ぐ**。IP 表記の正規化・CRLF 混入検査・内部サービスの認証を徹底する。
> 3. **多層防御**：どれか1つの穴が塞がっていれば、このチェーンは成立しなかった。SSRF・プロトコルスマグリング・デシリアライゼーションのいずれかを断てば全体が止まる。

> 出典: How I Chained 4 vulnerabilities on GitHub Enterprise, From SSRF Execution Chain to RCE! — https://blog.orange.tw/2017/07/how-i-chained-4-vulnerabilities-on.html

---

### 記事2：Amazon コラボレーションシステムを EL インジェクションで RCE（2018年）

> **注記**：本節の題として当初「Seam/XStream/FastJSON」と示されていたが、原典で実際にチェーンされたのは **JBoss Seam フレームワークの式言語（EL）インジェクション**である（XStream/FastJSON のガジェットは本記事の主役ではない）。以下は原典の内容に忠実に、Seam の EL インジェクションを軸に解説する。これは本書の主題のうち **「SSTI（式言語/テンプレートのインジェクション）」** 側を体現する事例である。

#### 全体像 ― Seam の EL とは何か、なぜ SSTI と同類なのか

対象は `collaborate-corp.amazon.com` で動く **Nuxeo 8.10**（エンタープライズ向けコンテンツ管理製品）で、内部で **JBoss Seam 2.3.1.Final** を用いていた。Seam は JSF（JavaServer Faces）ベースの Web フレームワークで、画面のあちこちで **EL（式言語）**、たとえば `#{someBean.someMethod()}` のような式を評価する。

EL は本来「テンプレート内で Bean のプロパティやメソッドを呼ぶ」ための便利機能だが、**攻撃者が EL 式の中身を制御できてしまうと、それは実質的にサーバ側での任意式評価＝SSTI（Server-Side Template Injection）／式言語インジェクション**になる。EL からは Java のリフレクション API に手が届くため、`java.lang.Runtime.exec()` まで到達できれば OS コマンド実行に至る。Orange はこの EL を攻撃者制御下に置くため、4つのバグ／仕様を積み重ねた。

#### バグ①：セミコロン（パスパラメータ）による認証 ACL バイパス

Nuxeo の認証フィルタ `NuxeoAuthenticationFilter` は、`getRequestedPage()` の返り値をホワイトリスト（`login.jsp` など認証不要ページの一覧）と突き合わせてアクセス制御していた。その `getRequestedPage()` は、URL のセミコロン以降（パスパラメータ）を切り捨てる。

```java
// Nuxeo の getRequestedPage() 抜粋
int i = requestedPage.indexOf(';');
return i == -1 ? requestedPage : requestedPage.substring(0, i);
```

ここで、次のような URL を送る。

```
/nuxeo/login.jsp;/..;/[本来は認証が必要な領域]
```

**なぜ通るのか（パーサ差異の悪用）**：認証フィルタは `;` 以降を切って `login.jsp` だけを見るので「認証不要ページ」と判定する。ところが**サーブレットコンテナ（Tomcat）はセミコロンを「パスパラメータ」区切りとして別扱い**し、実際のルーティングでは `..` によるディレクトリ遡上を経て、本来保護されるべき領域へ到達する。**「認証を判断するコンポーネント」と「実際にリクエストをディスパッチするコンポーネント」でパスの解釈が食い違う**という、パーサ差異（parser confusion）による認可バイパスの典型である。これは本書で繰り返し登場するテーマ（同じ入力を複数のパーサが違う意味に解釈することで生じる欠陥）そのものである。

#### バグ②③：`actionMethod` による EL インジェクションと「二重評価」

Seam には `actionMethod` というリクエストパラメータがあり、`FILENAME:EL_CODE` という形式で「あるビュー（.xhtml ファイル）の文脈でこの EL を実行せよ」と指示できる（本来はボタン押下時のアクションを呼ぶための仕組み）。Orange は、既存のビューファイルを**ガジェット**として悪用した。

```
widgets/suggest_add_new_directory_entry_iframe.xhtml
```

このファイルは内部で `request.getParameter('directoryNameForPopup')` を評価する。ここに Seam の **二重評価（double evaluation）** という危険な挙動が絡む。

```
actionMethod=widgets/suggest_add_new_directory_entry_iframe.xhtml:request.getParameter('directoryNameForPopup')
&directoryNameForPopup=/?#{PAYLOAD}
```

**なぜ RCE の入口になるのか**：`actionMethod` で指定したビューを評価すると、その中で `directoryNameForPopup` パラメータの値が取り出される。Seam は「**EL を評価した結果の文字列が、さらに EL 構文（`#{...}`）を含んでいたら、それをもう一度 EL として評価する**」。この二重評価のせいで、攻撃者が `directoryNameForPopup=/?#{PAYLOAD}` と与えれば、`#{PAYLOAD}` が**サーバ側で任意 EL 式として評価**される。これで EL の中身を完全に攻撃者が握った ―― すなわち SSTI（式言語インジェクション）が成立した。

> 防御教訓：**ユーザ入力を式言語の評価対象へ二次的にでも流し込まない**。テンプレートエンジンの「評価結果を再評価する」系の機能は、入力汚染があると即 SSTI 化する。フレームワークのバージョンと既知の EL 評価挙動を把握し、危険な機能（`actionMethod` の直接受理など）を無効化・制限する。

#### バグ④：EL ブラックリストのバイパス（ブラケット記法）

Seam の新しめのバージョン（2.2.2 以降）は、EL からの危険なメソッド呼び出しを**文字列マッチのブラックリスト**（`blacklist.properties`）で弾こうとしていた。ブロック対象には次のようなパターンが含まれる。

```
.getClass(
.class.
.getPassword(
```

つまり `foo.getClass()` のような**ドット記法での `getClass` 呼び出し**を、文字列 `.getClass(` の存在で検出して拒否していた。Orange はこれを **ブラケット（配列風）記法**で回避した。

```
# ブロックされる書き方（ドット記法）
"".getClass()

# バイパス（ブラケット記法。文字列 ".getClass(" が現れない）
""["class"]
```

**なぜ回避できるのか**：EL では `obj.property` と `obj["property"]` は等価であり、`""["class"]` は `"".getClass()` と同じく `String` の `Class` オブジェクトを返す。しかしブラックリストは `.getClass(` という**リテラル文字列**を探しているだけなので、`["class"]` という表記には一致しない。**「危険な操作の意味」ではなく「特定の文字列の見た目」でしか防いでいない**という、ブラックリスト防御の根本的な弱さがここでも露呈する。

#### 最終ペイロード：EL リフレクションから `Runtime.exec()` へ

ブラケット記法で `getClass` 相当を得られれば、あとは Java のリフレクション API をたどって `java.lang.Runtime` に到達し、`exec()` を呼ぶだけである。

```
""["class"].forName("java.lang.Runtime")
   .getMethods()[15].invoke(null, new String[]{"command"})
```

**なぜ動くのか（原理）**：

- `""["class"]` で `String` の `Class` を得て、その `forName("java.lang.Runtime")` で `Runtime` クラスの `Class` オブジェクトを取得する。
- `getMethods()` はそのクラスの public メソッド配列を返す。Orange は環境上の並び順から、`getRuntime()` がインデックス 7、`exec(String)` がインデックス 15 に来ることを利用し、リフレクションでこれらを順に呼び出した（`invoke(null, ...)` は静的メソッド呼び出し）。
- こうして EL 式だけで `Runtime.getRuntime().exec("command")` 相当を組み立て、**認証なしで OS コマンド実行**に到達した。

> **バージョン依存への注意**：`getMethods()` が返すメソッドの順序は JVM 実装・バージョンに依存し、インデックス（7 や 15）は環境ごとに変わりうる。これは「その環境でたまたま成立した具体値」であり、恒久的な定数ではない。バージョン依存の脆弱性を語るときは、対象バージョン（ここでは Nuxeo 8.10 / Seam 2.3.1.Final、2018年時点）を必ず明記して陳腐化を避けるべきである。

#### タイムラインと修正状況

- 2018年3月10日：AWS セキュリティへ報告。
- 2018年3月15日：Nuxeo が修正版を公開。
- 同月：Amazon から報奨。

現行の Nuxeo / Seam では、`actionMethod` の受理や EL 評価まわりの挙動が見直され、当時のチェーンはそのままでは成立しない。

> **この記事から抽出すべき教訓（防御視点）**
> 1. **EL/テンプレートの評価対象に外部入力を混ぜない**。二重評価・`actionMethod` のような「文字列を式として再解釈する」機能は SSTI の温床。
> 2. **ブラックリストは信用しない**。`.getClass(` のような文字列一致は `["class"]` で容易に破れる。**サンドボックス化・機能そのものの無効化・アローリスト**で守る。
> 3. **パーサ差異（セミコロン/`..`）を認可の抜け道にしない**。認可判定とルーティングで**同一の正規化済みパス**を使う。

> 出典: How I Chained 4 Bugs (Features?) into RCE on Amazon Collaboration System — https://blog.orange.tw/posts/2018-08-how-i-chained-4-bugs-features-into-rce-on-amazon/

---

### 2つの事例から学ぶ共通原理 ― 「小さな穴の掛け算」

本書の題名 **「insecure deserialization + SSTI = RCE」** を、この2事例はきれいに体現している。

| 観点 | GitHub Enterprise（2017） | Amazon/Nuxeo（2018） |
|---|---|---|
| 最終シンク | Ruby `Marshal.load`（デシリアライゼーション） | Seam EL 評価（SSTI／式言語インジェクション） |
| 入口 | webhook の SSRF（`http://0/`） | セミコロンによる認証 ACL バイパス |
| 中間の武器化 | 二段 SSRF＋CRLF プロトコルスマグリング | `actionMethod` の EL 二重評価 |
| 防御回避 | IP ブラックリストのバイパス | EL ブラックリストのブラケット記法バイパス |
| 権限 | root（uid=0） | 認証なしの OS コマンド実行 |

共通する設計上の教訓は次の通り。

1. **どのチェーンも「デシリアライズ or 式評価」という強力なシンクに、外部入力を到達させたこと」で決まった。** シンクを塞ぐ（信頼できないデータを `Marshal.load`/EL に渡さない）ことが最優先。
2. **ブラックリスト防御は繰り返し破られる。** IP 表記（`0`）でも EL 表記（`["class"]`）でも、「意味」ではなく「文字列の見た目」で弾く防御は回避される。**アローリスト・サンドボックス・機能の無効化**へ切り替える。
3. **パーサ差異／プロトコル差異が接着剤になる。** 認可コンポーネントとルーティング、HTTP クライアントと下位プロトコルなど、**同じ入力を異なる主体が違う意味に解釈**する箇所は、攻撃者の格好の連結点になる。正規化を一元化し、境界での再解釈を排除する。
4. **多層防御が効く。** 各チェーンは4段すべてが成立して初めて RCE に至った。1段でも断てば全体が止まる。個々の穴を「単体では軽微」と過小評価しないことが、チェーン攻撃への最良の対抗策である。

> ⚠️ **未取得の資料はありません**：本節の2記事は自動取得に成功した（記事1は正規化後の URL `https://blog.orange.tw/posts/2017-07-how-i-chained-4-vulnerabilities-on/` から取得。掲載時の URL は `https://blog.orange.tw/2017/07/how-i-chained-4-vulnerabilities-on.html`）。より詳細な図解やスライドは、Black Hat USA 2017 / DEF CON 25 での同氏の発表資料も参照されたい。
