## Blind SSRF の定義とOAST検出（PortSwigger/interactsh）

### この節で扱う範囲

前節までで扱った通常のSSRF（response-based SSRF）は、アプリケーションがバックエンドリクエストの**レスポンス本文をフロントエンドに返す**ため、攻撃者はレスポンスを直接観察して内部情報を読み取ったり、エラーメッセージの差分からポートスキャンを行ったりできた。本節ではその前提が崩れる「Blind SSRF（ブラインドSSRF）」を扱う。レスポンスが見えない状況で「本当に脆弱性が存在するのか」をどう確定させるか、そのための標準的手法である**OAST（Out-of-Band Application Security Testing）**の仕組みと、代表ツールである Burp Collaborator および interactsh の使い方・内部動作を、原理レベルで解説する。

---

### Blind SSRF とは何か

PortSwigger の定義を引用する。

> "Blind SSRF vulnerabilities arise when an application can be induced to issue a back-end HTTP request to a supplied URL, but the response from the back-end request is not returned in the application's front-end response."
> （日本語訳: Blind SSRF脆弱性は、アプリケーションが攻撃者の指定したURLへバックエンドリクエストを発行させられるにもかかわらず、そのバックエンドリクエストのレスポンスがアプリケーションのフロントエンドのレスポンスに含まれて返ってこない場合に発生する）

> 出典: Blind SSRF vulnerabilities — https://portswigger.net/web-security/ssrf/blind

ここでいう「sink（入力が最終的に実行・解釈される危険な代入先）」は、通常のSSRFと同じ「サーバーが外部/内部のURLへリクエストを発行する処理」だが、決定的に異なるのは**攻撃者から見た可観測性（observability）**である。通常のSSRFはリクエスト→レスポンスが一往復で完結し、攻撃者はブラウザやHTTPクライアントの画面上でレスポンスを直接読める。一方Blind SSRFでは、サーバー内部で以下のような処理が非同期・片方向（unidirectional）に行われる。

```
[攻撃者] → (悪意あるURLを含むリクエスト) → [脆弱なアプリケーション]
                                                    │
                                                    ▼
                                    [アプリケーションのバックエンド処理が
                                     指定URLへHTTPリクエストを送信]
                                                    │
                                                    ▼
                                    (レスポンスはログに書かれるだけ、
                                     あるいは単に破棄される)
                                                    │
                                                    ×  ← ここでフロントエンドへの経路が切れている
[攻撃者] ← (レスポンス本文を含まない通常の200 OKなど) ← [脆弱なアプリケーション]
```

このため、攻撃者は「送ったURLへ実際にアクセスが発生したかどうか」を、アプリケーションのHTTPレスポンスからは一切判断できない。これが「blind（盲目的）」と呼ばれる所以である。

#### なぜ「レスポンスが見えない」だけで脆弱性の価値が下がらないのか

一見、レスポンスが読めないなら実害は小さいように思えるが、PortSwigger は次のように述べている。

> Blind SSRF vulnerabilities are harder to exploit but can still be leveraged to access unauthorized actions or data.

具体的な悪用経路として、原文は主に2つの方向性を挙げている。

1. **内部ネットワークへのアウトオブバンド走査（out-of-band probing）**: 既知の内部脆弱性を狙ったペイロードを内部IPレンジに向けて送信し、外部インタラクション（DNSクエリやHTTPコールバック）の有無で内部ホストの存在・応答性を推測する。レスポンス本文は読めなくても、「リクエストが届いたかどうか」という1ビットの情報だけで、内部ネットワークマップの構築やファイアウォール越しの疎通確認が可能になる。
2. **クライアントサイド脆弱性の誘発**: サーバーが攻撃者の管理するシステムへ接続するよう仕向け、そのシステムから悪意あるHTTPレスポンス（例えば悪意あるヘッダーや壊れたコンテンツ）を返すことで、リクエスト発行側のHTTPクライアントライブラリやパーサーの脆弱性（例: Shellshockのような環境変数インジェクション、あるいは不正なパーサー実装によるRCE）を突く。

> 出典: Blind SSRF vulnerabilities — https://portswigger.net/web-security/ssrf/blind

