## モダンWeb技術の攻撃面マッピング（Frans Rosén）

Frans Rosén（Detectify、HackerOne 歴代ランキング上位の著名ハンター）が OWASP AppSec EU 2018（2018年7月5日、ロンドン）で行った講演 *Attacking "Modern" Web Technologies* は、本章のテーマである「クライアントサイド攻撃面のマッピング」の実例集として極めて優れている。この講演が教科書的に重要なのは、個々のバグの派手さではなく、**「ブラウザが新しく獲得した機能（AppCache、直アップロード、postMessage）は、それ自体が新しい信頼境界を作り、その境界の定義が曖昧なまま実装されるため、必ず穴が開く」** という攻撃面の見つけ方を示している点にある。

本節では講演を3つの柱（AppCache / バケットのアップロードポリシー / postMessage）に分解し、それぞれ「仕組み → なぜ破れるのか → 実際の事例 → 防御」の順で解説する。

> ⚠️ **未取得の資料**: 「Attacking Modern Web Technologies（講演動画版）」は自動取得できませんでした（理由: YouTube のページが動的レンダリングのため、取得できたのはフッターのナビゲーションと著作権表記のみで、説明文・字幕いずれも本文が含まれていなかった）。以下のURLからご自身で直接ご覧ください: https://www.youtube.com/watch?v=vRqcUS4CPFs
>
> （以下は未取得資料の補足として一般知識に基づく解説です）動画版は約43分で、スライドとほぼ同一の構成です。スライドだけでは伝わりにくい「デモの時間軸」——とくに後述するクライアントサイド・レースコンディションで、攻撃者側のメッセージが被害者側の初期化シーケンスをどう追い越すか——は動画で見ると理解が早いので、本節を読んだあとに視聴することを勧めます。以降の技術的内容は、同一講演のスライド版から抽出したものです。

---

### AppCache — 仕様の曖昧さが「ドメイン全体の傍受」になる

#### AppCache とは何だったのか

AppCache（Application Cache）は、Service Worker 以前に存在した「オフライン対応」の仕組みである。HTML に `<html manifest="/manifest.appcache">` と書くと、ブラウザはそのマニフェストを取得し、記載されたリソースを**オリジン単位の専用キャッシュ**に保存する。マニフェストの構文は次のようなプレーンテキストである。

```
CACHE MANIFEST

CACHE:
/app.js
/style.css

NETWORK:
*

FALLBACK:
/ /offline.html
```

ここで決定的に重要なのが `FALLBACK:` セクションだ。`FALLBACK:` の各行は「**名前空間（namespace）** ␣ **代替リソース**」という組で、「この URL プレフィックス配下へのリクエストが *取得できなかった* 場合、代わりにこのキャッシュ済みファイルを返す」という意味を持つ。上の例なら、`/` 配下（＝サイト全体）のリクエストが失敗したとき `/offline.html` の中身が返る。

つまり **FALLBACK は、ネットワークエラー時にブラウザが「別のコンテンツを、リクエストされた URL のふりをして」返す仕組み**である。返された `/offline.html` の中身は、あくまで「元の URL のドキュメント」としてそのオリジン上で実行される。ここが攻撃面になる。

#### 破れ方1: 「取得失敗」は攻撃者が作れる

FALLBACK が発動するのは「リクエストが失敗したとき」だ。では失敗をどう作るか。Rosén が使ったのが **cookie bombing（cookie stuffing）** である。

攻撃者のページから、対象ドメイン（またはその親ドメイン）に対して巨大な Cookie を大量に書き込む。サーバは受け取ったリクエストヘッダのサイズが上限（典型的には 8KB〜16KB）を超えるため、**すべてのページに対して 400 / 431 / 500 系のエラーを返すようになる**。被害者のブラウザから見ると「サイト全体が取得失敗」であり、AppCache の FALLBACK が全面的に発動する。

