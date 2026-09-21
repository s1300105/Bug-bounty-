## WebSocket実CVEとライトアップ集

前節までで、WebSocketハンドシェイクの仕組み、`Origin`検証の欠如がCSWSH（Cross-Site WebSocket Hijacking）を成立させる原理、そしてメッセージ経由のインジェクションと認可欠如を扱ってきた。本節では、その理屈が**実在のプロダクトでどう現実化したか**を、1件の実CVEのパッチ差分レベルと、バグバウンティのライトアップ集という2つの角度から確認する。

扱うのは次の2つである。

- **CVE-2024-51775（Apache Zeppelin）**: `Missing Origin Validation in WebSockets`。OSSの実コードとその修正パッチが公開されており、「なぜ抜けたのか」「どう直したのか」を1行単位で追える、教材として理想的な事例。
- **devanshbatham/Awesome-Bugbounty-Writeups**: カテゴリ別に整理されたバグバウンティ・ライトアップのキュレーション集。WebSocket関連の報告が**どのカテゴリに分類されているか**そのものが、この脆弱性クラスの立ち位置を示している。

いずれも防御・検知の観点から読む。実在サービスへの無許可の再現検証は行わないこと。

---

### CVE-2024-51775: Apache Zeppelin のWebSocket Origin検証欠如

#### 事実関係を先に押さえる

Apache Zeppelinは、ブラウザ上でSpark/SQL/Shellなどのコードを「パラグラフ（paragraph）」単位で実行・可視化するWebノートブックである。JupyterのSpark版と考えればよい。

| 項目 | 内容 |
|---|---|
| CVE ID | CVE-2024-51775 |
| 対象 | Apache Zeppelin（コンポーネント: `org.apache.zeppelin:zeppelin-shell`） |
| 影響バージョン | 0.11.1 以上 0.12.0 未満 |
| 脆弱性種別 | Missing Origin Validation in WebSockets |
| CWE | CWE-1385（Missing Origin Validation in WebSockets） |
| NVD CVSS v3.1 | **5.3 (MEDIUM)** / `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N` |
| 二次評価（CISA-ADP） | **7.5 (HIGH)** / `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N` |
| ASF側の深刻度 | Moderate |
| 公表日 | 2025-08-03（oss-security投稿） |
| 発見者 | Calum Hutton |
| 修正 | **0.12.0 へのアップグレード**（PR apache/zeppelin#4823） |

ASFのアドバイザリ本文は、影響をこう述べている。

> Missing Origin Validation in WebSockets vulnerability in Apache Zeppelin. The attacker could access the Zeppelin server from another origin without any restriction, and get internal information about paragraphs.
> （Apache ZeppelinにおけるWebSocketのOrigin検証欠如。攻撃者は別オリジンから何の制限もなくZeppelinサーバーへアクセスでき、パラグラフに関する内部情報を取得できる。）

「別オリジンから制限なく接続でき、内部情報を取れる」という一文は、前節で学んだCSWSHの定義そのものである。

#### 何が露出していたのか: Terminal Interpreter の構造

脆弱だったのは、Zeppelin本体のノートブック用WebSocketではなく、`zeppelin-shell` モジュールに含まれる **Terminal Interpreter**（ノートのパラグラフ内にブラウザ端末を埋め込む機能）である。構造は次の通りだった。

1. ユーザーが `%sh.terminal` パラグラフを実行すると、`TerminalInterpreter` が**ランダムな空きポート**を選び、そのポートで独立したJetty（Javaのサーブレット/WebSocketサーバー）スレッド `TerminalThread` を起動する。
2. `TerminalThread` は JSR-356（`javax.websocket`、Jakarta WebSocketの旧名）のAPIで `TerminalSocket` エンドポイントを `/` に登録する。
3. ノート画面には `http://<hostIp>:<port>?noteId=...&paragraphId=...` を指すダッシュボード（iframe）が描画され、その中のJavaScriptが上記ポートへWebSocket接続する。
4. クライアントは接続直後に、こんな形のJSONフレームを送って端末セッションを開始する（修正PRのテストコードに実物が残っている）。