**仕組みレベルでの補足**: 2番目の経路が成立する理由は、バックエンドがURLを「取得するだけ」ではなく、多くの実装（監視エージェント、URLプレビュー生成、Webhook配送、リンク展開ツールなど）が取得したレスポンスのヘッダーやメタデータを**何らかの形で処理・解釈する**ためである。たとえば古い実装で「レスポンスヘッダーをそのままシェルの環境変数にコピーしてサブプロセスへ渡す」ような設計があれば、攻撃者が制御するサーバーからのレスポンスヘッダーにシェルインジェクションペイロードを仕込むことで、レスポンス本文が読めなくてもリモートコード実行（RCE）に到達しうる。これは「Blind SSRFだから安全」という誤解を否定する重要なポイントであり、防御側は「レスポンスを返さないから低リスク」と判断してはならない。

---

### 検出の核心: OAST（Out-of-Band Application Security Testing）とは何か、なぜ必要か

通常のSSRFなら、脆弱性の有無はHTTPレスポンスの差分（内部IPの応答内容、エラーメッセージ、タイミング差）から**in-band（同一の通信チャネル内）**で確認できる。しかしBlind SSRFではそのチャネルが存在しないため、**別のチャネル（out-of-band）**を使って「バックエンドが実際にリクエストを発行したかどうか」を検出する必要がある。

原理は単純である。

1. 攻撃者は自分だけが監視できる一意のドメイン（例: `abc123xyz.oast.example`）を発行してもらう。
2. そのドメインを、SSRFの疑いがある入力（URLパラメータ、Refererヘッダー、Webhook URL、画像取得元URLなど）に埋め込んで送信する。
3. 脆弱なサーバーがそのURLへ実際にリクエスト（DNS解決＋HTTP接続）を発行すれば、監視サーバー側にDNSクエリやHTTPリクエストのログが記録される。
4. 攻撃者はその監視サーバーをポーリング（または通知を待つ）し、ログが記録されていれば「サーバーサイドで指定URLへのリクエストが発行された」＝Blind SSRFの存在を、レスポンス本文を一切見ずに証明できる。

この「攻撃者が制御する外部インフラを介して間接的に検出する」アプローチ全般を **OAST（Out-of-Band Application Security Testing）** と呼ぶ。SSRFに限らず、Blind XSS、Blind SQLi（DNS exfiltration経由）、Log4Shell（`${jndi:ldap://...}`）のような脆弱性も同じOASTの原理で検出される。共通するのは「脆弱なアプリケーションに、攻撃者が観測可能な外部リソース（DNS/HTTP/SMTP/LDAPサーバーなど）への通信を強制的に発生させ、その通信の発生自体を証拠とする」という考え方である。

PortSwigger は検出手法として次のように述べている。

> Blind SSRF vulnerabilities are generally harder to exploit, but can sometimes be detected using out-of-band (OAST) techniques ... You can use Burp Collaborator to generate a unique URL and then monitor for any interactions with that URL that result from submitting the URL in various parts of the application's requests.

> 出典: Blind SSRF vulnerabilities — https://portswigger.net/web-security/ssrf/blind

#### 重要な注意点: DNSクエリだけが発生してHTTP接続が発生しないケース

原文は次の重要な留意点を述べている（本節冒頭の抽出結果より）。

> DNS lookups may occur without subsequent HTTP requests, typically due to network-level filtering blocking outbound connections while permitting DNS queries.

これは実務上非常に重要な判断材料になる。多くの企業ネットワークでは、アウトバウンドのDNS解決（UDP/TCP 53番ポート）は許可しつつ、任意の外部ホストへのHTTP/HTTPS接続（80/443番ポートなど）はプロキシやファイアウォールでブロックしている構成が一般的である。この場合、脆弱なサーバーが `http://abc123xyz.oast.example/` へリクエストしようとすると、

1. まずDNS解決のためにOASTサーバーへ名前解決クエリが飛ぶ（→ 監視サーバーにDNSインタラクションとして記録される）
2. 次にTCP接続を確立しようとするが、ファイアウォールでアウトバウンドHTTP通信がブロックされ失敗する（→ HTTPインタラクションは記録されない）

という状態になる。したがって「DNSインタラクションのみが記録され、HTTPインタラクションが記録されない」場合でも、それは**誤検知ではなく**、SSRF自体は成立している（＝任意URLへのリクエスト発行は誘発できている）が、ネットワーク境界のエグレスフィルタリングによってHTTPレベルの到達は阻止されている、という状態を示している。防御側にとっては、このケースこそが「エグレスフィルタリングが機能している証拠」であり、同時に「入力検証層でのURL制御も併用すべき」というシグナルになる。攻撃者側の視点で言えば、DNSインタラクションのみでも「サーバーが外部ホスト名を解決した」という事実そのものが、内部ネットワーク情報の推測（例えばDNSリバインディングや、内部専用ドメインの存在確認）に使われうる。

