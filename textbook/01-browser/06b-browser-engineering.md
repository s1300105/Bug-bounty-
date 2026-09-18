# 実装コードで解剖する第10章のセキュリティ機構と、原典を自分の手で開く方法

> **この節で分かること**
> - 教材ブラウザ（Web Browser Engineering 第10章）の完成コードを読み、cookie・同一オリジンポリシー・CSRF・SameSite・XSS・CSPが「コードのどの1点で効いているか」を指し示せる。
> - 「同一オリジンポリシーはレスポンスの読み取りを止めるが、リクエストの送出自体は止めない」という診断上の急所を、実装から説明できる。
> - フレーム間分離・site isolation・Spectre/Meltdownという、Web層の下にあるプロセス層・CPU層の防御の必要性を説明できる。
> - この教材の図・章末Outline・クイズ・ウィジェットが「実際には何を再現でき、何を再現できないか」を区別できる。
> - 原典サイトが取得できない環境でも、公式リポジトリを clone して本文・コード・図・攻撃シナリオを自分で再現する手順を実行できる。
> - 本文とコードでライセンス条件が異なることを理解し、引用・転載の可否を自分で判断できる。

**元資料**: https://browser.engineering/security.html および https://browser.engineering/embeds.html （原典HTMLは取得できず、公式ソースリポジトリ https://github.com/browserengineering/book を clone して原稿・コード・図・ビルド設定から確認。commit `c8c6d34b636a0fec3589a4a2e901916c774f1929`）
**関連する節**: 06a（第10章の設計思想とセキュリティ概念の導入）

---

## 1. この節の位置づけ

この節は、教科書『Web Browser Engineering』（著: Pavel Panchekha & Chris Harrelson）第10章 "Keeping Data Private" の**完成コードそのもの**を材料に、前段（06a）で概念として学んだセキュリティ機構が「実際のコードのどこに、どの1行として現れるか」を確かめる。

この本は「ブラウザは魔法ではなくコードである」ことを示すために、数千行のPythonでネットワークからJavaScriptまで動く小さな実ブラウザを一から組み立てる教科書である。第10章時点のブラウザ実装は `src/lab10.py`、サーバ実装は `src/server10.py`、ブラウザ内で動くJavaScriptランタイムは `src/runtime10.js` に完成形がある。

概念（なぜ・どう動く・どこを突く・どう守る）の順序立てた説明は06aで扱った。ここでは**実装を信頼境界の地図として読む**ことに集中する。信頼境界（trust boundary）とは、信頼できるデータと信頼できないデータが接する境目のこと。攻撃者はこの境界の実装漏れを突く。コードを「攻撃面（attack surface, 攻撃者が触れる入口の総体）」として読む練習でもある。

〔補足〕本節の内容は原典サイトのHTMLではなく、そのサイトを生成しているソースリポジトリを clone して確認したものである。原典サイト `browser.engineering` は本教科書の執筆環境からは取得できなかった（後述の第12小節を参照）。ただしコード・原稿・図はすべてリポジトリ内に実体があるため、内容は一次資料で裏が取れている。

---

## 2. cookieはどこで付くのか — `URL.request` を読む

### なぜ cookie を実装から追うのか

cookieとは、ブラウザがサイトごとに保存する永続的な状態のこと。ログインのように「前のリクエストの続き」だとサーバに分からせるために使う。cookie自体は防御機構ではなく**識別機構**である。だが後段のCSRFやSameSiteは、この cookie の「自動付与」という性質の上に成り立つので、まずコードで正確に押さえる。

### どう動くのか

第10章の `URL.request` は、リクエストを送る直前に cookie を付ける。該当部分（`src/lab10.py`、逐語）。

``` python
        method = "POST" if payload else "GET"
        request = "{} {} HTTP/1.0\r\n".format(method, self.path)
        request += "Host: {}\r\n".format(self.host)
        if self.host in COOKIE_JAR:
            cookie, params = COOKIE_JAR[self.host]
            allow_cookie = True
            if referrer and params.get("samesite", "none") == "lax":
                if method != "GET":
                    allow_cookie = self.host == referrer.host
            if allow_cookie:
                request += "Cookie: {}\r\n".format(cookie)
```

`COOKIE_JAR` はモジュールのグローバル変数で、キーはホスト名。サーバから来たレスポンスに `Set-Cookie` があれば、同じ `request` メソッド内でここに保存される（逐語）。

``` python
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

そしてオリジンを組む1メソッドが加わる（逐語）。

``` python
    def origin(self):
        return self.scheme + "://" + self.host + ":" + str(self.port)
```

オリジン（origin）とは、スキーム（`http`/`https`）・ホスト名・ポート番号の3つ組のこと。同一オリジンポリシーはこの3つ組が一致するかで境界を引く。

### 攻撃者はどこを突くか

診断の観点で重要なのは次の点である。

- `COOKIE_JAR` は**全タブで共有**される1つのグローバル。キーがホスト名だけなので、スキームやポートを区別しない。つまり cookie の「サイト」の定義は、同一オリジンポリシーの「オリジン」より粗い。
- `token = headers["cookie"][len("token="):]` のような素朴なパースがサーバ側にあり（後述）、cookieが `token=...` 一つだけである前提。複数cookieがあると壊れる。
- サブリソース（画像・スクリプト・スタイルシートなど、HTMLページ本体以外のリソース）の要求にも cookie が自動で付く。

この「自動付与」こそがCSRFの前提である。ブラウザは「送れ」と指示されなくても、同じサーバへの次のリクエストに cookie を載せる。攻撃者はこの自動付与を、被害者の意図しないリクエストに流用する。

---

## 3. 同一オリジンポリシーは「レスポンスを捨てる」だけ — `XMLHttpRequest_send`

### 設計意図

`XMLHttpRequest`（XHR）とは、ページ内のJavaScriptがサーバへ追加のリクエストを投げてデータを取ってくるAPIのこと。これを足した瞬間に、悪意あるページが他サイトのユーザ専用データを読めてしまう危険が生まれる。そこで同一オリジンポリシー（Same-Origin Policy, SOP）が必要になる。

### どう動くのか（実装の実行順が急所）

第10章の完成コードの該当部分（`src/lab10.py`、逐語）。

``` python
    def XMLHttpRequest_send(self, method, url, body):
        full_url = self.tab.url.resolve(url)
        if not self.tab.allowed_request(full_url):
            raise Exception("Cross-origin XHR blocked by CSP")
        headers, out = full_url.request(self.tab.url, body)
        if full_url.origin() != self.tab.url.origin():
            raise Exception("Cross-origin XHR request not allowed")
        return out
