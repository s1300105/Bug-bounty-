# XSSの正体とDOM-based XSS — フロントエンドを狙う脆弱性の仕組みと多層防御

> **この節で分かること**
> - XSS（クロスサイトスクリプティング）とは何であり、なぜ同一オリジンポリシーでは防げないのかを説明できる
> - 反射型・蓄積型・DOM-based の3種類のXSSを、原因の所在と持続性で区別できる
> - DOM-based XSS を「ソース（source）」と「シンク（sink）」という観点で読み解き、危険なコードを自分で見つけられる
> - 著者のハンズオンコードを使って `textContent` / DOMPurify / URLスキーム検証 / CSP / Trusted Types という多層の対策を実装できる
> - 攻撃ペイロード `<img src onerror=...>` がサニタイザによってどう無害化されるかを、実物のコードで追える

**元資料**: https://codezine.jp/article/detail/17342 （原典は取得できず二次情報ベース。ただし記事の抜粋元である書籍のハンズオンコード https://github.com/shisama/security-handson は `git clone` で全文取得済み）
**関連する節**: 同一オリジンポリシー（オリジンによるアクセス制限）／CSRF・クリックジャッキング・オープンリダイレクト／コンテンツセキュリティポリシー（CSP）

---

## 0. この節の位置づけ

この節は、書籍『フロントエンド開発のためのセキュリティ入門 知らなかったでは済まされない脆弱性対策の必須知識』（翔泳社、著：平野昌士、監修：はせがわようすけ／後藤つぐみ、2023年2月13日発売）の**第5章「XSS」**を抜粋した CodeZine 記事「Webアプリへの攻撃『XSS』とは？フロントエンドと関連の強い『DOM-based XSS』を解説」（2023年2月20日公開）を主な題材にしている。

記事本文そのものは執筆環境から自動取得できなかった（後述の 📌 ブロックを参照）が、記事の抜粋元である**書籍第5章のハンズオン用サンプルコードは、著者が GitHub で CC0（パブリックドメイン相当）ライセンスで公開しているものを丸ごと取得できた**。したがってこの節では、記事が語る「XSSとは何か」という概念の部分と、著者自身が書いた「では実際にどう防ぐのか」というコードの部分を、両輪で扱う。

XSS はバグバウンティにおいてクライアントサイド脆弱性の最重要ターゲットである。記事は「XSS は JVN iPedia や HackerOne（脆弱性報奨金サイト）で最も報告件数が多い脆弱性である」と述べている。まずはその正体から見ていく。

---

## 1. XSSとは何か — なぜ同一オリジンポリシーでは防げないのか

### 1.1 XSSの定義

XSS（クロスサイトスクリプティング, Cross-Site Scripting）とは、Webアプリケーション内の脆弱性を利用して、攻撃者が用意した不正なスクリプトをユーザーのブラウザ上で実行させる攻撃のこと。記事本文の定義は次のとおりである。

> XSS（クロスサイトスクリプティング）とは、Webアプリケーション内の脆弱性を利用して不正なスクリプトを実行する攻撃です。具体的には、攻撃者が不正なスクリプトを攻撃対象ページのHTMLに挿入して、ユーザーに不正スクリプトを実行させる攻撃手法です。

ポイントは「攻撃対象ページのHTMLに挿入して」という部分にある。攻撃者は自分のサイトからではなく、**被害者が信頼している正規のページの中に**スクリプトを紛れ込ませる。ユーザーのブラウザから見れば、そのスクリプトは正規サイトのコードと区別がつかない。

### 1.2 根本原因は「文字列連結によるHTML生成」

記事は原因をこう説明する。

> XSSはユーザーが入力した文字列をそのままHTMLへ挿入することで発生する脆弱性です。例えば、リクエストの内容をそのままレスポンスのHTMLへ反映するような処理は反射型XSSの原因となります。

つまり、**ユーザーが入力した文字列を、そのままHTMLの一部として組み立ててしまう**ことが根本原因である。たとえば「こんにちは、〇〇さん」の〇〇にユーザー名を文字列連結で埋め込む処理を考えてほしい。ユーザー名が `<script>...</script>` だったら、その `<script>` はHTMLの一部として解釈され、実行されてしまう。設計意図としては「動的にページを組み立てたい」という自然な欲求があるのだが、そこに**データとコードの境界が曖昧になる**という落とし穴が潜んでいる。

### 1.3 なぜ同一オリジンポリシーでは防げないのか（この節の核心）

同一オリジンポリシー（Same-Origin Policy, SOP）とは、あるオリジン（スキーム＋ホスト＋ポートの組）のページから読み込まれたJavaScriptが、別のオリジンのページの中身を勝手に読み書きできないようにするブラウザの防御機構のこと。たとえば `attacker.example` のページが `bank.example` の中身を盗み見るのを防ぐ。これはクライアントサイドセキュリティの土台となる境界である。

ところが XSS はこの境界を**内側から**破る。記事の核心的な指摘を引用する。

> クロスオリジンのページ上で動作するJavaScriptからの攻撃は同一オリジンポリシーによってブロックされるが、XSSは攻撃対象ページ内でJavaScriptが実行されるため、同一オリジンポリシーでは防ぐことができない。

図で表すと次のような対比になる。

```
【SOPで防げる攻撃】                    【XSS（SOPで防げない）】
attacker.example のJS                  bank.example のページに
   │  読もうとする                        攻撃者のスクリプトが「注入」される
   ▼                                       │
bank.example の中身  ← ✕ SOPが拒否       ▼
                                        bank.example の「内側」で実行される
                                          → bank.example のCookieもDOMも読める
                                          → SOPは同一オリジンなので何も止めない
```

XSS は「オリジンをまたぐ攻撃を封じる仕組み（SOP）の内側に、攻撃者のコードを持ち込む」攻撃である。だから SOP や CORS といったオリジン境界の防御では止まらない。これが、クライアントサイド脆弱性ハンティングにおいて XSS が最重要ターゲットであり続ける理由である。

### 1.4 なぜフロントエンド開発者も対策しなければならないのか

記事は、XSS が実務でどれほど厄介かをこう述べる。

> XSSは「JVN iPedia」や「HackerOne」などの脆弱性データベース・脆弱性報奨金サイトにおいて、最も報告件数が多い脆弱性である。

> 脆弱性診断ツールや熟練した開発者をもってしても、すべてのXSSの攻撃手法を完全に防ぐことは難しい。ブラウザ上で動作するJavaScriptに起因するXSSの脆弱性も多いため、フロントエンド開発者も基本的な対策を実装する必要がある。

JVN iPedia とは、IPA（情報処理推進機構）が運用する日本語の脆弱性対策情報データベースのこと。HackerOne とは、企業が脆弱性報奨金（バグバウンティ）プログラムを運営するためのプラットフォームのこと。どちらでも XSS の報告が最も多いという事実は、裏を返せば**バグハンターにとって XSS は最も見つかりやすく、報奨につながりやすい脆弱性**だということでもある。

> ### 📌 ここは自分で開いて読んでください
> **資料**: CodeZine「Webアプリへの攻撃『XSS』とは？フロントエンドと関連の強い『DOM-based XSS』を解説」 — https://codezine.jp/article/detail/17342
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: サイト側の制限。エージェント用の通信プロキシが `codezine.jp` へのアクセスを403でブロックし、Wayback Machine 経由の参照も不可だった）。以下の記述は検索エンジン経由で回収できた本文の引用断片と書誌情報にもとづく部分的な再構成である。
> **読みどころ**:
> 1. 「XSSの種類」節に載っている**攻撃フロー図**（反射型・蓄積型・DOM-based の3つが、リクエスト・サーバ・DBをどう跨ぐか）。文章だけでは掴みにくい「どこにスクリプトが保存され、どこでHTMLに合流するか」を図で確認する。本教科書ではこの図を再現できていないので、ここが最大の欠落である。
> 2. DOM-based XSS の**完全なコード例**。本教科書は `location.hash.slice(1)` と `<img src onerror=...>` の断片しか確認できていない。原文の変数名・前後処理を確認すること。
> 3. 「XSSの脅威」節の列挙と、それぞれがどの種類のXSSで起きやすいかの対応。
> **代替手段**: 同じ内容は書籍『フロントエンド開発のためのセキュリティ入門』第5章そのものである（記事はその抜粋）。書籍が手元にあれば第5章を直接読むのが最良。記事本文が読めなくても、対策の実装だけなら著者のハンズオンコード（本節 §5〜§10）で足りる。

---

## 2. XSSの脅威 — 何が起きるのか

XSS が成立すると、攻撃者のスクリプトは正規ページの権限で動く。記事が挙げる脅威は次のとおり。