---

### 実例: PortSwigger Lab「Blind SSRF with out-of-band detection」

このラボは、Blind SSRFの検出手順を最小構成で体験できるように設計されている（**本教科書は防御目的の解説であり、実在の本番システムへの無許可検証は行わない。以下は学習用ラボ環境における一般的な手順の解説である**）。

#### 脆弱性のシナリオ

ラボの解説によれば、対象アプリケーションには商品ページのアクセス解析（analytics）機能があり、ユーザーが商品ページを閲覧すると、解析ソフトウェアが**Refererヘッダーに指定されたURL**へ自動的にフェッチ（バックグラウンドで取得）を行う。この処理はページ描画の裏側で非同期に実行され、取得結果はユーザーには一切表示されない。

```
GET /product?productId=1 HTTP/1.1
Host: vulnerable-app.example
Referer: https://vulnerable-app.example/product?productId=1
```

サーバー側の解析処理は、このRefererヘッダーの値をURLとして解釈し、バックエンドから直接フェッチする（実装イメージ）。

```
# 解析システム側の疑似コード
def on_page_view(referer_url):
    # アクセス元ページの内容を解析するために取得する、という名目の処理
    response = http_client.get(referer_url)   # ← ここがSSRFのsink
    log_analytics(response)
    # response の内容はユーザーには一切返されない
```

このコードの`referer_url`にバリデーションがなく、攻撃者が制御可能なRefererヘッダーの値がそのままHTTPクライアントに渡されている点が脆弱性の本体である。取得結果（`response`）はアプリケーションのユーザー向けレスポンスには一切含まれないため、通常の方法（レスポンス差分の観察）では検出できない＝Blind SSRFとなる。

#### 検出手順（Burp Suite Collaboratorを用いる場合）

1. 商品ページへのリクエストをBurp Suiteのプロキシでインターセプトし、Burp Repeaterへ送る。
2. リクエスト中の `Referer` ヘッダーの値を選択し、右クリックメニューから **"Insert Collaborator Payload"** を選択する。これにより、Burp Collaboratorサーバー（PortSwigger運営のパブリックOASTインフラ、または自己ホストのプライベートCollaboratorサーバー）が発行した一意のサブドメイン（例: `xy9z...burpcollaborator.net`）が自動的に挿入される。
3. リクエストを送信する。
4. Burp SuiteのCollaboratorタブを開き、「Poll now」を実行してCollaboratorサーバーに問い合わせる。
5. アプリケーションのバックエンド処理は非同期に実行されるため、インタラクションが記録されるまで多少の遅延が生じる場合がある。
6. インタラクション一覧にDNSクエリおよびHTTPリクエストが記録されていれば、サーバーが実際に指定URLへアクセスしたことが確認でき、Blind SSRFの存在が証明される。

> 出典: Blind SSRF with out-of-band detection lab — https://portswigger.net/web-security/ssrf/blind/lab-out-of-band-detection

#### なぜこの手順で検出できるのか（原理の補足）

Burp Collaboratorは、PortSwigger社が運営するパブリックな（あるいは自己ホスト可能な）DNS/HTTP/SMTPサーバー群であり、各ユーザーごとに一意のサブドメインを動的に発行する。そのサブドメインへの名前解決や接続が発生すると、Collaboratorサーバーはそのイベント（送信元IP、タイムスタンプ、プロトコル種別、リクエスト内容など)をログに記録し、Burp Suiteクライアントからのポーリングに応じて返す。

このラボでCollaboratorペイロードを「Refererヘッダー」に挿入するのは、脆弱性のsinkがRefererヘッダーの値を読み取る解析機能だからである。攻撃者が制御できる入力（Refererはブラウザ/HTTPクライアント側で自由に設定できるヘッダーである）を、サーバーが信頼して外部URLとして解釈・フェッチしてしまう、という構造そのものがSSRFの本質であり、Collaboratorはその「フェッチが実際に発生したか」を外部から観測するための計測器として機能している。

ファイアウォールなどによってCollaboratorへのアウトバウンド接続自体がブロックされる環境では、パブリックなBurp Collaboratorのインフラを使う代わりに、内部ネットワークから到達可能な自己ホストのOASTサーバーを用意する必要がある。次節で扱う interactsh は、まさにそのようなセルフホスト型OASTサーバーの代表例である。

---

