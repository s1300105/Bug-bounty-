## Web Cache Deception 原典（Omer Gil, 2017）

### この節で学ぶこと

**Web Cache Deception（WCD、ウェブキャッシュ欺瞞）** は、2017年2月に Omer Gil が公表した攻撃手法である。ひとことで言えば「**本来キャッシュしてはいけない個人情報つきの動的ページを、静的ファイルだと勘違いさせてキャッシュ（共有保存）させ、攻撃者がそれを取り出して読む**」攻撃だ。

同じ「キャッシュ」を悪用する攻撃でも、**Web Cache Poisoning（キャッシュ汚染）** が「攻撃者が仕込んだ悪意あるコンテンツを他人に配らせる（攻撃者 → 被害者）」方向なのに対し、WCD は「被害者の秘密情報をキャッシュに固定させ、攻撃者がそれを吸い出す（被害者 → 攻撃者）」方向である。向きが逆であることを最初に押さえておくと、以降の話が整理しやすい。

この節では、まず Omer Gil の原典（ブログ・Black Hat 2017 ホワイトペーパー）に忠実に「なぜキャッシュが騙されるのか」を仕組みレベルで解説し、続いて2024年時点で PortSwigger が体系化した現代的な発展形（パスマッピング・デリミタ・正規化の不一致）まで橋渡しする。

> ⚠️ **一部未取得の資料**: 「Medium 2次解説（hbenja47 による原典要約）」は自動取得できませんでした（理由: HTTP 403 Forbidden）。以下のURLからご自身で直接ご覧ください: https://medium.com/@hbenja47/my-summary-of-the-white-paper-web-cache-deception-attack-by-omer-gil-a686e106c84e
>
> （以下は未取得資料の補足として一般知識に基づく解説です）当該 Medium 記事は Omer Gil のホワイトペーパーを要約した2次資料であり、後述する「3つの成立条件」「`account.do/logo.png` 型の攻撃フロー」「PayPal 事例」を平易に紹介したものである。本節は原典（ブログ・ホワイトペーパー）から直接内容を抽出しているため、要約自体の記述に依存する箇所はない。

---

### キャッシュの基礎知識（原典の前提）

WCD を理解する前提として、ホワイトペーパーが最初に説明する「キャッシュとは何か」を押さえる。

Web サイトは、サーバの負荷（レイテンシ）を下げ、コンテンツを速くユーザに届けるために **Web キャッシュ** を多用する。毎回サーバに問い合わせる代わりに、よくアクセスされるファイルをキャッシュ機構が保存しておき、次回以降はそこから返す。

一般にキャッシュ対象とされるのは、**静的（static）で公開（public）なファイル** ——スタイルシート（`.css`）、スクリプト（`.js`）、テキスト（`.txt`）、画像（`.png`, `.bmp`, `.gif`）など——である。これらは通常、機微な情報を含まず、**全ユーザに同じ内容を返す**。だからこそ、多くのベストプラクティス記事は「公開向けの静的ファイルは、HTTP のキャッシュ制御ヘッダを無視してでも全部キャッシュしてしまえ」と推奨している。この「**ヘッダを無視して拡張子だけで判断する**」構成こそが、後に WCD の温床になる。

原典は、WCD に関係するキャッシュの実装形態を3つ挙げる。いずれも「クライアントとオリジンサーバの**間に立つ共有キャッシュ**」である点が重要だ（ブラウザ内キャッシュは各自のものなので WCD には無関係、と原典は明記している）。

- **CDN（Content Delivery Network）**: 地理的に分散したプロキシ群。クライアントに近いプロキシから配信する。
- **ロードバランサ**: トラフィック分散に加え、コンテンツをキャッシュしてサーバ負荷を下げることがある。
- **リバースプロキシ**: クライアントの代わりにオリジンからリソースを取得し、その一部をキャッシュする。