| 脅威 | 記事の説明（回収した要旨） |
| --- | --- |
| Webアプリケーションの改ざん | 攻撃者のスクリプトによってページの内容が書き換えられる（Webページ改竄） |
| 意図しない操作 | ユーザーの意図しない操作がアプリケーション上で実行される |
| なりすまし | 攻撃者がユーザーのセッション情報を盗み取り、そのユーザーとしてふるまう |
| フィッシング | 偽の入力フォームを表示させ、個人情報やアカウント情報（認証情報）を盗む |
| 情報漏洩 | ページ内の機密情報やCookie等が攻撃者へ送信される |
| 悪性サイトへの強制遷移 | `location.href` の書き換えなどでユーザーを攻撃者のサイトへ飛ばす（DOM-based XSSの例で明示） |

とりわけ「なりすまし」は重い。ログインセッションを識別する Cookie を盗めば、攻撃者はパスワードを知らなくてもそのユーザーとしてログイン状態を乗っ取れる。「フィッシング」は、正規ドメインの上に偽のログインフォームを描画する手口で、ユーザーは URL バーが正しいので疑わない。XSS が「最も報告件数が多い」と同時に「影響が大きい」とされるのはこのためである。

〔補足〕記事にはこれらの脅威に対応する攻撃フロー図があるはずだが、原文の図は取得できていない。上の 📌 ブロックのとおり、図は各自で原文を開いて確認してほしい。

---

## 3. XSSの3分類 — CWEに基づく反射型・蓄積型・DOM-based

### 3.1 分類の軸は「原因がサーバ側かフロント側か」

記事は CWE（Common Weakness Enumeration, 共通脆弱性タイプ一覧）という分類体系に沿って XSS を3種類に整理する。CWE とは、ソフトウェアの弱点の種類に共通の番号と名前を付けた辞書のこと。XSS は CWE-79 に相当する。

> XSSは主にCWE（Common Weakness Enumeration）によって3つの種類に分類される。反射型XSSと蓄積型XSSはWebアプリケーションのサーバサイドのコードの不備が原因で発生し、DOM-based XSSはフロントエンドのコードの不備が原因で発生する。ただし、3種類のいずれも最終的にはユーザーのブラウザ上で攻撃コードが実行される。

分類の全体像を表にまとめる。

| 種類 | 別名 | 原因の所在 | 持続性 | 影響範囲 |
| --- | --- | --- | --- | --- |
| 反射型XSS（Reflected XSS） | 非持続型XSS（Non-Persistent XSS） | サーバサイドのコードの不備 | なし（リクエストに不正スクリプトが含まれたときのみ） | 罠を踏んだユーザーのみ |
| 蓄積型XSS（Stored XSS） | 持続型XSS（Persistent XSS） | サーバサイドのコードの不備（＋データ保存） | あり（サーバ上に保存される） | 該当ページを閲覧するすべてのユーザー |
| DOM-based XSS | — | フロントエンド（JavaScript）のコードの不備 | ケースにより異なる | ソースを操作できる範囲のユーザー。**サーバを介さないため検知が困難** |

重要なのは「**いずれも最終的にはユーザーのブラウザ上で攻撃コードが実行される**」という共通点。原因の場所（サーバ側 or フロント側）が違うだけで、被害はすべてブラウザで起きる。

### 3.2 反射型XSS（Reflected XSS）

反射型XSSとは、攻撃者が用意した罠から発生するリクエストの内容を、サーバがそのままレスポンスのHTMLに反映してしまうことで発生する XSS のこと。

> 反射型XSS（Reflected XSS）とは、攻撃者が用意した罠から発生するリクエストに対して、不正なスクリプトを含むHTMLをサーバで組み立ててしまうことが原因で発生するXSSです。リクエストに含まれるコードをレスポンスのHTML内にそのまま出力することから「反射型XSS」と呼ばれています。

> 反射型XSSはリクエストの内容に不正なスクリプトが含まれたときのみ発生し、持続性がないことから「非持続型XSS」（Non-Persistent XSS）と呼ばれることもあります。

「反射」という名前は、リクエストに含めた文字列がそのまま鏡のように跳ね返ってレスポンスに現れることに由来する。攻撃が成立するのは、その悪性リンクを踏んだユーザーだけ。サーバには何も残らない（持続しない）。たとえば検索キーワードを画面にそのまま表示する検索ページで、キーワードに `<script>` を仕込んだURLを踏ませる、といった手口が典型である。

### 3.3 蓄積型XSS（Stored XSS）

蓄積型XSSとは、攻撃者が投稿した不正スクリプトが**サーバ上（データベースなど）に保存され**、それを表示するページを開いた全員に影響が及ぶ XSS のこと。

> 蓄積型XSS（Stored XSS）とは、攻撃者がフォームなどから投稿した不正なスクリプトを含むデータがサーバ上に保存され、その保存されたデータ内の不正なスクリプトがWebアプリケーションのページに反映されることで発生するXSSです。

> 蓄積型XSSは、データベースに登録されたデータが反映されるページを閲覧するすべてのユーザーに影響を及ぼし、持続型XSSと呼ばれることもあります。

掲示板やコメント欄、プロフィール欄など「ユーザーの投稿を他のユーザーが読む」場所が舞台になりやすい。攻撃者が一度スクリプトを投稿すれば、そのページを開いた人全員が被害に遭う。反射型と違って「罠リンクを踏ませる」手間が要らず、**影響範囲がページ閲覧者全員に広がる**ぶん、危険度は高い。

### 3.4 DOM-based XSS

DOM-based XSSとは、サーバではなく**ブラウザ内で動くJavaScriptのDOM操作**が原因で発生する XSS のこと。DOM（Document Object Model）とは、HTML文書をJavaScriptから操作できるように木構造で表現したもの。

> DOM-based XSSとは、JavaScriptによるDOM（Document Object Model）操作が原因で発生するXSSです。他のXSSがサーバのコードの不備が原因となるのに対して、DOM-based XSSはフロントエンドのコードの不備によって発生し、サーバを介さないので攻撃を検知することが難しいという特徴もあります。

「サーバを介さないので検知が難しい」という特徴が、この節のタイトルにもなっている核心である。攻撃文字列がサーバに届かない（＝サーバのログにもWAFにも残らない）場合があるため、サーバ側の監視だけでは気づけない。だからこそフロントエンドエンジニアが自分で対策する必要がある。次の §4 で構造を詳しく見る。

> ### 📌 ここは自分で開いて読んでください
> **資料**: CWE-79（Improper Neutralization of Input During Web Page Generation）公式定義 — https://cwe.mitre.org/data/definitions/79.html ／ JVN iPedia — https://www.ipa.go.jp/security/vuln/jvniPedia.html ／ HackerOne Hacktivity — https://hackerone.com/hacktivity
> **なぜ**: 本教科書の執筆環境からはいずれも自動取得できなかった（理由: サイト側の制限。プロキシが接続をブロック）。記事が「CWEによって3種類に分類される」「XSSが最も報告件数が多い」と述べる根拠を一次資料で裏取りできていない。
> **読みどころ**:
> 1. CWE-79 のページで、反射型・蓄積型・DOM-based が CWE の体系上どう位置づけられているかを確認する（本教科書は記事の記述のみに依拠しており、CWE番号の細かな対応は未検証）。
> 2. JVN iPedia の年次レポートで「XSSが最も多い」という統計の実数を確認する。
> 3. HackerOne Hacktivity で、実際の報奨金プログラムにおける XSS 報告の割合を見る。バグハンターとして「どんな XSS が報告され、いくら支払われたか」を知る一次情報になる。
> **代替手段**: なし（いずれも公式の一次資料であり、等価な無料代替はない）。

---

## 4. DOM-based XSSの構造 — 「ソース」と「シンク」

### 4.1 ソースとシンクとは

DOM-based XSS を読み解く最重要の道具が「ソース」と「シンク」である。記事の中核説明を引用する。

> DOM-based XSSはブラウザの機能によって発生し、「ソース」（source）と「シンク」（sink）の2つに分類して整理できる。ソースは `location.hash` のようにユーザーが操作できる文字列を提供する場所であり、シンクはその文字列からJavaScriptが生成され実行されてしまう場所である。

言葉で定義しなおすと次のようになる。

- **ソース（source）**とは、攻撃者が操作できる文字列がプログラムに入ってくる**入口**のこと。たとえば `location.hash`（URL の `#` 以降）は、ユーザー（＝攻撃者）が自由に書き換えられる。
- **シンク（sink）**とは、その文字列を受け取って**JavaScriptやHTMLとして解釈・実行してしまう出口**のこと。たとえば `innerHTML` は、渡された文字列をHTMLとしてパースする。

データの流れとしては次のようになる。

