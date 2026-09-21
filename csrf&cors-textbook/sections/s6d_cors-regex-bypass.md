## origin検証の正規表現・特殊文字バイパス

CORS（Cross-Origin Resource Sharing、オリジンをまたぐリソース共有）で最も危険な設定不備は、サーバがリクエストの `Origin` ヘッダーの値をそのまま `Access-Control-Allow-Origin`（以下 ACAO）に反映してしまう「リフレクション（reflection、受け取った値をそのまま応答に写し返すこと）」だ。ただし現実の実装は、たいてい「許可オリジンかどうか」を何らかの方法で検証してからリフレクションする。その検証が **文字列の部分一致** や **正規表現（regex）** で書かれていると、書き手の意図とパーサ（正規表現エンジンやブラウザのURLパーサ）の実際の挙動がずれ、攻撃者が任意に登録・制御できるオリジンを「許可」と誤判定させられる。

この節では、（1）許可リストを正規表現で書いたときに起きる典型的な論理欠陥と、（2）ブラウザがホスト名として受け付けてしまう「特殊文字」を使い、正規表現の想定を突き破る発見的手法の2系統を、原理レベルで解説する。対象読者はCORSとSOP（Same-Origin Policy、同一オリジンポリシー）の基礎を既に理解している中〜上級者を想定する。

> 本節は防御目的の解説である。ここで示す `target.local` / `attacker.domain` などはすべて架空の値であり、実在サービスや本番環境に対する無許可の検証には使用しないこと。

### なぜオリジン検証はミスりやすいのか（前提の整理）

「オリジン（origin）」は **スキーム（protocol）＋ホスト（domain）＋ポート（port）** の3つ組で定義される。CORSにおいて資格情報（Cookieやベーシック認証などの credentials）付きリクエストを許可する場合、ワイルドカード `Access-Control-Allow-Origin: *` は使えない。ブラウザ仕様上、`ACAO: *` と `Access-Control-Allow-Credentials: true` を同時に返すと応答は拒否される。そのため多くの実装は「複数オリジンを許可したい」という要件を満たすために、**受け取った `Origin` の値を検証してから、その値そのものをエコーバックする** という設計を取らざるを得ない。

```http
GET /api/private-data HTTP/1.1
Host: target.local
Origin: https://attacker.domain
Cookie: JSESSIONID=<redacted>
```
```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://attacker.domain
Access-Control-Allow-Credentials: true
...
{"account":"ACT1234567","balance":"123456,7","token":"top-secret-string"}
```

上記のように攻撃者オリジンがそのまま `ACAO` に反映され、かつ `ACAC: true` が付けば、被害者がログイン済みの状態で攻撃ページを踏むだけで、攻撃者のJavaScriptが資格情報付きクロスオリジン `XMLHttpRequest`/`fetch` を送り、機密応答を読み取れる。したがって攻撃者の狙いは「**自分が用意できるオリジンを検証にパスさせること**」に尽きる。以降のバイパスはすべてこの一点を達成するための技法である。

なお防御の大原則として、bedefended のガイドは「可能なら正規表現ではなく **許可リスト（whitelist）による完全一致** を使え」「`ACAO` にワイルドカードを設定するな」「受け取った `Origin` を **厳密に検証する前に** 反映するな」と述べている。正規表現がミスを誘発しやすいこと自体が、この節全体の背景にある。

> 出典: bedefended — The Complete Guide to CORS (In)Security (v1.1, 2020) — https://www.bedefended.com/papers/cors-security-guide

### 論理欠陥その1: 部分一致（文字列 contains 検査）

最も素朴な失敗は、「`Origin` の中に自社ドメイン名が含まれていれば許可」という部分一致だ。たとえば `Origin` に文字列 `target.local` が含まれるかだけを見る実装を考える。

```
# 疑似コード（危険な例）
if "target.local" in origin_header:
    allow(origin_header)
```

攻撃者は自分が制御するドメイン配下に、標的名を **接頭辞（prefix, サブドメイン側）** として含むホストを作れる。

```
Origin: https://target.local.attacker.domain
```

`target.local.attacker.domain` は攻撃者が登録済みの `attacker.domain` のサブドメインであり、DNSも証明書も攻撃者が自由に用意できる。しかし文字列としては `target.local` を含むので検査を通過してしまう。このパターンを bedefended は「Using the target as subdomain（標的名をサブドメインとして使う）」と呼ぶ。ポイントは、**部分一致はオリジンの構造（どこがサブドメインでどこが登録可能ドメインか）をまったく理解していない** という点にある。