キャッシュ機構が静的ファイルを受け取ったとき、**多くの実装は URL 末尾の拡張子を見てファイル種別を判定し、自分のキャッシュルールに従ってキャッシュするか否かを決める**。この「URL 末尾の拡張子だけを頼りにする」判定こそが攻撃の入り口である。

> 出典: WEB CACHE DECEPTION ATTACK（White Paper, Omer Gil, July 2017）— https://blackhat.com/docs/us-17/wednesday/us-17-Gil-Web-Cache-Deception-Attack-wp.pdf

---

### 核心のメカニズム：サーバとキャッシュの「解釈のずれ」

WCD の本質は、**同じ1本の URL を、オリジンサーバとキャッシュが違う意味に解釈する**ことにある。原典はこの構図を、Gareth Heyes らの **RPO（Relative Path Overwrite）攻撃** と同じ系譜だと位置づけている。

考えるべきは、次のような URL にアクセスしたとき何が起きるかだ。

```
http://www.example.com/home.php/nonexistent.css
```

ここで `home.php` は実在する動的ページ、`nonexistent.css` は**存在しないファイル**である。ブラウザはこの URL に GET リクエストを送る。問題は、この一見おかしな URL をサーバがどう解釈するかだ。

**サーバ側の挙動（第1条件の核心）**: サーバの技術・設定次第では、サーバは `/home.php` の部分だけを実在ページとして処理し、末尾の `/nonexistent.css` を**単に無視して 200 OK と `home.php` の中身を返す**。このとき URL は書き換わらない（リダイレクトされない）。決定的に重要なのは、**返される HTTP レスポンスヘッダが `home.php` のもの、すなわち `Content-Type: text/html` かつ `Cache-Control: no-store, no-cache`（キャッシュ禁止）になる**点だ。

原典が掲載した実レスポンス例（`/account.php/nonexistent.css` へのアクセス結果）を再現すると次のようになる。

```http
HTTP/1.1 200 OK
Date: Thu, 15 Jun 2017 18:47:53 GMT
Server: Apache/2.4.4 (Win32) OpenSSL/0.9.8y PHP/5.4.16
X-Powered-By: PHP/5.4.16
Expires: Thu, 19 Nov 1981 08:52:00 GMT
Cache-Control: no-store, no-cache, must-revalidate, post-check=0, pre-check=0
Pragma: no-cache
Content-Length: 1330
Connection: close
Content-Type: text/html

<html>
  <head>
    <title>Account</title>
```

ここで注目すべき矛盾は、「レスポンス本体は HTML の**アカウントページ（機微情報）**で、`Cache-Control` は明確に**キャッシュ禁止**を宣言している」のに、「**URL の末尾は `.css`**」だという食い違いである。

**キャッシュ側の挙動（第2条件の核心）**: 前述のとおり、キャッシュ機構は URL 末尾の `.css` を見て「これは静的な CSS だ」と判定する。そして「静的ファイルは HTTP ヘッダを無視してでもキャッシュせよ」という**誤設定または既定動作**のもとでは、`Cache-Control: no-store` を**無視**し、この HTML レスポンスを `.css` ファイルとしてキャッシュに保存してしまう。

こうして、**サーバは「動的ページ」として扱い、キャッシュは「静的 CSS」として扱う**——両者の解釈のずれが、機微情報のキャッシュ固定を引き起こす。これが WCD の心臓部である。

> 出典: WEB CACHE DECEPTION ATTACK（White Paper, Omer Gil, July 2017）— https://blackhat.com/docs/us-17/wednesday/us-17-Gil-Web-Cache-Deception-Attack-wp.pdf

---

### 攻撃の全手順（原典の7ステップ）

原典は、認証されていない攻撃者が本攻撃をどう成立させるかを、`bank.com` を例に7ステップで示している。以下に忠実に再構成する。