```

ここで実行順に注目する。順序は「CSPチェック → 実際にリクエストを送信（cookieも付く） → 同一オリジンチェック → 例外」になっている。つまり**同一オリジン違反であっても、リクエストは実際に飛んでおり、レスポンスだけが捨てられる**。

これは偶然ではない。演習10-5がCORSについて述べるとおり、実ブラウザの単純リクエスト（simple request）の挙動もこうである。ブラウザはリクエストに `Origin` ヘッダを付けて送り、同一オリジンポリシーを満たすためにレスポンスを捨てる。

### 攻撃者はどこを突くか

診断で最重要の教訓はこれである。

> 同一オリジンポリシーは**レスポンスの読み取り**を止めるが、**リクエストの送出そのもの**は止めない。だから副作用（サーバ側でデータが書き換わる等）は起きうる。

この性質があるからCSRFが成立する。「読めないから安全」と考えるのは誤りで、「書き込み系のリクエストはオリジンをまたいで届いてしまう」ことを常に疑う。

---

## 4. CSPの実施点はブラウザにただ1つ — `Tab.load` と `allowed_request`

### 設計意図

Content-Security-Policy（CSP）とは、「このページが読み込んでよいリソースの出所」をサーバがヘッダで宣言し、ブラウザに強制させる仕組みのこと。XSSでスクリプトが注入されても、許可外のオリジンからは読み込めないので被害を抑えられる。

### どう動くのか

第10章の実装（`src/lab10.py`、逐語）。判定メソッドと、それを使う `load` の要所。

``` python
    def allowed_request(self, url):
        return self.allowed_origins == None or \
            url.origin() in self.allowed_origins

    def load(self, url, payload=None):
        headers, body = url.request(self.url, payload)
        self.scroll = 0
        self.url = url
        self.history.append(url)

        self.allowed_origins = None
        if "content-security-policy" in headers:
           csp = headers["content-security-policy"].split()
           if len(csp) > 0 and csp[0] == "default-src":
                self.allowed_origins = []
                for origin in csp[1:]:
                    self.allowed_origins.append(URL(origin).origin())
```

`load` は続けてスクリプトとスタイルシートを収集し、`allowed_request` を通らないものはブロックする（逐語、要所）。

``` python
        for script in scripts:
            script_url = url.resolve(script)
            if not self.allowed_request(script_url):
                print("Blocked script", script, "due to CSP")
                continue
```

ブロックされたスクリプトはコンソールに `Blocked script ... due to CSP` と出る。CSPのパースは、スクリプト／スタイルシートの要求より**前**に行う必要がある。

### 攻撃者はどこを突くか

Outline（後述）を見ると、`Tab.allowed_request` は第10章で新設されたメソッドであり、**CSPを評価する地点はブラウザ側にただ1つ**である。診断の観点では、実施点が1つしかないことは「その1点の実装バグが全防御を無効化しうる」ことを意味する。CSPのバイパスを探すなら、まずこの単一の判定関数の抜けを疑う。

本書の実装は `default-src` ディレクティブだけを、スペース区切りのオリジン列挙として扱う簡略版である。実ブラウザは `self` や `script-src` などのディレクティブ、scheme-generic URLも持つ。

---

## 5. サーバ側の防御 — nonce・HTMLエスケープ・SameSite（`server10.py`）

### どう動くのか

第10章のゲストブックサーバ `src/server10.py` は、防御の主要部をサーバ側に置く。接続処理の要所（逐語）。

``` python
    if "cookie" in headers:
        token = headers["cookie"][len("token="):]
    else:
        token = str(random.random())[2:]

    session = SESSIONS.setdefault(token, {})

    status, body = do_request(session, method, url, headers, body)
    response = "HTTP/1.0 {}\r\n".format(status)
    response += "Content-Length: {}\r\n".format(
        len(body.encode("utf8")))
    if "cookie" not in headers:
        template = "Set-Cookie: token={}; SameSite=Lax\r\n"
        response += template.format(token)
    csp = "default-src http://localhost:8000"
    response += "Content-Security-Policy: {}\r\n".format(csp)
```

`SameSite=Lax` を付けて cookie を発行し、CSPヘッダも付ける。フォームには使い捨てのnonceを埋める（逐語、要所）。nonceとは、1回きり有効な使い捨ての値のこと。CSRF対策では「このフォームは確かにこのサイトが出したものだ」と確認するために使う。

``` python
def show_comments(session):
    out = "<!doctype html>"
    if "user" in session:
        out += "<h1>Hello, " + session["user"] + "</h1>"
        nonce = str(random.random())[2:]
        session["nonce"] = nonce
        out += "<form action=add method=post>"
        out +=   "<p><input name=guest></p>"
        out +=   "<input name=nonce type=hidden value=" + nonce + ">"
```

投稿受付側はnonceを照合し、投稿本文をHTMLエスケープして表示する（逐語）。HTMLエスケープとは、`<` を `&lt;` に変換するように、記号をタグとして解釈されない形に置き換えること。これがXSS（保存型・反射型）の基本的な防御になる。

``` python
def add_entry(session, params):
    if "user" not in session: return
    if "nonce" not in session or "nonce" not in params: return
    if session["nonce"] != params["nonce"]: return
    if 'guest' in params and len(params['guest']) <= 100:
        ENTRIES.append((params['guest'], session["user"]))