> 補足: cookie bombing 自体は「相手のサイトを自分のブラウザ上で壊す」だけなら単なる自己 DoS だが、**FALLBACK のような「失敗時に別の挙動へ切り替わる機構」と組み合わさった瞬間に、任意タイミングで発動できるトリガーへ昇格する**。これは「無害に見える原始的なバグが、別機能と噛み合って攻撃面になる」典型例で、攻撃面マッピングの思考法として覚えておきたい。

#### 破れ方2: マニフェストの配置パスが強制されていなかった

W3C の AppCache 仕様では、FALLBACK の名前空間は**マニフェスト自身と同じパス配下**でなければならない、と定められていた。`/u/2241902/manifest.txt` に置かれたマニフェストは `/u/2241902/` 配下しか fallback できないはずである。

しかし当時の主要ブラウザ実装はこのパス制約を強制していなかった。Rosén のスライドは端的にこう述べている。

```
Manifest placed in /u/2241902/manifest.txt
Would use the FALLBACK for EVERYTHING, even outside the dir
```

深い階層に置いたマニフェストが、**オリジン全体（`/`）に対する FALLBACK を登録できてしまう**。これにより、「サブディレクトリにファイルを1つ置ける」だけの権限が、「そのオリジン上の任意 URL のレスポンスを差し替えられる」権限に化ける。

#### Dropbox での実例

この2つを繋いだのが Dropbox のケースである。

1. ユーザコンテンツ配信ドメイン `dl.dropboxusercontent.com` では、**XML ファイルが HTML として解釈・実行される**経路が存在した（XHTML 名前空間を含む XML は、ブラウザによってはマークアップとしてレンダリングされる）。
2. そこに `manifest` 属性を持つドキュメントを仕込み、ユーザのパス配下に置いたマニフェストを、実質的に**ルートレベルの FALLBACK として登録**する。
3. 被害者に cookie bombing を仕掛けてドメイン全体を 500 状態にする。
4. 以後、被害者が開く `dl.dropboxusercontent.com` 上の**すべてのシークレットリンク**が、攻撃者の用意した FALLBACK ページに差し替わる。そのページは正規オリジン上で動くため、リクエストされた URL（＝秘密の共有リンク）を `location.href` から読み取り、攻撃者のログ収集サイトへ送信できる。

報奨金は **Dropbox から $12,845**、加えて**各ブラウザベンダから計 $3,000**。Dropbox 側の恒久対策は次の通りだった。

- `dl.dropboxusercontent.com` で XML を HTML として実行させない
- 全ブラウザベンダへ協調報告（Chromium バグ #696806 など）し、**パス配下でないルート FALLBACK を禁止**させる
- ユーザファイルを**ランダムなサブドメイン**に分離し、1ファイルの侵害が他ファイルへ波及しないようにする

最後の「ランダムサブドメインへの分離」は、クライアントサイド防御の王道である。**同一オリジンに置かれた時点で、そこに置かれたすべてのものは互いを侵害できる**という前提から逃れる唯一の方法がオリジン分離だからだ。

#### 2026年時点の状況（陳腐化への注記）

AppCache は現在では**完全に消滅した技術**である。Chrome は 85（2020年）で非推奨警告、**Chrome 95（2021年10月）で完全削除**。Firefox は 84（2020年12月）で削除、Safari も同時期に撤去した。したがって「AppCache のバグを探す」こと自体は、2026年現在では対象外と考えてよい。

しかし**原理はそのまま Service Worker に引き継がれている**。Service Worker は `fetch` イベントを介して、スコープ配下の**すべてのリクエストのレスポンスを合成できる**。そして「スコープ」は登録スクリプトの配置パスで決まる（`/sw.js` を登録できればオリジン全体）。つまり本節で学ぶべき教訓は次の一文に集約される。

> **「任意のファイルをオリジンのルートに置ける」は、それ自体が「オリジン全体の恒久的な乗っ取り」と等価である。**

Service Worker の場合は `Service-Worker-Allowed` ヘッダによるスコープ拡張という追加の考慮点もあるが、防御の本質は同じ——ユーザがアップロードしたコンテンツを、アプリ本体と同じオリジンの、しかも浅いパスに置かないことだ。

> 出典: OWASP AppSecEU 2018 – Attacking "Modern" Web Technologies — https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies

---

### バケットのアップロードポリシー（AWS S3 / Google Cloud Storage）

#### ブラウザ直アップロードの仕組み

大容量ファイルをアプリサーバ経由で中継するのは非効率なので、現代のアプリは**ブラウザから直接 S3 / GCS へ POST させる**設計を取る。このときサーバは「何をどこに置いてよいか」を記述した **POST policy**（JSON）を作り、それを Base64 エンコードし、秘密鍵で署名してブラウザに渡す。ブラウザは `multipart/form-data` にポリシー・署名・実ファイルを詰めて S3 に送る。S3 は署名を検証したうえで、**ポリシーの `conditions` に書かれた条件をすべて満たすかどうか**だけをチェックする。

つまり **`conditions` が、そのアップロードに対する唯一のアクセス制御である**。ここが緩ければ、攻撃者は正規に発行されたポリシー（自分のアップロード画面から普通に取得できる）を使って、想定外の操作を行える。実際のポリシーは次のような形をしている。

```json
{
 "expiration": "2018-07-31T13:55:50Z",
 "conditions": [
  {"bucket": "bucket-name"},
  ["starts-with", "$key", "acc123"],
  {"acl": "public-read"},
  {"success_action_redirect": "https://dashboard.example.com/"},
  ["starts-with", "$Content-Type", ""],
  ["content-length-range", 0, 524288]
 ]
}
```

`["starts-with", "$key", "acc123"]` は「オブジェクトキーは `acc123` で始まること」という意味。`$key` はアップロード先のパスそのものである。

#### 落とし穴4種（講演で挙げられた原文そのまま）

スライドに列挙された S3 の pitfalls は次の4つである。

```
starts-with $key does not contain anything
  -> We can replace any file in the bucket!

starts-with $key does not contain path-separator
  -> We can place stuff in root

$Content-Type uses empty starts-with + content-disp
  -> We can now upload HTML-files: Content-type: text/html

$Content-Type uses starts-with = image/jpeg
  -> We can still upload HTML: Content-type: image/jpegz;text/html
```

それぞれ「なぜそうなるのか」を押さえる。

**(1) `["starts-with", "$key", ""]`（空文字）**
前方一致の対象が空文字なので、**あらゆるキーが条件を満たす**。攻撃者は `index.html` でも `assets/app.js` でも、バケット内の既存ファイルを上書きできる。そのバケットが静的サイトや JS 配信に使われていれば、その時点で保存型 XSS かつサプライチェーン汚染である。

**(2) パスセパレータを含まない前方一致**
`["starts-with", "$key", "acc123"]` は一見ユーザ領域に閉じ込めているようだが、**`acc123` の直後に `/` が要求されていない**。よって `acc123-evil.html` や、ディレクトリ境界を無視した任意の名前が通る。さらに `["starts-with","$key","user/123"]` のような場合でも、`user/123../` のような正規化で親へ抜ける経路が残ることがある。

Rosén がこれを重視するのは、**ルート直下にファイルを置けること自体が致命的**だからだ。前節の AppCache マニフェスト、そして Service Worker の登録スクリプトは、いずれも「どのパスに置かれたか」でスコープが決まる。ルートに置ければオリジン全体を握れる。つまり `$key` の前方一致は、単なるファイル配置の話ではなく**スコープの話**である。

**(3) `["starts-with", "$Content-Type", ""]` と Content-Disposition 欠如**
Content-Type が実質無制限なら `text/html` を指定できる。さらにポリシーで `Content-Disposition: attachment` を強制していない場合、S3 はデフォルトで**インライン表示**する。結果、そのバケットのドメイン上で HTML/JS が実行される。

**(4) `image/jpegz;text/html` という古典的バイパス**
`["starts-with", "$Content-Type", "image/jpeg"]` と制限してもバイパスされる。理由は2層ある。