```json
{"type":"TERMINAL_READY","noteId":"<noteId>","paragraphId":"<paragraphId>"}
```

ここが要点である。**この端末用WebSocketサーバーは、Zeppelin本体の認証・認可を一切経由しない別プロセス的なリスナー**であり、かつ `Origin` を見ていなかった。したがって、被害者がZeppelinを開いているブラウザで攻撃者のページを踏むと、攻撃者のJavaScriptから同じポートへWebSocketを張り、`TERMINAL_READY` 相当のフレームを送って `noteId` / `paragraphId` に紐づく内部情報を引き出せた。これがアドバイザリの言う "get internal information about paragraphs" の中身である。

なお、端末ポートは**起動のたびにランダム**で、かつ通常はサーバーのLAN IPにバインドされる。攻撃の成否は「そのポートに到達できるか」に依存する。NVDが機密性影響を `C:L`（5.3）と控えめに採点した背景にはこの制約があり、逆にCISA-ADPが `C:H`（7.5）と採点したのは「到達できた場合に読めるのは端末セッションに紐づく内部情報であり、実質的な機密性喪失は大きい」という見方だと解釈できる。**同一CVEでスコアが割れているときは、評価者が前提条件（到達可能性）をどこまで織り込んだかの差**であることが多い。自組織のリスク判断では、自分の配置（Zeppelinをどのネットワークに置き、誰のブラウザがそこに到達できるか）に合わせて再計算するのが正しい。

#### なぜ抜けたのか: JSR-356 の `checkOrigin` はデフォルトで常に true

この脆弱性の核心は、仕様レベルの既定値にある。JSR-356（`javax.websocket`）では、サーバー側エンドポイントの挙動を差し替えるフック点として `ServerEndpointConfig.Configurator` というクラスがあり、その中に `checkOrigin(String originHeaderValue)` というメソッドが用意されている。ハンドシェイク時にコンテナがこれを呼び、`false` が返ればハンドシェイクを拒否する。

問題は、**このメソッドの既定実装が「常に `true` を返す」**ことである。つまり、

```java
// 修正前: エンドポイントをクラス指定でそのまま登録している
container.addEndpoint(TerminalSocket.class);
```

このようにアノテーション付きエンドポイントクラスをそのまま登録すると、コンテナは既定の `Configurator` を使い、`checkOrigin` は無条件に `true` を返す。結果として **`Origin` ヘッダーが何であろうとハンドシェイクは成立する**。開発者が「何も書かなかった」のではなく、「書かなければ全許可になる」というAPIの既定値に従った結果として穴が空いた、というのがこのCVEの構造である。

これは `ws`（Node.js）が既定でOriginを見ない、Django Channelsの `AllowedHostsOriginValidator` を自分で噛ませない限り素通しになる、といった前節のフレームワーク事情とまったく同じ形をしている。**WebSocketのOrigin検証は、どのスタックでも「明示的にオプトインする防御」であって、デフォルトで有効な防御ではない**。この一般則を、CVE-2024-51775は Java/Jetty 系のスタックで実証している。

もう一点、HTTPのCORSと対比しておくと理解が固まる。CORSでは、ブラウザが「レスポンスをJavaScriptに渡してよいか」を `Access-Control-Allow-Origin` で判定し、**ブラウザ側が**遮断する。ところがWebSocketのハンドシェイクにはCORSのプリフライトも、レスポンス読み取り制限も適用されない。`101 Switching Protocols` が返った時点でフレームの送受信は自由になる。したがって**防御の責任は100%サーバー側にある**。`checkOrigin` を実装しないことは、CORSで言えば `Access-Control-Allow-Origin: *` かつ `Allow-Credentials: true` を常時返しているのに近い状態になる。

#### 修正パッチを読む（PR apache/zeppelin#4823）

修正は「許可するOriginを起動時に1つ確定させ、`Configurator` で厳密一致を要求する」という最小構成である。新規追加されたクラスが本体で、実物は39行しかない。

