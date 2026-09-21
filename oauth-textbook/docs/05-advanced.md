# 第5章 発展と最新動向 — OAuth 2.1・DPoP・FAPI・MCP

## OAuth 2.1 と Security BCP（RFC 9700 / BCP 240）

この節では、OAuth 2.0（RFC 6749, 2012年）が公開されてから十数年の間に積み上がった「攻撃と対策の知見」が、どのように **OAuth 2.0 Security Best Current Practice（RFC 9700 / BCP 240）** と **OAuth 2.1** という二つの文書へ集約されていったのかを整理します。前章までで見てきた redirect_uri 操作、コード横取り、Implicit フローによるトークン漏えい、mix-up 攻撃などは、ほぼすべてこの二文書の「MUST / MUST NOT」に姿を変えています。つまり本節は、これまでの攻撃カタログを「防御側の仕様」として読み直す章でもあります。

用語の確認:

- **BCP（Best Current Practice）**: IETF の文書カテゴリの一つ。新しいプロトコルを定義するのではなく、「既存仕様をどう使うのが現時点で最善か」を規範的に定める。番号は RFC 番号とは別に振られ、RFC 9700 は **BCP 240** に当たる（RFC 9700 は 2025年1月公開）。
- **OAuth 2.1**: RFC 6749 本体と、その後の周辺 RFC・BCP の要点を一つの文書に統合し、危険な選択肢を仕様から削除した「整理版」。IETF OAuth WG の Internet-Draft `draft-ietf-oauth-v2-1` として作業が続いている（本稿執筆時点 2026年9月でも「OAuth 2.1 の正式 RFC 番号」は資料で確認できていないため、ドラフトとして扱う）。
- **sender-constrained token（送信者拘束トークン）**: トークンを特定クライアントの鍵や証明書に暗号的に結び付け、盗んだ第三者が単体では使えないようにしたトークン。mTLS（RFC 8705）や DPoP（RFC 9449）で実現する。対義語は「持っていれば誰でも使える」**bearer token（持参人トークン）**。

---

### 1. なぜ「2.1」が必要になったのか — Aaron Parecki の問題提起（2019年）

2019年12月、OAuth 2.1 の編集者の一人となる Aaron Parecki は「It's Time for OAuth 2.1」という記事で統合の必要性を訴えました。主張の核は次の一点です。

> OAuth を安全に実装するためには、今や **少なくとも 12 本の RFC とドラフト** を読まなければならない。

RFC 6749 が出た 2012 年当時は、SPA（Single Page Application）もネイティブアプリも今ほど主流ではなく、パスワード漏えい事件もここまで頻発していませんでした。その後、

- ネイティブアプリ向けの RFC 8252
- PKCE（RFC 7636）
- 脅威モデル（RFC 6819）
- Token Revocation（RFC 7009）、Introspection（RFC 7662）
- AS Metadata（RFC 8414）
- Device Grant（記事中の表記では RFC 8626 だが、正しくは RFC 8628 — Device Authorization Grant）
- 当時ドラフトだった Security BCP、Browser-Based Apps BCP、JWT BCP

……と、「本体を読んだだけでは安全に作れない」状態になっていました。Parecki はこれを「仕様の迷路に閉じ込められたようだ」と表現しています。

#### 提案された構成

記事で示された OAuth 2.1 の骨格は次の通りです。

| 区分 | 取り込む内容 |
|---|---|
| コア | OAuth 2.0 Core（RFC 6749）、Bearer Token（RFC 6750） |
| 削除 | Security BCP に従い **Password grant と Implicit フローを除外** |
| 必須化 | **PKCE をすべてのクライアント種別で必須** |
| 取り込み | Native Apps（RFC 8252）、Browser-Based Apps の推奨事項、Device Grant、Token Revocation（RFC 7009）、AS Metadata（RFC 8414） |
| 相互運用のための任意要素 | Token Introspection（RFC 7662）、JWT Access Token（当時ドラフト、現 RFC 9068）、JWT BCP（現 RFC 8725） |

重要なのは「**新しい振る舞いは定義しない**」という方針です。2.1 は新機能ではなく、既に RFC や BCP として合意済みの内容を一冊にまとめ、古い危険な選択肢を捨てる作業です。

#### 設計思想:「最も安全な方法が唯一の選択肢であるべき」

Security BCP の著者 Torsten Lodderstedt の言葉として、記事は次を引用しています。

> 仕様を読めば、そこに書かれているのが唯一の選択肢であり、それがそのまま最も安全な実装方法である — 本来そうあるべきで、「最も安全な実装方法」を別途文書化する必要などないはずだ。

これが 2.1 の哲学的転換点です。2.0 では Implicit も Password grant も「使ってもよい選択肢」として残っていたため、実装者が危険な方を選べてしまいました。2.1 は「非推奨と注記する」のではなく「**仕様から消す**」ことで、誤った選択の余地そのものを無くします。

#### 残された論点: 後方互換性

記事時点で最大の論点は、**機密クライアント（confidential client、client_secret などの資格情報を持つサーバーサイドアプリ）にまで PKCE を必須化するか** でした。これを必須にすると、既存の OAuth 2.0 実装の大半が自動的には 2.1 準拠にならないためです。「2.1」という名前で技術的な破壊的変更を許すかどうかで WG の意見は割れていました（結果的に 2.1 ドラフトは PKCE 必須の方向で進んでいます。後述）。

なお同時期に Justin Richer が、RFC 6749 との互換性に縛られない全面再設計（TXAuth / 当時「OAuth 3」と呼ばれたもの）を進めており、これは後に **GNAP（Grant Negotiation and Authorization Protocol, RFC 9635）** になりました。2.1 は「今ある OAuth を安全側に寄せる」現実路線、GNAP は「ゼロから作り直す」長期路線という棲み分けです。

> 出典: Aaron Parecki「It's Time for OAuth 2.1」 — https://aaronparecki.com/2019/12/12/21/its-time-for-oauth-2-dot-1

---

### 2. OAuth 2.1 の主要な変更点 — oauth.net のまとめ

oauth.net の OAuth 2.1 ページは、OAuth 2.0 との主な差分を 7 項目に要約しています（2026年9月取得時点。原ドラフトは `https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1`）。

1. **PKCE 必須**: 「認可コードフローを使うすべての OAuth クライアントで PKCE を必須とする」
2. **redirect_uri の完全一致**: 「リダイレクト URI は **完全な文字列一致（exact string matching）** で比較しなければならない」
3. **Implicit grant の削除**: 「Implicit grant（`response_type=token`）は本仕様から除外」
4. **Password grant の削除**: 「Resource Owner Password Credentials grant は本仕様から除外」
5. **クエリ文字列での Bearer Token 禁止**: 「URI のクエリ文字列で Bearer Token を使う方式を除外」
6. **リフレッシュトークンの制約**: 「パブリッククライアントのリフレッシュトークンは、**送信者拘束するか、ローテーションしなければならない**」
7. **クライアント定義の簡素化**: public / confidential の定義を「クライアントが資格情報を持つかどうか」だけで判断するように簡素化

また、ページは土台となる RFC として RFC 8252（Native Apps）、RFC 7636（PKCE）、RFC 9700（Security BCP）、および Browser-Based Apps（oauth.net 上では RFC 10017 として掲載）を挙げています。Browser-Based Apps BCP はドラフト期間が長かった文書なので、参照時には RFC 番号が振られているかを datatracker で確認してください。

7 番目の「クライアント定義の簡素化」は地味ですが意味があります。RFC 6749 では「資格情報の機密性を保てるか」という曖昧な基準で分類していましたが、2.1 では「資格情報を持っているか」で割り切ります。これにより「SPA に client_secret を埋め込んでいるから confidential」という誤解の余地が減ります（ブラウザに埋め込んだ secret は秘密ではないので、実態は public client です）。

> 出典: oauth.net「OAuth 2.1」 — https://oauth.net/2.1/

---

### 3. 変更点ごとの「なぜ」 — FusionAuth の解説

FusionAuth の記事は、2.1 の変更を 6 つに整理し、それぞれの根拠と実装への影響を説明しています（記事は 2020年7月30日時点のドラフトを対象としている点に注意。その後のドラフトで細部は変わっていますが、6 項目の骨子は現在も維持されています）。ここでは記事の内容に、前章までの攻撃知識を結び付けて「なぜそうなるか」を補強します。

#### 3.1 認可コードグラントでの PKCE 必須

PKCE（Proof Key for Code Exchange、RFC 7636、「ピクシー」と読む）は、認可リクエストを出したクライアントと、コードをトークンに交換するクライアントが **同一であることを一回限りの秘密で証明する** 仕組みです。

```text
# 1) クライアントが毎回ランダムな code_verifier を生成（43〜128文字）
code_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

# 2) そのハッシュを code_challenge として認可リクエストに載せる
code_challenge = BASE64URL(SHA256(code_verifier))
               = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

GET /authorize?response_type=code&client_id=app
    &redirect_uri=https%3A%2F%2Fapp.example%2Fcb
    &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
    &code_challenge_method=S256
    &state=...

# 3) トークン交換時に元の code_verifier を送る
POST /token
grant_type=authorization_code&code=SplxlOBeZQQYbYS6WxSbIA
&redirect_uri=https%3A%2F%2Fapp.example%2Fcb
&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

**なぜ効くのか**: 認可サーバー（AS）はコード発行時に `code_challenge` を記録し、交換時に `SHA256(code_verifier)` と照合します。攻撃者がリダイレクト途中でコードを盗んでも（悪意あるアプリによるカスタムスキーム横取り、ログや Referer 経由の漏えい等）、`code_verifier` は正規クライアントのメモリ内にしか無く、ハッシュから逆算もできないため交換に失敗します。`S256` を使う理由はここにあり、`plain`（challenge = verifier そのもの）では認可リクエストが漏れた時点で verifier も漏れてしまいます。

FusionAuth は根拠として「非 TLS 通信や TLS の脆弱性がある場合のコード横取り対策」を挙げていますが、Security BCP の観点ではさらに重要な効果があります。それが **コードインジェクション（攻撃者が自分のアカウントで取得したコードを被害者のセッションに差し込む攻撃）** の防止です。被害者側のクライアントが持つ `code_verifier` は攻撃者のコードに紐付いた challenge と一致しないので、差し込まれたコードは使えません（詳細は第 4 節）。これが **機密クライアントにも PKCE を求める理由** です。client_secret は「誰がコードを交換するか」を証明しますが、「そのコードが自分のセッションで発行されたものか」は証明しないからです。

#### 3.2 redirect_uri の完全一致

2.0 の実装ではワイルドカードやパターン照合（`https://*.example.com/*` やプレフィックス一致など）が広く使われていました。記事は「redirect URI のワイルドカード照合を許すことはセキュリティリスクである」とし、オープンリダイレクトとの連鎖を理由に挙げます。

**なぜ危険なのか**: パターン照合を許すと、AS は「このパターンに合えば正規」と判断します。しかしパターンに合う URL の集合には、しばしば攻撃者が制御できる場所が含まれます。

```text
登録: https://app.example.com/*        （プレフィックス/ワイルドカード）

攻撃者が使う redirect_uri の例:
  https://app.example.com/redirect?url=https://attacker.example  ← オープンリダイレクト経由
  https://app.example.com/user-content/attacker-page             ← ユーザー投稿ページ
  https://evil.app.example.com/cb    （*.example.com なら乗っ取られたサブドメイン）
```

コードやトークンはこの URL に付与されて送られるため、最終的に攻撃者サーバーへ流れます。さらに URL パーサの差（AS と ブラウザで `@`、`\`、`%2F`、ポート表記などの解釈が違う）が絡むと、パターン照合は想定外の一致を起こしやすくなります。**完全一致** はパーサ差もパターン設計ミスも入り込む余地を無くす、最も単純で確実な方法です。

唯一の例外は、ネイティブアプリがループバック（`http://127.0.0.1:{port}/cb`）を使う場合で、RFC 8252 / RFC 9700 はポート番号の違いだけは許容するよう求めています（OS がポートを動的に割り当てるため）。

記事が挙げる影響: 開発・CI/CD で動的ホスト名（プレビュー環境ごとの URL 等）を使う場合、そのつど AS 側へ登録を追加する運用が必要になります。

#### 3.3 Implicit grant の削除

Implicit grant（`response_type=token`）は、アクセストークンを認可レスポンスの URL フラグメント（`#access_token=...`）で直接ブラウザへ返す方式です。記事はこれを「SPA で使うと本質的に安全でない」と評価し、トークンが JavaScript から見える場所（`localStorage`、URL フラグメント、`HttpOnly` でない Cookie）に置かれることで、依存ライブラリに紛れ込んだ悪意あるスクリプトに盗まれ得る点を挙げます。

**原理的な問題点**:

- トークンがフロントチャネル（ブラウザのリダイレクト）を通る → ブラウザ履歴、拡張機能、リダイレクト先ページのスクリプト、オープンリダイレクト経由でのフラグメント引き継ぎ（ブラウザはリダイレクト時にフラグメントを保持する）で漏れ得る。
- トークン発行時にクライアント認証も PKCE も無い → 「誰に渡したか」を AS が確かめられない。
- 送信者拘束（mTLS/DPoP）をかける手段が無い。
- 攻撃者が別の場所で得たトークンを差し込む **アクセストークンインジェクション** を検知できない。

2014 年当時は CORS が普及しておらず、ブラウザから別オリジンのトークンエンドポイントを叩けなかったため Implicit が必要でした。現在は CORS が当たり前なので、SPA も **認可コード + PKCE** に移行できます。記事は「2.1 準拠の実装は Implicit をサポートする必要がない」としています。

#### 3.4 Password grant（ROPC）の削除

Resource Owner Password Credentials grant は、クライアントがユーザーの ID/パスワードを直接受け取り AS に送る方式です。記事は「アプリのバックエンドを OAuth サーバーと同じくらい安全にしなければならなくなる」と指摘し、OAuth の委譲モデルそのものと矛盾するとします。

**なぜ根本的にまずいのか**:

- パスワードがクライアントを通過する → クライアントの侵害 = パスワード漏えい。OAuth の存在意義（第三者にパスワードを渡さない）が崩れる。
- ユーザーに「アプリにパスワードを入力するのは普通のこと」と学習させてしまい、フィッシング耐性を下げる。
- 多要素認証、パスキー（WebAuthn）、フェデレーション（外部 IdP）、同意画面などの AS 側の認証体験を挟めない。

記事は、ネイティブアプリは認可コード + PKCE（外部ブラウザ経由、RFC 8252）へ移行するか、OAuth 2.0 サーバーを使い続けるかのどちらかになるとしています。

#### 3.5 クエリ文字列での Bearer Token の禁止

RFC 6750 は `GET /resource?access_token=...` という渡し方を（非推奨ながら）認めていました。記事は RFC を引いて「URL やその一部はサーバーログ、キャッシュ、ブラウザ履歴に記録され得る」ため、クエリ文字列は決してプライベートではないと説明します。

```http
# NG: URL にトークンが残る（アクセスログ、プロキシログ、Referer、履歴）
GET /api/me?access_token=eyJhbGciOi... HTTP/1.1

# OK: Authorization ヘッダー（RFC 6750 §2.1）
GET /api/me HTTP/1.1
Authorization: Bearer eyJhbGciOi...
```