### 論理欠陥その2: 末尾一致ミス（アンカー不足＋量指定子のスコープ）

次に、正規表現を使いつつも境界（アンカー）や量指定子の適用範囲を誤る例。bedefended が挙げる「Registering a domain ending with the same name（同じ名前で終わるドメインを登録する）」の正規表現はこうだ。

```
^https?:\/\/.*\.?target\.local$
```

書き手の意図は「`https://<なんらかのサブドメイン>.target.local` または `https://target.local` を許可」だったはずだ。分解すると次のようになる。

| 部分 | 意味 |
|------|------|
| `.*` | 改行以外の任意の文字が0回以上 |
| `\.` | ドット1文字（エスケープ済み） |
| `?` | 直前の要素（この場合 `\.`）を0回または1回 |

ここでの致命的な誤解は **「`?` が効くのは直前の `\.` だけ」** という点だ。書き手は「サブドメイン部分（ドット区切り）がある場合もない場合も許可したい」つもりで `.*\.?` と書いたが、実際には `.*`（任意文字列）は無条件に許され、`\.?`（ドットの有無）だけが選択肢になる。結果として「`target.local` の直前に **任意の文字列** が来てよく、そのつなぎ目にドットがあってもなくてもよい」という意味になる。

```
Origin: https://nottarget.local
```

`nottarget.local` は `.*` = `not`、`\.?` = ドットなし（0回）、`target.local` = そのまま、で完全にマッチする。つまり攻撃者は **標的ドメイン名で終わる別ドメインを新規登録する** だけで検査を突破できる。`not` の部分は任意なので、レジストラで購入可能な `xtarget.local`（架空例）のようなドメインを取ればよい。

この欠陥の本質は2つ。第一に `.*` の直後にドット必須を強制していないため「ドット境界のない結合（`nottarget.local`）」が通ること。第二に、そもそも `.*` を先頭側に置いた末尾一致は、**登録可能ドメインの境界（`target.local` という登録単位）を守れない**こと。正しくは「`target.local` の直前は必ずドット、またはオリジン先頭」でなければならない（例: `^https?:\/\/([a-z0-9-]+\.)*target\.local$` のように、サブドメインラベル＋ドットの繰り返しに限定する）。

同様に、末尾アンカー `$` を書き忘れると逆向きの被害が出る。

```
# $ を忘れた例（危険）
^https?:\/\/target\.local
```
```
Origin: https://target.local.attacker.domain
```

`$` がないので `target.local` に続く `.attacker.domain` は無視され、攻撃者サブドメインがマッチする。**アンカー `^` と `$` の両方を必ず付ける**ことは正規表現ベース検証の最低条件だ。

### 論理欠陥その3: サブドメイン許可の連鎖リスク

bedefended の「Controlling a subdomain of the target」では、次のような **一見正しい** 正規表現が示される。

```
^https?:\/\/(.*\.)?target\.local$
```

これは `^` と `$` で囲まれ、`(.*\.)?` で「サブドメイン部分（末尾にドット）」を丸ごと任意化しており、`https://target.local` と `https://<sub>.target.local` を許可する。文字列的なバイパスは（この後の特殊文字の話を除けば）成立しにくい。しかし**これ自体が別種のリスクを内包する**点に注意が必要だ。任意のサブドメインを許可しているため、標的の **いずれか1つのサブドメインでも攻撃者が制御できれば** CORSを悪用される。具体的には、

- サブドメインテイクオーバー（subdomain takeover、DNSが指す先のクラウドリソースが解放されており攻撃者が奪える状態）
- そのサブドメイン上に存在するXSS

のいずれかがあれば、攻撃者は「正規のサブドメイン」上でJavaScriptを実行し、正当なオリジンから資格情報付きCORSリクエストを発行できる。つまり「サブドメイン全許可」は、CORS単体では堅牢に見えても、**サブドメイン管理の穴とチェーンする**ことで破れる。ワイルドカード的なオリジン許可は、それ自体が攻撃対象領域を広げる設計判断だと理解すべきだ。

> 出典: bedefended — The Complete Guide to CORS (In)Security (v1.1, 2020) — https://www.bedefended.com/papers/cors-security-guide

### 論理欠陥その4: ドットのエスケープ漏れ

正規表現の `.`（ドット）は「任意の1文字」を表すメタ文字だ。ホスト名のドットを `\.` とエスケープし忘れると、意図しない文字がそこにマッチする。