```java
package org.apache.zeppelin.shell.terminal.websocket;

import javax.websocket.server.ServerEndpointConfig.Configurator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class TerminalSessionConfigurator extends Configurator {
  private static final Logger LOGGER =
      LoggerFactory.getLogger(TerminalSessionConfigurator.class);
  private String allowedOrigin;

  public TerminalSessionConfigurator(String allowedOrigin) {
    this.allowedOrigin = allowedOrigin;
  }

  @Override
  public boolean checkOrigin(String originHeaderValue) {
    boolean allowed = allowedOrigin.equals(originHeaderValue);
    LOGGER.info("Checking origin for TerminalSessionConfigurator: " +
        originHeaderValue + " allowed: " + allowed);
    return allowed;
  }
}
```

注目すべきは `allowedOrigin.equals(originHeaderValue)` という**完全一致比較**である。`startsWith` でも `contains` でも正規表現でもない。これは意図的に正しい。`startsWith("https://example.com")` なら `https://example.com.evil.net` が通り、`contains("example.com")` なら `https://evil-example.com.attacker.io` が通ってしまう。Origin検証のバイパスは、ほぼすべてが「部分一致」「サフィックス一致」「正規表現のドット未エスケープ」から生まれる。**ホワイトリストに対する完全一致（またはホワイトリスト集合への `contains` 判定）以外は書かない**、というのがここから持ち帰るべき実装規約である。

そして、この `Configurator` をエンドポイント登録に差し込む側が次の変更である。

```java
// 修正後: Builder経由でConfiguratorを明示的に注入する
container.addEndpoint(
    ServerEndpointConfig.Builder.create(TerminalSocket.class, "/")
        .configurator(new TerminalSessionConfigurator(allwedOrigin))
        .build());
```

`addEndpoint(Class)` から `addEndpoint(ServerEndpointConfig)` へ切り替えることで、はじめて `checkOrigin` の差し替えが効くようになる。許可Originの値そのものは、インタプリタ側が端末サーバーを起動する際に生成している。

```java
terminalPort = RemoteInterpreterUtils.findRandomAvailablePortOnAllLocalInterfaces();
terminalHostIp = RemoteInterpreterUtils.findAvailableHostAddress();
String allowedOrigin = generateOrigin(terminalHostIp, terminalPort);
terminalThread = new TerminalThread(terminalPort, allowedOrigin);

// ...
private String generateOrigin(String hostIp, int port) {
  return "http://" + hostIp + ":" + port;
}
```

つまり許可されるOriginは `http://<hostIp>:<randomPort>` ただ1つで、これはダッシュボードiframeが実際にロードされるURLと同一である。**「正規のクライアントが送ってくるOriginだけを許可する」**という、許可リストの最小化がそのままコードになっている。

回帰テストも同時に追加されており、クライアント側から任意の `Origin` を送って拒否を確認する形になっている。防御実装の検証方法としてそのまま流用できるので引用する。

```java
private static ClientEndpointConfig getOriginRequestHeaderConfig(String origin) {
  Configurator configurator = new Configurator() {
    @Override
    public void beforeRequest(Map<String, List<String>> headers) {
      headers.put("Origin", Arrays.asList(origin));
    }
  };
  return Builder.create().configurator(configurator).build();
}
```

```java
@Test
void testInvalidOrigin() {
  // ...
  String origin = "http://invalid-origin";
  ClientEndpointConfig clientEndpointConfig = getOriginRequestHeaderConfig(origin);
  // ... connectToServer が失敗することを確認
  assertTrue(exception instanceof IOException);
  assertEquals("Connect failure", exception.getMessage());
}
```

ここで押さえておきたいのは、**「不正なOriginでは接続自体が確立しない」ことをテストで固定している**点である。WebSocketの認可テストは「接続後に何ができるか」に目が行きがちだが、Origin検証は**ハンドシェイク段階で落ちること**が仕様であり、そこをアサートしないと退行に気づけない。自プロダクトにOrigin検証を入れるなら、必ずこの形の否定テスト（不正Origin → ハンドシェイク失敗）をCIに置くこと。

#### この事例から一般化できる教訓