URL はリクエストの「識別子」として扱われるため、ログ・監視・CDN・Referer ヘッダーなど多数の仕組みがそれを平文で複製します。一方ヘッダーは通常ログに記録されず、Referer にも乗りません。

#### 3.6 リフレッシュトークンの制約

記事は「リフレッシュトークンは一回限りの利用にするか、送信者拘束しなければならない」と説明します。根拠は、リフレッシュトークンがアクセストークンより **高い権限と長い寿命** を持ち、漏れれば攻撃者が「好きなだけアクセストークンを作れる」からです。

- **一回限り（ローテーション）**: リフレッシュのたびに新しいリフレッシュトークンを発行し、古いものを無効化。クライアントは毎回新しい値を保存する必要がある。
- **送信者拘束**: mTLS（RFC 8705）や DPoP（記事当時ドラフト、現 RFC 9449）でクライアントの鍵に結び付ける。

**ローテーションがなぜ漏えい検知になるのか**: 正規クライアントと攻撃者が同じリフレッシュトークンを持っている状況を考えます。どちらか一方が先に使うと、そのトークンは無効化され新しいものが発行されます。後からもう一方が **既に使用済みのトークン** を提示すると、AS は「同じトークンが二者に存在する＝漏えいしている」と判断でき、そのトークンファミリー（同じ認可から派生した全リフレッシュトークン）をまとめて失効させられます。攻撃者が先に使った場合も、正規クライアントの次回リフレッシュで検知されます。

```text
RT1 --(正規クライアントが使用)--> AT2 + RT2   (RT1 は使用済み)
RT1 --(攻撃者が盗んで使用)----> AS: 使用済み RT1 の再利用を検知
                                → RT2 を含むファミリー全体を失効
```

なお 2.1 の規定対象は主に **パブリッククライアント**（資格情報を持たないため、リフレッシュ時にクライアント認証で身元を証明できない）です。機密クライアントはリフレッシュ時にクライアント認証が必要なので、トークン単体が漏れても悪用されにくい、という整理です。

#### 変わらないもの・現状

記事によれば、Client Credentials grant（サーバー間通信）や、明示的に変更・削除されない 2.0 のその他の要素はそのまま残ります。OAuth 2.0 サーバーはこれからも動き続けられ、非推奨要素は即時削除ではなく警告や段階的廃止になるだろうとしています。

記事の推奨する「今からできる準備」:

- **クライアント側**: Implicit と ROPC を使わない
- **サーバー側**: 認可コードで PKCE を有効化、redirect_uri 完全一致、クエリ文字列の Bearer Token を廃止、リフレッシュトークンの一回限り化または送信者拘束

また、後方互換を明示的に放棄した次世代プロトコルとして GNAP にも触れています。

> 出典: FusionAuth「Differences between OAuth 2 and OAuth 2.1」 — https://fusionauth.io/articles/oauth/differences-between-oauth-2-oauth-2-1

---

### 4. Security BCP の中身 — Daniel Fett が語る三本柱

Auth0 のポッドキャスト「Identity, Unlocked」第 4 回では、Security BCP の共著者で Web プロトコルの形式解析（数学的モデルで安全性を証明する手法）の研究者でもある Daniel Fett（当時 yes.com）が、BCP の位置づけと主要な推奨を語っています。

#### BCP の位置づけ

Fett は、BCP は **コア仕様を上書きするものではなく**、OAuth の使い方に関する追加情報と実践を提供する文書だと説明します。RFC 6749 の MUST を消すのではなく、その上に「実際に安全に運用するための追加の MUST / SHOULD」を重ねる、というイメージです。そして OAuth 2.1 は、その BCP の内容を本体側へ取り込んだ文書、という関係になります。

```text
RFC 6749 / 6750 (2012) ── 本体
      +  RFC 6819 (脅威モデル, 2013)
      +  RFC 7636 (PKCE), RFC 8252 (Native Apps) ...
      +  RFC 9700 = BCP 240 (Security BCP, 2025/01) ── 「こう使え」
                  │
                  ▼  取り込み・危険な選択肢を削除
      draft-ietf-oauth-v2-1 (OAuth 2.1)
```

#### 推奨 1: Implicit グラントをやめる

Implicit は AS がアクセストークンを作って直接ブラウザへ送る方式で、ユーザビリティ上の利点はあるものの、ブラウザ環境へのトークン直接露出が攻撃面を広げる、と Fett は述べます（詳細はシリーズ第 2 回、Aaron Parecki との OAuth 2.1 の回で扱われた）。RFC 9700 では「Implicit grant および、認可レスポンスでアクセストークンを発行するその他のレスポンスタイプは使用 SHOULD NOT」とされ、送信者拘束などで漏えい・インジェクションを防げる場合を除き避けるべきとされています。

#### 推奨 2: 認可コードグラントでは PKCE を必須に

Fett が強調するのは、PKCE の役割が「コード横取り対策」にとどまらず **コードインジェクション攻撃への防御** である点です。

- クライアントは認可リクエストごとに一意の code verifier と code challenge を生成する
- AS は、そのコードが結び付いた code challenge に一致する場合にしかコードを受け付けない
- 攻撃者が不正なコードを注入しても、正規の code challenge と対応しないため無効になる

そしてこれを **機密クライアントかパブリッククライアントかを問わず** 適用すべきだとしています。

コードインジェクションの流れを図にすると、PKCE がどこで効くかが分かります。

```text
[攻撃者] 自分で認可フローを開始 → 自分のアカウントのコード C_att を入手
         (C_att は攻撃者の code_challenge にしか結び付いていない)

[被害者のブラウザ] クライアントの認可開始 → 被害者用 code_verifier V_vic を生成・保持
[攻撃者] 何らかの手段で被害者のコールバックに C_att を差し込む
         https://app.example/cb?code=C_att&state=...

[クライアント] POST /token code=C_att & code_verifier=V_vic
[AS]      SHA256(V_vic) ≠ C_att に紐づく challenge → 拒否
```

PKCE が無ければ、クライアントは C_att を正常に交換し、被害者のセッションが攻撃者のアカウントに紐付く（ログイン CSRF 的な被害、あるいは攻撃者のリソースへ被害者のデータが書き込まれる）ことになります。

#### 推奨 3: 送信者拘束か、リフレッシュトークンのローテーション

- **アクセストークンの送信者拘束**: トークンを特定クライアントに結び付け、漏えいしても悪用できなくする（詳細は同シリーズ第 1 回、Brian Campbell の回）。
- **リフレッシュトークンのローテーション**: 送信者拘束が難しい場合は、自動的な失効と差し替えによって漏えい時の被害範囲を限定する。

> 出典: Auth0「Identity, Unlocked… Explained | Episode 4」（Security BCP with Daniel Fett） — https://auth0.com/blog/identity-unlocked-explained-episode-4/

---

### 5. RFC 9700 の主要規定を攻撃ごとに整理する

（以下は上記4資料に登場する要点を、RFC 9700 本文の構成に沿って一般知識に基づき補足・整理したものです。原文の最終確認は https://www.rfc-editor.org/rfc/rfc9700 で行ってください。）

RFC 9700 は §2「推奨事項」で要点を示し、§4「攻撃と緩和策」で個々の攻撃を解説する構成です。本教科書の前章までで扱った攻撃と対応付けると、次のようになります。

| 攻撃（本書の関連章） | RFC 9700 の主な対策 |
|---|---|
| redirect_uri 操作・オープンリダイレクト連鎖（第2〜3章） | redirect_uri は **完全一致**（ネイティブのループバックはポートのみ可変）。クライアントも AS もオープンリダイレクタになってはならない |
| Referer / ブラウザ履歴からの漏えい | 認可レスポンス後のページで第三者リソースを読ませない、`Referrer-Policy` の適用、フォームポスト応答の利用、コードの一回限り化と短寿命化 |
| mix-up 攻撃（第2章） | 複数 AS と連携するクライアントは、応答がどの AS から来たか検証する。**`iss` 認可レスポンスパラメータ（RFC 9207）** または AS ごとに異なる redirect_uri を使う |
| 認可コードインジェクション | **PKCE**（パブリッククライアントは MUST、機密クライアントも SHOULD、OpenID Connect の `nonce` で代替可能な場合あり）。AS は PKCE をサポート MUST |
| PKCE ダウングレード | 認可リクエストに `code_challenge` が無かったのにトークン要求で `code_verifier` が来たら、AS は拒否しなければならない |
| アクセストークンインジェクション | Implicit を使わない（トークンを認可レスポンスで返さない） |
| CSRF（ログイン CSRF 含む） | PKCE、OIDC `nonce`、または一回限りの `state` のいずれかで防ぐ |
| トークン漏えい・リプレイ | 送信者拘束（mTLS / DPoP）を推奨。アクセストークンは **audience 制限**（特定リソースサーバー向け）と **権限の最小化**（scope・`authorization_details` 等） |
| リフレッシュトークン窃取 | パブリッククライアントは送信者拘束またはローテーション |
| ROPC によるパスワード露出 | Resource Owner Password Credentials grant は使用 MUST NOT |
| 307 リダイレクトでの資格情報再送 | AS がログインフォームの POST 後にリダイレクトする際 **307 を使わない**（303 を使う）。307 だとブラウザが ID/パスワード入りの POST ボディをそのままクライアントへ再送してしまう |
| クリックジャッキング | 認可画面に `X-Frame-Options` / CSP `frame-ancestors` |
| クライアントがリソースオーナーになりすます（client_id と sub の衝突） | client_credentials で得たトークンの主体と、ユーザー主体を混同しないよう識別子の衝突を防ぐ |

307 の項目は「なぜ」が分かりにくいので補足します。HTTP 307 は「メソッドとボディを変えずに再送せよ」という意味です。ユーザーが AS のログインフォームに ID とパスワードを POST し、AS がその応答として 307 で `redirect_uri` へ飛ばすと、ブラウザはパスワード入りのボディをそのままクライアントへ POST します。悪意あるクライアントはこれでユーザーのパスワードを手に入れられます。303 なら GET に変換されボディは捨てられます。

mix-up 対策の `iss` パラメータ（RFC 9207）は、認可レスポンスに発行元 AS の識別子を含める仕組みです。

```text
https://client.example/cb?code=xyz&state=abc&iss=https%3A%2F%2Fhonest-as.example
```

クライアントは「このフローを開始したときに選んだ AS」と `iss` を突き合わせ、一致しなければ処理を中止します。攻撃者の AS に向けたつもりのフローに正規 AS のコードが紛れ込む、という mix-up の核心部分がここで断たれます。

---

### 6. OAuth 2.0 → 2.1（BCP）移行チェックリスト（防御側）

最後に、ここまでの内容を自組織の実装レビューで使える形にまとめます（自分が管理権限を持つシステムに対して実施してください）。

**認可サーバー**

- [ ] redirect_uri を登録値と **完全一致** で比較している（ループバック以外でポートやパスを緩めていない）
- [ ] PKCE をサポートし、`S256` を受け付ける。パブリッククライアントには PKCE を強制している
- [ ] `code_challenge` 無しで開始されたフローに `code_verifier` が来たら拒否する（ダウングレード防止）
- [ ] 認可コードは一回限り・短寿命。再利用を検知したら、そのコードで発行したトークンを失効
- [ ] `response_type=token`（Implicit）と `grant_type=password` を無効化
- [ ] 認可レスポンスに `iss` を付与し、AS Metadata で `authorization_response_iss_parameter_supported` を公開
- [ ] パブリッククライアントのリフレッシュトークンはローテーション（再利用検知でファミリー失効）または DPoP/mTLS で拘束
- [ ] ログイン後のリダイレクトで 307 を使っていない
- [ ] 認可画面にフレーミング防止ヘッダーを付与

**クライアント**

- [ ] 認可コード + PKCE（`S256`）を使っている（機密クライアントも含む）
- [ ] `state`（または PKCE / `nonce`）で CSRF を防いでいる
- [ ] 複数 AS と連携する場合、`iss` もしくは AS ごとの redirect_uri で mix-up を防いでいる
- [ ] コールバックページで第三者スクリプトや画像を読み込まず、`Referrer-Policy` を設定している
- [ ] コールバックページがオープンリダイレクタになっていない
- [ ] アクセストークンをクエリ文字列で送っていない（`Authorization: Bearer` を使用）
- [ ] 新しく発行されたリフレッシュトークンを毎回保存し直している

**リソースサーバー**

- [ ] トークンの audience と scope を検証している
- [ ] 送信者拘束トークン（DPoP / mTLS）の場合、証明（DPoP proof の署名・`htm`/`htu`・`jti`、または証明書のサムプリント）を検証している

---

### まとめ

- OAuth 2.1 は「新機能」ではなく、2012 年以降の RFC と Security BCP の合意事項を 1 本にまとめ、**危険な選択肢を仕様から削除** する整理版である（2026年9月時点ではドラフトとして参照）。
- 主要な変更は、PKCE 必須化、redirect_uri 完全一致、Implicit / ROPC 削除、クエリ文字列の Bearer Token 禁止、パブリッククライアントのリフレッシュトークンの送信者拘束またはローテーション、クライアント定義の簡素化の 7 点。
- Security BCP（RFC 9700 / BCP 240, 2025年1月）はコア仕様を上書きせず、その上に「安全な使い方」を規範として重ねる。三本柱は **Implicit 廃止・PKCE の全クライアント適用・送信者拘束またはリフレッシュトークンのローテーション**。
- PKCE は「コード横取り」だけでなく **コードインジェクション** を防ぐため、client_secret を持つ機密クライアントにも有効である。
- 本書の前章で扱った攻撃の多くは、これらの MUST を 1 つ守らなかった実装で成立する。検査やレビューでは「どの MUST が欠けているか」という視点で読むと、原因と対策が一対一で結び付く。

## DPoP（RFC 9449）による送信者制約トークン

OAuth 2.0 のアクセストークンは、長いあいだ **Bearer トークン**（持っている人なら誰でも使える「持参人払い」のトークン）として運用されてきました。Bearer という名前のとおり、`Authorization: Bearer <token>` を送ってきた相手が「正規のクライアントかどうか」はリソースサーバ（API）側では確認しません。トークンの文字列がそのまま「鍵」なのです。

そのため、次のような経路でトークンが漏れると、攻撃者はそのまま API を呼べてしまいます。

- XSS（クロスサイトスクリプティング）で `localStorage` のトークンを読み出される
- ログ、APM（性能監視）やエラー報告ツールにヘッダごと記録される
- リダイレクト URI やリファラ経由で漏れる（Implicit フローの時代に多かった経路）
- 悪意ある、あるいは侵害されたリソースサーバが、受け取ったトークンを別の API に使い回す（トークンの再送、replay）

この問題に対する答えが **送信者制約トークン（sender-constrained token）** です。トークンを特定の鍵に結びつけておき、「その鍵を持っていることを証明できる送信者」だけが使えるようにします。これを **PoP（Proof-of-Possession、所持証明）** と呼びます。送信者制約の標準的な方式は次の2つです。

| 方式 | 仕様 | 結びつける対象 | 動作する層 |
|---|---|---|---|
| mTLS バインディング | RFC 8705 | クライアントの X.509 証明書 | TLS（トランスポート層） |
| **DPoP** | **RFC 9449（2023年9月）** | クライアントが生成した公開鍵（JWK） | HTTP / アプリケーション層 |