```
# ドット未エスケープ（危険）
^https?:\/\/api.target.local$
```

この `.` は任意の1文字なので、`https://apiXtarget.local`（`X` は任意文字）や `https://api-target.local` にもマッチしうる。攻撃者は `apiXtarget.local` 相当のドメインを登録できれば通過できる。**ホスト名内のすべてのドットは `\.` にする**ことが必須である。この「未エスケープのドット」は、次節で扱う特殊文字バイパスの土台にもなる（正規表現作者が文字クラスを甘く書く原因になる）。

### 論理欠陥その5: 特殊文字による正規表現バイパス（本節の核心）

ここからが Corben Leo（xxe.sh / sxcurity）による発見的手法「Advanced CORS Exploitation Techniques」の中核である。前述の各バイパスを防ぐため、開発者はしばしば「英数字・ドット・ハイフンだけを許し、それ以外の文字が標的ドメインの後ろに来たら拒否する」つもりで、次のような正規表現を書く。

```
^https?:\/\/(.*\.)?target.local([^\.\-a-zA-Z0-9]+.*)?
```

この意図は「`target.local` とそのサブドメインを許可し、`target.local` の直後に『英数字・ドット・ハイフン以外の文字』が続くような偽装ドメインは弾く」というものだ。分解する。

| 部分 | 作者の意図 | 実際の意味 |
|------|-----------|-----------|
| `[^\.\-a-zA-Z0-9]` | 「`.` `-` 英字 数字 以外」＝不正文字 | まさにその文字集合に **マッチする** 文字クラス |
| `+` | 直前を1回以上 | 同左 |
| `.*` | 任意文字列 | 同左 |
| `( ... )?` | このグループがあってもなくてもよい | 同左 |

ここに二重の罠がある。

**罠1: 否定文字クラスは「拒否」ではなく「マッチ」する。** 作者は `[^...]` を「これらは禁止」の意味で書いたつもりだが、正規表現の `[^\.\-a-zA-Z0-9]` は「**その集合に属する文字にマッチする**」パターンにすぎない。そしてそれが `(...)?` という **任意の末尾グループ** として置かれているため、「英数字でない特殊文字が `target.local` の後ろに来ても、パターン全体としては(その末尾グループにマッチして)成立する」。しかも末尾に `$` アンカーが無いので、`target.local` までマッチした時点で正規表現は成功と判定される。

**罠2: `target.local` のドットが未エスケープ。** これは論理欠陥その4と同じで、堅牢性をさらに下げる。

結果として、`target.local` の直後に英数字・ドット・ハイフン **以外の特殊文字** を1個挟めば、そこから先に攻撃者ドメインを続けても検証を通過する。

```
Origin: https://target.local{.attacker.domain
```

`target.local` までがマッチし、`{` は末尾の否定文字クラスグループに吸収され、残りは自由。実ホスト名は `target.local{.attacker.domain` であり、これは攻撃者が制御する `attacker.domain` 配下だ。Corben Leo の元記事では標的を `xxe.sh` として `^https?:\/\/(.*\.)?xxe\.sh([^\.\-a-zA-Z0-9]+.*)?` に対し `http://x.xxe.sh{.<attacker-domain>` を通す例が示されている。

#### なぜブラウザはそんなホスト名でリクエストを送るのか

ここで最大の疑問は「`target.local{.attacker.domain` のような不正なホスト名を、ブラウザが本当にDNS解決してリクエスト送信するのか」だ。ここに **ブラウザ実装差** という第2の原理が絡む。

- **Chrome / Firefox** は、リクエスト送信 **前に** ドメイン名の妥当性を検証する傾向があり、多くの特殊文字を含むホストではそもそもリクエストを出さない（＝攻撃が成立しない）。
- **Safari** は挙動が分岐する。Corben Leo の観察によれば「Safariで同じドメインを読み込もうとすると、実際にリクエストを送信してページを読み込む」。つまり Safari は不正に見えるホスト名でもリクエストを飛ばすため、特殊文字を使ったオリジン偽装が成立しやすい。

この「ブラウザがホスト名を送信前に検証するか否か」の差こそが、特殊文字バイパスの成否を分ける根本メカニズムだ。攻撃者が用意すべきインフラ側の前提は次の2つ。

- 自分のサーバに向く **ワイルドカードDNSレコード**（`*.attacker.domain`）。任意ラベルの偽装ホストを実在させ、解決させるため。
- Web層は **Node.js** など特殊文字入りホストを受け付けるサーバ。Apache や Nginx は既定では特殊文字を含むホスト名/リクエストを拒否するため、素の状態では攻撃PoCサーバとして機能しない。