```
[ソース]  location.hash など
   │  攻撃者が操作した文字列が流れ込む
   ▼
（アプリのJavaScriptが文字列を運ぶ・加工する）
   │
   ▼
[シンク]  innerHTML など
   → 文字列がHTML/JSとして解釈され、攻撃コードが実行される
```

**汚染された値がソースからシンクへ、無害化されずに到達する**とき、DOM-based XSS が成立する。だからハンティングの手順は「ソースを探す → シンクを探す → その間で無害化（エスケープ・サニタイズ・検証）が行われているかを確認する」となる。

### 4.2 具体例と攻撃ペイロードの読み解き

記事は `innerHTML` を題材にした具体例を挙げる。

> `innerHTML` がDOM-based XSSを引き起こす具体例として、`location.hash.slice(1)` で `<img src onerror="location.href='https://attacker.example'" />` のような文字列を取得し、それを `innerHTML` でHTMLへ挿入してしまうケースが示されている。

記事本文から回収できた逐語の断片は次のとおり。

```js
location.hash.slice(1)
```

```html
<img src onerror="location.href='https://attacker.example'" />
```

この2つを組み合わせると、脆弱なパターンは概念的に次のように書ける（原文の変数名・前後処理は未確認のため「概念コード」として扱う）。

```js
// 記事で示される脆弱なパターン（回収した要素の組み合わせ・概念コード）
element.innerHTML = location.hash.slice(1);
```

この攻撃ペイロードを、防御・診断の目的で読み解く。

- `<img src onerror="...">` — `src` 属性を値なし（または無効値）にすることで**画像読み込みを必ず失敗させ、`onerror` イベントハンドラを確実に発火させる**古典的パターン。画像が読めないと `onerror` が呼ばれるという仕様を逆手に取っている。
- `innerHTML` は代入された文字列をHTMLとしてパースするため、挿入されたタグの**イベントハンドラ属性が実行される**。〔補足〕`innerHTML` は `<script>` タグ自体は実行しないが、`onerror` や `onload` のようなイベントハンドラ属性は発火するという非対称性があり、攻撃者はこの抜け道を使う。
- `location.hash` は **`#` 以降がサーバへ送信されない**ため、サーバ側のログや WAF（Web Application Firewall）からは攻撃文字列が見えない。これが「サーバを介さないので攻撃を検知することが難しい」という記事の指摘の技術的根拠である。

記事が語る結末を引用する。

> この例はDOM操作における `innerHTML` の使用がDOM-based XSSを引き起こすことを示しており、結果として攻撃者はユーザーを悪性サイトへ強制的に遷移させたり、情報漏洩やWebアプリケーションの改ざんなど、さまざまな攻撃を行えるようになる。

### 4.3 代表的なソース一覧（一般知識の補足）

〔補足（一般知識）〕記事はソースの例として `location.hash` の1つを挙げているが、実務のハンティングでは以下のソースを併せて確認する。以下の表は記事本文にはない一般知識である。

| ソース | 備考 |
| --- | --- |
| `location.hash` | `#` 以降。サーバへ送信されない |
| `location.search` | クエリ文字列 |
| `location.pathname` / `location.href` | URL全体・パス |
| `document.referrer` | 参照元URL |
| `document.cookie` | 他脆弱性と組み合わせて汚染される場合 |
| `window.name` | クロスオリジンでも保持される |
| `postMessage` の `event.data` | オリジン検証漏れと組み合わせて危険 |
| `localStorage` / `sessionStorage` | 一度汚染されると持続 |
| `WebSocket` / `fetch` のレスポンス | サーバ側やサードパーティが汚染源になりうる |

### 4.4 代表的なシンク一覧（一般知識の補足）

〔補足（一般知識）〕同様に、記事が挙げる `innerHTML` 以外の主要なシンクを整理する。以下も記事本文にはない一般知識である。

| シンク | 実行の仕組み |
| --- | --- |
| `innerHTML` / `outerHTML` | HTMLとしてパース。イベントハンドラ属性が発火 |
| `insertAdjacentHTML()` | 同上 |
| `document.write()` / `document.writeln()` | HTMLとしてパース。`<script>` も実行される |
| `eval()` / `Function()` | 文字列をJavaScriptとして評価 |
| `setTimeout()` / `setInterval()`（文字列引数） | 同上 |
| `element.setAttribute('href', ...)` / `a.href` | `javascript:` スキームで実行 |
| `location` / `location.href` / `location.assign()` / `location.replace()` | `javascript:` スキームで実行、オープンリダイレクト |
| `element.srcdoc`（iframe） | HTMLとしてパース |
| イベントハンドラプロパティ（`element.onclick` 等）への文字列代入 | 実装によりコード評価 |
| jQuery の `$()` / `.html()` / `.append()` | 内部で `innerHTML` 相当の処理 |
| フレームワークの `dangerouslySetInnerHTML`（React）/ `v-html`（Vue）/ `[innerHTML]`（Angular） | 明示的にサニタイズを迂回する口 |

最後の行は特に重要である。React・Vue・Angular などのモダンフレームワークは、デフォルトでは文字列を自動エスケープして XSS を防ぐが、`dangerouslySetInnerHTML` や `v-html` は**その安全機構を意図的に迂回する口**として用意されている。バグハンティングでは、これらの「危険と名のついた口」に汚染値が流れ込んでいないかを真っ先に探す。

> ### 📌 ここは自分で開いて読んでください
> **資料**: OWASP DOM based XSS Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html ／ MDN `Element.innerHTML` — https://developer.mozilla.org/ja/docs/Web/API/Element/innerHTML
> **なぜ**: 本教科書の執筆環境から自動取得できなかった（理由: サイト側の制限で接続不可・403）。§4.3〜§4.4 の表は一般知識による補足であり、一次資料で網羅性を裏取りできていない。
> **読みどころ**:
> 1. OWASP チートシートで、ソース／シンクのより網羅的な一覧と、シンクごとの安全な書き方を確認する。§4.3〜§4.4 の表を一次資料に置き換えたいならここが最適。
> 2. MDN の `innerHTML` ページで、「`<script>` は実行されないがイベントハンドラ属性は発火する」という仕様上の非対称性を確認する（§4.2 の攻撃が成立する理由の一次的な裏付け）。
> **代替手段**: OWASP Cheat Sheet Series は GitHub でもミラーされており、`cheatsheetseries.owasp.org` が開けない場合はリポジトリのMarkdownを読める。

---

## 5. ハンズオンで体験する — 著者のサンプルコード

ここからは、記事の抜粋元である**書籍第5章のハンズオン用サンプルコード**を使って、脆弱性の再現と対策の実装を見ていく。このコードは著者（GitHub handle: shisama）が公開しているもので、ライセンスは CC0（パブリックドメイン相当）である。取得コマンドは次のとおり。

```bash
git clone https://github.com/shisama/security-handson.git
```

### 5.1 リポジトリの構成

リポジトリは**章番号がそのままディレクトリ名**になっている。

```
security-handson/
├── README.md
├── .gitignore
├── renovate.json
├── ch2/          # 第2章 ハンズオンの準備
├── ch3/          # 第3章 HTTP
├── ch4/          # 第4章 オリジンによるアクセス制限
├── ch5/          # 第5章 XSS  ← この節の対象
├── ch6/          # 第6章 その他の受動的攻撃（CSRF等）
├── ch7/          # 第7章 認証・認可
└── appendix/     # 付録
```

この構成には教材として2つの優れた性質がある。

1. **各章のディレクトリは前章の内容を累積的に含む「完成形スナップショット」**である。たとえば `ch5/` は `ch4/` の全ファイルを含み、そこに第5章で追加する分が足されている。したがって「**ch5 と ch4 の差分＝第5章で書き足すコード**」として読める。
2. `ch1` と `ch8` のディレクトリは存在しない。第1章「Webセキュリティ概要」（概念解説のみ）と第8章「ライブラリを狙ったセキュリティ」（`npm audit` などコマンド実行が中心で、サンプルアプリの改変を伴わない）には、動かすサンプルアプリが無いためと推測される。

第5章（`ch5`）に含まれるファイルは次のとおり。

| ファイル | 役割 |
| --- | --- |
| `server.js` | Express の Web サーバ。第5章で `/csp` ルートが追加される |
| `routes/api.js` | APIルート（第5章では第4章と同一） |
| `views/csp.ejs` | Trusted Types 検証ページ（第5章で追加） |
| `public/xss.html` | **XSS 検証用ページ。対策コードが入っている** |
| `public/user.html` | 「盗まれる側」の機密情報を模したページ |
| `public/attacker.html` | 攻撃者の罠ページ（SOP の実演用） |
| `public/purify.js` | DOMPurify 3.0.0 のバンドル版（ローカル同梱） |
| `public/csp-test.js` | CSP／Trusted Types 検証で読み込まれるスクリプト |

### 5.2 同一オリジンポリシーを体験する（attacker.html と user.html）