この節では、アプリケーション層で動く DPoP（Demonstrating Proof of Possession、所持証明のデモンストレーション）について、仕組み・メッセージの形・検証手順・実装時の落とし穴を解説します。

---

### 1. DPoP の全体像と基本の流れ

WorkOS の解説は、DPoP を「アクセストークンとリフレッシュトークンを、クライアントが持つ公開鍵/秘密鍵ペアに**バインド（結びつけ）**する、アプリケーション層の仕組み」と定義しています。クライアントは**トークン要求のたびに、そしてリソース要求のたびに**、新しい「証明 JWT（DPoP proof）」を秘密鍵で署名して送ります。トークンが盗まれても、攻撃者は秘密鍵を持っていないので正しい proof を作れず、トークンは使えません。

エンドツーエンドの流れは次の6ステップです。

1. **鍵ペアを作る**: クライアントは非対称鍵ペア（一般的には楕円曲線 P-256）を生成し、保存しておく。
2. **トークン要求に proof を付ける**: 認可コードをトークンに交換するとき、`DPoP` HTTP ヘッダに proof JWT を載せる。
3. **認可サーバが鍵を刻む**: 認可サーバ（AS）は proof を検証し、proof に含まれる公開鍵の **JWK SHA-256 サムプリント**（鍵の指紋。RFC 7638 で定義された、JWK の必須メンバを正規化して SHA-256 したもの）を計算し、発行するトークンの `cnf.jkt` にその値を入れる。
4. **token_type が変わる**: トークンレスポンスの `token_type` は `Bearer` ではなく **`DPoP`** になる。
5. **API 呼び出しにも proof を付ける**: クライアントはアクセストークンと、**新しく作った** proof（アクセストークンのハッシュ `ath` を含む）の両方を送る。
6. **リソースサーバが照合する**: リソースサーバ（RS）は proof の署名を検証し、`htm`/`htu` が実際のリクエストと一致するかを確認し、proof の公開鍵のサムプリントがトークンの `cnf.jkt` と一致するかを確かめる。

図にすると次のようになります。

```text
 Client                         Authorization Server              Resource Server
   |  (0) 鍵ペア生成 (P-256)            |                                  |
   |                                    |                                  |
   |-- POST /token ------------------->|                                  |
   |   DPoP: <proof{htm=POST,htu=/token}>                                 |
   |   grant_type=authorization_code... |                                  |
   |                                    | proof検証 → jkt = SHA256(JWK)     |
   |<-- {access_token(cnf.jkt), -------|                                  |
   |     token_type:"DPoP", refresh_token}                                 |
   |                                                                       |
   |-- GET /resource ---------------------------------------------------->|
   |   Authorization: DPoP <access_token>                                  |
   |   DPoP: <proof{htm=GET,htu=/resource,ath=SHA256(token)}>              |
   |                                           署名検証・htm/htu・ath・     |
   |                                           thumbprint == cnf.jkt ?     |
   |<-- 200 OK ------------------------------------------------------------|
```

**なぜこれで盗難に強くなるのか。** 認可サーバがトークンに刻むのは公開鍵そのものではなく、その「指紋」（`cnf.jkt`）です。リソースサーバは、リクエストに付いてきた proof の公開鍵から指紋を計算し直し、トークン内の指紋と比べます。攻撃者が自分の鍵で proof を作れば、指紋が一致しません。正規クライアントの公開鍵を proof ヘッダに入れることはできても、その公開鍵に対応する**秘密鍵で署名する**ことはできません。つまり「トークン＋秘密鍵」がそろわないと API は通らず、トークン単体の価値はほぼなくなります。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 2. DPoP proof JWT の構造

DPoP proof は普通の JWS（署名付き JWT）ですが、ヘッダと内容に独自の決まりがあります。

#### 2.1 ヘッダ

```json
{
  "typ": "dpop+jwt",
  "alg": "ES256",
  "jwk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "...",
    "y": "..."
  }
}
```

- **`typ: "dpop+jwt"` は必須**です。この JWT が DPoP proof であることを明示し、ID トークンや JWT アクセストークン（`at+jwt`）など**別用途の JWT と取り違える攻撃**（token confusion。ある文脈で有効な JWT を別の文脈に持ち込む手口）を防ぎます。検証側は最初に `typ` を確認するべきです。
- **`alg` は非対称アルゴリズムに限られます**。`HS256` のような対称鍵アルゴリズムは**禁止**です。理由は単純で、HMAC は署名と検証に同じ秘密を使うため、「公開鍵をヘッダに載せて誰でも検証できるようにする」という DPoP の設計と両立しないからです。`none` も当然不可です。
- **`jwk` に公開鍵そのものを埋め込みます**。事前のクライアント登録や証明書（PKI）が不要なのはこのためです。検証側は「この JWT が、ヘッダに書かれた鍵で署名されているか」を確かめ、次にその鍵の指紋がトークンの `cnf.jkt` と合うかを見ます。RFC 9449 では、`jwk` に**秘密鍵の成分（EC の `d` など）を含めてはならない**とされています。

#### 2.2 ペイロード（トークンエンドポイント向け）

```json
{
  "jti": "c1d2e3f4-5678-9abc-def0-1234567890ab",
  "htm": "POST",
  "htu": "https://auth.example.com/oauth2/token",
  "iat": 1745107200
}
```

| クレーム | 意味 | なぜ必要か |
|---|---|---|
| `jti` | proof ごとに一意な ID | 同じ proof の使い回し（リプレイ）を検出するため。サーバは一定時間 `jti` を記録する |
| `htm` | HTTP メソッド（`POST`、`GET` など） | 別メソッドへの流用を防ぐ |
| `htu` | HTTP の対象 URI（**クエリ文字列とフラグメントを除く**） | 別エンドポイントへの流用を防ぐ |
| `iat` | 発行時刻 | 古い proof を拒否するため（有効期間を短くする） |

`htm` と `htu` によって、proof は「**この**メソッドで**この** URL に送る**この**1回のリクエスト」に限定されます。仮に proof がトークンと一緒に漏れても、別の API に転用することはできません。

#### 2.3 ペイロード（リソースサーバ向けに追加されるクレーム）

- **`ath`**: アクセストークンの SHA-256 ハッシュを base64url エンコードした値。
- **`nonce`**: サーバが発行した nonce（後述）を求められた場合に入れる。

**`ath` が必要な理由。** `ath` がないと、proof と一緒に送るトークンを入れ替えられてしまいます。たとえば、同じ鍵に紐づく「権限の小さいトークン」と「権限の大きいトークン」がある場合や、何らかの理由で事前に作られた proof が漏れた場合に、proof とトークンの組み合わせを変える余地が生じます。`ath` を入れることで、proof は**特定のアクセストークン1つ**にも結びつきます。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 3. HTTP 上での見え方

Auth0 のブログ（2023年12月22日公開）は、HTTP ヘッダの実例で流れを示しています。

**トークンエンドポイントへの要求**では、クライアントが鍵ペアを生成し、公開鍵・HTTP メソッド・URI を含む proof を作って、認可コードと一緒に送ります。

```http
POST /oauth/token HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded
DPoP: eyJhbGciOiJFUzI1NiIsInR5cCI6ImRwb3Arand0IiwiandrIjp7Imt0eSI6IkVDIiwiY3J2I...

grant_type=authorization_code&code=...&redirect_uri=...&code_verifier=...
```

`DPoP` ヘッダ値の先頭 `eyJhbGciOiJFUzI1NiIsInR5cCI6ImRwb3Arand0Iiwiandr...` を base64url デコードすると `{"alg":"ES256","typ":"dpop+jwt","jwk":{"kty":"EC","crv"...` になります。つまり先ほどのヘッダ構造そのものです。

認可サーバは proof の署名と、リクエスト内容（メソッド・URI）を検証し、**JWK サムプリントを埋め込んだアクセストークン**を返します。

**API 呼び出し**では、2つのヘッダを同時に送ります。

```http
GET /api/orders HTTP/1.1
Host: api.example.com
Authorization: DPoP eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K0pXVCIsImNuZiI6eyJqa3QiOiJybW56aTJvSWNYW...
DPoP: eyJhbGciOiJFUzI1NiIsInR5cCI6ImRwb3Arand0IiwiandrIjp7Imt0eSI6IkVDIiwiY3J2I...
```

ここで注目したい点が2つあります。

1. **認証スキームが `Bearer` ではなく `DPoP`** になっています。リソースサーバは「このトークンは DPoP 束縛されているので、proof の検証が必須」と判断できます。逆に、DPoP 束縛されたトークン（`cnf.jkt` を持つトークン）が `Bearer` スキームで送られてきたら、**拒否しなければなりません**。受け入れてしまうと、攻撃者は proof を付けずに Bearer としてトークンを使えてしまい、ダウングレード（保護の弱い方式への切り替え）が成立します。
2. Auth0 の例では、アクセストークン（JWT）のヘッダ部分をデコードすると `{"alg":"ES256","typ":"at+JWT","cnf":{"jkt":"rmnzi2oIcX...` のように、**`cnf.jkt` がトークン内部に含まれている**ことがわかります（一般的な実装では `cnf` はペイロード側のクレームです）。JWT 形式でないトークン（参照トークン）の場合、リソースサーバは RFC 7662 のイントロスペクション（トークン情報照会）エンドポイントから `cnf.jkt` を取得します。

API は、アクセストークンと proof の両方を検証して、「このリクエストが本来の送信者から来ている」ことを確認します。

> 出典: Auth0「OAuth 2.0 Security Enhancements」（2023-12-22） — https://auth0.com/blog/oauth2-security-enhancements/

---

### 4. 認可サーバとリソースサーバの検証手順

WorkOS の記事は、両サーバが実装すべき検証をまとめています。RFC 9449 の要件と照らし合わせて整理します。

#### 4.1 認可サーバ（トークンエンドポイント）

1. `DPoP` ヘッダがちょうど1つあり、1つの整形式 JWT であることを確認する。
2. **最初に `typ === "dpop+jwt"` を確認する**。
3. `alg` が非対称で、サーバがサポートするものであることを確認する（`none`、対称鍵は拒否）。
4. ヘッダ内の `jwk` を使って署名を検証する。
5. `iat` が許容範囲内かを確認する（**よく使われる窓は60秒程度**。時計のずれを考慮する）。
6. `jti` を記録して**リプレイを検知**する。
7. `htm`/`htu` が実際のリクエストと一致するかを確認する。
8. nonce を要求している場合は、`nonce` が有効かを確認する。
9. JWK の SHA-256 サムプリントを計算し、トークンの `cnf.jkt` に入れる。
10. サーバメタデータの **`dpop_signing_alg_values_supported`** で、サポートする署名アルゴリズムを公開する。

#### 4.2 リソースサーバ

1. `Authorization: DPoP <token>` を探す（`Bearer` ではない）。
2. トークンから `cnf.jkt` を取り出す（JWT なら中身から、そうでなければイントロスペクションで取得）。
3. proof の署名・`typ`・`alg`・`iat`・`jti`・`htm`/`htu` を検証する（手順は AS と同じ）。
4. **`ath` が、提示されたアクセストークンの SHA-256 ハッシュと一致するか**確認する。
5. **proof の JWK サムプリントが `cnf.jkt` と一致するか**確認する。

エラー時、RFC 9449 ではリソースサーバが `WWW-Authenticate: DPoP error="invalid_dpop_proof", algs="ES256 PS256"` のようにチャレンジを返す形が定められています（`algs` はサポートするアルゴリズムの一覧）。

**`htu` の比較についての注意。** `htu` はクエリとフラグメントを**除いた** URI です。リバースプロキシや API ゲートウェイの背後にあるサーバは、自分が受け取った内部 URL（例: `http://10.0.0.5:8080/orders`）ではなく、**クライアントが実際に送った外部 URL**（`https://api.example.com/orders`）と比較する必要があります。ここの比較ミスは、正規の要求が失敗する原因にも、比較を緩めすぎた結果の抜け穴にもなりがちです。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 5. サーバ発行 nonce によるリプレイ対策の強化

`jti` と `iat` だけでは、「**未来の時刻の proof をあらかじめ作っておく**」攻撃に弱いという問題があります。たとえば XSS でクライアント側のコードを一時的に実行できた攻撃者は、秘密鍵そのもの（非抽出の鍵）は持ち出せなくても、**後で使う proof を大量に署名させて持ち出す**ことができます。そこで RFC 9449 は、任意機能として **サーバ発行 nonce** を用意しています。nonce はサーバが決める値なので、クライアントが事前に予測して proof に入れることはできません。

流れは次のとおりです。

1. クライアントが nonce なし（または古い nonce）で要求する。
2. サーバが **`400 invalid_dpop_proof`**（認可サーバの場合は `use_dpop_nonce` エラー）と **`DPoP-Nonce` ヘッダ**を返す。
3. クライアントは、その nonce を `nonce` クレームに入れた proof を作り直して再送する。
4. サーバはその後のレスポンスヘッダで、定期的に新しい nonce を配る（ローテーション）。

```http
HTTP/1.1 400 Bad Request
DPoP-Nonce: eyJ7S_zG.eyJH0-Z.HX4w-7v
Content-Type: application/json

{"error":"use_dpop_nonce","error_description":"Authorization server requires nonce in DPoP proof"}
```

実装上の重要な注意として、**認可サーバの nonce とリソースサーバの nonce は別物**です。クライアントは発行元ごとに別々に管理しなければなりません。一方の nonce をもう一方に送ると失敗します。

nonce を使うとリクエストが1往復増えることがありますが、サーバは nonce を時刻ベースで作るなどして、`jti` のサーバ側保存を軽くすることもできます（有効期間内の nonce に紐づく `jti` だけを記録すればよいため）。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 6. ブラウザでの鍵の保管 — 非抽出鍵と IndexedDB

DPoP の効果は、**秘密鍵が盗まれないこと**に完全に依存します。ブラウザ（SPA）では、Web Crypto API で**非抽出（non-extractable）**の鍵を作るのが定石です。

```javascript
const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  false,              // non-extractable
  ["sign", "verify"]
);
```

- 第2引数 `false` が「抽出不可」の指定です。こうして作った `CryptoKey` は**署名には使えますが、エクスポートはできません**。そのため、XSS が起きても秘密鍵のバイト列そのものは持ち出せません。
- `CryptoKeyPair` は **IndexedDB** に保存します（`CryptoKey` オブジェクトは構造化複製が可能なので、非抽出のまま永続化できます）。**`localStorage` には保存しません**。`localStorage` は文字列しか保存できないので、保存するには鍵をエクスポートする、つまり抽出可能にする必要があり、XSS で読み出せてしまいます。

**限界も理解しておく。** 非抽出鍵は「鍵の持ち出し」を防ぎますが、XSS が有効な間は、攻撃者がページ内で `crypto.subtle.sign` を呼んで**その場で** proof を作り、正規のトークンで API を叩くことは防げません。前節の nonce は、「後で使う proof の事前生成」を難しくして、被害を**XSS が生きている間**に限定するためのものです。DPoP は XSS 対策そのものではなく、**トークン流出の被害を小さくする多層防御**の1つだと位置づけてください。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 7. リフレッシュトークンの束縛

