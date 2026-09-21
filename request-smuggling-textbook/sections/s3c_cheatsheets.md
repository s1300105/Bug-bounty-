## チートシート・方法論リファレンス

この節は、第3章で学んだCL.TE / TE.CL / TE.TEの原理を「手を動かすときに即座に参照できる形」にまとめたリファレンスである。実際の検証現場では、ペイロードの一字一句の正確さ（バイト数のズレ一つで検出が失敗する）と、検出→確証→影響評価という手順の順守が成否を分ける。以下では3つの実務資料——PayloadsAllTheThingsのチートシート、The Hacker Recipesの方法論、Pentest Book（six2dez）の列挙手順——から、ペイロード雛形・判定基準・ツール・手順を統合して提示する。防御目的の検証を前提とし、実在サービスへの無許可検証や破壊的な手順（他ユーザーへの副作用を伴う本番実行など）はここでは扱わない。

### 3つの古典分類のペイロード雛形

まず、CL.TE/TE.CL/TE.TEそれぞれの「型」を、実際に送信するバイト列のレベルで確認する。ここでの「フロントエンド」はリバースプロキシ・ロードバランサ・CDNなど最初にリクエストを受ける層、「バックエンド」はアプリケーションサーバーを指す。

#### CL.TE（フロントエンドがContent-Length、バックエンドがTransfer-Encodingを採用）

```http
POST / HTTP/1.1
Host: vulnerable-website.com
Content-Length: 13
Transfer-Encoding: chunked

0

SMUGGLED
```

なぜこれが機能するか。フロントエンドはContent-Lengthヘッダを信頼するため、ボディの先頭13バイト（`0\r\n\r\nSMUGGLED`のうち「0」から始まる13バイト分）だけを見てリクエストの終端と判断し、そのまま丸ごとバックエンドへ転送する。一方バックエンドはTransfer-Encoding: chunkedを信頼するため、ボディをchunked形式として解釈する。`0\r\n\r\n`は「サイズ0のチャンク＝ボディ終端」を意味するchunked encodingの正式な終了マーカーであり、バックエンドはここでリクエストが終わったと判断する。したがって、その直後にある`SMUGGLED`という文字列は「このリクエストの一部」ではなく「次に届くリクエストの先頭バイト列」として、コネクション上でキューイングされている次のリクエストに結合されてしまう。これがフロントエンド／バックエンド間の解釈の食い違い（desync、脱同期）の本質である。

#### TE.CL（フロントエンドがTransfer-Encoding、バックエンドがContent-Lengthを採用）

```http
POST / HTTP/1.1
Host: domain.example.com
Content-Length: 4
Transfer-Encoding: chunked

5c
GPOST / HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Content-Length: 15
x=1
0

```

なぜこれが機能するか。フロントエンドはTransfer-Encodingを信頼してchunked形式として読み進める。`5c`（16進数で92）は後続チャンクのバイト数を示し、フロントエンドはその分（`GPOST / HTTP/1.1...`から始まる92バイト）を読み、続く`0\r\n\r\n`で終端と判断してリクエスト全体を転送する。一方バックエンドはContent-Length: 4のみを信頼するため、ボディの先頭4バイト（`5c\r\n`）だけを「今回のリクエストのボディ」として処理し、そこで区切りを打つ。残りの`GPOST / HTTP/1.1\r\n...`以降は「次のリクエスト」としてバックエンドのパーサに再解釈される。結果として、`GPOST`という不正なメソッド名を含む偽装リクエストがバックエンドのリクエストキューに割り込む。**実務上の重要な注意点**として、この末尾には`\r\n\r\n`（空行）を必ず付与する必要がある。これを欠くと、バックエンドが次の本物のリクエストの先頭行を巻き込んでヘッダ行として誤読し、検出結果が不安定になる。またBurp SuiteのRepeaterでこの種のリクエストを送る際は「Update Content-Length on Send」オプションを無効化しなければならない。有効なままだと、Burpが自動的にContent-Length値を実際のボディ長に書き換えてしまい、意図的に作り込んだ「フロントエンドとバックエンドで異なる長さ解釈をさせる」というズレそのものが消えてしまうためである。

#### TE.TE（両者ともTransfer-Encodingに対応するが、片方だけを難読化で無効化させる）

CL.TEやTE.CLは「そもそも片方のサーバーがTransfer-Encodingを一切解釈しない」ケースだが、TE.TEは両者ともTransfer-Encodingヘッダの存在自体は認識できるサーバー同士の組み合わせで、ヘッダ値を意図的に崩すことで一方だけの解釈を無効化させる手法である。

```
Transfer-Encoding: xchunked
Transfer-Encoding : chunked
Transfer-Encoding: chunked
Transfer-Encoding: x
Transfer-Encoding:[tab]chunked
[space]Transfer-Encoding: chunked
X: X[改行]Transfer-Encoding: chunked
Transfer-Encoding
 : chunked
```