1. 攻撃者は、**ログイン中のユーザ（被害者）** を `https://www.bank.com/account.do/logo.png` にアクセスするよう誘導する（メールやリンクなど）。
2. 被害者のブラウザが `https://www.bank.com/account.do/logo.png` をリクエストする。
3. リクエストがプロキシ（キャッシュ）に届く。プロキシは `logo.png` というファイルを知らないため、オリジンサーバに問い合わせる。
4. オリジンサーバは 200 OK で **被害者のアカウントページの中身** を返す（URL は変わらない）。
5. キャッシュ機構がそれを受け取り、URL 末尾が静的拡張子（`.png`）であること、かつ「全静的ファイルをヘッダ無視でキャッシュ」する設定であることから、この**偽装 `.png` をキャッシュする**。キャッシュディレクトリに `account.do` という新しいディレクトリが作られ、その中に `logo.png` という名前でファイルが保存される。
6. 被害者は普通に自分のアカウントページを受け取る（被害者から見て異常はない）。
7. 攻撃者が `https://www.bank.com/account.do/logo.png` にアクセスすると、リクエストはプロキシで止まり、**キャッシュされた被害者のアカウントページがそのまま攻撃者に返る**。

ポイントは、攻撃者はステップ7で**認証不要**である点だ。被害者の秘密情報が、公開された静的ファイルとしてキャッシュに固定されているため、URL さえ知っていれば誰でも読める。

**影響（Implications）**: 原典は、キャッシュされるのは「静的コピー」であることを強調する。攻撃者は被害者に成りすませるわけではなく、キャッシュされたファイルを上書きすることもできない。ファイルは失効するまで有効なだけの、読み取り専用のスナップショットである。しかし、**レスポンス本体にセッション識別子・秘密の質問の答え・CSRF トークンなどが含まれていれば、影響は一気に増大する**。それらを使えば追加攻撃が可能になり、**完全なアカウント乗っ取り（account takeover）** にまで発展しうる、と原典は述べている。

> 出典: Web Cache Deception Attack（Omer Gil, 原典ブログ, 2017-02）— http://omergil.blogspot.com/2017/02/web-cache-deception-attack.html
> 出典: WEB CACHE DECEPTION ATTACK（White Paper, Omer Gil, July 2017）— https://blackhat.com/docs/us-17/wednesday/us-17-Gil-Web-Cache-Deception-Attack-wp.pdf

---

### 成立に必要な3つの条件

原典は、攻撃成立には次の**3条件がすべて満たされる**必要があるとまとめている。裏を返せば、どれか1つでも崩せば攻撃は成立しない——これが後述の防御の考え方に直結する。

1. **サーバ側の条件**: `http://www.example.com/home.php/nonexistent.css` のようなページにアクセスしたとき、Web サーバが `home.php` の中身を返してしまうこと（末尾の余計なパスを無視する）。
2. **キャッシュ側の条件**: Web キャッシュ機能が、**拡張子でキャッシュ可否を判断し、キャッシュ制御ヘッダを無視する**よう設定されていること。
3. **被害者側の条件**: 被害者が、その悪意ある URL にアクセスする時点で**認証済み（ログイン中）** であること。

> 出典: WEB CACHE DECEPTION ATTACK（White Paper, Omer Gil, July 2017）— https://blackhat.com/docs/us-17/wednesday/us-17-Gil-Web-Cache-Deception-Attack-wp.pdf

---

### 既知の Web フレームワークでの再現（第1条件が成立するか）

「末尾に存在しないファイル名を足したとき、サーバが実在ページを返すか」は、フレームワーク／設定に依存する。原典は代表例を3つ検証している。ここは「なぜ成立するか」の分岐点なので、仕組みごとに理解したい。

#### PHP（フレームワーク無し）

素の PHP アプリケーションは、URL 末尾への付加を**無視して 200 OK で実ページを返す**傾向がある。原典の例では `http://www.example.com/login.php/nonexistent.gif` にアクセスしても `login.php` の中身が返り、**第1条件を満たす**。これは PHP が `PATH_INFO`（`script.php` の後ろに続くパス情報）を許容し、スクリプト本体まで到達したうえで余分なパスを処理に使わない、という古典的挙動に由来する。