1. **「アプリ本体とは別ポートで上がる補助サーバー」は認証・Origin検証の死角になる**。開発用ターミナル、メトリクス、ライブリロード、デバッガ用のWebSocketは、本体の認証ミドルウェアを通らないことが多い。棚卸しの際は「アプリが listen しているポートすべて」を対象にする。
2. **ランダムポート＋LAN限定は緩和であって防御ではない**。ブラウザは被害者のネットワーク内から接続するため、LANバインドは攻撃者のブラウザ経由で越えられる（いわゆるCSWSH／DNSリバインディング系の文脈）。到達性に依存した「事実上の安全」は、CVSSのスコアが割れる原因にもなる。
3. **検証は完全一致で書く**。`equals` 以外のOrigin比較を見たら、それだけでレビュー指摘の対象になる。
4. **バージョンを明記して管理する**。本件は 0.11.1〜0.11.x が影響を受け、**0.12.0 で修正**された。0.11系にバックポートリリースはないため、緩和ではなくアップグレードが唯一の恒久対策である（2026年9月時点）。

> 出典: NVD — CVE-2024-51775 — https://nvd.nist.gov/vuln/detail/CVE-2024-51775
> 出典: oss-security メーリングリスト「CVE-2024-51775: Apache Zeppelin: Missing Origin Validation in WebSockets」(2025-08-03) — http://www.openwall.com/lists/oss-security/2025/08/03/5
> 出典: apache/zeppelin PR #4823（修正パッチ） — https://github.com/apache/zeppelin/pull/4823

---

### ライトアップ集: Awesome-Bugbounty-Writeups から見るWebSocketの位置づけ

`devanshbatham/Awesome-Bugbounty-Writeups` は、バグバウンティのライトアップを**脆弱性タイプ別**に整理したキュレーションリポジトリである（`ngalongc/bug-bounty-reference` に着想を得たもの）。学習リソースとしての価値は個々の記事だけでなく、**「どのカテゴリにどれだけ報告が集まっているか」という分布そのもの**にもある。

#### コレクションの構造

README は16の脆弱性カテゴリで構成されている。2026年9月時点で、各カテゴリのエントリ数を数えると次の通りである。

| カテゴリ | エントリ数 |
|---|---|
| Cross Site Scripting (XSS) | 294 |
| Remote Code Execution (RCE) | 68 |
| Cross Site Request Forgery (CSRF) | 49 |
| SQL Injection (SQLi) | 34 |
| Server Side Request Forgery (SSRF) | 27 |
| Clickjacking / Subdomain Takeover | 各22 |
| CORS related issues | 15 |
| Local File Inclusion (LFI) | 13 |
| Authentication Bypass / Race Condition | 各12 |
| Denial of Service (DOS) | 11 |
| 2FA related issues | 10 |
| Buffer Overflow | 6 |
| Insecure Direct Object Reference (IDOR) | 5 |
| Android Pentesting | 1 |

ここで重要な観察が2つある。

**第一に、「WebSocket」という独立カテゴリは存在しない。** CSWSHもWebSocket経由XSSも、既存カテゴリ（CSRF / XSS / CORS）の中に埋もれている。これは偶然ではなく、**WebSocketの脆弱性が「新種」ではなく既存脆弱性クラスの輸送路違い**であることの反映である。本教科書がCSWSHをCSRFの延長として、メッセージ経由インジェクションをXSS/SQLiの延長として扱ってきたのと同じ構図が、コミュニティの分類実務にも現れている。

**第二に、その帰結として探索方法が決まる。** WebSocket関連の先行事例を探すときは、「websocket」で検索するだけでは取りこぼす。`CSRF`・`CORS`・`XSS` の各カテゴリを、`socket` / `wss://` / `Origin` といった語で横断的に見る必要がある。

#### WebSocket関連エントリ

このコレクション内でWebSocketに直接関係するエントリは次の通りである。

- **Exploiting websocket application wide XSS**（XSSカテゴリ, 39行目）— Osama Avvan
  https://medium.com/@osamaavvan/exploiting-websocket-application-wide-xss-csrf-66e9e2ac8dfa