Corben Leo が挙げる「ブラウザがホスト名として許容しうる特殊文字」は次の通り。

```
# 印字可能な特殊文字
, & ' " ; ! $ ^ * ( ) + = ` ~ - _ = | { } %

# 非印字文字
%01-08, %0b, %0c, %0e, %0f, %10-%1f, %7f
```

> 出典: Corben Leo — Advanced CORS Exploitation Techniques — https://www.sxcurity.pro/advanced-cors-techniques/ （原文ミラー: https://github.com/lc/lc.github.io/blob/master/_posts/18-6-16-advanced-cors-techniques.md ）

#### 特殊文字のブラウザ別対応表（bedefended 追試, 2020年時点）

bedefended は Corben Leo の研究を追試し、「Safari 専用」と思われていた特殊文字の一部が **他ブラウザでも通る** ことを検証した。以下は、各文字がオリジンのホスト名として受け付けられ、リクエストが送信されたか（Yes/No）を示す（1つ以上のブラウザで通った文字のみ掲載）。バージョンは Chrome v79.0.3945 / Edge v44.18362.449 / Firefox v72.0.2 / Internet Explorer v11 / Safari v13.0.4。

| 特殊文字 | Chrome | Edge | Firefox | IE | Safari |
|:---:|:---:|:---:|:---:|:---:|:---:|
| `!` | No | No | No | No | Yes |
| `=` | No | No | No | No | Yes |
| `$` | No | No | **Yes** | No | Yes |
| `&` | No | No | No | No | Yes |
| `'` | No | No | No | No | Yes |
| `(` | No | No | No | No | Yes |
| `)` | No | No | No | No | Yes |
| `*` | No | No | No | No | Yes |
| `+` | No | No | **Yes** | No | Yes |
| `,` | No | No | No | No | Yes |
| `-` | **Yes** | No | **Yes** | **Yes** | Yes |
| `;` | No | No | No | No | Yes |
| `^` | No | No | No | No | Yes |
| `_`（アンダースコア） | No | **Yes** | **Yes** | **Yes** | Yes |
| `` ` `` | No | No | No | No | Yes |
| `{` | No | No | No | No | Yes |
| `\|` | No | No | No | No | Yes |
| `}` | No | No | No | No | Yes |
| `~` | No | No | No | No | Yes |

この表から読み取るべき結論は次の通り。

1. **Safari は掲載された全特殊文字を許容する。** Safari 利用者を狙える攻撃なら、特殊文字バイパスの自由度は非常に高い。
2. **`$` と `+` は Firefox でも通る。** Safari 限定ではない。
3. **アンダースコア `_` は Edge / Firefox / IE / Safari で通る**（この表では Chrome は No）。DNS のホスト名仕様上アンダースコアは本来ラベルに使えないが、ブラウザは実装により許容する。Corben Leo は原記事で「アンダースコアは Safari だけでなく Chrome / Firefox でもサブドメインでサポートされ、複数ブラウザ攻撃に特に有用」と述べており、対応状況は測定時期・バージョンで揺れる点に注意（陳腐化に備え、実運用では最新ブラウザで再測定すること）。
4. したがって、脆弱な正規表現が **アンダースコアを含む** 特殊文字を `target.local` の後ろで許してしまうと、Safari 以外の主要ブラウザ利用者まで被害範囲に入る。

たとえば正規表現が英数字・ドット・ハイフンのみを厳密に見て、それ以外を末尾の任意グループとして「うっかり許して」いる場合、アンダースコアを使ったオリジンは複数ブラウザで通る。

```
# アンダースコアを使った例（Safari以外でも成立しうる）
Origin: http://www.target.local_.attacker.domain
```

`www.target.local` までが正規のサブドメイン部にマッチし、`_` が末尾の否定文字クラスグループに吸収され、`.attacker.domain` は攻撃者ドメイン。実ホスト `www.target.local_.attacker.domain` は `*.attacker.domain` のワイルドカードDNSで解決される。

#### 攻撃者側PoCの構造（防御理解のため）

bedefended が示す最小PoCの構造だけ、原理理解のために引用する（架空ドメインに対する仕組みの説明であり、実サービスへの利用は禁止）。攻撃者は Node.js で「特殊文字入りホストでも応答するサーバ」を立て、そこに次のようなCORS発火HTMLを置く。

```html
<script>
function cors() {
    var req = new XMLHttpRequest();
    req.onload = reqListener;
    req.open("GET","http://www.target.local/api/private-data",true);
    req.withCredentials = true;   // 資格情報付きで送る＝Cookieが乗る
    req.send();
    function reqListener() {
        document.getElementById("container").innerHTML = this.responseText;
    }
}
</script>
```

被害者を `http://www.target.local{.<attacker-domain>/cors-poc` のようなURLに誘導すると、そのページのオリジンが `www.target.local{.attacker.domain` になる。脆弱な正規表現はこれを `target.local` として許可し、`ACAO` にこのオリジンを反映して `ACAC: true` を返すため、`withCredentials=true` のリクエストが被害者のCookie付きで通り、機密応答がスクリプトに読み取られる。要点は「**オリジンのホスト名は攻撃者制御ドメイン配下なのに、正規表現がそれを標的の正規オリジンと誤認する**」という一点に集約される。