WorkOS は「**リフレッシュトークンも DPoP 束縛される**」点を落とし穴として挙げています。RFC 9449 では次のように整理されています。

- **パブリッククライアント**（SPA やネイティブアプリなど、クライアントシークレットを安全に持てないクライアント）: リフレッシュトークンは DPoP 鍵に束縛されます。リフレッシュ時にも同じ鍵で署名した proof が必要なので、**リフレッシュトークンだけが盗まれても使えません**。パブリッククライアントでは、リフレッシュトークンの盗難がもっとも深刻な被害（長期間のなりすまし）につながるため、ここが DPoP のもっとも大きな価値の1つです。
- **コンフィデンシャルクライアント**: リフレッシュトークンはもともとクライアント認証に結びついているので、DPoP 鍵には束縛されません（鍵のローテーションが可能）。

実装上の帰結として、パブリッククライアントで**鍵ペアを失う**（IndexedDB がクリアされる、再生成してしまう）と、リフレッシュトークンも使えなくなり、再ログインが必要になります。鍵は「アクセストークンの寿命」ではなく「**リフレッシュトークンの寿命**」の間、保持し続ける設計にする必要があります。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 8. DPoP と mTLS（RFC 8705）の比較

| 観点 | mTLS（RFC 8705） | DPoP（RFC 9449） |
|---|---|---|
| 層 | トランスポート（TLS） | アプリケーション（HTTP ヘッダ内の JWT） |
| 束縛対象 | X.509 クライアント証明書 | クライアント生成の公開鍵（JWK） |
| 運用コスト | PKI、証明書のライフサイクル管理、TLS 終端の制御が必要 | PKI 不要、証明書管理不要、TLS 再設定不要 |
| ブラウザ / モバイル | ブラウザや多くのモバイル SDK では実質使えない | どのプラットフォームでも動く |
| 実装負担 | TLS インフラ側 | JWT 処理と `jti` によるリプレイ管理 |

WorkOS は mTLS を「堅牢（robust）」と評価しつつも、PKI の運用と TLS 終端の制御が必要で、ブラウザでは使えないと指摘しています。DPoP は「PKI も証明書ライフサイクルも TLS の再設定も不要」ですが、JWT の処理とリプレイ追跡をアプリケーション側で実装する必要があります。

**なぜ「アプリケーション層」なのか。** かつては TLS 層でトークンを束縛する **Token Binding** が検討されましたが、主要ブラウザでのサポートが進まず失敗しました。TLS 終端がロードバランサや CDN にあると、証明書の情報がアプリケーションまで届かないという実務上の問題もあります。DPoP は HTTP ヘッダに証明を載せるので、TLS 終端の位置に左右されず、ブラウザの JavaScript からも使えます。これが「Token Binding が残した穴を埋める」と言われる理由です。

**FAPI 2.0**（金融グレード API のセキュリティプロファイル）は、送信者制約の方式として **mTLS と DPoP のどちらも認めて**います。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 9. 採用状況（2025年ごろの WorkOS 記事時点）

- **Bluesky / AT Protocol（atproto）の OAuth**: すべての要求で DPoP を**必須**とし、サーバ発行 nonce、PAR（Pushed Authorization Requests）、PKCE も必須にしています。
- **FAPI 2.0**: 金融グレード API 向けに、mTLS と DPoP を同等に認めています。
- **OAuth 2.1 と MCP（Model Context Protocol）**: AI エージェントを含むパブリッククライアントに対して、送信者制約トークンを推奨する方向です。

※ OAuth 2.1 は執筆時点ではまだ IETF ドラフトです。MCP の認可仕様も改訂が続いています。「必須」なのか「推奨」なのかは、参照する版で必ず確認してください。

> 出典: WorkOS「DPoP (RFC 9449) explained」 — https://workos.com/blog/dpop-rfc-9449-explained

---

### 10. 補足: Step-up 認証（RFC 9470）との組み合わせ

Auth0 の記事は、DPoP と並ぶ強化策として **OAuth 2.0 Step-Up Authentication Challenge Protocol（RFC 9470）** も紹介しています。DPoP が「**誰が**トークンを使っているか」を強くするのに対し、Step-up は「**どれだけ強く**ユーザーが認証されたか」を API 側で要求する仕組みです。

流れは次のとおりです。

1. クライアントが、重要な操作をする API（例: 送金）をアクセストークン付きで呼ぶ。
2. API はトークンから認証情報を取り出す。
3. 要件を満たしていなければ、必要な認証条件をエラーで返す。
4. クライアントは、その条件を満たす新しいアクセストークンを取得しにいく。

要件には次の2種類があります。

- **ACR（Authentication Context Class Reference、認証の強度クラス）**: 多要素認証などの必要な認証方式。JWT アクセストークンでは `acr` クレームで表されます。
- **最大認証経過時間（max age）**: 最後にユーザーが能動的に認証してからの経過時間。JWT では `auth_time` クレームを使います。

RFC 9470 では、エラーは次のような形になります（Auth0 記事ではなく RFC 本文にもとづく例）。

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="insufficient_user_authentication",
  error_description="A different authentication level is required",
  acr_values="myACR"
```

クライアントは、`acr_values` や `max_age` を付けて認可リクエストをやり直します。DPoP を使っている場合は、スキームが `DPoP` になるだけで考え方は同じです。高リスク操作では「**DPoP で盗難トークンを無力化し、Step-up で認証強度を担保する**」という組み合わせが有効です。

> 出典: Auth0「OAuth 2.0 Security Enhancements」（2023-12-22） — https://auth0.com/blog/oauth2-security-enhancements/

---

### 11. 図解で理解する DPoP（Takahiko Kawasaki）

> ⚠️ **未取得の資料**: 「Illustrated DPoP (OAuth Access Token Security Enhancement)」（Takahiko Kawasaki, Medium）は自動取得できませんでした（理由: Medium が HTTP 403 Forbidden を返したため。Web 検索でも概要しか得られませんでした）。以下のURLからご自身で直接ご覧ください: https://darutk.medium.com/illustrated-dpop-oauth-access-token-security-enhancement-801680d761ff

（以下は未取得資料の補足として一般知識に基づく解説です）

検索結果から確認できた範囲では、この記事は **2020年4月**、つまり RFC 9449 として成立する（2023年9月）前の**ドラフト段階**に書かれた図解記事です。要点は次のとおりです。

- 従来の OAuth では、API は「アクセストークンが有効か」だけを確認する。DPoP では、それに加えて「**トークンを提示したクライアントが、そのトークンの正当な所有者か**」も確認する。
- クライアントは公開鍵をサーバに提示する。認可サーバはその公開鍵をアクセストークンに関連づけ、リソースサーバはトークンがその公開鍵に束縛されていることを検証する。
- クライアントは秘密鍵で署名した DPoP proof JWT を作り、両方のサーバに提示する。

**陳腐化への注意。** 2020年のドラフトと最終版の RFC 9449 には、次のような違いがあります。古い図解を読むときは、以下を最新仕様で補ってください。

- **`ath` クレーム**（アクセストークンのハッシュ）: 初期ドラフトにはなく、後から追加された。
- **サーバ発行 `nonce` と `DPoP-Nonce` ヘッダ**: これも後から追加された。同じ著者の続編「DPoP Nonce」（https://darutk.medium.com/dpop-nonce-9787b9d276d1 ）が、この仕組みを扱っている。
- **認可コードの束縛 `dpop_jkt`**: 最終版では、認可リクエストに `dpop_jkt` パラメータ（使う予定の鍵のサムプリント）を入れることで、**認可コード自体を鍵に束縛できる**。これにより、認可コードが横取りされても別の鍵ではトークンに交換できない。PAR と組み合わせる場合は、PAR のリクエストに `DPoP` ヘッダを付ける方法もある。
- `token_type: "DPoP"`、`Authorization: DPoP` スキーム、`cnf.jkt`、メタデータ `dpop_signing_alg_values_supported` などの名前は、最終版の RFC 9449 に従う。

JWK サムプリント（`jkt`）の計算方法（RFC 7638）も確認しておきます。EC 鍵の場合は、**必須メンバだけ**（`crv`、`kty`、`x`、`y`）を**辞書順**に並べ、**空白なし**の JSON にして SHA-256 を取り、base64url エンコードします。

```text
input  = {"crv":"P-256","kty":"EC","x":"<x>","y":"<y>"}
jkt    = BASE64URL( SHA-256( UTF8(input) ) )
```

メンバを限定し、並び順を固定するのは、`kid` や `use` のような任意メンバの有無、キーの順序、空白の違いによって同じ鍵の指紋が変わらないようにするためです。検証側は必ずこの正規化手順で計算し直して比較します。

> 出典: Takahiko Kawasaki「Illustrated DPoP (OAuth Access Token Security Enhancement)」（Medium, 2020） — https://darutk.medium.com/illustrated-dpop-oauth-access-token-security-enhancement-801680d761ff

---

### 12. 実装チェックリストと防御側の観点

WorkOS が挙げる「よくある実装ミス」に、RFC 9449 の要件を加えて、防御側（設計・レビュー・診断）のチェックリストとして整理します。

| # | 確認項目 | 不備があるとどうなるか |
|---|---|---|
| 1 | `typ` が `dpop+jwt` であることを検証している | 別用途の JWT を proof として受け入れてしまう |
| 2 | `HS256`・`none` などを拒否し、許可リストで `alg` を制限している | 署名検証の迂回や、アルゴリズム混同 |
| 3 | `jwk` に秘密鍵成分がないことを確認している | 仕様違反、鍵の漏えい |
| 4 | `jti` をサーバ側で一定期間記録し、一意性を検証している | 同じ proof のリプレイ |
| 5 | `iat` に許容窓（例: 約60秒）と時計ずれへの配慮がある | 窓が広すぎると古い proof が使える。狭すぎると正規要求が失敗する |
| 6 | `htm`/`htu` を外部から見た実 URL（クエリとフラグメントを除く）と比較している | proof を別エンドポイントへ転用される |
| 7 | RS で `ath` を検証している | proof とトークンの組み合わせを差し替えられる |
| 8 | RS で proof の JWK サムプリントと `cnf.jkt` を比較している | 攻撃者の鍵で作った proof が通る（DPoP の意味がなくなる） |
| 9 | `cnf` 付きトークンの `Bearer` スキームでの提示を拒否している | proof なしで使えるダウングレード |
| 10 | パブリッククライアントのリフレッシュトークンを束縛している | 盗まれたリフレッシュトークンで長期間なりすまされる |
| 11 | ブラウザでは非抽出鍵を IndexedDB に保存している | XSS で秘密鍵を持ち出される |
| 12 | 必要に応じてサーバ発行 nonce を使っている（AS と RS で別管理） | proof を事前に作られて持ち出される |
| 13 | **proof JWT をログや監視基盤に記録しない** | ログから proof やトークンを収集される |

診断やレビューでは、上の各項目について、**自分が管理する検証環境、または許可を得た対象の範囲内で**「検証を省略・緩和した場合に拒否されるか」を確かめるのが基本です（例: `ath` を外す、`htu` を別パスにする、`cnf` 付きトークンを `Bearer` で送る）。実在のサービスで許可なくこうした試行をしてはいけません。

**まとめ。** DPoP は、Bearer トークンの「持っていれば使える」という性質を、「**トークン＋秘密鍵の所持証明**」に変える仕組みです。その強さは次の3点で決まります。

1. サーバ側で**すべての検証項目を省略せずに**実装していること
2. クライアント側で**秘密鍵が持ち出せない**こと
3. **nonce とリフレッシュトークンの束縛**で、事前生成と長期悪用を抑えていること

mTLS が使えないブラウザやモバイル、AI エージェントといったパブリッククライアントにとって、DPoP は現在もっとも現実的な送信者制約の手段であり、FAPI 2.0 や OAuth 2.1 / MCP の流れの中で中心的な位置を占めつつあります。

## FAPI 1.0/2.0 — 金融グレードの API セキュリティ（PAR・mTLS・JARM）

この節では、OAuth 2.0 / OpenID Connect（OIDC）を「銀行の口座情報や送金指示を扱っても大丈夫な強さ」まで締め上げたセキュリティプロファイル **FAPI（Financial-grade API）** を扱います。FAPI は新しいプロトコルではありません。OAuth/OIDC の**選択肢を絞り、危険なオプションを禁止し、拡張仕様（PKCE・PAR・JAR・JARM・mTLS・DPoP など）の採用を義務づけた「使い方の規格」**です。

これまでの章で見てきた OAuth の典型的な脆弱性（認可コードの横取り、`redirect_uri` の検証漏れ、`state` 欠落による CSRF、アクセストークン漏えい、IdP Mix-Up など）が、FAPI ではそれぞれどの仕組みで塞がれているのかを対応づけて読むと、理解が一気に深まります。

> 用語メモ
> - **プロファイル**: 既存仕様の中から「必ずこれを使う／これは使わない」を決めた適用ルール集。
> - **AS（Authorization Server, 認可サーバー）** / **RS（Resource Server, API サーバー）** / **クライアント**（API を呼ぶアプリ）。
> - **送信者制約トークン（sender-constrained token）**: トークンを「持っているだけ」では使えず、発行時に紐づけた鍵を持つ者だけが使えるようにしたトークン。対義語は **Bearer トークン**（持参人払い＝拾った人でも使える）。

---

### 1. FAPI とは何か — 位置づけとバージョン

#### 1.1 誰が作っているか

FAPI は OpenID Foundation の **FAPI Working Group**（旧称 Financial-grade API Working Group）が策定しています。Curity はこれを「データを保護する際に最も強いセキュリティ設計パターンを用いること」と表現しています。当初は金融（オープンバンキング）向けでしたが、現在は医療・行政・保険など「高価値データを扱う API 全般」に対象が広がっており、名称の "Financial-grade" も「金融専用」ではなく「金融レベルの強度」という意味で理解するのが適切です。

#### 1.2 FAPI 1.0 の 2 つのプロファイル

| プロファイル | 想定用途 | 要点 |
|---|---|---|
| **Baseline（Part 1）** | 読み取り（口座残高・明細の参照など） | PKCE、`state`/`nonce`、厳格な `redirect_uri` 照合など、OAuth の基本的な穴埋め |
| **Advanced（Part 2）** | 読み書き（送金指示など） | JAR（署名付きリクエスト）必須、Hybrid Flow（`code id_token`）または JARM による応答の完全性保護、mTLS による送信者制約トークン、`private_key_jwt`/mTLS によるクライアント認証 |

FAPI 1.0 は 2021 年に最終化され、**UK Open Banking、オーストラリアの Consumer Data Right（CDR）、ブラジル Open Banking** など多くの規制エコシステムが「FAPI 1.0 Advanced」を採用しました（Auth0・Zuplo 記事）。

#### 1.3 FAPI 2.0 の構成

FAPI 2.0 は FAPI 1.0 の「足し算」ではなく**作り直し**です。Auth0 の記事は FAPI 2.0 の仕様群を 3 つに分けて説明しています。

1. **Attacker Model（攻撃者モデル）** — どんな攻撃者を想定し、何を守るのかを明文化した文書
2. **Security Profile（セキュリティプロファイル）** — 攻撃者モデルに対するセキュリティ目標を達成するための必須要件（ベースライン）
3. **Message Signing（メッセージ署名プロファイル）** — Security Profile に**否認防止（non-repudiation）**を追加する上位プロファイル

Auth0 記事（2025年8月6日公開）の時点で、Security Profile と Attacker Model は**最終仕様（Final）**として公開済みです。Message Signing の成熟度（Final かどうか）は時期により異なるため、採用時は OpenID Foundation の仕様一覧で最新ステータスを確認してください。

FAPI 1.0 の「Baseline / Advanced」という二段構えに対応させると、FAPI 2.0 では「Security Profile ≒ 攻撃者モデル上の脅威への防御（ベースライン）」「Message Signing ≒ 署名による否認防止を足した上位（アドバンスト）」という関係になります。

> 出典: Curity「What is Financial-Grade Security?」 — https://curity.io/resources/learn/what-is-financial-grade/
> 出典: Auth0「FAPI 2.0: The Future of API Security for High-Stakes Customer Interactions」 — https://auth0.com/blog/fapi-2-0-the-future-of-api-security-for-high-stakes-customer-interactions/

---

### 2. 攻撃者モデルとセキュリティ目標 — 「何から守るか」を先に決める

FAPI 2.0 の最大の思想的変化は、**攻撃者モデルを先に定義し、要件をそこから導く**ことです。FAPI 1.0 までは「過去に見つかった攻撃への対策を積み上げる」性格が強く、要件同士の関係や「なぜこれで十分なのか」が見えにくいという問題がありました。

Curity は攻撃者モデルが定める 4 つのセキュリティ目標を次のように整理しています。

| セキュリティ目標 | 防ぎたいこと |
|---|---|
| **Authorization（認可）** | 盗まれたアクセストークンの利用、権限のないリソースへのアクセス |
| **Authentication（認証）** | 身元の盗用、なりすまし |
| **Session Integrity（セッション完全性）** | CSRF、セッションハイジャック（被害者のブラウザに攻撃者の認可結果を注入する等） |
| **Non-repudiation（否認防止）** | リプレイ攻撃、メッセージ改ざん、「そんな指示は送っていない」という否認 |

攻撃者モデルには、ネットワーク上の攻撃者、攻撃者が用意した悪性の AS（Mix-Up 攻撃の加害側）、ログやブラウザ履歴・Referer から認可リクエスト/レスポンスを読める攻撃者、盗んだアクセストークンを使おうとする攻撃者などが含まれます（詳細は仕様本文）。

Zuplo の記事が強調するとおり、FAPI 2.0 は **University of Stuttgart の研究者による形式検証（formal verification）** で、この攻撃者モデルに対して目標を満たすことが証明されています。形式検証とは、プロトコルを数学的モデルに落とし込み、「想定した攻撃者がどう振る舞っても目標が破られない」ことを機械的・論理的に示す手法です。FAPI 1.0 も同研究グループの分析を受けており、その過程で見つかった問題点が FAPI 2.0 の設計に反映されています。

> 出典: Curity「What is Financial-Grade Security?」 — https://curity.io/resources/learn/what-is-financial-grade/
> 出典: Zuplo「FAPI 2.0 Explained」 — https://zuplo.com/learning-center/fapi-2-financial-grade-api-security-patterns

---

### 3. FAPI が義務づける構成要素 — 何を、なぜ

Curity の記事は、FAPI が要求する標準を「所持証明と紐づけ」「リクエスト/レスポンスの完全性」「クライアント認証」の 3 群に整理しています。ここではそれぞれを「どの攻撃を、どういう仕組みで止めるのか」まで掘り下げます。

#### 3.1 PKCE（RFC 7636）— 認可コードをクライアントに縛る

PKCE（Proof Key for Code Exchange）は、クライアントがランダムな `code_verifier` を作り、そのハッシュ `code_challenge` を認可リクエストに入れ、トークン交換時に元の `code_verifier` を提示する仕組みです。

```http
# 認可リクエスト（PAR 経由で送る内容の一部）
code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
&code_challenge_method=S256