#### Django（url ディスパッチャの正規表現次第）

Django は `urls.py` の**正規表現**でリクエスト URL をルーティングする。ここで**アンカー（`$` による末尾固定）の有無**が成否を分ける。

```python
from django.conf.urls import include, url
from . import views

urlpatterns = [
    url(r'^inbox/', views.index, name='index')   # 末尾を固定していない
]
```

この `^inbox/`（先頭一致のみ）は、`http://www.sampleapp.com/inbox/` だけでなく `http://www.sampleapp.com/inbox/test.css` にもマッチしてしまう。その結果、`test.css` を付けても Inbox ページが返り、**第1条件を満たす**。トレイリングスラッシュを省いた `^inbox` でも同様に `inbox.css` にマッチする。

対して、次のように**ドル記号でアンカー**すると、余計なパスはマッチせず 404 になり、攻撃条件を満たさない。

```python
urlpatterns = [
    url(r'^inbox/$', views.index, name='index')   # 末尾を $ で固定 → 安全側
]
```

つまり Django での可否は「正規表現が末尾を厳密に固定しているか」という、開発者のルーティング記述の癖に依存する。

#### ASP.NET（FriendlyURLs 機能の有無）

ASP.NET には **FriendlyURLs** という機能があり、`home.aspx` へのアクセスを拡張子なしの `home` にリダイレクトして URL を「きれいに」見せる。既定で有効である。

FriendlyURLs が**有効**なとき、`http://localhost:39790/Account/Manage.aspx/test.css` にアクセスすると、`.aspx` 拡張子が取り除かれた結果 `Manage/test.css` へのリダイレクトが起き、最終的に **404** になる。つまり FriendlyURLs 有効時は攻撃条件を満たさない。

しかし、この機能は `Route.config` で簡単に無効化できる。

```csharp
public static void RegisterRoutes(RouteCollection routes)
{
    var settings = new FriendlyUrlSettings();
    settings.AutoRedirectMode = RedirectMode.Off;   // FriendlyURLs を無効化
    routes.EnableFriendlyUrls(settings);
}
```

無効化すると、同じトリガー URL（`Manage.aspx/test.css`）へのアクセスが **200 OK** となり、`Manage.aspx`（アカウント管理ページ）の中身が返る。つまり**第1条件を満たす**。原典は「FriendlyURLs は既定で有効だが、これを使っていないサイトは多い」と指摘している。

> 出典: WEB CACHE DECEPTION ATTACK（White Paper, Omer Gil, July 2017）— https://blackhat.com/docs/us-17/wednesday/us-17-Gil-Web-Cache-Deception-Attack-wp.pdf

---

### 既知のキャッシュ機構での再現（第2条件が成立するか）

「拡張子でキャッシュし、ヘッダを無視する」構成が現実に存在することを、原典は3つの製品で示す。

#### Cloudflare（2フェーズ判定と Edge Cache TTL）

Cloudflare にファイルが届くと、2段階の判定を経る。

1. **Eligibility Phase（適格性フェーズ）**: そのサイト・ディレクトリでキャッシュ機能が有効かを確認する。有効なら、URL 末尾が以下の**静的拡張子リスト**のいずれかで終わるかをチェックする。

```
class, css, jar, js, jpg, jpeg, gif, ico, png, bmp, pict, csv, doc,
docx, xls, xlsx, ps, pdf, pls, ppt, pptx, tif, tiff, ttf, otf, webp,
woff, woff2, svg, svgz, eot, eps, ejs, swf, torrent, midi, mid
```

2. **Disqualification Phase（失格フェーズ）**: 拡張子が一致した場合、次に HTTP キャッシュ制御ヘッダの有無を確認する。トリガー URL 経由だと、サーバは元の動的ページの `no-cache` ヘッダを返すため、通常はここでキャッシュされない。