- **Exploiting websocket application wide XSS and CSRF**（CSRFカテゴリ, 325行目）— 上と同一URL
- **Full account takeover through CORS with connection sockets**（CORSカテゴリ）— saamux
  https://medium.com/@saamux/full-account-takeover-through-cors-with-connection-sockets-179133384815

注目すべきは、**同一の記事がXSSとCSRFの両カテゴリに重複登録されている**ことである。キュレーターの手違いではなく、この報告が実際に両方の性質を併せ持つためだと読める。WebSocket経由の攻撃は、(1) 別オリジンから接続を開ける（＝CSRFの性質）、(2) 開いた接続から注入したメッセージが他ユーザーのDOMに到達する（＝XSSの性質）という**二段構えになりやすい**。前節で見た「CSWSHは双方向であるがゆえにCSRFより強い」という論点が、分類の重複という形で可視化されている。

#### Exploiting WebSocket [Application Wide XSS / CSRF]

> ⚠️ **未取得の資料**: 「Exploiting WebSocket [Application Wide XSS / CSRF]」（Osama Avvan, Medium）は本文を自動取得できませんでした（理由: MediumがWebFetchに対し HTTP 403 Forbidden を返すため。GitHubミラーにも本文は存在しません）。以下のURLからご自身で直接ご覧ください: https://medium.com/@osamaavvan/exploiting-websocket-application-wide-xss-csrf-66e9e2ac8dfa

検索結果から確認できた範囲では、この報告の骨子は次の通りである。WebSocketメッセージがアプリケーション全体で共有される描画経路に流れ込んでいたため、注入されたペイロードが**特定の1ページではなくWebアプリの全ページで実行される（application wide）**状態になっていた。さらに同じ経路を通じて被害者のメールアドレス変更などの状態変更操作も可能で、これがCSRF／コンテンツインジェクションとしてもアプリ全体に及んだ。PoCとしてはWebSocket接続を張り、`document.body` の内容を書き換えるメッセージを送るデモが用いられ、報告は **P1（最重要）** として受理された、とされている。

（以下は未取得資料の補足として一般知識に基づく解説です）

この「アプリケーション全体に及ぶXSS」という性質は、WebSocket特有の**接続の永続性とブロードキャスト構造**から説明できる。従来の反射型XSSは「特定のURLを踏ませる」必要があり、影響範囲は1リクエスト1ページに閉じる。しかしWebSocketの場合、

- 接続はSPAのシェル（全ページ共通のレイアウト）で1本張られ、ページ遷移をまたいで生き続ける
- 受信メッセージは通知バナーやチャットウィジェットなど、**全ページに常駐するコンポーネント**に渡される
- そのコンポーネントが `innerHTML` 相当のsink（入力が最終的に解釈・実行される危険な代入先）を持っていると、1回の注入が全ページ・全滞在時間にわたって発火する

という条件が揃う。つまり「蓄積型XSSの持続性」と「全ページ常駐UIの到達範囲」が掛け算になる。防御側の含意は明確で、**WebSocketの受信ハンドラは、HTTPレスポンスの描画経路と同等以上に厳格な出力エンコーディングを要求される**。具体的には次のような形になる。

```js
// 危険: サーバーから来た文字列をそのままHTMLとして解釈させている
socket.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  notificationBar.innerHTML = msg.text;   // ← sink
};

// 安全: テキストとして扱い、HTMLパーサに渡さない
socket.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  notificationBar.textContent = msg.text; // パースされず文字列のまま表示される
};
```

`innerHTML` は代入された文字列をHTMLパーサに通すため `<img src=x onerror=...>` のようなペイロードがイベントハンドラとして生きるのに対し、`textContent` はDOMテキストノードを作るだけでパースが起こらない。React/Vueであれば `dangerouslySetInnerHTML` / `v-html` が同じ位置のsinkに当たる。**「WebSocketから来たデータは信頼できる内部データである」という暗黙の前提**が、このクラスの報告の根っこにある。

#### 隣接エントリ: CORS と WebSocket の合流点