§1.3 で「SOP は防げるが XSS は防げない」と述べた。その**前半（SOPが防ぐ様子）**を体験させるのが `attacker.html` と `user.html` の2ファイルである。

まず「盗まれる側」の機密情報ページ `ch5/public/user.html`（全文・逐語）。

```html
<!DOCTYPE html>
<html>
  <head>
    <title>ログインユーザー情報</title>
  </head>
  <body>
    <ul id="user_info">
      <li>ログインID: frontend_security</li>
      <li>メールアドレス: frontend-security@@mail.example</li>
      <li>住所: 東京都〇〇1-2-3</li>
    </ul>
  </body>
</html>
```

次に攻撃者の罠ページ `ch5/public/attacker.html`（全文・逐語）。

```html
<!DOCTYPE html>
<html>
  <head>
    <title>attacker.example</title>
    <script>
      function load() {
        // ユーザー情報を読み取る
        const userInfo = frm.document.querySelector("#user_info");
        // ユーザー情報の文字列をログに出力
        console.log(userInfo.textContent);
      }
    </script>
  </head>
  <body>
    <div>
      <!-- ユーザーを誘導するための罠ページのコンテンツ -->
    </div>

    <!-- ユーザー情報をiframeで埋め込む -->
    <iframe
      name="frm"
      onload="load()"
      src="http://site.example:3000/user.html"
      width="80%"
    />
  </body>
</html>
```

このコードの意図はこうである。`attacker.html` は `iframe` で `site.example:3000/user.html`（機密情報のページ）を埋め込み、`frm.document.querySelector("#user_info")` でその中身を読もうとする。しかし `attacker.example` と `site.example` は**別オリジン**なので、SOP によってブロックされ、`iframe` の中身は読めない。`console.log` には何も出ないか、エラーになる。

```
attacker.example のページ
   │ iframe で site.example:3000/user.html を埋め込む
   │ frm.document.querySelector("#user_info") で中を読もうとする
   ▼
   ✕ SOP がブロック → 機密情報は読めない
```

つまり「別オリジンから機密ページを読もうとしても SOP が守ってくれる」。ところが XSS が成立すると、攻撃者のコードは `site.example` 自身の**内側**で動くので、SOP は何も止めない。この対比を、`attacker.html`（SOPが守る例）と `xss.html`（XSSで破られる例）の2つで体験するのが第5章の設計である。

〔補足〕`site.example` / `attacker.example` というホスト名を使うため、ハンズオンでは hosts ファイルへの追記（`127.0.0.1 site.example` など）が前提になっているはずである（手順は書籍本文にあり未取得）。その裏付けとして `ch5/routes/api.js` の許可リストには次のホストが含まれている。

```js
const allowList = [
  "http://localhost:3000",
  "http://site.example:3000"
];
```

### 5.3 脆弱なページと対策コード（xss.html）

第5章の中心が `ch5/public/xss.html` である。**このファイルは記事本文では読めなかった「対策の実装」を、著者自身のコードとして示している最重要の資料**である。全文（逐語）を掲げる。

```html
<!DOCTYPE html>
<html>
  <head>
    <title>XSS検証用ページ</title>
    <script src="./purify.js"></script>
  </head>
  <body>
    <h1>XSS検証用ページ</h1>
    <div id="result"></div>
    <a id="link" href="#">リンクをクリック</a>

    <script>
      const url = new URL(location.href);
      const message = url.searchParams.get("message");
      if (message !== null) {
        // 5.3.1 適切なDOM操作を行う場合
        document.querySelector("#result").textContent = message;

        // 5.3.3 DOMPurifyを使う場合
        const sanitizedMessage = DOMPurify.sanitize(message);
        document.querySelector("#result").innerHTML = sanitizedMessage;
      }

      const urlStr = url.searchParams.get("url");
      if (urlStr !== null) {
        const linkUrl = new URL(urlStr, url.origin);
        if (linkUrl.protocol === "http:" || linkUrl.protocol === "https:") {
          document.querySelector("#link").href = linkUrl;
        } else {
          console.warn("httpまたはhttps以外のURLが指定されています。");
        }
      }
    </script>
  </body>
</html>
```

このコードから確定した事実がいくつかある。

**（1）ソースはクエリ文字列である。** 記事の例では DOM-based XSS のソースが `location.hash` だったが、このハンズオンでは `new URL(location.href)` から `url.searchParams.get("message")` でクエリ文字列（`?message=...`）を取り出している。つまり**記事とハンズオンで題材のソースが違う**。ハンティングでは両方のソースを疑う姿勢が大切だと分かる。

**（2）シンクは2種類ある。** `#result` に対する `innerHTML`／`textContent` と、`#link` の `a.href` である。前者はテキスト表示、後者は `javascript:` スキームによる XSS を扱う題材である。

**（3）コメントに書籍の節番号が埋め込まれている。** `5.3.1 適切なDOM操作を行う場合` と `5.3.3 DOMPurifyを使う場合` というコメントから、書籍第5章の 5.3 が「XSSの対策」の節であることが強く示唆される。次の §6〜§8 で、この各対策を1つずつ読み解く。

〔注意〕このファイルは「完成形」なので、5.3.1（`textContent`）と 5.3.3（`DOMPurify`）の両方のコードが同居している。実行順では後者（`innerHTML`）が前者（`textContent`）を上書きするため、そのまま動かすと実際に効いているのは DOMPurify 経路である。**本来はどちらか一方を選ぶ**ものであり、教材としては「2通りの対策を並べて見せている」と理解すること。

〔補足〕コメントは 5.3.1 と 5.3.3 しか現れず、**5.3.2 が何なのかは特定できていない**。また後半の `url` パラメータを扱うブロック（`protocol` の検証）にはコメントが無いため、これが 5.3.2 なのか 5.3.4 なのかも不明である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: 版元の書籍詳細ページ（詳細目次） — https://www.shoeisha.co.jp/book/detail/9784798169477
> **なぜ**: 本教科書の執筆環境から自動取得できなかった（理由: サイト側の制限で接続不可）。節レベル（5.1, 5.2, 5.3.2, 5.4 …）の見出しを確認できていない。
> **読みどころ**:
> 1. 第5章の**節レベルの詳細目次**。最優先。サンプルコードのコメントから 5.3.1「適切なDOM操作を行う」／5.3.3「DOMPurifyを使う」までは判明したが、5.1・5.2・**5.3.2**・5.4 以降の見出しが不明。ここを埋めれば第5章の全体構成が確定する。
> 2. 第7章「認証・認可」の節構成。Cookie 属性（`HttpOnly` / `Secure` / `SameSite`）が第5章（XSS対策）側か第7章側かは本教科書では未確定。
> 3. 正誤表（Errata）。§8 で触れる `appendix` 版の緩いスキーム検証が正誤表で言及されていないかを確認すると有益。
> **代替手段**: ISBN `9784798169477` で書店サイト（Amazon等）の「目次」欄からも節レベルの目次が得られることが多い。版元のダウンロードページ https://www.shoeisha.co.jp/book/download/9784798169477 に付属データがある。

---

## 6. 対策1 — 適切なDOM操作（textContent）

### 6.1 なぜ効くのか

最も基本的な対策が、`innerHTML` の代わりに `textContent` を使うこと。

```js
// 5.3.1 適切なDOM操作を行う場合
document.querySelector("#result").textContent = message;
```

`textContent` とは、要素の中身を**プレーンテキストとして**設定・取得するプロパティのこと。`innerHTML` が文字列をHTMLとしてパースするのに対し、`textContent` は**渡された文字列をHTMLとして一切解釈しない**。`<img src onerror=...>` を渡しても、それは画面に「`<img src onerror=...>`」という文字列がそのまま表示されるだけで、タグとしては機能しない。

```
message = "<img src onerror=alert(1)>"

innerHTML  に代入 → HTMLとしてパース → <img> タグが作られ onerror 発火 → XSS成立
textContent に代入 → ただの文字列として表示 → 「<img src onerror=alert(1)>」と見える → 安全
```

### 6.2 どこを突かれるか

この対策の限界は「**HTMLを表示したい場合には使えない**」こと。ユーザー入力を装飾付きHTML（太字やリンクなど）として表示したい要件があると、`textContent` では実現できない。そういうときに必要になるのが次の DOMPurify によるサニタイズである。逆に言えば、**HTMLである必要がない箇所でうっかり `innerHTML` を使っている**のがハンティングの狙い目になる。「ただのテキストなのに `innerHTML` で描画している」箇所を見つけたら、DOM-based XSS の候補である。

---

## 7. 対策2 — サニタイズ（DOMPurify）

### 7.1 DOMPurifyとは