```

`show_comments` の投稿一覧では `html.escape(entry)` / `html.escape(who)` を通して出力している。

### 攻撃者はどこを突くか（この教材サーバに残る穴）

原典コードには、教材ゆえの簡略化・不整合が残る。これらは「実装漏れがどう脆弱性になるか」の具体例として価値がある。

- `token = headers["cookie"][len("token="):]` は Cookie が `token=...` 一つだけである前提の素朴なパース。複数cookieで壊れる。
- `str(random.random())[2:]` はトークンとnonceの両方に使われ、暗号論的に安全でない（53ビット、予測可能）。CSRF nonceが予測できれば防御は無意味になる。
- `show_comments` は `<link rel=stylesheet src=/comment.css>` と出力するが、`lab10.py` のスタイルシート収集は `"href" in node.attributes` を要求する。属性名が `src` では読み込まれない（正しくは `href`）。
- nonceはセッションに1つだけ保存されるので、複数タブでフォームを開くと先のnonceが上書きされる。
- HTMLエスケープは1箇所でも忘れればセキュリティバグになる。エスケープの網羅性が命である。

---

## 6. `innerHTML` というXSSの sink — `runtime10.js`

`src/runtime10.js` は、ブラウザがJSコンテキストに注入するランタイムである。ここに、クライアントサイドXSSの sink（注入された値が最終的に実行・解釈される到達点）が現れる。該当部分（逐語）。

``` javascript
Object.defineProperty(Node.prototype, 'innerHTML', {
    set: function(s) {
        call_python("innerHTML_set", this.handle, s.toString());
    }
});
```

そしてXHRの入口（逐語）。

``` javascript
function XMLHttpRequest() {}

XMLHttpRequest.prototype.open = function(method, url, is_async) {
    if (is_async) throw Error("Asynchronous XHR is not supported");
    this.method = method;
    this.url = url;
}

XMLHttpRequest.prototype.send = function(body) {
    this.responseText = call_python("XMLHttpRequest_send",
        this.method, this.url, body);
}
```

`innerHTML` のセッターが `call_python("innerHTML_set", ...)` を呼ぶ。Python側でこの文字列はHTMLとしてパースされ、ノードツリーに差し替えられる。つまり**文字列を無検証でここに渡せば、その文字列がHTMLとして解釈される**。DOM系XSSを探すときは、ユーザ制御の値がこの sink まで届く経路（source から sink までのデータフロー）を追うことになる。

---

## 7. フレーム間の分離とクロスオリジン防壁（第15章）

### なぜ第15章まで見るのか

第10章はページ単体の防御だが、実際のWebページは他サイトのページをiframeで埋め込む。iframeとは、ページの中に別のページを丸ごと埋め込む枠のこと。ここで新たな信頼境界が生まれるので、第15章 "Supporting Embedded Content" の分離の話が第10章と対になる。

### どう動くのか — オリジン単位でJSコンテキストを束ねる

本書のブラウザは、JSコンテキスト（JavaScriptの実行環境）を**フレームごとではなくオリジンごと**に持つ。設計原則（逐語）は「same-origin iframes should run in the same JavaScript context and should be able to access each other's globals, call each other's functions, and modify each other's DOMs」。実装（逐語、要所）。

``` python
class Tab:
    def __init__(self, browser, tab_height):
        self.origin_to_js = {}

    def get_js(self, url):
        origin = url.origin()
        if origin not in self.origin_to_js:
            self.origin_to_js[origin] = JSContext(self, origin)
        return self.origin_to_js[origin]
```

同一オリジンのフレームは何個あっても1つのJSコンテキストを共有し、異なるオリジンのフレームは隔離される。

### クロスオリジンの防壁

クロスオリジンのフレーム同士はドキュメントに触れてはならない。防壁（逐語）。

``` python
class JSContext:
    def throw_if_cross_origin(self, frame):
        if frame.url.origin() != self.url_origin:
            raise Exception(
                "Cross-origin access disallowed from script")
```

このチェックは `querySelectorAll` / `setAttribute` / `innerHTML_set` / `style_set` など、ドキュメントに触れる**全メソッドの冒頭で**呼ばれる。

### 攻撃者はどこを突くか（著者自身の警告）

著者はこの防壁の不十分さを自ら明記している（逐語）。

> Note that in a real browser this is woefully inadequate security. A real browser would need to very carefully lock down the entire `runtime.js` code and audit every single JavaScript API with a fine-toothed comb.

診断の含意は明快である。**JS APIを1つでも防壁チェックの外に置き忘れれば、クロスオリジンのDOMアクセスが通ってしまう**。実ブラウザでも、ランタイムのAPI監査漏れがこのクラスの脆弱性を生む。

### クロスオリジン間の安全な通信は message passing

直接アクセスが危険なので、クロスオリジン間は `postMessage` によるメッセージパッシングで通信する（逐語の使い方）。

``` javascript
window.parent.postMessage("...", '*')
```
``` javascript
window.addEventListener("message", function(e) {
    console.log(e.data);
});
```

第2引数はオリジン制限に関わり、演習15-8で `targetOrigin`（受信を許可するオリジンを指定する文字列）を実装する。`postMessage` が非同期である理由も設計上重要で、著者曰く「sending a synchronous message might involve synchronizing multiple `JSContext`s or even multiple processes, which would add a lot of overhead and probably result in deadlocks」。同期にするとデッドロックの恐れがあるため、非同期でなければならない。

また、structured cloning（オブジェクトをバイト列に直列化して別フレームへ渡すアルゴリズム）は**DOMノードを送れない**。教材ブラウザは文字列のみ対応する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Web Browser Engineering 第15章 "Supporting Embedded Content"（`Isolation and Timing` 節） — https://browser.engineering/embeds.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側のプロキシ制限で `browser.engineering` へのアクセスが403で拒否された）。以下の記述は clone した原稿 `book/embeds.md` の逐語引用にもとづく要約である。
> **読みどころ**:
> 1. 同一オリジンポリシーという「Web層」の防御の下に、プロセス層・CPU層の防御がなぜ必要かを理解する。
> 2. site isolation、rasterizerの `seccomp` サンドボックス、Spectre/Meltdown、`SharedArrayBuffer` のヘッダ要件を、短いが密度の高い1節で通読する。
> 3. 本節の図（後述の Figure 7）と併読し、オリジン単位のJSコンテキスト割り当てが site isolation の簡略版であると腑に落とす。
> **代替手段**: 公式リポジトリ `https://github.com/browserengineering/book` を clone すれば `book/embeds.md` に原稿全文がある。日本語の正式訳語はオライリー・ジャパン版 `https://www.oreilly.co.jp/books/9784814401574/`。