- **S3 側**: `starts-with` は文字列の単純な前方一致にすぎない。`image/jpegz;text/html` は `image/jpeg` で始まるので条件を通過する。MIME 型として妥当かどうかは検証されない。
- **ブラウザ側**: 保存された Content-Type ヘッダをブラウザがパースするとき、`;` より後ろはパラメータ部として扱われる……はずだが、実装によっては不正な型（`image/jpegz`）を解釈できず、フォールバック処理やスニッフィングを経て `text/html` 側が効いてしまうケースがあった。

教訓は普遍的である。**`starts-with` のようなプレフィックス一致で構造化された値（MIME 型、パス、オリジン）を検証してはいけない。** 構造を持つ値は、構造を理解したうえで完全一致か厳格なパースで検証する。この原則は後述の postMessage の origin 検証でもまったく同じ形で再登場する。

#### 署名付き URL（signed URL）をユーザ入力から作ってはいけない

講演は「ポリシーそのものは正しくても、アプリ側の独自ロジックが署名付き URL を漏らす」ケースも扱っている。核心は次の一文だ。

> "being able to get a signed GET-URL to the root of the bucket will show you the file-listing"

バケットのルートに対する署名付き GET URL を得られれば、**バケット全体のファイル一覧が見える**。実例として3パターンが挙げられている（いずれも報告済み・修正済みの事例）。

1. **パラメータのパストラバーサル**: `get-image?key=../../../` のように、キーを遡らせてルートに到達させる
2. **URL パースの誤り**: `https://.x./example-bucket` のような壊れた URL を投げると、ホスト名抽出のロジック（多くは雑な正規表現）が誤判定し、ルートを指す署名付き URL が返る
3. **パラメータ注入**: `s3_key="/"` をそのまま渡すと、ルートの一覧 URL が生成される

これらの合計報奨金は **約 $15,000**。

#### 防御チェックリスト

講演の推奨事項（スライドの原文の趣旨）をまとめる。

| 項目 | 正しい設定 | なぜ |
|---|---|---|
| `$key` | `starts-with` を使わず**完全に確定**させる。ランダムなパス＋ランダムなファイル名 | 上書き・ルート配置・トラバーサルを構造的に排除 |
| `Content-Type` | `starts-with` ではなく**明示的な完全一致** | プレフィックス一致は `image/jpegz;text/html` で抜ける |
| `Content-Disposition` | `attachment` を**ポリシーで強制** | インライン実行（XSS・マニフェスト）を封じる |
| `acl` | `private`、または指定しない | `public-read` は意図せぬ公開を生む |
| 署名付き URL | **ユーザ入力を一切もとにしない** | ルートを指す URL が作れれば全ファイル列挙 |
| ホスティング先 | ユーザコンテンツはアプリ本体と**別オリジン** | 1ファイルの侵害をオリジン境界で止める |

> 出典: OWASP AppSecEU 2018 – Attacking "Modern" Web Technologies — https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies
> 出典: Bypassing and exploiting Bucket Upload Policies and Signed URLs（Detectify Labs, 2018-08-02） — https://labs.detectify.com/2018/08/02/bypassing-exploiting-bucket-upload-policies-signed-urls/

---

### postMessage — 見えない攻撃面を可視化する

#### 前提の整理

`window.postMessage()` は、**異なるオリジンのウィンドウ／フレーム間でデータを送る、同一オリジンポリシーの公式な抜け道**である。送信側は `target.postMessage(data, targetOrigin)`、受信側は `window.addEventListener('message', handler)` で受ける。ハンドラが受け取る `MessageEvent` には少なくとも次が含まれる。

- `event.data` — 送られたデータ（構造化クローン）
- `event.origin` — **送信元のオリジン（ブラウザが保証する、偽装不能な値）**
- `event.source` — 送信元の `WindowProxy`（返信に使える）

セキュリティは完全に**アプリ側の2つの責務**に委ねられている。

1. **送信時**: `targetOrigin` に `'*'` を使わない（使うと、遷移した先の任意のオリジンにデータが渡る）
2. **受信時**: `event.origin` を**厳密に**検証する

この「アプリ任せ」が、後述するすべてのバグの共通原因である。

#### なぜ専用ツールが必要か: postMessage-tracker