DOMPurify とは、Cure53（Webセキュリティの専門企業）が開発する、HTML / MathML / SVG 向けの**DOM専用のXSSサニタイザ**のこと。サニタイズ（sanitize）とは、危険な要素・属性を取り除いて安全なHTMLだけを残す処理のこと。書籍は `public/purify.js` としてバージョン 3.0.0 のバンドル版を同梱している。

```js
// 5.3.3 DOMPurifyを使う場合
const sanitizedMessage = DOMPurify.sanitize(message);
document.querySelector("#result").innerHTML = sanitizedMessage;
```

`DOMPurify.sanitize(message)` は、汚れたHTML文字列を受け取り、危険な要素・属性（`onerror` などのイベントハンドラや `<script>`）を除去した安全な文字列を返す。その結果を `innerHTML` に代入するので、装飾付きHTMLを表示しつつ XSS を防げる。動作原理は「ブラウザが提供するDOMパーサを、XSSフィルタに転用する」というものである。

### 7.2 どう無害化されるのか（公式のサニタイズ例）

DOMPurify 公式が示すサニタイズ例を引用する。左が入力、`becomes` の右が出力である。

```js
DOMPurify.sanitize('<img src=x onerror=alert(1)//>'); // becomes <img src="x">
DOMPurify.sanitize('<svg><g/onload=alert(2)//<p>'); // becomes <svg><g></g></svg>
DOMPurify.sanitize('<p>abc<iframe//src=jAva&Tab;script:alert(3)>def</p>'); // becomes <p>abc</p>
DOMPurify.sanitize('<math><mi//xlink:href="data:x,<script>alert(4)</script>">'); // becomes <math><mi></mi></math>
DOMPurify.sanitize('<TABLE><tr><td>HELLO</tr></TABL>'); // becomes <table><tbody><tr><td>HELLO</td></tr></tbody></table>
DOMPurify.sanitize('<UL><li><A HREF=//google.com>click</UL>'); // becomes <ul><li><a href="//google.com">click</a></li></ul>
```

1行目に注目してほしい。`<img src=x onerror=alert(1)//>` は、記事の攻撃例 `<img src onerror="...">` にほぼ対応する。DOMPurify を通すと `onerror` 属性が除去され `<img src="x">` だけが残る。危険なイベントハンドラが消え、無害な画像タグになる。

3行目の `jAva&Tab;script:` は、**HTMLエンティティ `&Tab;` でタブ文字を差し込んで `javascript:` を難読化する**古典的バイパス手法である。DOMPurify はこの難読化を見抜いて `<iframe>` ごと除去する。これは「拒否リストでスキーム名を文字列一致で弾く実装は破られる」ことの実例であり、§8 で見る**完全一致の許可リスト**が正しい理由を補強している。

### 7.3 公式が警告する落とし穴

DOMPurify 公式 README は、次の落とし穴を明記している（原文英語）。

> Well, please note, if you _first_ sanitize HTML and then modify it _afterwards_, you might easily **void the effects of sanitization**. If you feed the sanitized markup to another library _after_ sanitization, please be certain that the library doesn't mess around with the HTML on its own.

（訳：**サニタイズした後にそのHTMLを改変すると、サニタイズの効果を容易に無効化してしまう**。サニタイズ後のマークアップを別のライブラリに渡す場合は、そのライブラリがHTMLを勝手に加工しないことを確認せよ。）

つまり「サニタイズは最後にやる」。サニタイズ後にHTMLを文字列連結で加工したり、別ライブラリに通して再び組み立てたりすると、除去したはずの危険が復活しうる。バグハンティングでは「サニタイズしてから、その結果をさらにいじっている」コードが狙い目になる。

もう1点。除去された要素を確認できる `DOMPurify.removed` プロパティについて、公式はこう警告している。

> After sanitizing your markup, you can also have a look at the property `DOMPurify.removed` (…) Please **do not use** this property for making any security critical decisions.

（訳：`DOMPurify.removed` で除去された要素・属性を確認できるが、**セキュリティ上重要な判断にこのプロパティを使ってはならない**。）

〔注記〕§7.2〜§7.3 の内容は CodeZine 記事にも書籍にも書かれていない可能性がある。これは書籍が使う DOMPurify について、公式リポジトリ（`github.com/cure53/DOMPurify`）の一次資料から補った情報である。なお公式 README は執筆時点の最新版であり、書籍同梱版（3.0.0）とは記述が異なる場合がある。

> ### 📌 ここは自分で開いて読んでください
> **資料**: DOMPurify Security Goals & Threat Model（Wiki） — https://github.com/cure53/DOMPurify/wiki/Security-Goals-&-Threat-Model
> **なぜ**: 本教科書の執筆環境では Wiki ページを取得していない（README のリンク記載のみ確認。理由: サイト側の取得範囲の制限）。
> **読みどころ**:
> 1. DOMPurify が「何を守り、何を守らないか」の脅威モデル。サニタイザを使うなら**必読**と DOMPurify 公式が明言している。
> 2. mutation XSS、namespace confusion、DOM clobbering など、サニタイザを破ろうとする攻撃クラスの歴史（`Attack Classes & Bypass History` のWikiページ）。ハンターとして「どうやってサニタイザを破ろうとしてきたか」を知る一次情報になる。
> **代替手段**: DOMPurify 公式 README（https://github.com/cure53/DOMPurify）にサニタイズ例と基本的な注意点は載っている。

---

## 8. 対策3 — URLスキームの許可リスト検証

### 8.1 なぜ必要か — `javascript:` スキームというシンク

`a.href` や `location` に `javascript:alert(1)` のような文字列を入れると、リンクをクリックしたときにそのJavaScriptが実行される。つまり `href` も立派なシンクである。`xss.html` の後半はこの `a.href` を守るコードである。

```js
const urlStr = url.searchParams.get("url");
if (urlStr !== null) {
  const linkUrl = new URL(urlStr, url.origin);
  if (linkUrl.protocol === "http:" || linkUrl.protocol === "https:") {
    document.querySelector("#link").href = linkUrl;
  } else {
    console.warn("httpまたはhttps以外のURLが指定されています。");
  }
}
```

### 8.2 どう動くのか — 「許可リスト」と「URLパーサに正規化させる」

このコードには2つの良い実践が込められている。

**（1）許可リスト方式**である。`javascript:` を拒否リストで弾くのではなく、`"http:"` と `"https:"` **だけを通す**という書き方になっている。拒否リストは `JaVaScript:` や `java\tscript:` のような変形で破られるため、「通してよいものだけを列挙する」許可リストの方が堅い。

**（2）URLパーサに正規化させてから判定している**。生の文字列に `startsWith("http")` のような前方一致検査をかけるのではなく、`new URL(urlStr, url.origin)` でいったんURLオブジェクトに正規化し、その `protocol` を見る。パーサに解釈させることで、難読化や相対URLのトリックをまとめて無害化できる。この「パースしてから判定する」という順序は、実務のレビューでも要点になる。

### 8.3 前方一致は緩い — appendix版との差分

リポジトリの `appendix/public/xss.html` だけは、このスキーム検証が1行だけ違う。

```js
// ch5 / ch6 / ch7 版（厳密な完全一致による許可リスト）
if (linkUrl.protocol === "http:" || linkUrl.protocol === "https:") {

// appendix 版（前方一致による許可リスト）
if (linkUrl.protocol.startsWith("http") || linkUrl.protocol.startsWith("https")) {
```

本教科書の執筆過程で Node.js の `URL` 実装を使って両方式の挙動を実測した結果が次の表である（推測ではなく実行結果）。

```js
// new URL(入力, "http://localhost:3000") の protocol と、2つの検査方式の結果
// 入力                    protocol        厳密一致(ch5版)  前方一致(appendix版)
// "http://e.com"          "http:"         true             true
// "https://e.com"         "https:"        true             true
// "javascript:alert(1)"   "javascript:"   false            false   ← どちらも防げる
// "httpfoo:alert(1)"      "httpfoo:"      false            true    ← 前方一致だけ通す
// "httpx:x"               "httpx:"        false            true    ← 前方一致だけ通す
```

読み取れることは2つ。

- **`javascript:` に対しては両方式とも有効**なので、`appendix` 版も XSS としては破られない。
- しかし前方一致は `httpfoo:` や `httpx:` のような**`http` で始まる未知のスキームを通してしまう**。〔補足〕未知スキームが `href` に入ると、OSに登録されたカスタムプロトコルハンドラを起動できる場合があり、別種の攻撃面になりうる。

教訓は、〔補足（一般知識）〕**スキーム検証は「前方一致」「`includes`」「正規表現の部分一致」ではなく、完全一致（`=== "http:"`）の許可リストで書く**ということ。`appendix` 側がなぜ緩い書き方になっているか（誤記か意図的な簡略化か）はリポジトリからは判断できない。

---