---

## 8. Web層の下 — site isolation・Spectre/Meltdown・タイマー

第15章 `Isolation and Timing` 節は、論理的な防御（同一オリジンポリシー）だけでは足りない理由を扱う。ここは実ブラウザの守りの深さを知る上で必読である。

### 脅威モデル

著者はまず脅威の双方向性を述べる（逐語）。攻撃者ページに自分のページが埋め込まれる場合と、自分のページに信頼できないページを埋め込む場合の**両方**を守る必要がある。加えて「Websites can protect themselves from being iframed via the `X-Frame-Options` header.」——自サイトがiframe化されるのを `X-Frame-Options` ヘッダで拒否できる。

### JSエンジンのバグを前提にした多層防御

クロスオリジンのiframeはJavaScriptで直接アクセスできない。だがJSエンジンにバッファオーバーラン（buffer overrun, メモリの領域外書き込みで保護を突破するバグ）があればこの保護は破られる。著者曰く「bugs like this are common enough that browsers have to defend against them」。そのため近年のブラウザは**異なるオリジンのフレームを別々のOSプロセスで実行**し、OSの機能でプロセスの権限を制限する。これが site isolation である。

### rasterizer 経由の情報漏洩

さらにブラウザは複数フレームの内容を混ぜる箇所がある（例: タブ全体の display list）。rasterizer（描画リスト実行部）にバグがあると、1つのフレームがrasterizerを乗っ取り、別フレーム由来のデータを読めてしまう。著者曰く「it has happened before」——実際に起きたことがある。そこでChromiumは**rasterizerを独立プロセスに置き、Linuxの `seccomp` でそのプロセスが実行できるシステムコールを制限する**。仮に乗っ取られてもネットワークへデータを持ち出せない。

### Spectre / Meltdown

近年 site isolation の重要性を高めたのが、CPUキャッシュのタイミング攻撃 Spectre と Meltdown である（逐語の要旨）。これらは「CPU演算にかかる時間を測ることで、メモリの任意の場所——同一プロセスにいる別フレームのデータを含む——を読み出す」攻撃。だから機密性の高い内容を別々のCPUプロセス（別々のメモリ空間を持つ）に置くことが有効な防御になる。

### タイマーという急所

タイミング攻撃には正確な時刻データが要る。そこでブラウザは**高精度タイマーへのアクセスを制限**し、`Date.now` や `setTimeout` の精度をわざと落とす。厄介なのは「タイマーに見えないタイマー」で、例えば `SharedArrayBuffer`（2つのJSスレッドがメモリを共有して並行実行できるAPI）は時計の代わりに使える。これは時計ではないので「精度を落とす」ことができない。そこでブラウザは、`SharedArrayBuffer` を使うには**親フレームと子フレームの両方**のHTTPレスポンスに特定のヘッダが付いていることを要求する。

著者はこの制約に自分で嵌まった実話を残している（逐語の要旨）。本のサイトの埋め込みウィジェットにJavaScriptサポートを足したとき、`SharedArrayBuffer` を使うためにセキュリティヘッダを設定しようとしたが、第14章がYouTube動画を埋め込んでおりYouTubeがそのヘッダを送らないため設定できず、結局「ウィジェットを埋め込まず、読者に新しいウィンドウを開いてもらう」形で回避した。ヘッダ要件が現実の埋め込み構成と衝突する好例である。

---

## 9. 第10章のセキュリティ機構 早見表

以下は原文の記述から構成した、各機構の「何を防ぐか／本書の実装範囲／残る穴」の対応表である。診断時のチェックリストとして使える。

| 機構 | ヘッダ/API | 何を防ぐか | 本書の実装範囲 | 残る穴・注意点 |
| --- | --- | --- | --- | --- |
| Cookie | `Set-Cookie` / `Cookie` | （識別機構） | hostキーのjar、単一cookie | 複数`Set-Cookie`非対応、タブ横断共有、サブリソースにも付与 |
| Same-origin policy | `URL.origin()` | 他オリジンの**レスポンス読み取り** | `XMLHttpRequest`のみ | リクエスト送出は止めない。CSS/JSリンク読込には非適用 |
| CSRF nonce | `<input name=nonce type=hidden>` | クロスサイトフォーム送信 | セッションに1つ | XSSで盗める。複数タブで上書き。予測可能な乱数 |
| SameSite cookie | `Set-Cookie: ...; SameSite=Lax` | クロスサイト`POST`のcookie送出 | `Lax`と`None`のみ | `Strict`未実装。判定はhost一致のみ |
| HTMLエスケープ | `html.escape()` / `&lt;` | 反射・保存型XSS | サーバ側2箇所 | 1箇所忘れれば破れる |
| CSP | `Content-Security-Policy: default-src ...` | 許可外リソース読込 | `default-src`のみ | 実施点が1つ。パースはJS/CSS要求より前が必須 |
| （演習）`HttpOnly` | `Set-Cookie: ...; HttpOnly` | JSからのcookie読書 | 演習10-3 | RFC 6265 §5.3 |
| （演習）CORS | `Origin` / `Access-Control-Allow-Origin` | クロスオリジン読取の明示許可 | 演習10-5 | 本書は全て "simple request" |
| （演習）`Referrer-Policy` | `Referer` / `Referrer-Policy` | Referer経由の漏洩 | 演習10-6 | `Referer` は綴りミスが仕様 |
| （第15章）`throw_if_cross_origin` | — | クロスオリジンDOMアクセス | 主要4メソッド | 著者自ら「woefully inadequate」 |
| （第15章）`postMessage` | `postMessage` / `message`イベント | クロスオリジン間の安全な通信 | 文字列のみ | 非同期必須。DOMノードは送れない |
| （第15章）site isolation | — | JSエンジンのバグ、rasterizer漏洩、Spectre/Meltdown | 解説のみ | Chromiumは`seccomp`でsyscall制限 |