Corben Leo は許容オリジンの探索（どの特殊文字が正規表現を抜けるか）を自動化する Python ツール **TheftFuzzer** を公開している。防御側にとっての含意は「特殊文字の順列を機械的に試すファジングが容易であり、正規表現の穴は人手を介さず発見されうる」ということだ。

> 出典: Corben Leo — Advanced CORS Exploitation Techniques — https://www.sxcurity.pro/advanced-cors-techniques/ ／ bedefended — The Complete Guide to CORS (In)Security (v1.1, 2020) — https://www.bedefended.com/papers/cors-security-guide

### 参考: null オリジンと関連する落とし穴

正規表現・文字列検証とは別系統だが、検証ロジックがしばしば見落とす特殊値として `Origin: null` がある。サンドボックス化した iframe やリダイレクト、ローカルHTMLファイル由来のリクエストは `Origin: null` を送る。攻撃者は次のようなサンドボックス iframe で任意ページのオリジンを `null` にできる。

```html
<iframe sandbox="allow-scripts allow-top-navigation allow-forms"
  src='data:text/html,<script>**CORS request here**</script>'></iframe>
```

もし許可リストや正規表現が文字列 `null` を「安全な既定値」として通してしまうと、`ACAO: null` + `ACAC: true` が返り、任意サイトから資格情報付きで攻撃できる。**`null` を許可オリジンとして扱わない**ことは、正規表現バイパス対策と並ぶ必須事項である。

### まとめ: 正規表現・特殊文字バイパスへの防御

これらのバイパスは、いずれも「検証ロジックがオリジンの構造とパーサの実挙動を正しくモデル化していない」ことに起因する。防御の要点は以下。

- **可能な限り正規表現をやめ、許可リストによる完全一致にする。** bedefended も「regex より whitelist を優先せよ」と明言する。オリジンは有限で管理可能なはずだ。
- どうしても正規表現を使うなら、**`^` と `$` の両アンカーを必ず付ける**。末尾一致漏れ・接頭辞偽装を封じる。
- **ホスト名内のドットは必ず `\.` にエスケープ**し、任意文字マッチを防ぐ。
- サブドメインは `([a-z0-9-]+\.)*` のように **正規の文字集合とドット境界に限定**し、`.*` のような何でも通るパターンを使わない。特に「否定文字クラスを末尾の任意グループにする」書き方は、拒否ではなくマッチになるため厳禁。
- **`null` を許可しない**。
- サブドメイン全許可は、サブドメインテイクオーバーやXSSと連鎖することを前提に、サブドメイン管理・監視を強化する。
- 資格情報が不要なら `Access-Control-Allow-Credentials` を返さない。反映するオリジンが偽装されても被害（資格情報付き読み取り）を大幅に減らせる。
- CORS設定を **動的生成する場合は `Vary: Origin`** を返し、キャッシュ経由の別種攻撃を防ぐ。

正規表現ベースのオリジン検証は「一見動く」ため本番投入されやすいが、パーサの挙動差とブラウザのホスト名許容差という2つの見えにくい原理によって、機械的なファジングで突破されうる。検証は「攻撃者が用意できるどんなオリジン文字列も、標的の正規オリジン集合に対して完全一致でしか通らない」ことを保証できて初めて安全といえる。

> 出典: bedefended — The Complete Guide to CORS (In)Security (v1.1, 2020) — https://www.bedefended.com/papers/cors-security-guide ／ Corben Leo — Advanced CORS Exploitation Techniques — https://www.sxcurity.pro/advanced-cors-techniques/