## 9. 対策4 — CSP（Content-Security-Policy）

### 9.1 CSPとは — 多層防御の「最後の砦」

CSP（Content-Security-Policy, コンテンツセキュリティポリシー）とは、ブラウザに「このページではどこから読み込んだスクリプトを実行してよいか」などをHTTPヘッダで指示する仕組みのこと。エスケープやサニタイズをすり抜けて万一スクリプトが注入されても、CSP が実行を止めれば被害を防げる。「入力を無害化する対策」が破られたときの**最後の砦**である。

第5章のハンズオンでは `server.js` に `/csp` ルートが追加される。これは `ch4` には存在せず、第5章で書き足されるサーバ側コードである。`ch5/server.js` の全文（逐語）を掲げる。

```js
// ch5/server.js （ch4 からの追加部分を含む全文）
const crypto = require("crypto");
const express = require("express");
const api = require("./routes/api");
const app = express();
const port = 3000;

app.set("view engine", "ejs");

app.use(express.static("public"));

app.use("/api", api);

app.get("/", (req, res, next) => {
  res.end("Top Page");
});

app.get("/csp", (req, res) => {
  const nonceValue = crypto.randomBytes(16).toString("base64");
  res.header("Content-Security-Policy",
    `script-src 'nonce-${nonceValue}' 'strict-dynamic';` +
    "object-src 'none';" +
    "base-uri 'none';" +
    "require-trusted-types-for 'script'"
  );
  res.render("csp", { nonce: nonceValue });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
```

### 9.2 送出されるCSPヘッダの読み解き

このコードが送るヘッダは4つのディレクティブから成る。

| ディレクティブ | 値 | 意味 |
| --- | --- | --- |
| `script-src` | `'nonce-<ランダム16バイトのbase64>' 'strict-dynamic'` | nonce付き `<script>` のみ許可。`strict-dynamic` により、許可されたスクリプトが動的に生成した `<script>` も許可（＝ホスト名の許可リストを捨てられる） |
| `object-src` | `'none'` | `<object>`/`<embed>` を全面禁止（プラグイン経由の実行を封じる） |
| `base-uri` | `'none'` | `<base>` による相対URL基準の乗っ取り（base tag injection）を封じる |
| `require-trusted-types-for` | `'script'` | **Trusted Types の強制を有効化**。生文字列を危険なシンクへ代入すると `TypeError` になる |

nonce（number used once, 使い捨ての乱数）とは、CSP で「この特定の `<script>` は正規のものだ」と印を付けるためのランダム値のこと。`crypto.randomBytes(16).toString("base64")` で**リクエストごとに新しく生成**されている点が重要である。nonce を固定値にすると攻撃者に予測されて意味がなくなるため、毎回変える必要がある。

`strict-dynamic` は、「nonce で許可されたスクリプトが `document.createElement` などで動的に作った `<script>` も信頼する」という指定。これによりホスト名の許可リスト（`script-src https://cdn.example ...`）を書かずに済み、CSP が壊れにくくなる。

### 9.3 どこを突かれるか

CSP は強力だが万能ではない。設定ミス（`unsafe-inline` の許可、nonce の固定・使い回し、ホスト名許可リストに JSONP を返すエンドポイントが混ざる、など）があると迂回される。バグハンティングでは、CSP ヘッダを読んで「実行を許してしまう抜け道」を探すのが1つの型である。逆に、CSP が無い／緩いページは XSS が刺さったときの被害が大きい。

---

## 10. 対策5 — Trusted Types

### 10.1 なぜTrusted Typesが生まれたのか — シンクは多すぎる

§4 で見たとおり、シンク（`innerHTML`、`location.href`、`ScriptElement.src` …）は数が多い。ソースからシンクへの経路をすべて追ってレビューするのは、大きなコードベースでは現実的でない。この問題への回答が Trusted Types である。

Trusted Types とは、HTML片やURLを**ただの文字列ではなく「型付きオブジェクト」として扱う**ことを強制するブラウザの仕組みのこと。W3C が仕様を策定している。設計思想を、公式の explainer.md から引用する（原文英語）。

> security reviewers don't need to deeply understand and review each and every usage of a given *sink*, but can instead focus their efforts on the code that *generates* the typed objects.

（訳：セキュリティレビュー担当者は、個々のシンクの使用箇所すべてを深く理解してレビューする必要がなくなり、代わりに**型付きオブジェクトを生成するコードだけに労力を集中できる**。）

つまり戦略の転換である。「シンクは数が多すぎて全箇所レビューできない → だから**シンクへ到達できる値の生成箇所を一点（ポリシー関数）に絞る**」。書籍第5章が `createScriptURL` ポリシーを1箇所だけ定義しているのは、まさにこの思想に沿っている。これは §4 の「ソースとシンク」という整理が実務上有効な理由の説明にもなっている。

### 10.2 どう動くのか — ポリシー関数の実装例

`ch5/views/csp.ejs` の全文（逐語）が、Trusted Types のポリシー実装例である。

```html
<!DOCTYPE html>
<html>
  <head>
    <title>CSP検証ページ</title>
  </head>
  <body>
    <script nonce="<%= nonce %>">
      if (window.trustedTypes && trustedTypes.createPolicy) {
        // ポリシー関数を定義する
        const policy = trustedTypes.createPolicy("script-url", {
          // <script>要素のsrcに設定するURLをチェック
          createScriptURL: (str) => {
            // strのURL文字列からOriginを取得するためにURLオブジェクトにする
            const url = new URL(str, location.origin);
            if (url.origin !== location.origin) {
              // クロスオリジンの場合エラーにする
              throw new Error("クロスオリジンは許可されていません。");
            }
            // 同一オリジンの場合のみURLを返す
            return url;
          }
        });

        const script = document.createElement("script");
        // 作成したポリシー関数によって検査されて
        // TrustedScriptURLへ変換された値は代入可能になる
        script.src = policy.createScriptURL("./csp-test.js");
        document.body.appendChild(script);
      }
    </script>
  </body>
</html>
```

読み込まれる `ch5/public/csp-test.js` は次の1行だけである。

```js
alert("csp-test.jsのスクリプトが実行されました。");
```

このコードのポイントは4つ。

- ポリシー名は `"script-url"`、実装するトラップは `createScriptURL`。これは `script.src` というシンクを守るためのものであり、`innerHTML` 用の `createHTML` ではない。ここでは `<script>` の `src` を題材にしている。
- ポリシー関数は**同一オリジンのみ許可**し、クロスオリジンなら `throw` する。`require-trusted-types-for 'script'`（§9.2）が効いているため、ポリシーを通していない生文字列を `script.src` に代入することはできない。
- `if (window.trustedTypes && trustedTypes.createPolicy)` という**存在チェック（feature detection）**から始まっている。Trusted Types 非対応ブラウザ（当時の Safari / Firefox）では丸ごとスキップされる構成。
- `strict-dynamic` があるため、nonce付きインラインスクリプトが `document.body.appendChild(script)` で動的に挿入した `<script>` は実行を許される。`strict-dynamic` と動的挿入はセットで理解する必要がある。

### 10.3 `javascript:` URLはどう塞がれるか

Trusted Types の強制が有効なとき、`javascript:` URL によるナビゲーションはプラットフォーム機能によって守られる。explainer.md はこう述べる。

> Trusted Types の強制（`require-trusted-types-for 'script'`）が有効な場合、`javascript:` URLへのナビゲーションはデフォルトポリシーの仕組みによって守られる。通常は単に動作しなくなる。

つまり §8 で見た手書きの `protocol` 検証（`a.href` を守る）と、`/csp` ルートで有効化する Trusted Types（プラットフォームに任せる）は、**同じ「`javascript:` スキームのXSS」という問題に対する2層の対策**になっている。手書きの検証をうっかり忘れても、CSP + Trusted Types が下支えする。これが「多層防御（defense in depth）」の考え方である。

> ### 📌 ここは自分で開いて読んでください
> **資料**: web.dev「Trusted Types」 — https://web.dev/trusted-types/ ／ W3C Trusted Types 仕様ドラフト — https://w3c.github.io/trusted-types/dist/spec/
> **なぜ**: 本教科書の執筆環境から web.dev は自動取得できなかった（理由: サイト側の制限で接続不可）。仕様本体も本セッションからは参照できなかった。§10 の内容は公式リポジトリ（`w3c/trusted-types`）の README と explainer から補ったものである。
> **読みどころ**:
> 1. web.dev の記事で、Trusted Types の導入手順（レポート専用モードでの段階導入、既存コードの移行）を平易に確認する。
> 2. 仕様ドラフトで、保護対象のシンク一覧（`innerHTML` / `outerHTML` / `insertAdjacentHTML()` / `document.write()` / `DOMParser.parseFromString()` ほか）と、`TrustedHTML` / `TrustedScriptURL` / `TrustedScript` の型定義を確認する。
> **代替手段**: W3C の公開リポジトリ https://github.com/w3c/trusted-types の README と `explainer.md` は取得可能で、設計思想はそこで読める。