**ところが**、Cloudflare には **Edge Cache Expire TTL** という機能があり、これを「on」にすると**既存のヘッダを上書きしてキャッシュできる**。原典は、Cloudflare 自身がさまざまな理由でこの設定を推奨しているため、実際によく使われていると述べる。Page Rule の例では、`http://*.webcachedeception.com/app/*` に対し Cache Level=Standard、Edge Cache TTL=2 hours といった設定が示されている。この設定下では、`no-cache` を宣言した動的ページでも `.css` 等の拡張子さえ付けばキャッシュされ、**第2条件を満たす**。

#### IIS ARR（Application Request Routing）

ARR は IIS にロードバランシング機能を与えるモジュールで、キャッシュ機能を持つ。キャッシュルールはワイルドカードと拡張子で定義する（例: `*.css`）。ARR は URL 末尾の拡張子でファイル種別を判定する。さらに **"Apply rule: Always"** を選ぶと、**ファイルのキャッシュヘッダを無視して常にルールを適用**できる。原典の例では、2台の Web サーバに対し `*.css`（キャッシュ 60 分）と `*.js`（キャッシュ 10080 分）を Always でキャッシュする設定が示されている。これも**第2条件を満たす**典型例である。

#### NGINX（proxy_cache と proxy_ignore_headers）

NGINX をロードバランサ／リバースプロキシとして使う場合、設定ファイルでキャッシュ挙動を制御する。原典が挙げる脆弱な設定は次のとおり。

```nginx
location ~* \.(css|js|gif|png)$ {
    proxy_cache my_cache;
    proxy_cache_valid 200 60m;
    proxy_pass http://<upstream>;
    proxy_ignore_headers Expires Cache-Control Set-Cookie;
}
```

ここが仕組みの要点だ。`location ~* \.(css|js|gif|png)$` は **URL 末尾の拡張子**にマッチする正規表現ロケーションであり、`account.do/logo.png` のような偽装 URL も `.png` で終わるためマッチする。そして `proxy_ignore_headers Expires Cache-Control Set-Cookie;` が、オリジンが返す `Cache-Control`（キャッシュ禁止）や `Set-Cookie`（本来キャッシュを抑止すべき指標）を**明示的に無視**させる。原典の実演では、認証ユーザが `http://www.sampleapp.com/app/welcome.php/test.css` にアクセスすると、"Welcome admin / Here's all your sensitive information..." というページが `welcome.php/test.css` としてキャッシュディレクトリに保存され、続いて**未認証の攻撃者**が同 URL にアクセスすると、そのキャッシュ済みの機微ページが返る様子が示されている。

> 出典: WEB CACHE DECEPTION ATTACK（White Paper, Omer Gil, July 2017）— https://blackhat.com/docs/us-17/wednesday/us-17-Gil-Web-Cache-Deception-Attack-wp.pdf

---

### 実世界の衝撃：PayPal 事例

原典ブログが公表当時に注目を集めた最大の理由は、**PayPal の本番環境で実際に成立した**ことである。Omer Gil の報告によれば、脆弱だった URL には次のようなものが含まれ、**アカウント残高・取引データ・パスポート番号・住所・電話番号**といった極めて機微な情報が露出しうる状態だった。

```
https://www.paypal.com/myaccount/home/attack.css
https://history.paypal.com/cgi-bin/webscr/attack.css?cmd=_history-details
```

キャッシュされたファイルは**約5時間**アクセス可能なままだったと報告されている（失効までの間、攻撃者が読み取れる時間窓が存在した）。この事例は、WCD が理論上の話ではなく、大手決済サービスの本番構成でも起こりうる現実的な脅威であることを示した。

> 出典: Web Cache Deception Attack（Omer Gil, 原典ブログ, 2017-02）— http://omergil.blogspot.com/2017/02/web-cache-deception-attack.html

**※スコープ注記（本教科書の方針）**: 本節は防御目的の解説であり、上記の URL・手順は歴史的事実の記録として引用している。実在サービスや本番環境に対する無許可の検証は行わないこと。手法の理解は、自分が権限を持つ環境・許可された演習環境でのみ確認する。