postMessage の攻撃面は**DOM を見ても分からない**。リスナーは JavaScript の内部状態であり、しかも実運用では次の事情で観測が難しい。

- リスナーが**短命**（特定の UI 操作の間だけ登録され、すぐ `removeEventListener` される）
- リスナーが**ラッパで包まれている**。Raven.js（Sentry）、Rollbar、Bugsnag、New Relic といった監視ライブラリは `addEventListener` をフックして全ハンドラを try/catch でラップする。そのため `toString()` してもラッパのコードしか見えず、**本体の関数が特定できない**
- **jQuery** 経由（`$(window).on('message', ...)`）で登録された場合、実体は jQuery の内部ストア（`$._data` / `.expando` / `.events`）に入り、バージョンごとに格納場所が違う
- **無名関数**は Chrome では `Function.toString()` から元の定義位置を辿れない

Rosén はこの可視化のために Chrome 拡張 **postMessage-tracker** を公開している。機能の要点は次の通り。

- ページと**すべてのサブフレーム**の `message` リスナー数をアイコンにバッジ表示する
- 監視ライブラリや jQuery のラッパを**アンラップ**して、DevTools 上で「本当の受信関数」の定義にジャンプできるようにする
- ウィンドウ間のメッセージ流を**コンソールにログ出力**し、送信元・受信先を読みやすいパス表記（別ウィンドウは `diffwin` 識別子）で示す
- オプションで **Log URL** を設定すると、検出したリスナーの関数シグネチャとメタ情報を外部エンドポイントへ送信し、短命・隠れリスナーを後から分析できる
- 関数を文字列化できない場合（無名関数など）は `"bound"` と表示する

方法論としての含意は明確だ。**攻撃面マッピングとは「見えないものを見えるようにする計測器を先に作る」作業である。** どんなに手で探しても、リスナーが 200ms しか存在しなければ見つからない。

> 出典: postMessage-tracker（GitHub） — https://github.com/fransr/postMessage-tracker

#### パターン A: そのまま XSS になる受信ハンドラ

もっとも単純な型。受け取ったデータを、そのまま **sink（入力が最終的に実行・解釈される危険な代入先。`eval`、`innerHTML`、`script.src`、`location` など）** に流してしまう実装である。講演のペイロード例はこうだ。

```js
b.postMessage({"JSloadScript":{"value":"data:text/javascript,alert(...)"}}, '*')
```

受信側は `JSloadScript.value` を `<script src=...>` の `src` に代入していた。`data:` URI を受け付けるため、**外部ドメインを一切使わずに**対象オリジン上で任意 JS が走る。`data:text/javascript,` が使われているのは、CSP の `script-src` にホスト名ベースのホワイトリストしかない場合でも通ることがあるためだ（`data:` を明示的に禁じていない CSP は意外に多い）。

同型のバリエーションとして、受信データが `iframe.src` や `location.href` に入るケースがあり、その場合は `javascript:` スキームが sink になる。

#### パターン B: 設定投入型のデータ抽出

より巧妙なのが、**「XSS ではないが、メッセージで挙動を設定できる」機能を悪用する型**である。アナリティクスや A/B テスト系のタグは、親ウィンドウから「ルールセット」を受け取って動作する設計になっていることが多い。ルールは典型的に「CSS セレクタで要素を選び、その値を取り、指定先へ送る」という形をしている。

攻撃者が任意のルールセットを postMessage で注入できると、コードを実行しなくても

```
セレクタ: input[name=csrf_token]  → 値を攻撃者のエンドポイントへ送る
```

という指示だけで **CSRF トークンや個人情報を吸い出せる**。講演ではこれを "action-rules and element selectors" による data extraction として紹介している。

**教訓**: postMessage の危険度を「eval に届くか」だけで判定してはいけない。**「攻撃者がハンドラの設定空間をどこまで支配できるか」**が本当の評価軸である。

#### パターン C: サンドボックスドメインの XSS を本体へ橋渡しする

ドキュメント変換サービス（アップロードされた文書をプレビュー表示するタイプ）では、安全のためレンダリングを**隔離ドメイン**の iframe 内で行う設計が定石である。オリジンが違うので、そこで XSS が起きても本体のセッションは守られる——はずだった。