---

## 11. 対策技術の関係整理

第5章が示す対策は、単独ではなく層をなしている。ソースからシンクへ向かうデータの流れに沿って、どの対策がどこで効くかを整理する。

```
[ソース]  ?message=... / ?url=...  （攻撃者が操作できる入口）
   │
   ├─ 対策3: URLスキームの許可リスト検証（=== "http:" || === "https:"）  ← a.href シンクの手前
   │
   ▼
[表示のシンク]
   ├─ 対策1: textContent（HTMLとして解釈させない）           ← HTMLが不要な箇所
   └─ 対策2: DOMPurify.sanitize（危険な要素・属性を除去）     ← HTMLを表示したい箇所
   │
   ▼
[プラットフォームの砦]
   ├─ 対策4: CSP（script-src 'nonce' 'strict-dynamic', object-src 'none', base-uri 'none'）
   └─ 対策5: Trusted Types（require-trusted-types-for 'script' でシンクへの生文字列代入を禁止）
```

| 対策 | 種別 | 効く場所 | 書籍の節（判明分） |
| --- | --- | --- | --- |
| 対策1 `textContent` | 適切なDOM操作 | HTML不要なテキスト表示 | 5.3.1 |
| 対策2 DOMPurify | サニタイズ | HTMLを表示したい箇所 | 5.3.3 |
| 対策3 URLスキーム検証 | 入力検証（許可リスト） | `a.href` などURLシンク | 節番号不明 |
| 対策4 CSP | プラットフォーム防御 | ページ全体（実行の可否） | 5.3 の範囲内 |
| 対策5 Trusted Types | プラットフォーム防御 | 危険なシンク全般 | 5.3 の範囲内 |

要点は、**入力側の無害化（対策1〜3）とプラットフォーム側の砦（対策4〜5）を両方入れる**こと。前者が破られても後者が止め、後者が非対応環境でも前者が守る。単一の対策に頼らないのが、XSS 対策の基本姿勢である。

〔補足〕DOMPurify と Trusted Types を組み合わせるときは、Trusted Types のデフォルトポリシーの中で DOMPurify を呼ぶ書き方がある（DOMPurify 公式 README より）。

```js
window.trustedTypes.createPolicy('default', {
  createHTML: (to_escape) =>
    DOMPurify.sanitize(to_escape, { RETURN_TRUSTED_TYPE: false }),
});
```

`createHTML` は通常の文字列を返すことが期待されるため、DOMPurify 側では `RETURN_TRUSTED_TYPE: false` を指定する必要がある。

---

## 手を動かす

以下は許可された自分の検証環境（ローカルに立てたハンズオンアプリ）での操作を前提とする。他人のサイトに対して試してはならない。

1. サンプルコードを取得する。

```bash
git clone https://github.com/shisama/security-handson.git
cd security-handson/ch5 && npm install && node server.js
# → http://localhost:3000/xss.html?message=<img src onerror=alert(1)> で検証
```

2. ブラウザで `http://localhost:3000/xss.html?message=<img src onerror=alert(1)>` を開く。`xss.html` は対策入りなので、`textContent`／DOMPurify によって `onerror` が発火しないことを確認する（`alert` が出なければ対策が効いている）。

3. 対策が効いている理由を確かめるため、`ch5/public/xss.html` を開き、5.3.1（`textContent`）と 5.3.3（`DOMPurify.sanitize`）のコメント行を読む。試しに `textContent` の行だけを残して `innerHTML` の2行をコメントアウトし、逆に `innerHTML = message`（サニタイズ無し）に書き換えると、対策が外れて `alert` が出ることを確認できる（自分の環境でのみ）。

4. URLスキーム検証を試す。`http://localhost:3000/xss.html?url=javascript:alert(1)` を開き、リンクに `javascript:` が設定されないこと（コンソールに `httpまたはhttps以外のURLが指定されています。` と出る）を確認する。

5. 同一オリジンポリシーの実演を試す場合は、hosts ファイルに `127.0.0.1 site.example` と `127.0.0.1 attacker.example` を追記し（管理者権限が必要）、`attacker.html` を開いて `iframe` 内の `user.html` を読もうとして失敗する様子をコンソールで確認する。

〔注意〕上記の検証URLは `xss.html` のコードから組み立てた例であり、書籍に記載されている手順そのものではない。書籍のハンズオン手順（hosts 設定・証明書生成など）は本教科書では未取得なので、書籍が手元にある場合はそちらの手順に従うこと。

## つまずきポイント

- **「SOP があるのに XSS で破られるのはなぜ？」** — SOP はオリジンをまたぐアクセスを止める仕組みで、XSS は「そのオリジンの内側」でコードを動かすため止まらない。SOP と XSS は守る場所が違う。混同しやすいが、SOP の話（§1.3、§5.2）と XSS の話は別のレイヤーである。
- **`innerHTML` は `<script>` を実行しない、と覚えて安心してしまう** — 確かに `innerHTML` で挿入した `<script>` タグ自体は実行されない。しかし `onerror`・`onload` などの**イベントハンドラ属性は発火する**。この非対称性が攻撃の抜け道になる。
- **`xss.html` をそのまま動かすと `textContent` が効いていない** — 完成形コードは 5.3.1 と 5.3.3 が同居しており、後の `innerHTML` 代入が前の `textContent` を上書きする。実際に効いているのは DOMPurify 経路。本来はどちらか一方を選ぶ。
- **拒否リストでスキームを弾こうとする** — `javascript:` を文字列一致で弾く実装は、`jAva&Tab;script:` のような難読化（§7.2 の3行目）で破られる。必ず**完全一致の許可リスト**（§8）で書く。
- **前方一致 `startsWith("http")` を許可リストに使う** — `httpfoo:` のような未知スキームを通してしまう（§8.3 の実測）。`=== "http:"` の完全一致にする。
- **記事の例（`location.hash`）とハンズオン（`?message=`）でソースが違う** — 記事だけ読むと `location.hash` が唯一のソースだと誤解しがち。ソースはクエリ、ハッシュ、`postMessage`、`window.name` など多様である（§4.3）。
- **CSP や DOMPurify を入れれば完璧、という誤解** — CSP は設定ミスで迂回され、DOMPurify はサニタイズ後の改変で無効化される（§7.3）。単一の対策に頼らず多層で守る（§11）。
- **書籍執筆時とリポジトリのバージョンがずれている** — リポジトリは Renovate Bot で依存が更新されており、`package.json` は Express `^4.18.2` / EJS `^3.1.8` だが lockfile はさらに新しい。動作確認済み環境は Node.js 18.12.1 なので、再現するならバージョンを合わせる。

## この節のまとめ

- XSS（クロスサイトスクリプティング）とは、Webアプリの脆弱性を突いて、攻撃対象ページのHTMLに不正スクリプトを挿入し、ユーザーのブラウザで実行させる攻撃である。
- 根本原因は「ユーザー入力をそのままHTMLへ挿入する（文字列連結によるHTML生成）」こと。
- XSS は攻撃対象ページの**内側**でコードが実行されるため、同一オリジンポリシー（SOP）では防げない。これが最重要ターゲットである理由。
- XSS は JVN iPedia や HackerOne で最も報告件数が多く、フロントエンド開発者も基本対策を実装する必要がある。
- CWE に基づく3分類：反射型（サーバ原因・非持続・罠を踏んだ人のみ）、蓄積型（サーバ原因・持続・閲覧者全員）、DOM-based（フロント原因・サーバを介さず検知困難）。
- DOM-based XSS は「ソース（攻撃者が操作できる入口）」と「シンク（文字列がHTML/JSとして実行される出口）」で読み解く。汚染値がソースからシンクへ無害化されずに届くと成立する。
- 記事の攻撃例 `<img src onerror=...>` は、`src` を失敗させて `onerror` を確実に発火させ、`innerHTML` のパースで実行される。`location.hash` はサーバに送られないので検知が難しい。
- 対策1（`textContent`）はHTMLとして解釈させない。HTMLが不要な箇所で `innerHTML` を使っているのが狙い目。
- 対策2（DOMPurify）は危険な要素・属性を除去する。`<img src=x onerror=alert(1)//>` は `<img src="x">` になる。ただしサニタイズ後の改変で無効化されるので最後にやる。
- 対策3（URLスキーム検証）は `=== "http:" || === "https:"` の完全一致の許可リストで書く。前方一致は未知スキームを通すので緩い。パースしてから `protocol` を見る。
- 対策4（CSP）は `script-src 'nonce' 'strict-dynamic'`、`object-src 'none'`、`base-uri 'none'`、`require-trusted-types-for 'script'` で実行を制御する最後の砦。nonce はリクエストごとに生成する。
- 対策5（Trusted Types）は危険なシンクへの生文字列代入を禁止し、値の生成箇所（ポリシー関数）に検査を集中させる。`javascript:` URL もプラットフォームが塞ぐ。
- 入力側の無害化（対策1〜3）とプラットフォームの砦（対策4〜5）を両方入れる多層防御が基本姿勢。
- ハンズオンコードは CC0 で公開されており、`git clone` で誰でも取得・改変・検証できる。