なぜこれが機能するか。RFC 9112はTransfer-Encodingヘッダの構文について比較的緩い実装が歴史的に許容されてきた経緯があり、実装によっては「ヘッダ名の直後にスペースがある（`Transfer-Encoding : chunked`）」「値の前にタブや余分な空白が挟まる」「ヘッダ値が`chunked`という正確な文字列と完全一致しない（`xchunked`や単なる`x`）」といった異形を、あるサーバーは「無効なヘッダなので無視する」と判断し、別のサーバーは「多少崩れていても`chunked`という文字列を含むので有効とみなす」と判断する。この寛容性の差そのものが脆弱性になる。攻撃者は、フロントエンドには「無効」と判定させて素通りさせつつ、バックエンドには「有効なchunked」と判定させる（あるいはその逆）ヘッダ値を探索することで、CL.TEやTE.CLと同様の脱同期を発生させる。

> 出典: HTTP Request Smuggling — PayloadsAllTheThings — https://swisskyrepo.github.io/PayloadsAllTheThings/Request%20Smuggling/

### HTTP/2関連の発展形（H2.CL / H2.TE、クライアントサイドデシンク）

古典3分類はHTTP/1.1同士の通信を前提とするが、フロントエンドがHTTP/2でクライアントを受け付けてバックエンドへHTTP/1.1へダウングレードして転送する構成（多くのCDN・ロードバランサでデフォルト）では、別の攻撃面が生まれる。HTTP/2はバイナリフレーミングでヘッダとボディの境界が明確なため、原理上はContent-Length/Transfer-Encodingの曖昧さは存在しない。しかし、フロントエンドがHTTP/2からHTTP/1.1へ変換する過程で、擬似ヘッダやフィールド内に混入したCRLF・改行を適切にエスケープしないと、変換後のHTTP/1.1リクエストにヘッダインジェクションが発生し得る。

```
:method GET
:path /
:authority www.example.com
header ignored\r\n\r\nGET / HTTP/1.1\r\nHost: www.example.com
```

なぜこれが機能するか。HTTP/2のヘッダフィールドは本来CRLFを含めてもそのままバイナリとして扱われる（フレーム構造で区切られているため改行文字に構文上の意味はない）。ところがダウングレード時にフロントエンドがこの値をHTTP/1.1のテキスト形式のヘッダ行としてそのまま書き出すと、値中の`\r\n\r\n`が「ヘッダ終端＋ボディ開始」として解釈され、それ以降の文字列がバックエンドにとっては「新しいリクエストの先頭」に見えてしまう。これはH2.CL / H2.TEというラベルで呼ばれることもあるが、本質はCL.TE/TE.CLと同じ「層ごとの解釈の不一致」である。

さらに近年注目されているのがクライアントサイドデシンク（Client-Side Desync, CSD）である。これは攻撃者がサーバー側のフロントエンド／バックエンドを直接操作するのではなく、被害者のブラウザに偽装リクエストを送らせることで、被害者自身のコネクション上でデシンクを発生させる手法である。

```javascript
fetch('https://www.example.com/', {
  method: 'POST',
  body: "GET / HTTP/1.1\r\nHost: www.example.com",
  mode: 'no-cors',
  credentials: 'include'
})
```

なぜこれが機能するか。一部のサーバー実装は、あるパス（例えば静的リソースを返すエンドポイント）に対してPOSTでリクエストが来ても、実際にはボディを一切読まずにGETと同じ扱いで即座にレスポンスを返す。このときPOSTのボディに書き込んだ`GET / HTTP/1.1\r\nHost: ...`という文字列は、サーバー側では読み捨てられるべきものだが、コネクションの再利用（keep-alive）が行われている場合、後続の別ユーザー（あるいは被害者自身の次のリクエスト）と混ざってバックエンド側に予期しない形で解釈される余地が生まれる。CSDは攻撃者のサーバーインフラへの直接アクセスを必要とせず、被害者にJavaScriptを実行させるだけで成立する点が古典的スマグリングと大きく異なる。攻撃結果としては、認証情報の窃取、被害者のセッション上でのXSS注入、内部限定エンドポイントの踏み台化などが挙げられる。

> 出典: HTTP Request Smuggling — PayloadsAllTheThings — https://swisskyrepo.github.io/PayloadsAllTheThings/Request%20Smuggling/

### 検出方法論：タイミングベースと差分レスポンス

The Hacker Recipesは、実務での検出を「タイミング遅延技法」と「差分レスポンス技法」の2系統に整理している。