---

## 10. 本書が意図的に扱わない領域

診断者は「この教材でどこまで学べるか」の境界も知るべきである。`book/skipped.md`（"What Wasn't Covered"）が明示している割愛領域は次のとおり。

- **TLSと通信の暗号化**: AES-GCM、ChaCha20、HMAC-SHA512といった暗号プロトコル群、TLS。著者は「A minimal and incomplete version of TLS is a broken and insecure version of it」（TLSの最小・不完全版は、壊れた・安全でない版に等しい）として意図的に省いた。暗号は別の専門書で学ぶべき、という立場。
- **プライバシー**: third-party cookie、フィンガープリンティング（fingerprinting, ブラウザの特徴の組み合わせで個人を追跡する手法）、広告向けAPIの是非。「基本的な概念すら定まっていない（何がプライバシーの基準か、誰が役割を担うべきか）」ため割愛。
- **JITとWebAssembly**: 現代のブラウザはJavaScriptを実行時型解析で機械語にJITコンパイルし、hidden classesのような技法で最適化する。WebAssemblyも実行する。本書はJSエンジン構築を省き、`DukPy`（軽量なJS評価器）を使う。

用語集（`book/glossary.md`）は「web security」を、browser security（ユーザの計算機がブラウザに害されないこと）、web application security（Webアプリがユーザに害されないこと）、privacy（第三者がユーザに害を及ぼさないこと）などの総体として定義する。本教科書が主眼とするクライアントサイド脆弱性は、主にこの browser security と web application security の境界にある。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Web Browser Engineering "What Wasn't Covered" — https://browser.engineering/skipped.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側のプロキシ制限で403拒否）。以下は clone した `book/skipped.md` の逐語引用にもとづく要約である。
> **読みどころ**:
> 1. 本書の守備範囲の**外側**（TLS詳細・プライバシー・third-party cookie・フィンガープリンティング・JIT/WebAssembly）を把握する。
> 2. バグバウンティで次に深掘りすべき領域の地図として使う。
> **代替手段**: clone した `book/skipped.md`。

---

## 11. 図で構造をつかむ

原典サイトにはアニメーションGIFの図がある。サイトは取得できないが、GIF本体はリポジトリの `www/im/` にあり内容を確認できた。要点を自作のツリーで示す。

### 図1: cookieの自動付与（`im/security-cookies-2.gif`）

```
Browser                         Server
  |----------- GET / ------------->|
  |<-------- Set-Cookie:... -------|
  |-- GET /login + Cookie:... ---->|   ← 2回目以降は cookie が自動で載る
  |<--------- <form...> -----------|
```

3本目の矢印が本質。ブラウザは指示されなくても、同じサーバへの次のリクエストにcookieを自動で付ける。この自動付与がCSRFの前提になる。

### 図2: SPAとリクエストの起点の移動（`im/security-spa-2.gif`）

```
              Page（ブラウザ内のページ）
  Browser --GET--> [Request] --HTML--> Page      ← ナビゲーション起点
  Page  --XMLHttpRequest--> [Request] --JSON--> Page   ← ページ(JS)起点
  Page  --XMLHttpRequest--> [Request] --JSON--> Page   ← ページ(JS)起点
```

最初のリクエストだけがブラウザ（ナビゲーション）起点で、2回目以降はページ自身（JavaScript）が起点。この「リクエストの起点がページに移る」ことが、同一オリジンポリシーが必要になる理由そのもの。逆にCSRFがブロックできないのはナビゲーション起点のリクエストだ、という対比もこの図から説明できる。

### 図7: フレーム木とJSコンテキストは別物（`im/browser-tab-frame-jscontext-2.gif`）

```
Browser
 └─ Tab
     ├─ Frame (Origin A) ┐
     │   ├─ Frame (Origin A) ┼──破線──> ◇ JSContext (A)
     │   └─ Frame (Origin A) ┘
     └─ Frame (Origin B) ───実線──> ◇ JSContext (B)
```

同一オリジンのフレームは何個あっても1つのJSコンテキストを共有し、異なるオリジンのフレームは別コンテキストに隔離される。フレームの木構造とJSコンテキストの割り当ては別物である。これは実ブラウザの site isolation（プロセス割り当ての単位）を1段簡略化したモデルにあたる。

〔補足〕アニメーションの各フレームの動き（何がどの順に現れるか）までは静止画からは確定できない。動きそのものはサイトで見る価値が残る。

---

## 12. Outlineを攻撃面として読む

各章末には「Outline」節があり、その章時点のブラウザ／サーバの全クラス・関数・メソッドの一覧が載る。これは原稿Markdownには本文がなく、`python3 infra/outlines.py src/lab10.py --template book/outline.txt` を実行して生成する。生成器は `book/outline.txt`（テンプレート）に無い定義があるとエラーで止まる仕組みで、**本の目次と実装が乖離しないよう機械的に強制**されている。

このOutlineは「攻撃面を関数単位で俯瞰する」のに使える。第10章時点で信頼境界をまたぐ関数を抜き出すと次のようになる。

| 関数・定数 | 信頼境界上の役割 | 対応する脆弱性クラス |
| --- | --- | --- |
| `COOKIE_JAR` | 全タブ共有の資格情報ストア（キーはホスト名のみ） | scheme/port無視、ログイン状態共有 |
| `URL.request(referrer, payload)` | cookie付与可否（SameSite判定）の唯一の地点 | CSRF、SameSiteバイパス |
| `URL.origin()` | `scheme://host:port` を組む。同一オリジン判定の基準 | 同一オリジンポリシー回避 |
| `JSContext.XMLHttpRequest_send` | スクリプトからの任意URLフェッチの入口 | クロスオリジン情報漏洩 |
| `JSContext.innerHTML_set` | 文字列をHTMLとしてパースするsink | DOM系XSS |
| `Tab.allowed_request(url)` | CSPの実施点（第10章で新設） | CSP実装漏れ／バイパス |
| `Tab.submit_form(elt)` | 同一オリジンポリシーが適用されない経路 | CSRF |