## 理解度チェック

1. XSS はなぜ同一オリジンポリシーでは防げないのか。
   ▶ 答え：SOP はオリジンをまたぐアクセスを止める仕組みだが、XSS は攻撃対象ページ自身の内側で攻撃者のJavaScriptが実行される。同一オリジン内の動作なので SOP は何も止めない。

2. 反射型XSSと蓄積型XSSの違いを、原因・持続性・影響範囲の3点で述べよ。
   ▶ 答え：反射型はリクエスト内容をサーバがそのままレスポンスに反映することが原因で、持続性がなく、罠を踏んだユーザーだけに影響する。蓄積型は不正スクリプトがサーバ（DB等）に保存されることが原因で、持続し、そのページを閲覧する全ユーザーに影響する。

3. DOM-based XSS が「検知が難しい」とされる技術的な理由は何か。
   ▶ 答え：サーバを介さずブラウザ内のDOM操作で発生し、特に `location.hash`（`#` 以降）をソースにする場合はその文字列がサーバへ送信されないため、サーバのログや WAF から攻撃文字列が見えないから。

4. 「ソース」と「シンク」をそれぞれ定義し、DOM-based XSS が成立する条件を述べよ。
   ▶ 答え：ソースは攻撃者が操作できる文字列が入ってくる入口（例：`location.hash`、`location.search`）。シンクはその文字列をHTML/JSとして解釈・実行してしまう出口（例：`innerHTML`、`eval`、`a.href`）。汚染値がソースからシンクへ、無害化されずに到達すると成立する。

5. `element.textContent = message` が XSS を防ぐのはなぜか。`innerHTML` との違いは何か。
   ▶ 答え：`textContent` は渡された文字列をHTMLとして一切解釈せず、そのままプレーンテキストとして表示する。`innerHTML` は文字列をHTMLとしてパースし、`onerror` などのイベントハンドラ属性を発火させるので危険。

6. URLスキームの検証を「完全一致の許可リスト」で書くべき理由を、拒否リストや前方一致の問題点に触れて説明せよ。
   ▶ 答え：拒否リスト（`javascript:` を弾く）は `jAva&Tab;script:` のような難読化で破られる。前方一致（`startsWith("http")`）は `httpfoo:` のような `http` で始まる未知スキームを通してしまう。`=== "http:" || === "https:"` の完全一致なら、通してよいものだけを確実に許可できる。

7. CSP の nonce をリクエストごとに生成しなければならないのはなぜか。
   ▶ 答え：nonce は「この `<script>` は正規」という使い捨ての印。固定値だと攻撃者に予測され、注入したスクリプトに同じ nonce を付けられて許可されてしまう。だから `crypto.randomBytes(16)` などでリクエストごとに新しく生成する。

8. Trusted Types の設計思想を、「シンクの数」という観点から説明せよ。
   ▶ 答え：シンクは種類が多くて全使用箇所をレビューするのは非現実的。そこで、危険なシンクへ生文字列を代入することを禁止し、代わりに検査を通した型付きオブジェクトだけを許す。レビューは「型付きオブジェクトを生成するポリシー関数」という一点に集中できる。

9. DOMPurify を使うときに「サニタイズは最後に行う」べき理由は何か。
   ▶ 答え：サニタイズ後にHTMLを改変（文字列連結や別ライブラリでの再加工）すると、除去したはずの危険が復活し、サニタイズの効果を無効化してしまうから。

10. XSS対策で「多層防御」が推奨されるのはなぜか。この節の対策を例に説明せよ。
    ▶ 答え：単一の対策は破られたり非対応環境で効かなかったりする。入力側の無害化（`textContent`／DOMPurify／URLスキーム検証）が破られても、プラットフォームの砦（CSP／Trusted Types）が実行を止める。逆に Trusted Types 非対応ブラウザでは入力側の対策が守る。互いに補い合うことで穴を塞ぐ。

## 出典

- CodeZine「Webアプリへの攻撃『XSS』とは？フロントエンドと関連の強い『DOM-based XSS』を解説」 https://codezine.jp/article/detail/17342 （原文は自動取得できず、検索エンジン経由で回収した引用断片にもとづく）
- 書籍『フロントエンド開発のためのセキュリティ入門』版元ページ https://www.shoeisha.co.jp/book/detail/9784798169477
- CodeZine 書籍発売告知 https://codezine.jp/news/detail/17169
- CodeZine「フロントエンドエンジニア必見！ 脆弱性の仕組みと対策方法を解説」 https://codezine.jp/article/detail/17841
- ハンズオン用サンプルコード（CC0、`git clone` で全文取得） https://github.com/shisama/security-handson
- DOMPurify 公式リポジトリ https://github.com/cure53/DOMPurify
- W3C Trusted Types https://github.com/w3c/trusted-types ／ 仕様ドラフト https://w3c.github.io/trusted-types/dist/spec/
- web.dev Trusted Types https://web.dev/trusted-types/
- OWASP DOM based XSS Prevention Cheat Sheet https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
- MDN `Element.innerHTML` https://developer.mozilla.org/ja/docs/Web/API/Element/innerHTML
- CWE-79 https://cwe.mitre.org/data/definitions/79.html
- 著者の刊行告知ブログ https://shisama.hatenablog.com/entry/2023/02/13/083000 ／ 登壇資料 https://speakerdeck.com/masashi/frontend-security

<!-- self-read: https://codezine.jp/article/detail/17342 | サイト側の制限（プロキシが403でブロック）。原文の攻撃フロー図と完全なコード例が未取得 -->
<!-- self-read: https://cwe.mitre.org/data/definitions/79.html | サイト側の制限で接続不可。CWE-79の公式定義と3分類の位置づけを一次資料で裏取りできていない -->
<!-- self-read: https://www.ipa.go.jp/security/vuln/jvniPedia.html | サイト側の制限で接続不可。「XSSが最も報告件数が多い」統計の一次出典 -->
<!-- self-read: https://hackerone.com/hacktivity | サイト側の制限で接続不可。報奨金プログラムでのXSS報告割合の裏取り -->
<!-- self-read: https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html | サイト側の制限で接続不可。ソース／シンクの網羅的な一覧の一次資料 -->
<!-- self-read: https://developer.mozilla.org/ja/docs/Web/API/Element/innerHTML | サイト側の制限（403）。innerHTMLのイベントハンドラ発火という非対称性の一次的裏付け -->
<!-- self-read: https://www.shoeisha.co.jp/book/detail/9784798169477 | サイト側の制限で接続不可。第5章の節レベル詳細目次（5.1/5.2/5.3.2）が未取得 -->
<!-- self-read: https://github.com/cure53/DOMPurify/wiki/Security-Goals-&-Threat-Model | Wikiは未取得（READMEのリンク記載のみ確認）。サニタイザの脅威モデルはDOMPurify公式が必読と明言 -->
<!-- self-read: https://web.dev/trusted-types/ | サイト側の制限で接続不可。Trusted Typesの導入手順と仕様のシンク一覧 -->
<!-- sources: https://codezine.jp/article/detail/17342, https://www.shoeisha.co.jp/book/detail/9784798169477, https://codezine.jp/news/detail/17169, https://codezine.jp/article/detail/17841, https://github.com/shisama/security-handson, https://github.com/cure53/DOMPurify, https://github.com/w3c/trusted-types, https://w3c.github.io/trusted-types/dist/spec/, https://web.dev/trusted-types/, https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html, https://developer.mozilla.org/ja/docs/Web/API/Element/innerHTML, https://cwe.mitre.org/data/definitions/79.html, https://shisama.hatenablog.com/entry/2023/02/13/083000, https://speakerdeck.com/masashi/frontend-security -->
<!-- terms: XSS（クロスサイトスクリプティング）, 反射型XSS, 蓄積型XSS, DOM-based XSS, ソース（source）, シンク（sink）, 同一オリジンポリシー（SOP）, CWE, innerHTML, textContent, DOMPurify, サニタイズ, CSP（Content-Security-Policy）, nonce, strict-dynamic, Trusted Types, require-trusted-types-for, createScriptURL, DOM（Document Object Model）, JVN iPedia, HackerOne, 多層防御 -->