**タイミングベース検出**は、意図的に曖昧なリクエストを送信し、レスポンスが返るまでの時間を観測する手法である。例えばCL.TEの疑いがある場合、Content-Lengthを実際のボディより小さく申告しつつTransfer-Encodingヘッダを付与したリクエストを送る。バックエンドがchunked encodingとして解釈した結果、終端のゼロチャンク（`0\r\n\r\n`）が見当たらない状態になると、バックエンドは「まだボディが続く」と判断してタイムアウトまで待機し続ける。この待機時間の異常な長さ（例えば通常数百ミリ秒のレスポンスが数秒〜数十秒に伸びる）が、脆弱性の兆候になる。タイミングベースは他ユーザーへの副作用がほぼないため、本番相当の環境で最初に試す手法として推奨される。

**差分レスポンス技法**は、スマグリングしたリクエストが実際にキューに割り込んで処理されたかどうかを、後続リクエストのレスポンス内容の変化で確認する手法である。具体的には、1本目の接続でスマグリング用リクエストを送った直後に、2本目（正規の）リクエストを同じコネクション上に送信し、2本目のレスポンスが「本来期待される内容」から逸脱していないかを見る。逸脱していれば、1本目のリクエストの残骸（あるいは注入した偽装リクエスト）が2本目の処理に混入した証拠となる。この手法は確証を得る力が強い一方、実サービスの他ユーザーのリクエストを巻き込むリスクがあるため、検証環境や自分専用のテストアカウント経由でのみ用いるべきである。

Pentest Bookはこれをさらに具体的な検出手順として提示している。

**CL.TE検出の手順**：Content-Length: 4を指定しつつ、実際のボディにはchunked形式で余分な文字（例えば`X`という1バイト）を追加したリクエストを送る。フロントエンドはContent-Length: 4の分だけを読んで転送するため、`X`はバックエンドに渡らずコネクション上に取り残される。次に同じコネクション上で2本目のリクエストを送ると、取り残されていた`X`がそのリクエストの先頭に結合され、バックエンドはリクエスト行が`X`から始まる不正な形式として解釈し、パースエラーやステータスコードの異常（400番台など）として観測される。

**TE.CL検出の手順**：Transfer-Encoding: chunkedを主軸にしつつ、Content-Length: 4のような小さい値を併記する。chunkedボディの中に、意図的に不正なメソッド名を持つ埋め込みリクエスト（例えば`GPOST`のような、実在しないメソッド名）を仕込む。バックエンドがContent-Lengthのみを信頼していれば、chunkedの構造を無視して先頭4バイトだけを読み、残りを次のリクエストとして再パースしようとする。この際`GPOST`という不正な行がリクエストラインとして読まれ、パースエラーやステータス異常が発生すれば、TE.CLの脆弱性が示唆される。

**TE.TE検出の手順**：Transfer-Encodingヘッダに崩した値（例えば`Transfer-encoding: cow`のような、ヘッダ名の大文字小文字や値そのものを変形したもの）を追加した状態で送信する。これによって、一方のサーバーはこのヘッダを無効と判断してTransfer-Encodingを無視し、他方は有効と判断してchunked処理を行う、という解釈の分岐を誘発できるかを確認する。

> 出典: HTTP request smuggling — The Hacker Recipes — https://www.thehacker.recipes/web/config/http-request-smuggling/
> 出典: request-smuggling — Pentest Book (six2dez) — https://www.pentest-book.com/enumeration/web/request-smuggling

### 検証・自動化ツール

手動でのバイト単位のペイロード作成は学習段階では不可欠だが、実務では以下のツールで一次スクリーニングを行い、疑わしい候補に対してのみ手動での確証作業を行うのが効率的である。

```bash
# smuggler（defparam製、Python3実装）
# 単一ホストまたはURLリストに対してCL.TE/TE.CL/TE.TEの自動検出を行う
python3 smuggler.py -u https://target.example.com

# smuggle.py（anshumanpattnaik製、別実装）
python3 smuggle.py -u https://target.example.com

# h2csmuggler（BishopFox/assetnote製、Go実装）
# HTTP/2クリアテキスト（h2c）へのアップグレード経由のスマグリングを検証
go run ./cmd/h2csmuggler check https://target.example.com
```

なぜこれらのツールが有効か。いずれも、上述したCL.TE/TE.CL/TE.TE検出手順（曖昧なヘッダの組み合わせを機械的に生成し、タイミングまたはレスポンス差分を観測する）を自動化したものであり、多数のエンドポイント・パラメータの組み合わせを人手より高速に走査できる。ただし自動ツールは「疑わしい兆候」を報告するに留まり、実際に悪用可能かどうか（他ユーザーのリクエストに実害を及ぼせるか）の最終確証は、影響範囲を限定した手動検証で行う必要がある。これはスマグリングが「検証の失敗自体が他ユーザーへの副作用を生みうる、数少ない脆弱性クラスの一つ」であるためであり、本番相当の環境で不用意に自動スキャンを乱発すべきではない。