# トークンリクエスト
grant_type=authorization_code
&code=...
&code_verifier=dBjftJeZ4CVP-mJ92K9DUdG9...（元の乱数）
```

**なぜ効くか**: 認可コードがリダイレクト経由で漏れても（ログ、Referer、悪性アプリによるカスタムスキーム横取りなど）、攻撃者は `code_verifier` を知らないためトークンに交換できません。さらに、攻撃者が**自分の認可コードを被害者のセッションに注入する「認可コード注入」**も、被害者側クライアントが持つ `code_verifier` と一致しないため失敗します。FAPI 2.0 では `S256`（SHA-256）方式のみが許され、`plain` は禁止です（`plain` だとチャレンジ自体が秘密値になり、漏れた時点で無意味になるため）。

#### 3.2 PAR（RFC 9126）— 認可リクエストをブラウザから追い出す

**PAR（Pushed Authorization Requests）** は、FAPI 1.0 Advanced では任意でしたが、**FAPI 2.0 Security Profile では必須**です（Auth0）。

通常の OAuth では、`client_id`・`redirect_uri`・`scope`・`code_challenge` などを**ブラウザの URL クエリ**に載せて AS に送ります。つまり、パラメータは

- ユーザー（あるいはブラウザ上のマルウェア・拡張機能）に改ざんされうる
- ブラウザ履歴、プロキシログ、`Referer` ヘッダに残りうる
- 長くなると URL 長制限に引っかかる

という問題を抱えています（Zuplo はこれを「パラメータ改ざん・ブラウザ履歴への記録・Referer 経由の漏えい」の解決として説明しています）。

PAR ではクライアントが**先にバックチャネル（サーバー間通信）で**パラメータを AS に POST し、受け取った参照値 `request_uri` だけをブラウザに渡します。

```http
POST /as/par HTTP/1.1
Host: as.example.com
Content-Type: application/x-www-form-urlencoded

client_id=s6BhdRkqt3
&response_type=code
&redirect_uri=https%3A%2F%2Fclient.example.org%2Fcb
&scope=accounts%3Aread
&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
&code_challenge_method=S256
&client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer
&client_assertion=eyJhbGciOiJQUzI1NiIs...
```

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "request_uri": "urn:ietf:params:oauth:request_uri:6esc_11ACC5bwc014ltc14eY22c",
  "expires_in": 60
}
```

```http
# ブラウザのリダイレクト先（パラメータは参照だけ）
GET /authorize?client_id=s6BhdRkqt3
  &request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3A6esc_11ACC5bwc014ltc14eY22c
```

**なぜ効くか（仕組み）**:

1. **クライアント認証済みの経路で受け付ける**: PAR エンドポイントはトークンエンドポイント同様にクライアント認証（`private_key_jwt` や mTLS）を要求します。つまり AS は「このパラメータは確かに正規クライアント本人が送った」ことを、**ユーザーがブラウザで何かする前に**確認できます。これにより、JAR で署名しなくても実質的な完全性・真正性が得られます。FAPI 2.0 で JAR が必須から外れた（Message Signing 側へ移った）のはこのためです。
2. **ブラウザに機微パラメータが流れない**: `request_uri` は不透明な参照値にすぎず、短い有効期限（FAPI 2.0 では 600 秒未満）で失効し、原則一回限りの利用です。
3. **`redirect_uri` の事前確定**: 攻撃者が URL 上の `redirect_uri` を書き換えて認可コードを自分のサーバーへ流す古典的攻撃が、構造的に成立しにくくなります。

#### 3.3 JAR（RFC 9101）と JARM — リクエストと応答に「署名」を付ける

- **JAR（JWT-Secured Authorization Request）**: 認可リクエストのパラメータを**クライアントが署名した JWT**（Request Object）にまとめて送る仕様。Auth0 は「メッセージレベル署名により、否認防止つきで認可リクエストパラメータの完全性を守る」と説明しています。FAPI 1.0 Advanced では必須、**FAPI 2.0 Security Profile では不要となり Message Signing へ移動**しました。
- **JARM（JWT Secured Authorization Response Mode）**: 認可**レスポンス**（`code` や `state`）を、平文クエリではなく**AS が署名（必要に応じて暗号化）した JWT**として返す仕様。FAPI 2.0 の基本 Security Profile では必須ではなく、**Message Signing プロファイルで必須**です（Zuplo）。

JARM レスポンスはおおむね次のような形になります（`response_mode=jwt` 等を指定）。

```http
HTTP/1.1 302 Found
Location: https://client.example.org/cb?response=eyJraWQiOiJsYWViIiwiYWxnIjoiRVMyNTYifQ...
```

```json
// response JWT のペイロード（デコード後）
{
  "iss": "https://as.example.com",
  "aud": "s6BhdRkqt3",
  "exp": 1311281970,
  "code": "PyyFaux2o7Q0YfXBU32jhw.5FXSQpvr8akv9CeRDSd0QA",
  "state": "S8NJ7uqk5fY4EjNvP_G_FtyJu6pUsvH9jsYni9dMAJw"
}
```

Zuplo はクレームの役割を次のように整理しています。

| クレーム | 防ぐ攻撃 | 仕組み |
|---|---|---|
| `iss` | **Mix-Up 攻撃** | クライアントは「どの AS から来た応答か」を署名つきで確認できるため、悪性 AS が正規 AS のコードを混入させても検知できる |
| `aud` | 別クライアントへのリプレイ | 宛先クライアントが固定されるため、他クライアント向け応答の流用を拒否できる |
| `exp` | リプレイの時間窓 | 応答の有効期限を短く限定 |

**なぜ署名が必要か**: 平文クエリの `code` と `state` は、経路上やブラウザ内で差し替えられても受け手には区別がつきません。署名があれば「AS が、このクライアント宛てに、この時刻に発行した」ことが暗号学的に検証でき、後日の紛争で証拠（否認防止）としても使えます。

> 補足（FAPI 1.0 Advanced の Hybrid Flow）: FAPI 1.0 Advanced では JARM の代わりに `response_type=code id_token` を使い、フロントチャネルで返る ID トークンを「**分離署名（detached signature）**」として使う方式も認められていました。ID トークン内の `c_hash`（コードのハッシュ）と `s_hash`（state のハッシュ）で、同じ応答内の `code` と `state` が改ざんされていないことを検証します。FAPI 2.0 ではこの Hybrid Flow は採用されず、`response_type=code` に一本化されています。

**Mix-Up 対策の補足（RFC 9207）**: Curity が挙げる **RFC 9207（Authorization Server Issuer Identification）** は、JARM を使わない場合でも認可レスポンスに `iss` パラメータを付与させる仕様です。FAPI 2.0 Security Profile ではこれにより、署名なしでも Mix-Up 攻撃を防げるよう設計されています。

```http
HTTP/1.1 302 Found
Location: https://client.example.org/cb?code=x1848ZT64p4IirMPT0R-X3141MFPTuBX-VFL_cvaplMH58&state=ZWVlNDBlYzA1NjdkMDNhYjg3ZjUxZjAyNGQzMTM2NzI&iss=https%3A%2F%2Fas.example.com
```

クライアントは「リクエストを送った AS の issuer」と応答の `iss` を厳密一致で比較し、不一致なら破棄します。

#### 3.4 クライアント認証 — 共有シークレットを捨てる

FAPI（1.0/2.0 共通）で認められるクライアント認証は次の 2 つだけです（Auth0・Zuplo）。`client_secret_basic` / `client_secret_post` のような**共有シークレット方式は使えません**。

1. **`private_key_jwt`**: クライアントが秘密鍵で署名した JWT（client assertion）をトークン/PAR エンドポイントに提示する。

```json
// client_assertion のペイロード例
{
  "iss": "s6BhdRkqt3",
  "sub": "s6BhdRkqt3",
  "aud": "https://as.example.com",
  "jti": "a3f9c2e1-...",
  "iat": 1735689600,
  "exp": 1735689660
}
```

   **なぜ強いか**: AS 側には公開鍵しか置かないため、AS のデータベースが漏れてもクライアントになりすませません。`jti`（一意 ID）と短い `exp` によりアサーション自体のリプレイも防ぎます。`aud` を AS の issuer に限定するのは、別の AS に同じアサーションを流用されるのを防ぐためです。

2. **mTLS（RFC 8705 の Mutual-TLS Client Authentication）**: TLS ハンドシェイクでクライアント証明書を提示させ、AS は事前登録した証明書（または信頼する CA＋サブジェクト DN 等）と照合する。

#### 3.5 送信者制約トークン — mTLS と DPoP

Zuplo の言葉を借りれば FAPI 2.0 では「**Bearer トークンはもはや受け入れられない。すべてのアクセストークンは、それを要求したクライアントに紐づけなければならない**」。その手段が mTLS か DPoP です。

##### (a) 証明書バインド（mTLS, RFC 8705）

AS はトークン発行時、TLS 接続で使われたクライアント証明書の SHA-256 サムプリントをトークンの `cnf`（confirmation）クレームに埋め込みます。Curity の例:

```json
{
    "cnf": {
        "x5t#S256": "FjeHcvJwiHXlr8dgnP7UvLQ7dLLMTe_3SgMYMuEpekc"
    }
}
```

RS（またはゲートウェイ）は、API 呼び出し時の **mTLS 接続で提示された証明書のサムプリント**を計算し、`cnf.x5t#S256` と一致するか確認します。**なぜ効くか**: トークンが漏れても、攻撃者は対応する秘密鍵を持たないため、その証明書で TLS ハンドシェイクを完了できません。所持証明を TLS 層がやってくれるので、アプリ層の追加実装が少なく済む一方、PKI 運用（証明書発行・失効・ローテーション）や、TLS 終端をどこで行うか（ロードバランサで終端すると RS まで証明書情報を安全に中継する必要がある）という運用課題があります。

##### (b) DPoP バインド（RFC 9449）

DPoP（Demonstrating Proof of Possession）はアプリ層で所持証明を行う方式です。Zuplo の説明する流れ:

1. クライアントが公開鍵/秘密鍵ペアを生成する
2. トークンリクエストに公開鍵を含める（DPoP 証明 JWT のヘッダ `jwk` として）
3. AS は公開鍵の **JWK サムプリント**を `cnf.jkt` としてトークンに埋め込む
4. クライアントは **API 呼び出しのたびに**、秘密鍵で署名した短命の DPoP 証明 JWT を作って送る
5. RS/ゲートウェイは証明の署名と、鍵がトークンの `jkt` と一致することを検証する

Curity の例:

```json
{
    "cnf": {
        "jkt": "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I"
    }
}
```

API 呼び出しは次のようになります。

```http
GET /accounts HTTP/1.1
Host: api.bank.example
Authorization: DPoP eyJhbGciOiJFUzI1NiIsImtpZCI6...
DPoP: eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7...
```

```json
// DPoP 証明 JWT（ヘッダ / ペイロード）
{ "typ": "dpop+jwt", "alg": "ES256", "jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." } }
{ "jti": "e1j3V_bKic8-LAEB", "htm": "GET", "htu": "https://api.bank.example/accounts",
  "iat": 1735689600, "ath": "fUHyO2r2Z3DZ53EsNrWBb0xWXoaNy59IiKCAqksmQEo" }
```

**なぜ効くか（各クレームの役割）**:

- `htm`（HTTP メソッド）と `htu`（URL）: 証明を**特定のリクエストに縛る**。盗んだ証明を別エンドポイントや別メソッドに流用できない。
- `iat` と `jti`: 短命＋一意 ID により、同じ証明の再送（リプレイ）を検知できる。
- `ath`: アクセストークンのハッシュ。証明を**特定のトークンに縛る**。
- 署名＋`jwk`: 秘密鍵を持つ者しか有効な証明を作れない。

Curity が指摘するとおり、DPoP を使うとアクセストークンは Bearer ではなく **DPoP トークン**になり（`Authorization: DPoP ...`）、DPoP JWT は短命で API 呼び出しごとに生成されます。Auth0 は、DPoP が mTLS より「**汎用的で取り組みやすい**送信者制約の選択肢」であり、FAPI 2.0 でリプレイ耐性を高める目的で採用されたと説明しています。mTLS と違い PKI や TLS 終端の問題に縛られないため、ブラウザや SPA、ゲートウェイ越しの構成でも導入しやすいのが利点です。

Zuplo はゲートウェイでの DPoP 検証の骨格を TypeScript で示しています（コメント部分が検証すべき項目の要約になっています）。

```typescript
import { ZuploContext, ZuploRequest } from "@zuplo/runtime";

export default async function validateDpopProof(
  request: ZuploRequest,
  context: ZuploContext,
) {
  const dpopHeader = request.headers.get("DPoP");
  if (!dpopHeader) {
    return new Response(JSON.stringify({ error: "missing_dpop_proof" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Verify: JWT signature, 'htm' claim matches HTTP method
  // Verify: 'htu' claim matches request URL
  // Confirm: key thumbprint matches token's 'jkt' claim
  return request;
}
```

これは雛形であり、実運用ではコメントの各項目に加えて **`typ` が `dpop+jwt` であること、`alg` が許可リスト内（`none` や HS 系を拒否）であること、`iat` の許容時間窓、`jti` の再利用検知（キャッシュ）、`ath` とアクセストークンの一致**まで検証しなければ防御になりません。特に「`DPoP` ヘッダの有無しか見ていない」「`jkt` 照合を省略している」実装は、送信者制約を名乗りながら実質 Bearer トークンと同じ強度になってしまう典型的な欠陥です。

> 出典: Curity「What is Financial-Grade Security?」 — https://curity.io/resources/learn/what-is-financial-grade/
> 出典: Zuplo「FAPI 2.0 Explained」 — https://zuplo.com/learning-center/fapi-2-financial-grade-api-security-patterns
> 出典: Auth0「FAPI 2.0: The Future of API Security for High-Stakes Customer Interactions」 — https://auth0.com/blog/fapi-2-0-the-future-of-api-security-for-high-stakes-customer-interactions/

#### 3.6 RAR と JWE（Auth0 の比較から）

- **RAR（Rich Authorization Requests, RFC 9396）**: `scope` という単なる文字列ではなく、`authorization_details` という構造化 JSON で「どの口座から、いくら、誰に送金するか」を表現する仕様。Auth0 は「認証・認可フローの中でユーザーにリッチな文脈を提示できる」と説明し、FAPI 2.0 Security Profile では**任意だが推奨**としています。ユーザーが「何に同意しているか」を正確に理解できることは、同意画面を悪用したソーシャルエンジニアリングへの対策にもなります。

```json
"authorization_details": [{
  "type": "payment_initiation",
  "instructedAmount": { "currency": "EUR", "amount": "123.50" },
  "creditorName": "Merchant A",
  "creditorAccount": { "iban": "DE02100100109307118603" }
}]
```

- **JWE（JSON Web Encryption）**: フロントチャネルのトークン（ID トークン等）に含まれる機微情報の暗号化。FAPI 1.0 Advanced では任意、FAPI 2.0 Security Profile では**不要**（PAR によってフロントチャネルに流れる情報自体が減ったため）。

---

### 4. FAPI 1.0 Advanced と FAPI 2.0 の比較

Auth0・Zuplo・Curity の記述をまとめると次のようになります。

| 項目 | FAPI 1.0 Advanced | FAPI 2.0 Security Profile | FAPI 2.0 Message Signing |
|---|---|---|---|
| 設計方針 | 既知攻撃への対策の積み上げ、選択肢が多い | 攻撃者モデルから導出・形式検証済み、選択肢を削減 | Security Profile＋否認防止 |
| レスポンスタイプ | `code id_token`（Hybrid）または `code`＋JARM | `code` のみ | `code`（＋JARM） |
| PKCE | （Baseline で必須、Advanced は実質併用） | 必須（S256） | 必須 |
| PAR | 任意 | **必須** | 必須 |
| JAR（署名付きリクエスト） | **必須** | 不要 | **必須** |
| JARM（署名付き応答） | Hybrid の代替として利用 | 不要（`iss` パラメータ/RFC 9207 で Mix-Up 対策） | **必須** |
| 送信者制約 | mTLS | **mTLS または DPoP** | 同左 |
| クライアント認証 | `private_key_jwt` または mTLS | 同左 | 同左 |
| パブリッククライアント | 規定あり（Baseline） | **対象外（機密クライアントのみ）** | 同左 |
| RAR | — | 任意・推奨 | 同左 |
| JWE | 任意 | 不要 | — |

読み解きのポイント:

- **「足した」より「減らした」が多い**: Zuplo が言うように、FAPI 1.0 では任意機能が多く、組み合わせごとに相互運用性・安全性の検証が必要でした。FAPI 2.0 は「任意を必須に、あるいは廃止に」して選択肢を減らし、Auth0 の言う**クライアント・AS・RS 間の相互運用性**を高めています。多数の銀行と多数のフィンテックが相互接続するオープンバンキングでは、選択肢の少なさ自体がセキュリティになります。
- **PAR が JAR の役割の多くを吸収**: クライアント認証つきのバックチャネルでパラメータを送れば、署名がなくても改ざん・偽装は防げます。署名が本当に必要なのは「第三者に対して後から証明したい」＝否認防止の場面だけなので、JAR/JARM は Message Signing に分離されました。
- **パブリッククライアントの扱い**: Curity によれば FAPI 2.0 はパブリッククライアント（秘密を保持できないアプリ）の要件を**スコープから外しました**。FAPI 1.0 の時代、モバイルアプリについては「PKCE を必須にしたうえで、Dynamic Client Registration によりアプリのインスタンスごとに機密クライアントを作り、各インスタンスが鍵ペアを生成して `private_key_jwt` で認証する」パターンが示されていました。

#### 4.1 FAPI 2.0 Security Profile の代表的な細則（仕様本文に基づく補足）

（以下は取得資料を補う一般知識に基づく解説です。数値は FAPI 2.0 Security Profile Final 版に基づきますが、採用時は必ず仕様原文を確認してください。）

- 認可コードの有効期間は **60 秒以内**（漏えい時の悪用窓を最小化）
- PAR の `request_uri` の有効期限（`expires_in`）は **600 秒未満**
- `redirect_uri` は**完全一致**で比較（部分一致・ワイルドカードは禁止。オープンリダイレクタ経由のコード窃取を防ぐ）
- 署名アルゴリズムは **PS256・ES256・EdDSA（Ed25519）** に限定（RS256 の PKCS#1 v1.5 や `none` は不可）
- TLS 1.2 以上、TLS 1.2 の場合は仕様指定の安全な暗号スイートのみ
- インプリシットフローや Resource Owner Password Credentials は使用不可
- AS は認可レスポンスで `iss` を返す（RFC 9207）

---

### 5. 認証とユーザー保護 — トークン以外の要素

Curity の記事は、プロトコル要件と並んで次の運用要素を FAPI の実装上の柱として挙げています。

#### 5.1 強力な顧客認証（SCA）

**多要素認証（MFA）は必須**で、次の 3 種類のうち 2 種類を組み合わせます。

- 知識要素（パスワードなど）
- 所持要素（スマートフォン、キーフォブなど）
- 生体要素（指紋・顔など）

EU の PSD2 が定める SCA（Strong Customer Authentication）と同じ考え方です。どれだけトークンを堅牢にしても、入口の本人確認が弱ければ正規の手順で攻撃者にトークンが発行されてしまうためです。

#### 5.2 ペアワイズ仮名識別子（PPID）

アプリに実際の個人データではなく、**アプリごとに異なる生成済みユーザー識別子**（Pairwise Pseudonymous Identifier）を渡します。氏名・メールアドレスなどの機微値は AS 側に保持し、必要な場合だけトークンで返します。**なぜ有効か**: 複数のアプリが同じユーザー ID を共有していると、アプリ同士の情報を突き合わせた名寄せ（トラッキング）が可能になるため、ID をアプリごとに分けることでプライバシーを守ります。

#### 5.3 コンテキストに応じた認証ポリシー

ユーザーの地理的位置、ログイン試行の頻度、現在進行中の脅威などを評価して、追加認証を要求したりブロックしたりします。

#### 5.4 クライアントアテステーション

認証を始める前に、そのクライアントが本物のアプリか（改ざん・エミュレータ・偽アプリでないか）を検証します。Web、iOS、Android それぞれのアテステーション機構が使われます。Curity はこれらを組み合わせた自社ソリューション（HAAPI: Hypermedia Authentication API。アテステーション、認証中の DPoP、多要素ワークフロー、アプリ内ログイン等を提供）を紹介していますが、これはベンダー固有の実装であり FAPI 仕様そのものではない点に注意してください。

> 出典: Curity「What is Financial-Grade Security?」 — https://curity.io/resources/learn/what-is-financial-grade/

---

### 6. API ゲートウェイでの強制 — RS 側でやるべきこと

FAPI の要件の多くは AS 側で満たされますが、**RS（API）側で送信者制約を検証しなければ、すべてが無意味**になります。AS が `cnf` を入れたトークンを発行しても、RS が `cnf` を見ずに署名と期限だけ確認していれば、盗まれたトークンはそのまま使えてしまうからです。

#### 6.1 Curity: ファントムトークンパターン

Curity は次の構成を推奨しています。

- リバースプロキシ（ゲートウェイ）が mTLS を終端し、クライアント証明書を検証する
- ゲートウェイが所持証明（mTLS または DPoP）を検証する
- ゲートウェイが公開鍵（またはそのサムプリント）をバックエンド API に転送する
- API は受け取った公開鍵と `cnf` クレームを**毎リクエスト**照合する
- スコープとクレームも毎回検証する

**ファントムトークンパターン**とは、外部クライアントには中身の読めない不透明（opaque）トークンを渡し、ゲートウェイがそれをイントロスペクションして内部向けの JWT に差し替えて API に渡す方式です。外部にクレーム（個人情報など）を晒さずに済み、失効も AS 側で即座に効かせられます。

**注意点（防御側の観点）**: ゲートウェイが TLS を終端して証明書情報を HTTP ヘッダ（例: `X-Client-Cert`）で内部に転送する構成では、**外部から同名ヘッダを送り込まれても上書き・除去する**設定が必須です。これを怠ると、攻撃者が任意の証明書情報をヘッダに入れて証明書バインドを偽装できてしまいます。

#### 6.2 Zuplo: ポリシーパイプライン

Zuplo は、ゲートウェイが検証すべき項目を「トークンの署名・有効期限・発行者・受信者（audience）・スコープ」に加えて「トークンの鍵に一致する有効な DPoP 証明」または「トークンの `cnf` と一致するクライアント mTLS 証明書のサムプリント」と整理し、次の順序のポリシーパイプラインを示しています。

1. mTLS Auth（クライアント証明書の検証。有効期限・失効チェックを含む）
2. JWT Auth（トークンの検証・デコード）
3. カスタム DPoP 検証（前掲の TypeScript）
4. JWT スコープ検証
5. リクエスト検証（OpenAPI スキーマで body・query・path・header を強制）
6. レート制限（ユーザー、API キー、IP、独自属性ごと）

スコープ検証の設定例:

```json
{
  "name": "fapi-scope-check",
  "policyType": "jwt-scopes-inbound",
  "handler": {
    "export": "JWTScopeValidationInboundPolicy",
    "module": "$import(@zuplo/runtime)",
    "options": {
      "scopes": ["accounts:read", "transactions:read"]
    }
  }
}
```

**なぜこの順序か**: 安価で決定的な検証（TLS 層の証明書）から始め、トークンの正当性 → そのトークンを「この送信者が」使ってよいか（DPoP/mTLS 照合）→ その操作をしてよいか（スコープ）→ リクエストの形が正しいか（スキーマ）→ 量の制御（レート制限）と、**「誰が」「何を」「どのように」**の順で絞り込んでいます。送信者制約の検証をスコープ検証より前に置くことで、盗まれたトークンによるリクエストを早期に落とせます。

> 出典: Zuplo「FAPI 2.0 Explained」 — https://zuplo.com/learning-center/fapi-2-financial-grade-api-security-patterns
> 出典: Curity「What is Financial-Grade Security?」 — https://curity.io/resources/learn/what-is-financial-grade/

---

### 7. 規制と採用の動向（時事情報・2025〜2026年時点）

各資料が挙げる採用状況をまとめます。規制の日付・対象は改定されやすいため、実務では必ず一次情報を確認してください。

| 地域 | 制度 | FAPI との関係（資料時点） |
|---|---|---|
| 英国 | UK Open Banking | FAPI 1.0 Advanced ベースのセキュリティプロファイル。FAPI 2.0 への移行が見込まれる（Zuplo） |
| EU | PSD2 | 2018 年から銀行 API の提供を義務化（Zuplo） |
| オーストラリア | Consumer Data Right（CDR） | 銀行（稼働中）・エネルギー・通信で FAPI 準拠を要求。FAPI 1.0 Advanced を参照し、FAPI 2.0 を「セキュリティ強化」として目標化（Zuplo・Auth0） |
| ブラジル | Open Banking/Open Finance | FAPI 1.0 Advanced を要求（Auth0） |
| コロンビア | Superintendencia Financiera de Colombia 外部通達 004/2024（2024年2月7日） | Open Finance に **FAPI 2.0 を義務化**（Auth0） |
| 米国 | CFPB Section 1033（消費者金融データ権ルール） | 対象機関に API 提供を義務化。最大手は **2026 年**から、小規模機関は **2030 年**まで段階適用（Zuplo。なお同ルールは見直し・訴訟の動きがあり、日程は変動しうる） |
| 北米 | FDX（Financial Data Exchange） | FAPI 要件に整合した相互運用標準を策定（Zuplo） |

Auth0 は「銀行を Web で操作したり、モバイルウォレットを銀行口座と連携したりするとき、利用者は知らないうちに FAPI で保護されたフローを使っている可能性が高い」と述べています。また Auth0 自身も Highly Regulated Identity（HRI）として FAPI 2.0 Security Profile の認証（certification）を取得し、FAPI 1.0 Advanced についても「PAR with Private Key JWT」「PAR with mTLS」の構成で認証を維持していると記しています。

**適合性テスト**: OpenID Foundation は FAPI の**適合性テストツール（conformance suite）**を提供しており、Zuplo はこれによる検証を推奨しています。自組織の AS/RS を検証する場合は、この公式テストスイートを**自分の管理下の環境**に対して実行するのが正攻法です（他者のサービスに対して許可なく実行してはいけません）。

---

### 8. 実装・レビュー時の落とし穴チェックリスト（防御側）