---

### 防御（原典の推奨と原理）

原典が挙げる緩和策は、前述の「3条件のいずれかを崩す」という発想に沿っている。

1. **キャッシュ機構を「HTTP キャッシュヘッダが許可する場合のみキャッシュ」する設定にする**（第2条件を崩す）。`Cache-Control: no-store` を尊重すれば、拡張子が `.css` でも動的ページはキャッシュされない。
2. **すべての静的ファイルを専用ディレクトリに置き、そのディレクトリだけをキャッシュ対象にする**。`account.do/logo.png` のような動的パス配下の偽装ファイルは、そもそもキャッシュ対象ディレクトリに入らない。
3. **キャッシュ製品が対応していれば、拡張子ではなく Content-Type（実際のコンテンツ種別）でキャッシュ判定させる**。`Content-Type: text/html` の応答を「CSS」としてキャッシュしなくなる。
4. **サーバ側を、`http://www.example.com/home.php/nonexistent.css` のような URL に対して `home.php` の中身を返さず、404 または 302 を返すよう設定する**（第1条件を崩す）。存在しない末尾パスを拒否すれば、そもそも機微応答が生成されない。

補足として、防御の実務では次も重要である（原典 Summary の趣旨に一般知識を加えたもの）。動的な機微応答には必ず `Cache-Control: no-store, private` を付け、CDN 側でそれを尊重させる。Cloudflare であれば **Cache Deception Armor**（レスポンスの Content-Type と URL 拡張子の整合を検証し、`text/html` を `.css` としてキャッシュするような不整合をブロックする機能）を有効にする。そして、原典 Summary が結論づけるように、**フレームワークやキャッシュ機構それ自体は「脆弱」なのではなく、問題は不適切な設定（improper configuration）にある**。よって最大の対策は、技術者がこの条件の存在を「知っている」ことであり、ベンダは既定設定・既定動作を安全側に変更し、警告を出して認知を高めるべきだ、と述べている。

> 出典: WEB CACHE DECEPTION ATTACK（White Paper, Omer Gil, July 2017）— https://blackhat.com/docs/us-17/wednesday/us-17-Gil-Web-Cache-Deception-Attack-wp.pdf

---

### 現代的な発展（PortSwigger Web Security Academy, 2024年時点）

2017年の原典は「動的ページに `.css` を付ける」古典型に焦点を当てていた。その後、CDN や Cloudflare の Cache Deception Armor 普及で単純な `.css` 付与は通りにくくなったが、PortSwigger は2024年の研究「Gotta cache 'em all」等を踏まえ、WCD を**「キャッシュとオリジンの解釈のずれ（discrepancy）」の一般論**として再体系化した。Web Security Academy の分類を、原典の3条件と対応づけて整理する。

- **キャッシュキー（cache key）とキャッシュルール（cache rule）**: キャッシュはリクエストの一部（通常は URL パスとクエリ）から**キャッシュキー**を生成し、同一キーのリクエストにキャッシュ応答を返す。キャッシュルールには「静的拡張子ルール（`.css`, `.js`）」「静的ディレクトリルール（`/static`, `/assets`）」「ファイル名ルール（`robots.txt`, `favicon.ico`）」がある。WCD はこれらルールの適用条件を、オリジンとずれた解釈で満たさせる攻撃だと捉え直せる。

- **① パスマッピングの不一致（path mapping discrepancy）**: 原典の古典型そのもの。REST 型ルーティングのオリジンは `/user/123/profile/wcd.css` を `/user/123/profile` と解釈して機微データを返すが、キャッシュは末尾 `.css` を見て静的ルールでキャッシュする。