Burp Suite環境では、**HTTP Request Smuggler拡張機能**が標準的な選択肢となる。この拡張は、既知の曖昧化パターンを自動的に多数試行するスキャン機能に加え、Turbo Intruderと連携してタイミング攻撃を高精度に実行する機能、および手動でペイロードを組み立てる際にContent-Lengthを自動計算する補助機能を備える。特にContent-Lengthの自動計算は、TE.CLペイロードのような「意図的に短く申告する」ケースでは無効化が必須である点に注意する（前述のBurp Repeaterの注意点と同様）。

> 出典: request-smuggling — Pentest Book (six2dez) — https://www.pentest-book.com/enumeration/web/request-smuggling
> 出典: HTTP Request Smuggling — PayloadsAllTheThings — https://swisskyrepo.github.io/PayloadsAllTheThings/Request%20Smuggling/

### 方法論としてのチェックリスト

The Hacker Recipesは、検証を段階的なフェーズとして整理している。これを防御的な観点（＝どこを塞げば各フェーズが成立しなくなるか）とあわせて再構成すると次のようになる。

1. **フロントエンド／バックエンドの多段構成の有無を確認する** — 単一サーバー構成ではスマグリングは原理的に成立しない。CDN・リバースプロキシ・ロードバランサを経由しているか、レスポンスヘッダ（Server、Via、X-Cache等）やインフラの公開情報から推定する。
2. **どちらのヘッダが優先されるか（CL.TE / TE.CL / TE.TE）を確定する** — タイミングベース検出を用い、副作用を避けながら型を絞り込む。
3. **HTTP/2からHTTP/1.1へのダウングレードの有無を確認する** — ダウングレードが行われている場合、H2.CL/H2.TEやCRLFインジェクションの経路が追加される。
4. **タイミング遅延・差分レスポンスの兆候を確証する** — 疑わしい型が絞れたら、影響を限定した形で差分レスポンス検証を行い、実際にキューへの割り込みが起きているかを確認する。
5. **バイト数を正確に調整し、後続処理への影響を検証する** — Content-Lengthや chunkサイズのわずかなズレが検出の成否を左右するため、ここが最も手作業を要するフェーズである。

防御側は、このチェックリストの各段階に対応する形で対策を講じることができる。すなわち、(1)多段構成そのものを見直しHTTP/2をエンドツーエンドで統一する、(2)フロントエンド・バックエンド双方でContent-LengthとTransfer-Encodingが同時に存在するリクエストを拒否する、(3)HTTP/2→HTTP/1.1ダウングレード時のヘッダ値のサニタイズを徹底する、(4)(5)いずれにせよ、リクエストの構文検証をRFC準拠で厳格化し、曖昧な入力を「寛容に解釈して通す」のではなく「明確に拒否する」方針に統一することが、これら全フェーズを無力化する最も一般的な防御である。

> 出典: HTTP request smuggling — The Hacker Recipes — https://www.thehacker.recipes/web/config/http-request-smuggling/

### 実務上の落とし穴（3資料共通の注意点）

最後に、3資料に共通して強調されている、検証時に見落としがちな点を整理する。

- **Content-Lengthの自動更新機能**：Burp RepeaterなどのGUIツールは、送信時にボディの実長へ合わせてContent-Lengthを書き換える機能を持つことが多い。スマグリングの検証では「意図的に不正確な値を送る」ことが前提のため、この自動更新は必ず無効化する。
- **末尾の空行（`\r\n\r\n`）の有無**：TE.CL型のペイロードでは、最終チャンク（`0`）の後に空行が欠けていると、バックエンドが後続の正規リクエストの先頭を巻き込んで誤読し、検出結果が不安定になる。
- **ヘッダ名・値の微細な変形への実装依存**：TE.TE型の難読化パターン（大文字小文字、空白、タブ、改行の挿入位置）は、対象サーバーソフトウェア（nginx、Apache、各種CDN等）ごとに有効なパターンが異なる。単一のパターンで「脆弱性なし」と結論づけず、複数パターンを試す必要がある。ただし本番環境での網羅的な試行は副作用リスクを伴うため、検証環境での事前確認を徹底する。
- **副作用への配慮**：差分レスポンス検証は他ユーザーのリクエストに影響しうる。実サービスでの検証は、自分専用のテストアカウント・専用コネクションに限定し、他ユーザーへの実害を発生させる手順（セッションハイジャックの実演等）は行わない。

> 出典: HTTP Request Smuggling — PayloadsAllTheThings — https://swisskyrepo.github.io/PayloadsAllTheThings/Request%20Smuggling/
> 出典: HTTP request smuggling — The Hacker Recipes — https://www.thehacker.recipes/web/config/http-request-smuggling/
> 出典: request-smuggling — Pentest Book (six2dez) — https://www.pentest-book.com/enumeration/web/request-smuggling