`Tab.allowed_request` が第9章まで存在せず第10章で追加された点が示唆的で、CSPの実施点がブラウザ側にただ1つであることが一覧から読み取れる。診断では「評価地点が1つ」＝「その1点のバグが全防御を無効化しうる」と読む。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Web Browser Engineering 各章末の "Outline" 節 / ワンページ版 — https://browser.engineering/onepage.html
> **なぜ**: 本教科書の執筆環境からは原典サイトを自動取得できなかった（理由: サイト側のプロキシ制限で403拒否）。Outlineは原稿Markdownには結果が入っておらず、ビルド時に自動生成される。
> **読みどころ**:
> 1. その章時点の全クラス・関数の一覧で、攻撃面を関数単位で俯瞰する。
> 2. ワンページ版は全16章を1ページで全文検索でき、特定のヘッダ名やAPI名がどの章で出るか横断検索できる。
> **代替手段**: clone した環境なら `python3 infra/outlines.py src/lab10.py --template book/outline.txt` で自分で生成でき、`grep -rn` で横断検索もできる。

---

## 13. 埋め込みクイズ・ウィジェットは「何を再現できるか」

原典サイトには理解確認のクイズや、ブラウザ内でブラウザを動かすウィジェットがある。だがこれらは「見た目ほど何でもできるわけではない」ので、実態を正確に押さえる。

### クイズの実態（誤解しやすい点）

`config.json` の設定を確認すると、公開ビルドと書籍版の両方で `show_quiz: false` であり、**クイズは表示されない**。全16章を通じて実在するクイズブロックは第5章（レイアウト）の1個だけで、**第10章にはクイズが存在しない**。`www/quiz-embed.iife.js` というファイルがあるのは「かつて使われた／再有効化できる」ことを示すに過ぎず、ファイルの存在をクイズの存在と取り違えてはならない。セキュリティ学習の観点でクイズの価値はほぼない。

### ウィジェットの仕組みと限界

第10章のウィジェット `www/widgets/lab10-browser.html` は、本文のPythonコードを機械的にJavaScriptへトランスパイルし（`make widgets` / `infra/compile.py`）、ゲストブックサーバごとブラウザ内で動かす（逐語、要所）。

``` html
import { handle_connection } from "./server10.js";
socket.accept(8000, handle_connection);
```

`socket.accept(8000, handle_connection)` により、`server10.py` 由来のサーバが**偽のポート8000**に結び付く。ネットワークには一切出ない。共通ランタイム `rt.js` が `socket`・`ssl`・`tkinter` 等のPython標準ライブラリ相当を偽装しており、TCPもTLSも実際には張らず、登録されたハンドラへループバックするだけである。

ここに診断教材として重要な限界がある。`rt.js` には次のエラークラスがある（逐語）。

``` javascript
class WidgetXHRError extends ExpectedError {
    constructor(hostname) {
        super("This widget cannot access " + hostname + " due to sandboxing, " +
              "but the book's Python code should work correctly.");
        this.name = "WidgetXHRError";
    }
}
```

つまりウィジェットは偽ソケットに登録されたホスト（`localhost:8000`）以外へは一切リクエストできない。したがって「攻撃者サイトから被害者サイトへクロスオリジン `XMLHttpRequest` を投げる」という**攻撃シナリオそのものはウィジェット内では実行できない**。攻撃側のオリジンを用意できないからである。

ウィジェットで確認できるのは主に**同一オリジン側の挙動**（ログイン、cookie自動付与、nonce付きフォーム、XSSペイロードの投入とエスケープ後の無害化、CSPによるスクリプトのブロック）だけである。SameSiteや同一オリジンポリシーの効果を実際に観測するには、後述のローカル実行が必要になる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Web Browser Engineering 第10章のウィジェット — https://browser.engineering/widgets/lab10-browser.html
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側のプロキシ制限で403拒否。またウィジェットの実挙動はコード読解に基づく推論であり実行結果ではない）。
> **読みどころ**:
> 1. ログイン・cookie自動付与・nonce・XSS・CSPの「同一オリジン側の挙動」を、環境構築なしに触って確かめる。
> 2. `WidgetXHRError` によりクロスオリジン攻撃はサンドボックスで再現できないことを体感する。
> **代替手段**: clone 後に `src/server10.py` と `src/lab10.py` をローカルのPythonで動かす（次の「手を動かす」を参照）。

---

## 14. 動作環境とライセンス — 引用の前に確認する

### 依存バージョンは記述が3つに割れている

リポジトリ内でPythonやライブラリのバージョン記述が食い違うので、実行する前に把握しておく。

| 出典 | 記述内容 |
| --- | --- |
| `README.md` | Python 3.9.10 で動作確認（より古くてもおそらく動く） |
| `book/porting.md` | Python 3.14、Skia 138、Tk 8.6.14、DukPy 0.3.0、PySDL2 0.9.15 |
| `requirements.txt` | `dukpy==0.5.0` / `skia-python==144.0.post1` / `PySDL2==0.9.17` ほか |

`porting.md` と `requirements.txt` は一致しない。実際に動かすなら、ビルドが参照する `requirements.txt` を正とするのが妥当。また `book/porting.md`（"Porting WBE to Recent Software Releases"）は、書籍版第1刷が Skia 87、オンライン版が Skia 138 を前提とし第15章の実装が異なる、という**版差の実例**を記録している。本書を引用するときは「オンライン版を正とし、参照日を明記する」のが安全である。

### 本文とコードでライセンスが異なる（最重要）

| 対象 | ファイル | 条件 |
| --- | --- | --- |
| コード（`src/`, `infra/`, `www/`） | ルート `LICENSE` | MIT型。著作権表示と許諾表示を添えれば再利用可 |
| 本文（各章の文章） | `book/LICENSE` | 「All rights reserved.」＝**全権留保** |
| ウィジェットの第三者コード | `www/widgets/LICENSE` | 各々のライセンスに従う（DOMPurify等） |