- **② デリミタの不一致（delimiter discrepancy）**: フレームワークごとに区切り文字の扱いが違う点を突く。例えば Java Spring は `;`（マトリクスパラメータ）を区切りとみなすため、`/profile;foo.css` をオリジンは `/profile` と解釈するが、多くのキャッシュは区切りとみなさず `.css` 付きパスとしてキャッシュする。エンコードされた例では、OpenLiteSpeed が `%00`（NULL）をデコードして `/profile%00foo.js` を `/profile` と解釈する一方、キャッシュはデコードせず `%00foo.js` を末尾とみなす。

```
/profile;foo.css      → Spring: /profile を返す / キャッシュ: .css としてキャッシュ
/profile%00foo.js     → OpenLiteSpeed: /profile / キャッシュ: %00foo.js を末尾扱い
```

- **③ 正規化の不一致（normalization discrepancy）**: パス正規化（`..` の解決や `%2f` 等のデコード）を、オリジンとキャッシュのどちらか一方だけが行うことを突く。
  - *オリジン側だけが正規化する場合*: `/static/..%2fprofile` を、キャッシュは文字どおり `/static` 配下（静的ディレクトリルール一致）と見てキャッシュするが、オリジンは `%2f`→`/` をデコードし `..` を解決して `/profile`（機微データ）を返す。
  - *キャッシュ側だけが正規化する場合*: `/profile%2f%2e%2e%2fstatic`（デリミタ併用で `/profile;%2f%2e%2e%2fstatic` 等）を、キャッシュは `/static` に正規化して静的ルールでキャッシュするが、オリジンは `;` 以降を無視して `/profile` を返す。
  - *ファイル名ルールの悪用*: `/profile%2f%2e%2e%2findex.html` を、キャッシュは `/index.html` に正規化してファイル名ルールでキャッシュする、といった応用もある。

**検出の考え方（防御・診断目的）**: 自分が権限を持つ環境で診断する場合、各リクエストに一意のクエリ（キャッシュバスター）を付けて他人のキャッシュ応答と混ざらないようにし、`X-Cache` ヘッダ（`hit`＝キャッシュ由来／`miss`＝オリジン由来／`dynamic`＝キャッシュ不可）や `Cache-Control: public, max-age>0`、応答時間差でキャッシュ命中を判別する。PortSwigger の Param Miner 拡張が持つ動的キャッシュバスタ機能などが実務で使われる。デリミタ探索は、自動エンコードを切ったうえで `;` `:` や非印字文字から試す。

> 出典: Web cache deception（PortSwigger Web Security Academy）— https://portswigger.net/web-security/web-cache-deception

---

### まとめ

- **WCD は「解釈のずれ」を突く攻撃**である。オリジンは動的ページ（機微情報）として応答し、キャッシュは静的ファイルとして保存する。この非対称性が、被害者の秘密を公開キャッシュに固定する。
- 原典（2017）の古典型は **`account.do/logo.png` 型**——動的ページ URL に存在しない静的拡張子を足す——であり、成立には**①サーバが余計な末尾を無視して実ページを返す ②キャッシュが拡張子で判定しヘッダを無視する ③被害者が認証済み**の3条件が必要。
- フレームワーク側の可否は「末尾付加を無視するか」（PHP は無視しがち、Django は正規表現の `$` 次第、ASP.NET は FriendlyURLs の有効/無効次第）に、キャッシュ側の可否は「ヘッダ無視・拡張子判定の有無」（Cloudflare の Edge Cache TTL、IIS ARR の Always、NGINX の `proxy_ignore_headers`）に依存する。
- **PayPal 事例**は本攻撃の現実性を示し、影響はセッション/CSRF トークン露出によるアカウント乗っ取りにまで及びうる。
- 防御は3条件のいずれかを崩すこと——ヘッダ尊重、静的専用ディレクトリのみキャッシュ、Content-Type 判定、サーバ側で 404/302——に集約される。根本原因は「不適切な設定」であり、認知が最大の対策。
- 2024年時点では、**パスマッピング・デリミタ・正規化の不一致**として一般化され、`;` や `%2f`・`%00`・`..%2f` などを使う手法へ発展している。原理は原典と同じ「オリジンとキャッシュの解釈差」である。