最後に、ここまでの内容を「FAPI を名乗る実装をレビューするときの観点」に落とし込みます。

- [ ] **ライブラリ対応**: Curity が指摘するように、標準的な OAuth ライブラリは DPoP・PAR・JAR・JARM を十分にサポートしていないことが多い。自前実装した部分（特に署名検証・`cnf` 照合）を重点的にレビューしたか
- [ ] **RS 側の `cnf` 照合**: `cnf.x5t#S256` / `cnf.jkt` を毎リクエスト検証しているか。`Authorization: DPoP` のトークンを `Bearer` として送られた場合に拒否しているか（ダウングレード防止）
- [ ] **DPoP 検証の網羅性**: `typ`、`alg` 許可リスト、`htm`/`htu` 一致、`iat` 時間窓、`jti` 再利用検知、`ath` 一致
- [ ] **PAR の強制**: AS が「PAR を経由しない認可リクエスト」を拒否しているか（PAR を"提供しているだけ"では URL 直書きのリクエストで迂回できる）
- [ ] **PKCE**: `S256` 限定、`plain` 拒否、`code_verifier` なしのトークン交換を拒否
- [ ] **`iss` 照合**: RFC 9207 の `iss` または JARM の `iss` を、リクエスト送信先 AS と厳密比較しているか（Mix-Up 対策）
- [ ] **`redirect_uri` 完全一致**
- [ ] **クライアント認証**: 共有シークレットが残っていないか。`private_key_jwt` の `aud`・`exp`・`jti` を検証しているか
- [ ] **署名アルゴリズム**: PS256/ES256/EdDSA に限定され、`none`・HS 系・RS256 が拒否されるか
- [ ] **TLS 終端とヘッダ転送**: ゲートウェイが転送する証明書ヘッダを外部から偽装できないか
- [ ] **有効期限**: 認可コード 60 秒以内、`request_uri` 600 秒未満、アクセストークンは短命

FAPI の本質は「新しい魔法」ではなく、**OAuth の既知の穴を一つずつ仕組みで塞ぎ、その組み合わせが十分であることを攻撃者モデルと形式検証で裏づけた**点にあります。個々の要件を「どの攻撃を、どういう原理で止めているのか」とセットで理解しておけば、FAPI 準拠を謳うシステムでも、どこが省略・誤実装されやすいかを見抜けるようになります。

## MCP の認可課題と日本語の実装解説（認可エンドポイント・トークン検証）

この節では、OAuth の「最新の応用先」と「昔からある実装ミス」を一緒に扱います。前半は、AI エージェントが外部ツールにつながるためのプロトコル **MCP（Model Context Protocol）** の認証・認可（AuthN/Z）に関する Doyensec の分析です。後半では日本語の実装解説を 2 本読みます。1 本は**認可エンドポイント**（ユーザーに同意させて認可コードを発行する窓口）、もう 1 本は**リソースサーバでのアクセストークン検証**（API がトークンを受け取ったときの確認処理）を扱います。

3 本を並べると共通点が見えてきます。MCP のような新しい構成でも、実際の事故の多くは次の 3 つに行き着きます。

- redirect_uri を正確に確認していない
- トークンの宛先（audience）を確認していない
- 外部から取り込んだメタデータを信頼しすぎている

どれも古くからある OAuth の失敗パターンです。

---

### 1. MCP の認証・認可が「悪夢」と呼ばれる理由（Doyensec）

#### 1.1 前提：MCP の認可モデルのおさらい

MCP は、LLM クライアント（Claude Desktop や IDE 拡張など）が **MCP サーバ**（ツールやリソースを提供する側）を呼び出すためのプロトコルです。リモートの MCP サーバでは OAuth 2.1 系の認可を使うことが仕様で定められています。記事は **MCP 仕様 2025-11-25 版** を前提にしています。仕様は SEP（Specification Enhancement Proposal、仕様改善提案）の積み重ねで毎回のように変わるため、読むときは必ず版を確認してください。

（以下は記事の前提を補うための一般知識に基づく整理です）2025-06-18 版以降の MCP 認可の登場人物と流れは、おおむね次のとおりです。

```text
MCPクライアント ──(1) 未認証でアクセス──▶ MCPサーバ(=リソースサーバ)
                 ◀─(2) 401 + WWW-Authenticate: resource_metadata="https://.../.well-known/oauth-protected-resource"
                ──(3) PRM(RFC 9728)取得 → authorization_servers を知る
                ──(4) 認可サーバのメタデータ(RFC 8414 / OIDC Discovery)取得
                ──(5) クライアント登録: DCR(RFC 7591) または CIMD(Client ID Metadata Document)
                ──(6) 認可コード + PKCE、resource パラメータ(RFC 8707)付きで認可 → トークン取得
                ──(7) Bearer トークンで MCP サーバを呼ぶ
```

この流れの特徴は、クライアントが**事前に面識のない**サーバから URL やメタデータを受け取り、それを信じて処理を進める点です。手順 (3)〜(5) で受け取る JSON はすべて相手が書いたものです。つまり外部から入ってくる値であり、ここが攻撃面になります。

#### 1.2 脅威の 3 分類

記事は MCP の脅威を「誰が悪意を持つか」で 3 つに分けています。

**(a) 悪意ある MCP サーバ**

- **Tool Poisoning（ツール汚染）**: ツール定義に悪意ある指示を仕込むこと。最初は無害な定義を見せておき、実行時に悪意ある実装へ差し替える手口は **Rug Pull（ラグプル）** と呼ばれます。
- **Tool Shadowing**: 注入したツール説明文によって、同じセッション内にある信頼済みツールの使われ方まで変えてしまうこと。
- **Schema Poisoning**: インタフェース定義（スキーマ）を改ざんし、モデルに誤った使い方をさせること。
- **ツール応答経由のプロンプトインジェクション**: MCP の応答に指示文を埋め込むこと。
- **リソース経由のデータ持ち出し**: サーバが公開するリソースを使って、クライアント側の機密情報を漏らさせること。

**(b) 悪意ある MCP クライアント**

- **コマンドインジェクション**: 細工した入力を、入力を無害化していない MCP サーバに送ること。例として CVE-2025-53100（RestDB Codehooks MCP Server）と CVE-2025-53818（GitHub Kanban MCP Server）が挙がっています。
- **コンテキストインジェクション／過剰共有**: セッション間の分離が不十分なため、別セッションの機密情報を引き出せること。
- **プロンプトインジェクション**: サーバ側の動作を変える入力を送ること。

**(c) 中継者の侵害**

- **MCP プロキシ／ゲートウェイ**: メッセージの改ざんやポリシーのすり抜け。
- **SSO 中継**: OAuth 2.0/2.1 の悪用。偽のメタデータを注入する、redirect URI を操作する、登録エンドポイントを乗っ取る、といった手口です。

#### 1.3 記事が挙げる既知の脆弱性

| 脆弱性 | 識別子 | 攻撃の方向性 |
|---|---|---|
| workers-oauth-provider の PKCE 回避 | CVE-2025-4144 | クライアント検証の不備 |
| redirect_uri 検証の不備 | CVE-2025-4143 | 認可コードの横取り |
| RestDB Codehooks MCP Server | CVE-2025-53100 | 無害化されていない入力によるコマンド注入 |
| GitHub Kanban MCP Server | CVE-2025-53818 | 同上 |
| mcp-remote の RCE | CVE-2025-6514 | 悪意あるメタデータ URI のスキーム |
| OpenMCP Client | CVE-2025-58062 | メタデータ探索（discovery）の操作 |
| Claude Code IDE 拡張 | GHSA-9f65-56v6-gxw7 | 認証のない localhost WebSocket |
| MCP Inspector | CVE-2025-49596 | 「localhost なら安全」を前提にした WebSocket 初期化 |

記事は識別子を挙げるだけで、攻撃手順の詳細までは書いていません。ここでは、仕組みとして特に重要な 2 つのパターンを掘り下げます。

##### パターン A：メタデータ注入 → OS のブラウザ起動処理 → コード実行

記事はこう指摘しています。**Protected Resource Metadata（PRM）** や OIDC Discovery の文書に悪意ある URI スキームを入れられるとします。すると、ブラウザを起動するクライアントが `open()` のような URL ハンドラにその値を渡し、任意のプロセスを起動させられてしまいます。

（以下は一般知識に基づく補足です）CVE-2025-6514 は、MCP クライアントとリモートサーバを中継する npm パッケージ `mcp-remote` の脆弱性です。サーバが返した `authorization_endpoint` の値をほぼ検証せずに OS の「URL を開く」処理へ渡していたことが原因で、特に Windows では細工した値からコマンド実行につながりました。0.1.16 で修正されています。原理は次のとおりです。

- 認可 URL は本来「ユーザーのブラウザで開く https の URL」のはずです。
- しかし OS の URL オープナーは `http(s)` 以外のスキームやシェル的な解釈も受け付けることがあります。
- 攻撃者が制御するサーバの JSON が、そのまま OS レベルの sink（入力が最終的に実行・解釈される危険な処理）に届いてしまいます。

防御の要点は次の 2 つです。

- 認可サーバのメタデータから取った URL は `https:` スキームに限定し、URL パーサで正規化してから開く。
- シェルを経由しない API で開く。

##### パターン B：「localhost は安全」という思い込み

記事の言葉では、多くの実装が `localhost` を安全だと考え、**認証なしで WebSocket サーバを起動していました**。そのため、同じ端末の他プロセスや DNS リバインディング（外部ドメインの名前解決先を途中で 127.0.0.1 に切り替え、ブラウザに同一オリジンだと誤認させる手法）で操作されてしまいます。

（補足）ブラウザの WebSocket には CORS のようなプリフライト制約がありません。そのため、悪意あるサイトの JavaScript から `ws://127.0.0.1:<port>` へ接続を試みることができます。MCP Inspector（CVE-2025-49596、0.14.1 で修正）や IDE 拡張の件はこの種の問題です。

防御の要点は次のとおりです。

- ランダムなセッショントークンを必須にする。
- `Origin` と `Host` ヘッダを検証する。
- 待ち受けは 127.0.0.1 のみにする。

#### 1.4 エンタープライズ向け拡張（ID-JAG）の構造的な問題

記事の後半では、コミュニティでレビュー中の **Enterprise-Managed Authorization Extension（ドラフト）** を検討しています。これは既存の企業 IdP（Okta や Entra ID など）を MCP の認可に使うための拡張で、**Identity Assertion JWT Authorization Grant（ID-JAG）** を使います。トークンは 3 段階で受け渡されます。

1. IdP が発行する **ID Token**：ユーザーが誰かを示す
2. IdP が発行する **ID-JAG**：「このユーザーとして、この MCP 認可サーバからトークンをもらってよい」という許可証
3. MCP 認可サーバが発行する **MCP アクセストークン**

この流れで重要なのは、**ユーザー向けの同意画面が挟まらない**ことです。記事は、ID-JAG ドラフトの問題を 5 つ指摘しています。

**問題 1：アクセスを取り消す仕組みがない**
MCP クライアントのアクセスを無効化したり、発行済みトークンを失効させたりする仕組みが明示されていません。エージェントの動作は非決定的（同じ入力でも毎回同じ行動になるとは限らない）です。記事は、エージェントがツールやリソースにアクセスすることのリスクは高く、暴走やインジェクションが起きたときの緊急停止手段が要ると述べています。

**問題 2：同意なしでスコープを使える**
IdP が発行する ID Token にはスコープが入っていません。記事の言葉では「MCP クライアントがユーザーに成りすませるよう、ユーザーの身元を述べるだけ」です。そのため、クライアントが `github:write slack:write` のような高リスクのスコープを要求しても同意ダイアログは出ず、企業ポリシーだけで可否が決まります。結果として **LLM が、タスクと関係なくても、企業ポリシーが許すスコープを自律的に要求できてしまう**、と記事は警告しています。通常の OAuth では「人間が同意画面で確認する」ことが安全装置になっていますが、それが外れているということです。

**問題 3：クライアント資格情報の扱いが決まっていない**
仕様には次の点の定めがありません。

- IdP がクライアント資格情報をどう発行・配布するか（共有シークレット、private_key_jwt、mTLS のどれか）
- 資格情報をどうローテーションするか
- `audience` クレームを特定の MCP 認可サーバにどう結び付けるか
- RFC 9728 に従って `resource` 識別子をどう検証するか

**問題 4：スコープ名の衝突**
IdP も MCP サーバも複数ある環境では、`files:read` や `admin:write` のようなスコープ名が重なることがあります。`aud` や `resource` を厳密に検証していないと、サーバ B 向けの低権限の ID-JAG を手に入れた攻撃者が、名前の重なりを利用してサーバ A にアクセスできる可能性があります。これは後半の 3 章で扱う「audience 検証の欠落」と同じ構造です。

**問題 5：ID-JAG の再利用による被害拡大**
1 枚の ID-JAG から高リスクのツール向けアクセストークンを何枚も発行できると、ID-JAG の漏洩がそのまま被害の増幅につながります。記事は、`jti`（JWT ID、トークンごとの一意な ID）を使った **1 回限りの利用** を仕様で必須にすべきだと述べています。現状のドラフトでは必須になっていません。

#### 1.5 記事の提言

1. **プロトコルを最小限にする**: 複雑な OAuth/OIDC スタックより、MCP に合わせた**証明書ベースの認可や mTLS** を優先する。
2. SSO の各遷移点で**入力を厳密に検証**する（メタデータ、URL、スキーム）。
3. **信頼の起点を明示**する。暗黙の信頼の連鎖に頼らず、ID を強く結び付ける。
4. **一元的に失効できる仕組み**を用意し、インシデント時に一括で止められるようにする。
5. **リソースの名前空間を分ける**。スコープの対応付けを決定的にし、「ユーザーの委任」と「エージェントの実行」の文脈を分ける。
6. **取り消せない操作を特別に保護**する（追加の確認や人間の承認など）。

記事の結論はこうです。エージェントが動く分散アーキテクチャは、従来の SSO の弱点をさらに悪化させる。企業向け OAuth/OIDC の複雑さをそのまま持ち込むのではなく、OAuth/OIDC/SAML/SCIM の数十年分の失敗から学び、次の 3 点を重視すべきである。

- 認可判断が決定的であること
- 委任の意味が監査できること
- 暗黙の信頼が最小限であること

（補足：MCP 仕様側の防御要件）2025-06-18 版以降の MCP 仕様は、次のことを定めています。

- MCP サーバは、自分宛て（audience が自分）に発行されたトークンだけを受け入れる。
- 受け取ったトークンを上流 API へ**そのまま転送する「トークンパススルー」は禁止**。
- クライアントは `resource` パラメータ（RFC 8707）で宛先を明示する。

2025-11-25 版では、DCR の代わりに **CIMD**（クライアント ID を HTTPS の URL とし、その URL で公開するメタデータ文書でクライアントを識別する方式）が推奨の選択肢として加わりました。CIMD では認可サーバが**攻撃者の指定した URL を取りに行く**ことになるため、SSRF（サーバに内部ネットワークなどへリクエストを送らせる攻撃）への対策も実装者が考える必要があります。

> 出典: Doyensec「The MCP AuthN/Z Nightmare」(2026-03-05) — https://blog.doyensec.com/2026/03/05/mcp-nightmare.html