CORSカテゴリの「Full account takeover through CORS with connection sockets」も同じ文脈で読む価値がある。CORS設定ミス（`Access-Control-Allow-Origin` をリクエストの `Origin` でそのまま反響し、かつ `Allow-Credentials: true` を返す等）と、ソケット接続によるデータ取得が連鎖してアカウント乗っ取りに至る形である。

ここで押さえるべき原理の対比を再掲する。

| | HTTP + CORS | WebSocket |
|---|---|---|
| クロスオリジン要求の送信 | 常に可能（単純リクエスト） | 常に可能 |
| Cookieの自動付与 | `credentials` 指定時 | 常に付与される |
| プリフライト | 条件により発生 | **発生しない** |
| レスポンス読み取りの遮断 | ブラウザがCORSヘッダで判定 | **遮断されない** |
| 防御の所在 | ブラウザ＋サーバーの協調 | **サーバーのOrigin検証のみ** |

CORS設定ミスの調査でエンドポイントを洗うとき、同じホストの `wss://` エンドポイントも同時に確認すべき理由がこの表に尽きている。CORSのミスは「読み取り可能になる」だけだが、WebSocketのOrigin未検証は最初から「双方向に使える」状態であり、しかもブラウザ側の安全網が一枚もない。

#### 防御側としてのライトアップ集の使い方

このリポジトリは攻撃手順のカタログとしてではなく、**自社サービスに対する仮説生成の道具**として使うのが健全である。実務的な読み方を挙げる。

1. **カテゴリ横断で「自社に存在する機能」に当たる記事だけを読む**。チャット、通知、ライブ更新ダッシュボード、協調編集を持つなら WebSocket 関連3本は必読。
2. **記事から「前提条件」だけを抽出してチェックリスト化する**。例: 「Origin未検証か」「Cookieのみでハンドシェイク認証しているか」「受信メッセージが全ページ常駐UIに届くか」「そのUIは `innerHTML` を使うか」。
3. **社内の検証は必ず自社の検証環境で行う**。これらの記事は既に修正済みの実在サービスを対象にしている。同じ手順を第三者のサービスへ向けることは、たとえ報奨金プログラムがあってもスコープ・規約の確認なしには許されない。

> 出典: devanshbatham/Awesome-Bugbounty-Writeups（README） — https://github.com/devanshbatham/Awesome-Bugbounty-Writeups/blob/master/README.md
> 出典: Osama Avvan「Exploiting WebSocket [Application Wide XSS / CSRF]」（本文未取得） — https://medium.com/@osamaavvan/exploiting-websocket-application-wide-xss-csrf-66e9e2ac8dfa

---

### 本節のまとめ

- **CVE-2024-51775 は「デフォルトが全許可」というAPI設計が脆弱性を生む典型例**である。JSR-356 の `ServerEndpointConfig.Configurator#checkOrigin` は既定で常に `true` を返すため、`addEndpoint(TerminalSocket.class)` と書いた瞬間にOrigin検証は消える。影響は 0.11.1〜0.11.x、修正は 0.12.0。
- 修正パッチは **`allowedOrigin.equals(originHeaderValue)` という完全一致**と、**許可Originを正規クライアントのURLただ1つに絞る**という最小構成で実現されている。加えて「不正Originではハンドシェイクが失敗する」ことを否定テストで固定している。この3点はそのまま自プロダクトの実装規約に転用できる。
- **アプリ本体と別ポートで上がる補助WebSocket（ターミナル、デバッガ、ライブリロード）は認証・Origin検証の死角**になりやすい。listenしているポートを網羅的に棚卸しすること。
- ライトアップ集にWebSocket専用カテゴリが存在せず、同じ記事がXSSとCSRFに重複登録されている事実は、**WebSocketの脆弱性が既存クラスの輸送路違いである**ことを示す。探索も防御も、既存のXSS/CSRF/CORSの知見をWebSocketという経路に接続し直す作業になる。
- WebSocket受信データは外部入力である。全ページ常駐UIに届く経路では、`innerHTML` 系sinkを避け `textContent` 等を使うこと。接続の永続性と常駐UIの到達範囲が掛け合わさると、1回の注入が「アプリケーション全体のXSS」へ増幅される。