診断ノートや教材に転記するときは、この違いを守る。本文の文章は全権留保なので**そのまま転載してはならず**、自分の言葉で要約し章URLを出典に明記する。コードはMIT型なので断片を載せてよいが、著作権表示（`Copyright 2018-2023 Pavel Panchekha & Chris Harrelson, MIT License`）とリポジトリURLを添える。図版は本文側の成果物とみなし、転載せず自作の図に置き換える。

---

## 手を動かす

原典サイトが取得できない環境でも、公式リポジトリから本文・コード・図・攻撃シナリオを自分で再現できる。

1. リポジトリを clone する。図はサイズが大きいので、まず本文とコードだけ取るなら次のとおり。
   ``` bash
   GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/browserengineering/book
   ```
2. 本文を読む。原稿ファイル名 `<name>.md` は公開URL `<name>.html` に対応する。第10章は `book/security.md`、第15章は `book/embeds.md`。
   ``` bash
   sed -n '1,80p' book/security.md
   ```
3. ゲストブックサーバを起動する（ポート8000）。
   ``` bash
   cd src/
   python3 server10.py
   ```
4. 別のターミナルで教材ブラウザを起動し、サーバに接続する。
   ``` bash
   python3 lab10.py http://localhost:8000/
   ```
5. 攻撃者サイト役として、**別のポート**で任意の静的サーバを立て、第10章のCSRFフォームやXSSペイロードを置く。ホスト名／ポートが変われば `URL.origin()` の値が変わるので、同一オリジンポリシーと `SameSite` の判定を実際に踏める。ウィジェットではこれができない（クロスオリジンを作れないため）。
6. 第10章の節順（Cookies → Login → Implementing Cookies → Cross-site Requests → Same-origin Policy → CSRF → SameSite → XSS → CSP）に沿って、**防御コードを入れる前と後**で挙動を比較すると学習効果が最大になる。
7. その章時点の攻撃面一覧（Outline）を生成する。
   ``` bash
   python3 infra/outlines.py src/lab10.py --template book/outline.txt
   ```

---

## つまずきポイント

- **「同一オリジンポリシーがあるから他サイトへリクエストは飛ばない」は誤り。** 実装（`XMLHttpRequest_send`）は「リクエストを送ってからレスポンスを捨てる」順序で、副作用は起きる。止まるのは読み取りだけ。
- **クイズが第10章にあると思い込まない。** 公開ビルドはクイズを無効化しており、実在するのは第5章の1個だけ。ファイルの存在＝表示、ではない。
- **ウィジェットでSameSiteやクロスオリジン攻撃を検証しようとして失敗する。** ウィジェットはサンドボックスで `localhost:8000` 以外へアクセスできない（`WidgetXHRError`）。攻撃シナリオはローカルでPythonを直接動かす。
- **本文をそのまま転載してしまう。** 本文は全権留保。要約し章URLを出典に明記する。コードはMIT型だが著作権・許諾表示が必要。
- **依存バージョンを `README.md` の 3.9.10 だと決めつける。** 3か所で記述が食い違う。実行時は `requirements.txt` を正とする。
- **書籍版とオンライン版のコードが同一だと思い込む。** `porting.md` が示すとおり版によって実装が違う。参照日と版を明記する。
- **CSPのバイパスを探すとき複数箇所を疑う。** 本書では実施点は `Tab.allowed_request` の1つだけ。まずそこを見る。

---

## この節のまとめ

- 第10章の cookie は `URL.request` の1メソッドで付与・保存され、`COOKIE_JAR` は全タブ共有・キーはホスト名のみという粗い粒度である。
- cookieの自動付与（指示なしで次のリクエストに載る）がCSRFの前提であり、図1がこれを視覚化している。
- `XMLHttpRequest_send` の実行順は「CSPチェック→送信→同一オリジンチェック→例外」で、同一オリジンポリシーは**レスポンスの読み取りを止めるが送出は止めない**。副作用は起きうる。
- CSPの実施点は `Tab.allowed_request` のただ1つ。この単一地点の実装バグは全防御を無効化しうる。
- サーバ側は nonce・HTMLエスケープ・SameSite で守るが、乱数が予測可能・nonceが1つだけ・属性名の取り違えなど教材ゆえの穴が残る。
- `runtime10.js` の `innerHTML` セッターがDOM系XSSの sink にあたる。
- 第15章はオリジン単位でJSコンテキストを束ね、`throw_if_cross_origin` を全DOMメソッドに置く。著者自ら「woefully inadequate」と認め、実ブラウザは全JS APIの監査を要する。
- Web層の下には site isolation（別プロセス）、rasterizerの `seccomp` サンドボックス、Spectre/Meltdown対策、高精度タイマー制限・`SharedArrayBuffer` のヘッダ要件がある。
- 本書は TLS詳細・プライバシー・JIT/WebAssembly を意図的に割愛している。次に学ぶ領域の地図として `skipped.html` が使える。
- クイズは公開ビルドで無効、実在は第5章の1個のみ。第10章にはない。
- ウィジェットは同一オリジン側の挙動しか再現できず、クロスオリジン攻撃はローカルでPythonを動かす必要がある。
- 依存バージョンは3か所で食い違い、`requirements.txt` を正とする。書籍版とオンライン版でコードが異なる。
- 本文は全権留保、コードはMIT型。転記時はこの違いを守る。
- 原典サイトが取得できなくても、公式リポジトリを clone すれば本文・コード・図・攻撃シナリオを自分で再現できる。

## 理解度チェック

1. `XMLHttpRequest_send` の実行順から読み取れる、同一オリジンポリシーの本質的な限界は何か。
   ▶ 答え: 同一オリジンポリシーはレスポンスの読み取りを止めるだけで、リクエストの送出自体は止めない。実装は「CSPチェック→送信→同一オリジンチェック→例外」の順で、違反時もリクエストは飛び、レスポンスだけ捨てられる。だからCSRFのような副作用は起こりうる。