---

### 2. 認可エンドポイントの脆弱な実装と対策（task4233）

この記事は**認可コードグラント**に絞り、認可サーバ（IdP）を**自分で実装する側**の目線で脆弱性を解説しています。PKCE、他のグラント、トークンエンドポイント、MITM や DNS 偽装のような通信路・暗号層の脅威は対象外だと明記されています。参照している規範は RFC 6749、RFC 7591（DCR）、RFC 7636（PKCE）、OAuth 2.0 Security BCP、OpenID Connect Core 1.0 です。

MCP との関係で言えば、MCP サーバの開発者が認可サーバまで自前で作る（または前述の workers-oauth-provider のようなライブラリを使う）ケースが増えました。そのため、この記事の内容は MCP の文脈でもそのまま当てはまります。

#### 2.1 redirect_uri 検証の不備

認可コードは redirect_uri に付けて返されます。検証が甘いと、**攻撃者のサーバに認可コードが届いてしまいます**。記事が示す、脆弱な Go の実装は次のとおりです。

```go
func (s *AuthorizationServer) validateAuthorizeRequestWithClient(
    req *authorizeRequest, client model.Client) error {
    for _, c := range client.RedirectURIs {
        re := regexp.MustCompile(c)
        if re.MatchString(req.redirectURI) {
            return nil
        }
    }
    return errors.New("invalid redirect_uri")
}
```

このコードには、登録済み URI を**正規表現として扱う**ことによる問題が複数あります。

**① メタ文字をエスケープしていない**
登録値が `https://*.task4233.dev/*` の場合、`.` は正規表現では「任意の 1 文字」です。さらに `MatchString` は**部分一致**です。そのため `https://attacker.com/.task4233.dev/` のように、攻撃者のドメインの後ろに正規のドメイン名を付けた文字列がマッチしてしまいます。ホスト部分は `attacker.com` なので、コードは攻撃者に届きます。

**② 前方一致での検証の限界**
登録値 `https://client.task4233.dev/` を前方一致で調べるとします。ここにパーセントエンコードした文字（`%08`、`%09`、`%2F` など）を混ぜると検証をすり抜けられる場合があります。原因は、**検証に使う文字列比較**と、**実際に遷移するブラウザや後段の URL パーサ**とで解釈が食い違うことです。これはパーサ差分と呼ばれる典型的な問題です。

**③ HTTP パラメータ汚染（HPP）**
redirect_uri の末尾に `code=compromised_value&` のような文字列を埋め込んでおきます。すると認可サーバが `?code=...` を付けたときにクエリで `code` が重複し、クライアントがどちらの値を使うかによっては、認可コードを攻撃者の値に差し替えられます。

**対策**
記事は「**完全一致（exact match）がベスト**」と明言しています。例外はネイティブアプリのループバックアドレス（`http://127.0.0.1:{port}/`）で、ここはポート番号だけを任意にします。起動のたびに空きポートが変わるためで、RFC 8252 の規定に沿った扱いです。

```go
// 考え方の例: 正規化せず、登録文字列とのバイト単位完全一致のみ許可
for _, registered := range client.RedirectURIs {
    if req.redirectURI == registered {
        return nil
    }
}
return errors.New("invalid redirect_uri")
```

正規表現やワイルドカードは便利ですが、便利さの分だけ攻撃面が増えます。記事はこれを「複雑さとセキュリティのトレードオフ」と表現しています。

#### 2.2 エラーレスポンスを使ったオープンリダイレクト

攻撃シナリオは次のとおりです。

1. 不正な `client_id` と、攻撃者の用意した `redirect_uri` を付けた認可リクエストを送る。
2. 実装が **client_id を redirect_uri より先に検証**している。
3. 「client_id が不正」というエラーを、**未検証の redirect_uri** へリダイレクトして返してしまう。
4. 正規の IdP のドメインを起点としたオープンリダイレクトになり、フィッシングサイトへ誘導される。

記事は **RFC 6749 Section 4.1.2.1** を根拠に、redirect_uri が欠落・不正な場合や client_id が不正な場合は、**クライアントへ自動でリダイレクトせず、リソースオーナー（ユーザー）にエラーを表示すべき**だと指摘しています。記事の整理は次のとおりです。

- リクエストパラメータが異常な場合 → IdP 自身が管理するドメインのエラーページで表示する。
- redirect_uri が検証済みで、ユーザーが認可を拒否した場合など → `error=access_denied` をクライアントへ返し、クライアント側で処理してよい。

#### 2.3 CSRF（ログイン CSRF／アカウント紐付け CSRF）

攻撃の流れは次のとおりです。

1. 攻撃者が**自分のアカウント**で認可コードを取得し、使わずに取っておく。
2. そのコード付きのコールバック URL を被害者に踏ませる。
3. 被害者のセッションが**攻撃者のアカウントやリソースと紐付く**。
4. その後、被害者が入力した情報を攻撃者が別の端末から見られるようになる。

**対策 1：state パラメータ**

```text
クライアント: 暗号学的に安全な乱数で state を生成 → セッションに保存 → 認可リクエストに付与
コールバック: 受け取った state とセッションの値を比較 → 不一致ならトークンリクエスト前に中止
```

state が効くのは、攻撃者は被害者のブラウザのセッションに保存された値を知らないからです。そのため、一致する state を持つコールバック URL を作れません。記事は、認可エンドポイントと Approve エンドポイントの両方について、state の生成・保存・検証を含む Go の正常系の実装例を示しています。

**対策 2：nonce（OIDC の場合）**
ID トークンの `nonce` クレームが、リクエスト時に保存した値と一致するかを検証します。認可フローの一貫性を保つとともに、リプレイ対策にもなります。

#### 2.4 ReDoS

Dynamic Client Registration（RFC 7591）に対応し、**登録時の redirect_uri を正規表現として扱う**設計だとします。すると攻撃者が悪意ある正規表現（例: `(a+)+$` のような、バックトラックが爆発するもの）を登録し、認可リクエストのたびにサーバの CPU を使い果たさせることができます。

記事は、Go 標準の `regexp` は RE2 系で**線形時間が保証されている**ため影響を受けにくいと述べています。一方、JavaScript などバックトラック型のエンジンでは危険です。緩和策としてタイムアウトの設定を挙げています。根本的な対策は、2.1 と同じく「正規表現を使わず完全一致にする」ことです。**MCP では DCR や CIMD で誰でもクライアントを登録できる**ため、この脅威は現実的なものになっています。

#### 2.5 XSS のソースになる

検証が不十分だと、redirect_uri に `javascript:` や `data:` スキームを入れられることがあります。認可サーバがそれを `Location` やリンク、フォームの action に反映すると XSS になります。記事は GitLab や PayPal での報告例に触れています。対策は、スキームを許可リスト（`https`、ネイティブアプリ向けのループバック `http`、プライベート URI スキーム）に限定することと、完全一致にすることです。

> 出典: Qiita（task4233）「OAuth 2.0の認可エンドポイントにおける脆弱な実装例と対策」 — https://qiita.com/task4233/items/3af1b3d2690b44979659

---

### 3. アクセストークンの audience 検証漏れによる成りすまし（calloc134）

#### 3.1 前提となる構成

- フロントエンド：OAuth 2.0 の **Public Client**（SPA など、秘密を保持できないクライアント）
- バックエンド API：**リソースサーバ**。Bearer トークンでユーザーを識別する。
- 認可サーバ：Auth0 のような外部の IDaaS

多くの個人開発や中小規模のサービスで使われている、「アクセストークンをセッションの代わりに使う」構成です。

#### 3.2 攻撃の仕組み

サービス A とサービス B が**同じ認可基盤（同じ issuer・同じ署名鍵）**を使っているとします。サービス B の開発者に悪意がある場合、次のことが起きます。

1. 被害者がサービス B にログインすると、B 向けのアクセストークン（JWT）がサービス B の手に渡る。
2. サービス B の運営者が、そのトークンを**サービス A のバックエンド API** に送る。
3. サービス A は署名・有効期限・`iss` だけを検証し、**`aud` を検証していない**。
4. 署名は正しく、発行者も正しいため受け入れられ、`sub` のユーザーとして処理される。**被害者への成りすまし**が成立する。

原理はこうです。署名が保証するのは「このトークンは認可サーバが発行した」ことだけです。「このトークンは自分（サービス A）宛てに発行された」ことは保証しません。宛先を示すのは `aud` で、それを確認するのはリソースサーバの責任です。

**RFC 9068**（JWT 形式のアクセストークン）は、`iss`・`aud`・`scope` などのクレームを定めています。そのうえで、リソースサーバは**自分の識別子が `aud` に含まれていることを必ず確認する**よう求めています。1.4 の「スコープ名の衝突」や MCP の「トークンパススルー禁止」も、根本はこの問題です。

#### 3.3 Hono の事例（CVE-2025-62610）

Web フレームワーク Hono の JWT ミドルウェアは、JWT の汎用的な検証ツールで、OAuth のリソースサーバ用には作られていません。`iss` の検証オプションはありましたが、**`aud` の検証オプションはありませんでした**。そのため、開発者が audience の検証を省きやすい状態でした。この問題は **CVE-2025-62610** として報告され、`aud` の検証オプションが追加されています。

```javascript
jwk({
  jwks_uri: `https://${auth0Domain}/.well-known/jwks.json`,
  verification: {
    aud,  // audience 検証が追加可能に
    iss,
  },
});
```

注意点として、これは**オプション**なので、明示的に指定しなければ検証されません。デフォルトで安全になるわけではない、というのが記事の強調点です。

#### 3.4 他のフレームワークの状況

| フレームワーク | 汎用 JWT ミドルウェア | OAuth リソースサーバ専用 |
|---|---|---|
| Express.js | express-jwt（`aud` 対応） | node-oauth2-jwt-bearer（scope も対応） |
| Fastify | fastify-jwt-jwks（`aud` 対応） | auth0-fastify-api（scope も対応） |
| Elysia | @elysiajs/jwt（`aud` 対応） | elysia-oauth2-resource-server（scope も対応） |

実務上の教訓は、「JWT の検証」と「OAuth アクセストークンの検証」は別のものだということです。リソースサーバ用として作られたミドルウェアを選ぶべきです。

#### 3.5 テナント分離による緩和と例外

攻撃が成り立つには、**A と B のトークンが同じ issuer・同じ鍵で署名されている**必要があります。

- **分離されているもの**: Okta（Organization ごとに issuer と鍵が別）、AWS Cognito（User pool ごと）、Keycloak（Realm ごと）。他テナントのトークンは `iss` の検証や署名の検証で弾かれます。
- **注意が必要なもの**: OneLogin の generic issuer（全テナントで issuer と鍵が共通）、Firebase Auth（テナント間で署名鍵を共有）。この場合は `aud` の検証が唯一の防御線になります。

#### 3.6 Opaque トークンでも起きる

JWT ではない不透明トークン（中身を読めない参照型のトークン）でも同じことが起きます。リソースサーバがトークンイントロスペクション（RFC 7662、認可サーバにトークン情報を問い合わせる仕組み）の応答に含まれる発行元や対象者（`aud`、`client_id`）を確認しなければ、他サービス向けのトークンを受け入れてしまいます。

#### 3.7 推奨構成：BFF（Backend For Frontend）

記事の主張は「**アクセストークンをセッションのように使うべきではない**」です。どうしてもリソースサーバとして使う場合は、issuer・audience・（必要に応じて）scope の検証が必須だとしています。そのうえで推奨するのが BFF パターンです。バックエンドが Confidential Client（クライアントシークレットを持つクライアント）として OIDC の認可コードフローを行い、ブラウザとは HttpOnly Cookie のセッションでやり取りします。

```typescript
export const auth0Middleware = auth({
  domain: c.env.AUTH0_DOMAIN,
  clientSecret: c.env.AUTH0_CLIENT_SECRET,
  session: {
    cookie: {
      sameSite: "lax",
      secure: true,
    },
  },
  authorizationParams: {
    response_type: "code",
    scope: "openid profile email",
  },
});

authRoutes.get("/api/me", requiresAuth(), async (c) => {
  const session = await c.var.auth0Client?.getSession(c);
  return c.json({ user: session?.user });
});
```

```javascript
export async function apiFetch(path, init) {
  const url = new URL(path, API_BASE);
  const res = await fetch(url.toString(), {
    credentials: "include",  // HttpOnly Cookie 自動送信
    ...init,
  });
  return res.json();
}
```

この構成が安全な理由は 2 つあります。

- **認証を ID トークンで行う**。ID トークンの `aud` はクライアント ID で、OIDC ではその検証が必須です。そのうえでサーバ側でセッションを作ります。
- **ブラウザにアクセストークンを渡さない**。そのため、他のサービスで手に入れたトークンを持ち込んで成りすますことができません。

一方で Cookie を使う構成になるので、CSRF 対策（SameSite に加えて、必要なら CSRF トークン）は別途必要です。記事は、仕様を理解しないまま雰囲気で OAuth を使うことを戒め、RFC 6749・RFC 9068・OIDC の仕様を理解するよう促しています。

> 出典: Zenn（calloc134）「【OAuth】アクセストークンの検証を誤ると成りすまし攻撃ができます」 — https://zenn.dev/calloc134/articles/oauth-cross-api-vuln-attack

---

### 4. まとめ：MCP 時代の実装チェックリスト

| 観点 | 確認事項 | 対応する節 |
|---|---|---|
| 外部メタデータ | PRM・AS メタデータ・CIMD から得た URL を `https:` に限定し、正規化してから使う。シェルを経由せずに開く。取得先への SSRF を防ぐ | 1.3 A, 1.5 |
| ローカルサーバ | localhost の WebSocket/HTTP にトークン認証と Origin/Host の検証を入れる | 1.3 B |
| redirect_uri | 完全一致にする（ループバックのポートだけ例外）。正規表現・前方一致を使わず、スキームを許可リストで制限する | 2.1, 2.4, 2.5 |
| エラー処理 | client_id や redirect_uri が不正なときはリダイレクトせず、IdP の画面で表示する | 2.2 |
| CSRF | state（と OIDC の nonce）を生成・保存・照合する | 2.3 |
| トークン検証 | 署名・`exp`・`iss` に加えて **`aud`（自分の識別子）** と scope を確認する。イントロスペクションでも同じ | 3.2–3.6 |
| トークンの転送 | 受け取ったトークンを上流へそのまま渡さない（MCP のパススルー禁止）。上流向けには別のトークンを取得する | 1.5 補足 |
| エージェント特有 | 高リスクの操作には人間の承認を入れる。一元的に失効できる仕組みを持つ。`jti` で 1 回限りの利用にする。スコープの名前空間を分ける | 1.4, 1.5 |

なお、本節の CVE やドラフト仕様の状況は、2026 年 3 月時点の記事と 2025-11-25 版の MCP 仕様に基づいています。ID-JAG の拡張や MCP 仕様は改訂が続いているため、実装や診断の前に最新版を確認してください。検証は、自分が管理する環境か、許可を得た範囲でのみ行ってください。


---

## ナビゲーション

[← 第4章 検証演習と方法論](04-hands-on-methodology.md)  ｜  [📚 目次（ホーム）](index.md)  ｜  [付録](99-appendix.md) →