### interactsh: Burp Collaboratorに相当するオープンソースOOB検出基盤

Burp CollaboratorがBurp Suite Professionalに統合された商用機能であるのに対し、**interactsh** は Project Discovery が開発したオープンソース（MITライセンス）のOOBインタラクション収集システムであり、Burp Suiteを持たない環境や、CI/CDパイプライン、独自ツールへの組み込み、あるいは自己ホストによるプライバシー確保を必要とする場面で広く使われる。

> Interactsh is an open-source tool for detecting out-of-band (OOB) interactions. It is a tool designed to detect a broad range of vulnerabilities ... by generating out of band payloads and detecting interaction on them.

> 出典: interactsh — https://github.com/projectdiscovery/interactsh

#### アーキテクチャ: クライアント/サーバー型

interactsh はBurp Collaboratorと同じ設計思想を持つ。

- **サーバー（interactsh-server）**: DNS・HTTP/HTTPS・SMTP/SMTPS・LDAP、さらに自己ホスト構成ではFTP/FTPS・SMB/NTLM等、複数プロトコルの着信リクエストを捕捉するバックエンド。パブリックに提供されているデフォルトサーバー（`oast.pro`、`oast.live`、`oast.site` など複数のドメインがロードバランス的に用意されている）を使うことも、自前のドメインとVPSで自己ホストすることもできる。
- **クライアント（interactsh-client）**: 一意のペイロード（サブドメイン）を生成し、ユーザーがそれをテスト対象の入力（本節文脈で言えばSSRFの疑いがあるURLパラメータやヘッダー）に埋め込む。クライアントはサーバーへ定期的にポーリングし、受信したインタラクションをリアルタイムに表示する。

```
[interactsh-client] --(一意のサブドメインを要求・生成)--> [interactsh-server]
        │
        │ 生成されたペイロード（例: 8f3a...oast.pro）を
        │ 攻撃者がテスト対象の入力欄に埋め込む
        ▼
[脆弱性のあるアプリケーション] --(DNS解決 / HTTP接続)--> [interactsh-server]
                                                                │
[interactsh-client] <----------(ポーリングで結果取得)---------- ┘
```

#### 主な使い方

Go 1.20以上の環境でのインストール（原文の記載）。

```bash
go install -v github.com/projectdiscovery/interactsh/cmd/interactsh-client@latest
```

基本的な起動（引数なしでも一意のペイロードが自動生成され、待受が始まる）。

```bash
interactsh-client
```

代表的なオプション（原文より抜粋）。

| オプション | 意味 |
|---|---|
| `-s` / `-server` | 使用するinteractshサーバーを指定（デフォルトは `oast.pro`、`oast.live`、`oast.site` 等の中からランダム/選択） |
| `-n` / `-number` | 複数のペイロードを一度に生成 |
| `-o` | インタラクションのログをファイルに出力 |
| `-v` | 受信したリクエスト/レスポンスの詳細を表示 |
| `-json` | 出力をJSONL形式にする（自動化・後処理向け） |
| `-sf` / `-session-file` | セッションを保存し、再起動後も同じペイロードを使い続ける |
| `-dns-only` / `-http-only` | 特定プロトコルのインタラクションのみ表示 |

**なぜこの構成が有効か**: DNSのみ・HTTPのみといったフィルタが用意されているのは、Blind SSRFの検出において「DNS解決は通ったがHTTP接続はファイアウォールに阻まれた」という前述のケースを明確に切り分けて確認する必要があるためである。`-dns-only`でノイズを削り、DNSクエリの発生有無だけをまず確認し、次に`-http-only`でHTTPレベルの到達可否を別途確認する、という段階的な検証が可能になる。

#### 自己ホスト（セルフホスティング）

パブリックサーバーは便利だが、テスト対象の内部ネットワークからパブリックインターネット上のドメインへ到達できない構成（社内ネットワークが外部DNS解決すら制限しているケースなど）や、機密性の高い診断でログを外部第三者インフラに残したくない場合は、自己ホストが推奨される。

> 出典（自己ホスト要件の記載）: interactsh README — https://github.com/projectdiscovery/interactsh

必要要件と手順（原文より）。

```bash
# 要件: カスタムネームサーバーを設定可能な独自ドメイン、
# 24時間稼働するVPS（廉価な構成でも動作する）

go install -v github.com/projectdiscovery/interactsh/cmd/interactsh-server@latest

# 基本起動
interactsh-server -domain yourdomain.com
```