ところが、そのサンドボックス iframe は本体と `postMessage` で会話している。攻撃者がサンドボックスドメイン上で XSS を取ると、そこから `window.opener` や `parent`、あるいは `event.source` を辿って、**攻撃者が開いた別ウィンドウへ、被害者がアップロードした文書の中身を postMessage で流出させる**ことができる。

ここでの原理は **「オリジン分離は、その境界を越える通信路を開けた瞬間に、通信路の強さまで弱まる」** という点だ。サンドボックス化は万能薬ではなく、**境界を越えるメッセージの種類と方向を最小化して初めて効く**。

#### パターン D: クライアントサイド・レースコンディション（その1）

講演の白眉がここからの2つである。

対象は locale（多言語化）サービス。ページ読み込み時に、JavaScript のロードと iframe のロードが**並行して**走り、両者が postMessage でハンドシェイクする。ここには「JS はもう読み込まれたが、iframe の origin 検証ロジックがまだ初期化されていない」という**時間的な隙間**が存在した。

その隙間に攻撃者がメッセージを送り込むと、注入値が読み込み中のスクリプトに取り込まれる。スライドにあるペイロードは次の通り。

```
&osl='-alert(1)-'
```

これは `osl` パラメータの値が、生成される JavaScript の**文字列リテラルの中**に補間されていることを示している。`'` でリテラルを閉じ、`-` で式を連結し、`alert(1)` を評価させ、再び `-'` で後続のクォートと辻褄を合わせる。`+` ではなく `-`（減算）を使うのは、URL 中で `+` が空白にデコードされる問題を避けるためで、JS インジェクションの定番テクニックである。

さらにスライドには、`alert` が使えない状況での回避として **iframe の `contentWindow` を使う手法**が挙げられている。ページ側で `window.alert` が潰されていても、新たに生成した同一オリジン iframe の `contentWindow.alert` は手つかずで残っているため、PoC の証明に使える。

#### パターン E: origin 正規表現のバグ ＋ 決済フローのレース（その2）

最も実害の大きい事例。決済処理（Stripe 連携）を行うページで、受信側の origin 検証が**動的に組み立てた正規表現**で行われていた。

```js
// 意図: "*.example.co.nz" からのメッセージだけを受け付けたい
var domain = '.example.co.nz';
var re = '^https:\\/\\/.*(' + domain.replace('.', '\\.') + ')$';
Boolean("https://www.exampleaco.nz".match(re));  // => true  ← 通ってしまう
```

**なぜ通るのか**。JavaScript の `String.prototype.replace()` は、**第1引数が文字列の場合、最初に一致した1箇所しか置換しない**（全置換には正規表現 `/\./g` が必要）。したがって `.example.co.nz` は `\.example.co.nz` になり、**先頭のドットだけがエスケープされ、`example.co.nz` の中の2つのドットは未エスケープのまま**残る。正規表現では未エスケープの `.` は「任意の1文字」である。

組み上がったパターンを文字単位で当ててみる。

```
パターン: ^https:\/\/.*(\.example.co.nz)$
入力:      https://www.exampleaco.nz

  ^https:\/\/  →  "https://"
  .*           →  "www"
  \.           →  "."        (エスケープ済みの本物のドット)
  example      →  "example"
  .            →  "a"        ★任意文字なのでドット以外にもマッチ
  co           →  "co"
  .            →  "."
  nz           →  "nz"
  $            →  終端
```

つまり攻撃者が `exampleaco.nz` というドメインを取得すれば、`*.example.co.nz` 専用のはずの origin 検証を突破できる。

そのうえで**レース**が仕掛けられる。正規のフローは、フレーム間で `INIT` → `LOAD` といった順序でハンドシェイク（スライドの表現で "INIT-dance"）してから Stripe の公開鍵を確定させる。攻撃者は自分の（検証を通過する）ドメインから、`setInterval` で **`LOAD` メッセージを高頻度に連射（spray）** し、正規の `LOAD` より先に自分のメッセージを届かせる。