2. 第10章でCSPを評価する地点はコードのどこか。それが1つしかないことは診断上どう読むべきか。
   ▶ 答え: `Tab.allowed_request` の1メソッドだけ（第10章で新設）。実施点が1つなので、その1点の実装バグが全CSP防御を無効化しうる。バイパスを探すときはまずここを疑う。

3. cookieの「自動付与」とは何を指し、なぜCSRFの前提になるのか。
   ▶ 答え: ブラウザが指示されなくても、同じサーバへの次のリクエストに cookie を自動で載せること（`URL.request`）。攻撃者は被害者の意図しないリクエストにこの自動付与された資格情報を流用できるため、CSRFが成立する。

4. 教材ウィジェットで第10章のクロスオリジン攻撃シナリオを再現できない理由は何か。どうすれば再現できるか。
   ▶ 答え: ウィジェットはサンドボックスにより `localhost:8000` 以外へアクセスできず（`WidgetXHRError`）、攻撃者オリジンを用意できないため。ローカルで `python3 server10.py` と `python3 lab10.py` を動かし、別ポートで攻撃者役の静的サーバを立てれば `URL.origin()` が変わり、同一オリジンポリシーとSameSiteの判定を実際に踏める。

5. `throw_if_cross_origin` について著者はどう評価しているか。診断への含意は何か。
   ▶ 答え: 実ブラウザとしては「woefully inadequate（ひどく不十分）」で、ランタイム全体をロックダウンし全JS APIを精査する必要があると認めている。含意は、DOMに触れるAPIを1つでもチェックの外に置き忘れれば、クロスオリジンDOMアクセスが通ってしまうこと。

6. site isolation は何を防ぐための仕組みか。Spectre/Meltdownとどう関係するか。
   ▶ 答え: 異なるオリジンのフレームを別々のOSプロセスで実行し、JSエンジンのバグ（バッファオーバーラン）やrasterizer経由の情報漏洩を封じる仕組み。Spectre/MeltdownはCPUのタイミングで同一プロセス内の別フレームのメモリを読み出す攻撃なので、別プロセス（別メモリ空間）に置くことが有効な防御になり、site isolationの重要性を高めた。

7. 第10章にクイズはあるか。この教材のクイズについて誤解しやすい点は何か。
   ▶ 答え: 第10章にはない。公開ビルドは `show_quiz: false` でクイズを表示せず、全16章で実在するクイズブロックは第5章の1個だけ。`quiz-embed.iife.js` というファイルの存在をクイズの存在と取り違えないこと。

8. 本書の本文とコードのライセンスの違いを述べ、診断ノートに載せるときの扱いを説明せよ。
   ▶ 答え: 本文（`book/LICENSE`）は「All rights reserved」の全権留保、コード（ルート `LICENSE`）はMIT型。本文はそのまま転載せず自分の言葉で要約し章URLを出典に明記する。コードは著作権表示と許諾表示を添えれば載せてよい。図版は本文側の成果物として自作図に置き換える。

9. 原典サイトが取得できない環境で、本文・コード・図・章末Outlineをどう手に入れるか。
   ▶ 答え: 公式リポジトリを clone する（`git clone --depth 1 https://github.com/browserengineering/book`）。本文は `book/*.md`（`<name>.md`↔`<name>.html`）、コードは `src/`、図は `www/im/`、Outlineは `python3 infra/outlines.py src/lab10.py --template book/outline.txt` で生成できる。

## 出典

- https://browser.engineering/security.html （第10章 "Keeping Data Private"。原稿 `book/security.md`、実装 `src/lab10.py` / `src/server10.py` / `src/runtime10.js` を clone して確認）
- https://browser.engineering/embeds.html （第15章 "Supporting Embedded Content"。原稿 `book/embeds.md`）
- https://browser.engineering/skipped.html （"What Wasn't Covered"。原稿 `book/skipped.md`）
- https://browser.engineering/onepage.html （ワンページ版）
- https://browser.engineering/preface.html （Preface）
- https://browser.engineering/widgets/lab10-browser.html （第10章ウィジェット。`www/widgets/lab10-browser.html` と `rt.js` を確認）
- https://github.com/browserengineering/book （公式ソースリポジトリ。commit `c8c6d34b636a0fec3589a4a2e901916c774f1929`）
- https://www.oreilly.co.jp/books/9784814401574/ （日本語版・オライリー・ジャパン）
- https://meltdownattack.com/ （Spectre / Meltdown）
- https://www.chromium.org/Home/chromium-security/site-isolation/ （site isolation）
- https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage （postMessage）

<!-- sources: https://browser.engineering/security.html, https://browser.engineering/embeds.html, https://browser.engineering/skipped.html, https://browser.engineering/onepage.html, https://browser.engineering/preface.html, https://browser.engineering/widgets/lab10-browser.html, https://github.com/browserengineering/book, https://www.oreilly.co.jp/books/9784814401574/, https://meltdownattack.com/, https://www.chromium.org/Home/chromium-security/site-isolation/, https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage -->
<!-- terms: オリジン, 同一オリジンポリシー, cookie, XMLHttpRequest, CSRF, nonce, SameSite, HTMLエスケープ, XSS, Content-Security-Policy, sink, 信頼境界, 攻撃面, iframe, JSコンテキスト, postMessage, structured cloning, site isolation, seccomp, rasterizer, Spectre, Meltdown, SharedArrayBuffer, 高精度タイマー, CORS, HttpOnly, X-Frame-Options, フィンガープリンティング, WebAssembly, DukPy -->

<!-- self-read: https://browser.engineering/embeds.html | サイト側のプロキシ制限で403拒否。原稿 book/embeds.md の逐語引用にもとづく要約 -->
<!-- self-read: https://browser.engineering/skipped.html | サイト側のプロキシ制限で403拒否。原稿 book/skipped.md にもとづく要約 -->
<!-- self-read: https://browser.engineering/onepage.html | サイト側のプロキシ制限で403拒否。Outlineは原稿になくビルド時生成のため -->
<!-- self-read: https://browser.engineering/widgets/lab10-browser.html | サイト側のプロキシ制限で403拒否。ウィジェットの実挙動はコード読解に基づく推論 -->