自己ホストサーバーでは、AWSやAlibaba Cloudなどのメタデータサービス（`169.254.169.254` 相当のクラウドメタデータエンドポイント）を模したカスタムDNSレコードを用意できる機能もあり、クラウド環境特有のSSRF（メタデータ窃取型）の検証・防御訓練にも応用できる。ただし、これは自己が管理・許可した環境内でのみ用いるべきであり、実在の他者のクラウド環境や本番システムに対して無許可で行ってはならない。

#### 主要な連携・統合ポイント

interactsh は単体のCLIツールとしてだけでなく、脆弱性スキャナ **Nuclei**（Project Discoveryが開発する同系統のツールで、テンプレートベースの自動スキャンにOOB検出を組み込める）や、Burp Suite・OWASP ZAPの拡張機能からも呼び出せるよう設計されている。これにより、手動診断だけでなく自動化されたセキュリティスキャンのパイプラインにもBlind SSRF検出を組み込むことができる。

#### セキュリティ上の留意点（原文より）

- デフォルトのパブリックサーバー群は定期的にローテーションされるため、長期間にわたる再現性の高い検証や本番運用には自己ホストが推奨される。
- 動的HTTPレスポンス制御機能（クエリパラメータでレスポンス内容を変更できる機能）はセキュリティリスクを伴うため、専用の隔離されたドメインで使うべきとされている。
- 保護されたサーバーへのアクセスには認証トークン（`-t` / `-token`）が必要な場合がある。

> 出典: interactsh — https://github.com/projectdiscovery/interactsh

---

### Burp Collaborator と interactsh の対応関係まとめ

| 観点 | Burp Collaborator | interactsh |
|---|---|---|
| 提供形態 | Burp Suite Professionalに統合された商用機能 | オープンソース（MIT）、単体CLI/ライブラリ |
| 開発元 | PortSwigger | Project Discovery |
| 対応プロトコル | DNS, HTTP/HTTPS, SMTP | DNS(A/AAAA/MX/TXT), HTTP/HTTPS, SMTP/SMTPS, LDAP（自己ホストでFTP/FTPS, SMB/NTLM等も） |
| 自己ホスト | 可能（Burp Suite Enterprise向けの設定等） | 可能（`interactsh-server`、独自ドメイン＋VPSが必要） |
| 主な利用方法 | Burp UI上でペイロード挿入・ポーリング | CLI (`interactsh-client`) や他ツール（Nuclei等）への統合 |
| 典型用途 | 手動診断でのBurp Repeater/Intruderとの一体運用 | 自動化パイプライン、Burp以外のツールチェーンへの組み込み、CI連携 |

両者は「攻撃者が観測可能な一意のOOBエンドポイントを発行し、そこへの到達有無で片方向の脆弱性を検出する」という同一原理に基づいており、Blind SSRFの検出においては実質的に互換の役割を果たす。診断環境やツールチェーンの制約（Burp Suiteの有無、CI/CDでの自動化要件、社内ネットワークからの到達性、ログの取り扱いポリシーなど）に応じて選択すればよい。

---

### 防御側の視点: Blind SSRFの検出手法から学ぶべきこと

本節はSSRFの「攻撃者側からの検出手法」を解説したが、これは同時に防御側にとって重要な示唆を含む。

1. **エグレスフィルタリング（outbound filtering）の効果測定にOASTの原理を応用できる**: 自社の外部送信制御が正しく機能しているかを、DNSのみ許可・HTTP遮断という構成が意図通りかどうか、自己ホストのOASTサーバー等を用いて定期的に検証できる。
2. **「レスポンスを返さないから安全」という設計判断は誤り**: 本節冒頭で述べた通り、Blind SSRFでもクライアントライブラリの脆弱性経由でRCEに至る経路が存在する。防御は「レスポンスを見せない」ことではなく、そもそもサーバーサイドで任意URLへの到達を許さない設計（許可リスト方式、内部アドレス帯域のブロック、メタデータエンドポイントの遮断など）で行うべきである。
3. **DNSログの監視は有効な検知手段になりうる**: 内部システムが予期しない外部ドメイン（特に`oast.*`のような既知のOASTサービスのドメインパターンや、動的に生成された一意なランダムサブドメイン）へDNSクエリを発行していないかを監視することは、実際に進行中のSSRF調査・侵害活動を検知する手がかりになる。

これらの防御的対策の詳細（許可リスト設計、DNSリバインディング対策、クラウドメタデータ保護など）は、後続の章で体系的に扱う。