```js
// 概念コード（学習用。実サービスに対して実行しないこと）
setInterval(function () {
  victimFrame.postMessage({ type: 'LOAD', stripeKey: ATTACKER_PUBLISHABLE_KEY }, '*');
}, 1);
```

結果、決済フォームは**攻撃者のマーチャントアカウントの公開鍵**で初期化される。被害者が入力したクレジットカード情報は、正規の見た目のまま**攻撃者の Stripe アカウントへトークン化されて送られる**。UI 上の異常は一切ない。

この事例が教えるのは2点。

1. **origin 検証を文字列操作や動的正規表現で書いてはいけない。** 正しくは `event.origin === 'https://app.example.com'` の完全一致、または許可リストへの `includes()`。サブドメインを許したいなら `new URL(event.origin)` でパースして `hostname` を `.example.co.nz` で `endsWith` 判定するなど、構造を理解した比較を行う。
2. **クライアントサイドにも競合状態がある。** サーバ側のレースコンディションは広く知られているが、「複数のフレーム／スクリプトが非同期に初期化し、その間に状態が確定していない」という状況は、JS が単一スレッドであっても**イベントループ上の順序として**存在する。ハンドシェイクの各ステップは、**一度だけ受け付ける／nonce と突き合わせる／初期化完了フラグを立てる**という形で冪等化・順序固定するべきである。

> 出典: OWASP AppSecEU 2018 – Attacking "Modern" Web Technologies — https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies

---

### 方法論としてのまとめ: 攻撃面をどう列挙するか

本節の3つの柱は、表面的にはバラバラの技術だが、攻撃面マッピングの観点では**同じ4つの質問**に還元できる。実際の調査では、対象アプリに対してこの4問を機械的に当てていくとよい。

| 質問 | AppCache の場合 | バケットの場合 | postMessage の場合 |
|---|---|---|---|
| **① この機能はどの信頼境界を跨ぐか** | オフラインキャッシュがオリジン全体のレスポンスを合成する | ブラウザから直接ストレージへ書き込む | 異なるオリジンのウィンドウ間 |
| **② 境界を定義しているのは誰か** | マニフェストの配置パス（＝仕様。ただし当時ブラウザが未強制） | ポリシーの `conditions`（＝アプリが生成） | `event.origin` の検証コード（＝アプリが実装） |
| **③ その定義は構造を理解して検証されているか** | パス制約が無視されていた | `starts-with` による**プレフィックス一致** | 動的組み立ての**正規表現** |
| **④ 攻撃者が制御できるタイミング／状態は何か** | cookie bombing で「取得失敗」を任意発動 | 正規ポリシーを自分の画面から取得して再利用 | 初期化前の隙間にメッセージを連射 |

そして、この講演全体を貫く2つの原則を最後に置く。

- **プレフィックス一致・部分一致・自作正規表現で、構造を持つ値（オリジン、MIME 型、パス）を検証しない。** 必ずパースするか完全一致で比較する。`indexOf()`、`startsWith()`、`String.replace()` を使った origin チェックは、それだけで脆弱性報告に値する。
- **「ファイルを1つ置ける」を軽視しない。** 置ける場所がオリジンのルートに近いほど、それは「オリジン全体の恒久的な制御」に近づく。AppCache は消えたが、Service Worker という後継が同じ性質を持っている。

なお本節の内容は、いずれも**適切な許可のもとで行われたバグバウンティ調査の報告済み・修正済み事例**である。読者が同種の検証を行う場合は、必ず自分で構築した検証環境か、明示的にスコープが許可されたプログラム上で行うこと。実在サービスの本番環境に対して無許可でこれらの手法を試すことは、本書の目的の範囲外であり、また法的に許されない。

> 出典: OWASP AppSecEU 2018 – Attacking "Modern" Web Technologies — https://speakerdeck.com/fransrosen/owasp-appseceu-2018-attacking-modern-web-technologies
> 出典: Attacking Modern Web Technologies（講演動画・未取得） — https://www.youtube.com/watch?v=vRqcUS4CPFs
