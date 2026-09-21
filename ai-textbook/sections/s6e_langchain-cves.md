## LLMフレームワーク（LangChain）の実CVE

LLMアプリを「素の API 呼び出し」から一段抽象化して、ドキュメントローダー・ツール・エージェント・チェーン・プロンプトテンプレートといった部品を組み合わせられるようにしたのが **LangChain** である。Unit42 の集計時点で 100 万人超の開発者、GitHub スター 8 万超という巨大なエコシステムを持つ。しかしこの「部品の豊富さ」がそのまま攻撃対象領域（アタックサーフェス）になっている。LangChain の CVE を並べると、実は **中身は昔ながらの Web 脆弱性そのもの**——SSRF・OS コマンドインジェクション・安全でないデシリアライズ——であることがわかる。新しいのは「その脆弱な sink（入力が最終的に実行・解釈される危険な代入先）に、LLM の出力や外部ドキュメントというまったく検証されていないデータが流れ込む」という **データフローの構造**のほうだ。

この節では、LangChain の代表的な実 CVE を「昔ながらの脆弱性クラス × LLM 特有のデータフロー」という視点で分解し、各々について「なぜそのコードで脆弱になるのか」をソースコードのパッチ差分レベルで説明する。読者が対象としているのは防御・レビュー・パッチ適用であり、実在サービスへの無許可検証や破壊的手順は本書の範囲外である。

まず全体像を表にまとめる（バージョンは記事・GitHub Advisory 参照時点）。

| CVE | クラス | 脆弱な部品 | 影響パッケージ / 修正版 | CVSS |
|---|---|---|---|---|
| CVE-2023-34540 | OS コマンドインジェクション（RCE） | `JiraAPIWrapper.other()` の `exec()` | `langchain` < 0.0.225 → 0.0.225 | 9.8 |
| CVE-2023-44467 | サンドボックス回避 RCE | `PALChain`（`langchain_experimental`） | `langchain-experimental` ≤ 0.0.14 → 0.0.306 | 9.8 |
| CVE-2023-46229 | SSRF | `RecursiveUrlLoader` | `langchain` < 0.0.317 → 0.0.317 | 8.8 |
| CVE-2025-2828 | SSRF | `RequestsToolkit`（OpenAPI toolkit） | `langchain-community` < 0.0.28 → 0.0.28 | 8.4 |
| CVE-2025-68664 | 安全でないデシリアライズ（LangGrinch） | `dumps()`/`dumpd()` ↔ `load()`/`loads()` | `langchain-core` < 0.3.81、1.0.0〜1.2.4 → 0.3.81 / 1.2.5 | 9.3 |

---

### CVE-2023-34540 — `JiraAPIWrapper` の `exec()` による OS コマンドインジェクション

#### 何が起きたか

LangChain には各種 SaaS を LLM から操作するための「ツール」群があり、その一つが Jira を叩く `JiraAPIWrapper` である。エージェントに「Jira でこういう操作をして」と自然言語で頼むと、LLM が操作内容を決めて `JiraAPIWrapper` を呼ぶ。この `run()` には `jql`（検索）や `create_page` など複数のモードがあり、そのうち「その他の任意の Jira API を呼ぶ」ための `other` モードが決定的に危険だった。

修正前の `langchain/utilities/jira.py` の `other()` はこうなっていた（パッチ差分の削除側）。

```python
def other(self, query: str) -> str:
    context = {"self": self}
    exec(f"result = {query}", context)   # ← query をそのまま Python コードとして実行
    result = context["result"]
    return str(result)
```

`query` は「LLM が生成した文字列」であり、それを `exec()` に文字列連結して渡している。`exec()` は Python の任意コードを実行する組み込み関数だから、ここが完全な RCE sink になる。報告 Issue（#4833, LangChain 0.0.171）の再現手順はこうだ。

```python
jira = JiraAPIWrapper()
output = jira.run('other', "exec(\"import os;print(os.popen('id').read())\")")
```

`os.popen('id')` が実行され、`id` コマンドの出力が返る。攻撃者が `query` を操作できれば——たとえばプロンプトインジェクションで LLM に「`other` モードでこの Python を実行させる」よう誘導できれば——サーバー上で任意コマンドが走る。CVSS は 9.8（認証・UI 不要で機密性・完全性・可用性すべて全損）。

#### なぜそうなるのか（原理）

根本原因は「LLM に**コードを書かせて**、それを**評価器（`exec`）にそのまま渡す**」というアーキテクチャそのものにある。`exec(f"result = {query}", context)` は、`query` が信頼できるコードであるという暗黙の前提の上に成り立っているが、LLM の出力は本質的に「攻撃者が（間接的にでも）内容を左右できる untrusted なテキスト」だ。文字列テンプレートに埋め込んで評価している以上、`query` の中に任意の文がいくつでも書ける（`import os; ...` のようにセミコロンで文を連結できる）。これは SQL 文字列連結によるインジェクションと構造的に同じで、「コードとデータの境界」が消えていることが病理である。

#### 修正（0.0.225）

パッチは `exec()` を廃止し、「Python コードを受け取る」のをやめて「呼びたい関数名と引数を JSON で受け取り、`getattr` でディスパッチする」設計に変えた。

```python
def other(self, query: str) -> str:
    import json
    params = json.loads(query)
    jira_function = getattr(self.jira, params["function"])
    return jira_function(*params.get("args", []), **params.get("kwargs", {}))
```

入力は `{"function": "issue_create", "kwargs": {...}}` のような**データ構造**になり、実行されるのは `self.jira` の属性として実在するメソッドだけになった。`getattr` によるディスパッチは「任意コード」ではなく「許可された名前空間内のメソッド呼び出し」に制限される。プロンプトも「Python コードを渡せ」から「関数名と引数の辞書を渡せ」に書き換えられ、そもそも LLM にコードを書かせない方針に転換した。これが「コードとデータの境界を復活させる」典型的な修正である。

> ⚠️ **未取得の資料**: GitLab Advisory「CVE-2023-34540」ページは自動取得できませんでした（理由: サイトが JavaScript レンダリング前提で本文が空になり抽出不可）。以下からご自身でご覧ください: https://advisories.gitlab.com/pkg/pypi/langchain/CVE-2023-34540/
>
> （以下は未取得資料の補足として一般知識に基づく解説です）GitLab Advisory は基本的に GitHub Security Advisory（GHSA-x32c-59v5-h7fg）と同一の内容を再掲しており、CWE-78（OS Command Injection）、影響 `langchain < 0.0.225`、修正 0.0.225、CVSS 9.8 という点は本文の記述と一致する。上記のコード差分・CVSS・影響範囲は GitHub Advisory API（GHSA-x32c-59v5-h7fg）および修正コミット `a2f191a` から直接取得・検証したものである。

> 出典: Unit42 "LangChain Vulnerabilities" — https://unit42.paloaltonetworks.com/langchain-vulnerabilities/ ／ GitHub Advisory GHSA-x32c-59v5-h7fg（コミット a2f191a、Issue #4833）— https://github.com/advisories/GHSA-x32c-59v5-h7fg

---

### CVE-2023-44467 — `PALChain` のブロックリスト回避による RCE

#### PALChain とは

`PALChain`（Program-Aided Language model）は「LLM に問題を解く Python コードを書かせ、それを実行して答えを得る」チェーンである。数学の文章題などで有効な反面、「LLM 生成コードを実行する」という設計そのものが RCE の温床になる。危険性は認識されており、`allow_imports`（`import` 文を AST 検査でブロック）と `allow_command_exec`（`system`, `exec`, `execfile`, `eval` の 4 つをブロックリスト化）という二重の防御が入っていた。

#### バイパスの原理

問題はブロックリストが不完全だったことだ。この CVE（別名としては CVE-2023-36258 の修正回避）は、`import` 文を使わずにモジュールを読み込む Python の組み込み関数 **`__import__()`** が禁止対象に入っていなかった点を突く。攻撃者はプロンプトインジェクションで LLM に次のようなコードを生成させる。

```python
__import__('subprocess').run(['id'])
```

これは AST 上「`import` 文」ではなく「関数呼び出し」なので `allow_imports` の検査をすり抜け、`system`/`exec`/`execfile`/`eval` のいずれでもないのでブロックリストにも当たらない。しかし `__import__('subprocess')` は `import subprocess` と等価にモジュールオブジェクトを返すため、そこから `subprocess.run` を呼べば任意コマンドが実行できる。CVSS 9.8。

これは「ブロックリスト（拒否リスト）方式の防御は、言語の抜け道を一つ見落とすだけで破れる」という原理の教科書的な例だ。Python は動的で、同じ効果を出す書き方が複数ある（`import X` / `__import__('X')` / `importlib.import_module('X')` など）。禁止すべき文字列を列挙する方式は、こうした等価表現を全部潰さない限り穴が残る。

#### 修正と本質的な限界

修正（PR #11233、`langchain-experimental` 0.0.306）はブロックリストに `__import__` などを追加して穴を塞いだ。ただし本質的には「LLM が生成した任意 Python を評価する」設計自体がハイリスクであり、LangChain 公式も `PALChain` を含む実験的機能を `langchain_experimental` に隔離し、利用側に強い注意を促している。Flatt Security の記事が「利用側の教訓」として真っ先に挙げるのも、`PythonREPLTool` や `PALChain` のような**実験的・危険な機能を設計段階で回避する**ことだ。ブロックリストを追いかけるより、そもそも untrusted なコード生成を実行系に流さないアーキテクチャにするのが正解である。

> 出典: Unit42 "LangChain Vulnerabilities" — https://unit42.paloaltonetworks.com/langchain-vulnerabilities/ ／ GitHub Advisory GHSA-gjjr-63x4-v8cq（PR #11233）— https://github.com/advisories/GHSA-gjjr-63x4-v8cq

---

### CVE-2023-46229 — `RecursiveUrlLoader` の SSRF

#### 何が起きたか

`RecursiveUrlLoader` は、起点 URL からページ内リンクを再帰的に辿ってドキュメントを収集する「クローラー型ローダー」である。RAG（検索拡張生成）のためにサイト全体を取り込む用途に使われる。SSRF（Server-Side Request Forgery: サーバーに攻撃者の指定した先へリクエストを送らせる脆弱性）が成立したのは、**辿る URL のスコープ（範囲）に制限がなかった**ためだ。GitHub Advisory の記述はこうだ。

> LangChain before 0.0.317 allows SSRF via `document_loaders/recursive_url_loader.py` because crawling can proceed from an external server to an internal server.

外部サーバーのページ内に `http://169.254.169.254/latest/meta-data/`（クラウドのインスタンスメタデータ）や `http://localhost:8500/`（内部サービス）へのリンクを仕込んでおき、そのページを起点にクローラーを走らせれば、クローラーは内部リソースへ GET リクエストを送ってしまう。Unit42 の解説は同系統の `SitemapLoader`（`WebBaseLoader` を継承し、`scrape_all` が `aiohttp.ClientSession.get` を宛先の検証なしに呼ぶ）を例に、悪意ある sitemap に intranet URL を並べることで内部リソースへの不正アクセス・機密データ（社会保障番号や従業員住所など）の窃取・内部 API 経由の攻撃に繋がると述べている。

#### なぜそうなるのか（原理）

SSRF の核心は「サーバーは内部ネットワークに対して特権的な位置にいる」ことだ。外からは届かない `localhost`・プライベート IP・クラウドメタデータエンドポイントに、サーバー自身は到達できる。クローラーが「取り込むべき URL」を外部データ（ページ内リンクや sitemap）から無検証で受け取ると、その「外部データを書いた者」がサーバーのリクエスト先を実質的に指定できてしまう。ここでの untrusted データは「クロール対象ページの中身」であり、これは完全に攻撃者側のコントロール下にある。

#### 修正（0.0.317）

修正は「デフォルトで起点 URL と同一ドメイン以外を辿らない」制限（`prevent_outside` 引数）を導入し、ドキュメントに明確なセキュリティ注意書きを追加した。修正コミットのソースコメントが原理をよく説明している。

```
While crawling, the crawler may encounter malicious URLs that would lead to a
server-side request forgery (SSRF) attack.

To mitigate risks, the crawler by default will only load URLs from the same
domain as the start URL (controlled via prevent_outside named argument).

This will mitigate the risk of SSRF attacks, but will not eliminate it.
```

重要なのは最後の一文「**緩和はするが、根絶はしない**」だ。同一ドメイン制限には限界がある。マルチテナントで `https://some_host/alice_site/` と `https://some_host/bob_site/` が同じホストに同居している場合、Alice のサイト上の悪意あるリンクから Bob のサイトのエンドポイントへリクエストを飛ばせてしまう（同一ホスト＝同一ドメイン判定を通過する）。だから根本対策は「**クローラーに内部ネットワークへのアクセス権を与えないネットワーク分離**」であり、アプリ層の allowlist はあくまで多層防御の一枚である。Flatt Security の記事も対策として「allowlist 形式での URL 検証フィルタ追加」を挙げている。

> 出典: Unit42 "LangChain Vulnerabilities" — https://unit42.paloaltonetworks.com/langchain-vulnerabilities/ ／ GitHub Advisory GHSA-655w-fm8m-m478（PR #11925、コミット 9ecb724）— https://github.com/advisories/GHSA-655w-fm8m-m478 ／ Flatt Security「LLM を活用したアプリケーションの脆弱性」— https://blog.flatt.tech/entry/llm_framework_security

---

### CVE-2025-2828 — `RequestsToolkit` の SSRF

#### 何が起きたか

これも SSRF だが、こちらは「エージェントに HTTP リクエストを送らせるツール」である `RequestsToolkit`（`langchain_community.agent_toolkits.openapi.toolkit.RequestsToolkit`）が舞台だ。GitHub Advisory（GHSA-h5gc-rm8j-5gpr）の記述はこうだ。

> the toolkit does not enforce restrictions on requests to remote internet addresses, allowing it to also access local addresses.

このツールキットは `RequestsGetTool`/`RequestsPostTool` など GET/POST/PATCH/PUT/DELETE の各ツールを提供し、OpenAPI 仕様を与えるとエージェントが自律的に API を叩く。宛先アドレスに制限がないため、リモートだけでなくローカルアドレスにもアクセスできてしまう。結果として、ポートスキャン、ローカルサービスへのアクセス、クラウド環境（Azure・AWS 等）のインスタンスメタデータの取得、内部ネットワーク上のサーバーとの通信が可能になる。CVSS は 8.4（`PR:H`＝高権限が前提だが、`S:C`＝スコープ変更ありで機密性・完全性・可用性が高影響）。修正版は `langchain-community` 0.0.28。

#### なぜそうなるのか、そして修正の考え方

原理は CVE-2023-46229 と同じ SSRF だが、こちらは「LLM エージェントが送信先 URL を決める」ため、プロンプトインジェクションで送信先を `169.254.169.254` などに誘導されるリスクが直接的だ。攻撃者が LLM への入力（あるいは取り込ませたドキュメント）を操作できれば、エージェントは「内部 API を叩け」という指示に素直に従ってしまう。

修正は URL フィルタを足すのではなく、**「危険であることを明示的に自覚させる」オプトイン方式**を採った。パッチ差分では各リクエストツールの基底クラスに `allow_dangerous_requests` フラグが追加され、初期化時に明示的に `True` を渡さない限り例外で拒否するようになった。

```python
class BaseRequestsTool(BaseModel):
    requests_wrapper: GenericRequestsWrapper
    allow_dangerous_requests: bool = False

    def __init__(self, **kwargs: Any):
        if not kwargs.get("allow_dangerous_requests", False):
            raise ValueError(
                "You must set allow_dangerous_requests to True to use this tool. "
                "Request scan be dangerous and can lead to security vulnerabilities. "
                "For example, users can ask a server to make a request to an internal "
                "server. ..."
            )
        super().__init__(**kwargs)
```

この設計の意図は「利用者に SSRF リスクを認識させ、プロキシ経由・サンドボックス化・信頼できない入力の排除といった対策を講じたうえで**意図的に有効化**させる」ことにある。フレームワーク側で URL を完璧にフィルタするのは（内部 IP のバリエーション、DNS リバインディング、リダイレクトなどがあり）困難なので、「危険な機能はデフォルト無効・明示同意で有効化」という安全側のデフォルトに倒したわけだ。Flatt Security の記事も、利用側は `allow_dangerous_requests` のような危険オプションを設計段階で避けるべきだと述べている。

> ⚠️ **未取得の資料**: GitLab Advisory「CVE-2025-2828」ページは自動取得できませんでした（理由: サイトが JavaScript レンダリング前提で本文が空になり抽出不可）。以下からご自身でご覧ください: https://advisories.gitlab.com/pkg/pypi/langchain-community/CVE-2025-2828/
>
> （以下は未取得資料の補足として一般知識に基づく解説です）本文の記述（CWE-918 SSRF、影響 `langchain-community < 0.0.28`、修正 0.0.28、CVSS 8.4、`RequestsToolkit` 由来）は GitHub Advisory（GHSA-h5gc-rm8j-5gpr）および修正コミット `e188d4e` から直接取得・検証したもので、GitLab Advisory の再掲内容と一致する。報告は huntr のバウンティ（8f771040-...）経由。

> 出典: GitHub Advisory GHSA-h5gc-rm8j-5gpr（コミット e188d4e）— https://github.com/advisories/GHSA-h5gc-rm8j-5gpr

---

### CVE-2025-68664「LangGrinch」— `langchain-core` の安全でないデシリアライズ RCE / シークレット窃取

これは 2025 年 12 月に Cyata の Yarden Porat が公開した、`langchain-core` の中核シリアライズ機構を突く脆弱性で、CVSS **9.3**（Critical）。前述の CVE 群が「危険な部品を使ったときだけ」危ないのに対し、これは **`astream_events(version="v1")` や `RunnableWithMessageHistory` など広く使われる機能が内部で踏む**ため、影響範囲が桁違いに広い。

> ⚠️ **未取得の資料**: Cyata のブログ「All I Want for Christmas is Your Secrets: LangGrinch hits LangChain Core」は自動取得できませんでした（理由: `cyata.ai` が `checkpoint.com/ai-security/` へ 301 リダイレクトし、本文が取得できなかった。Wayback も 429 / アクセス不可）。以下からご自身でご覧ください: https://cyata.ai/blog/langgrinch-langchain-core-cve-2025-68664/
>
> 以下の技術解説は、LangChain 公式のセキュリティアドバイザリ（GHSA-c67j-w6g6-q2cm）本文・修正コミット・The Hacker News の Cyata 取材記事から取得・再構成したものである。

#### 仕組み — `lc` マーカーと「エスケープ漏れ」

LangChain はオブジェクトを JSON にシリアライズ（直列化）するとき、「これは単なる辞書ではなく LangChain のオブジェクトだ」と示すために予約キー **`'lc'`** を使う。たとえば環境変数から読むシークレットは、シリアライズ表現上こう表される。

```json
{"lc": 1, "type": "secret", "id": ["OPENAI_API_KEY"]}
```

`load()`/`loads()`（デシリアライズ）は、辞書に `'lc'` キーがあると「マニフェスト（オブジェクト復元指示）」とみなし、`type` に応じてシークレットの読み込みやクラスのインスタンス化を行う。ここで **`type: "secret"` は、デシリアライズ時に `id` で指定された名前の環境変数を読み込んで実際の値に展開する**（旧デフォルト `secrets_from_env=True` のとき）。

脆弱性の本体は、逆方向の `dumps()`/`dumpd()`（シリアライズ）にあった。Advisory の言葉を借りれば「これらの関数は自由形式の辞書をシリアライズする際、`'lc'` キーを持つ辞書を**エスケープしなかった**」。つまり、ユーザー由来の辞書がたまたま（あるいは意図的に）`'lc'` キーを含んでいても、それを「ただのユーザーデータ」として無害化せず、そのまま出力してしまう。その出力を後で `load()` すると、注入された構造が「正規の LangChain マニフェスト」として解釈される。CWE-502（Deserialization of Untrusted Data）そのものだ。

#### 攻撃の流れ — 自分の出力すら信用できない

Advisory が載せる最小の再現例が原理を端的に示す。

```python
from langchain_core.load import dumps, load
import os

# 攻撃者がユーザー制御フィールドに secret 構造を注入
attacker_dict = {
    "user_data": {
        "lc": 1,
        "type": "secret",
        "id": ["OPENAI_API_KEY"]
    }
}

serialized = dumps(attacker_dict)   # バグ: 'lc' キーをエスケープしない

os.environ["OPENAI_API_KEY"] = "sk-secret-key-12345"
deserialized = load(serialized, secrets_from_env=True)

print(deserialized["user_data"])   # "sk-secret-key-12345" ← シークレット漏洩！
```

注目すべきは、これが「攻撃者から受け取ったデータを直接デシリアライズした」ケースではなく、**アプリが自分で `dumps()` した出力を自分で `load()` しただけ**で成立している点だ。「自分のシリアライズ出力なら信用できる」という前提が崩れている。ユーザー由来の値が `'lc'` 構造を含んでいれば、往復（dump→load）を経ただけでシークレットが環境変数から抜き出される。

より現実的な侵入経路は **LLM の応答フィールド**だ。Advisory は「最も一般的な攻撃ベクトルは `additional_kwargs` や `response_metadata` のような LLM 応答フィールドで、これらはプロンプトインジェクションで制御でき、ストリーミング処理でシリアライズ/デシリアライズされる」と述べている。攻撃連鎖はこうなる。

1. 攻撃者が（外部ドキュメントやユーザー入力を通じて）LLM にプロンプトインジェクションを仕込む
2. LLM が応答の `additional_kwargs`/`response_metadata` に `{"lc":1,"type":"secret","id":["...")]}` のような構造を出力する
3. アプリが `astream_events(version="v1")` や `astream_log()`、`RunnableWithMessageHistory` 等でその応答をシリアライズ→デシリアライズする
4. デシリアライズ時に環境変数のシークレット（API キー等）が展開され、応答テキストや後続処理に混入 → 外部へ流出しうる

#### 影響の広さと第二の攻撃面

Advisory は影響を受ける「フロー」を 12 種類挙げている。代表例だけでも `astream_events(version="v1")`、`Runnable.astream_log()`、`RunnableWithMessageHistory`、`InMemoryVectorStore.load()`、`langchain-community` のキャッシュ、`hub.pull`（LangChain Hub からのマニフェスト取得）など、日常的に使われる機能が並ぶ（なお `astream_events(version="v2")` は影響を受けない）。

シークレット窃取に加えて、もう一つの攻撃面が**クラスのインスタンス化**だ。注入したマニフェストで、信頼済み名前空間（`langchain_core`, `langchain`, `langchain_community`）内の任意の `Serializable` サブクラスを、攻撃者制御のパラメータでインスタンス化できる。`__init__` で副作用（ネットワーク呼び出し・ファイル操作など）を起こすクラスがあれば、それをトリガーにできる。ただし名前空間の検証はこのパッチ以前から効いており、**信頼済み名前空間の外**の任意クラス（例: `os.system` 相当）を直接インスタンス化することはできなかった点は正確に理解しておきたい。さらに Jinja2 テンプレートを復元させられると、Jinja2 が任意 Python を実行しうるため RCE に発展する余地がある。

#### 修正（0.3.81 / 1.2.5）— 安全なデフォルトへの転換

パッチは二段構えだ。第一に `dumps()`/`dumpd()` のエスケープ漏れを修正（`'lc'` を含むユーザー辞書を正しく無害化）。第二に、より重要なのが `load()`/`loads()` の**デフォルトを安全側に倒す破壊的変更**である。

- **`allowed_objects`（新規、デフォルト `'core'`）**: デシリアライズ可能なクラスを allowlist で制限する。`'core'` は `langchain_core` 内のオブジェクトのみ、`'all'` は `mapping.py` の定義全体。任意クラスのインスタンス化を絞り込む。
- **`secrets_from_env` を `True` → `False`** に変更: 環境変数からのシークレット自動読み込みを既定で無効化。前掲の secret 窃取はこのデフォルト変更で塞がれる。
- **`init_validator`（新規、デフォルト `default_init_validator`）**: Jinja2 テンプレートを既定でブロックする。

移行時、標準的な LangChain 型（メッセージ・ドキュメント・プロンプト・`ChatOpenAI` 等の信頼済みパートナー統合）を扱うだけなら変更不要だが、カスタムクラスをデシリアライズする場合は `load(serialized, allowed_objects=[MyCustomClass])` のように明示指定が要る。Jinja2 が必要なら `init_validator=None` を渡すが、Advisory は「シリアライズデータを信頼できる場合にのみ無効化せよ。Jinja2 は任意 Python を実行しうる」と強く警告している。環境変数からのシークレット読み込みが必要なら `secrets_from_env=True` を明示する。

この修正思想は CVE-2025-2828 と共通で、「危険な挙動をデフォルト無効・明示オプトインにする」ことだ。デシリアライザは本質的に「データに書かれた指示でオブジェクトを組み立てる」機能なので、untrusted データに対しては allowlist を効かせなければ pickle 級の危険物になる。

なお同時に JavaScript 版 **LangChain.js の CVE-2025-68665（CVSS 8.6）** も公開された。影響は `@langchain/core` < 0.3.80 および 1.0.0〜1.1.7（修正 0.3.80 / 1.1.8）、`langchain` < 0.3.37 および 1.0.0〜1.2.2（修正 0.3.37 / 1.2.3）。公開日は 2025-12-04。

> 出典: GitHub Security Advisory GHSA-c67j-w6g6-q2cm — https://github.com/advisories/GHSA-c67j-w6g6-q2cm ／ The Hacker News "Critical LangChain Core Vulnerability"（Cyata / Yarden Porat 取材）— https://thehackernews.com/2025/12/critical-langchain-core-vulnerability.html ／ Cyata "LangGrinch"（未取得）— https://cyata.ai/blog/langgrinch-langchain-core-cve-2025-68664/

---

### まとめ — LLM フレームワーク特有の「防御の型」

これらの CVE を貫く教訓は、Flatt Security の記事が整理するとおり「利用側」と「実装側」の二層で捉えると見通しがよい。

**共通する原理**は次の 3 点だ。

1. **LLM の出力・外部ドキュメントは untrusted なデータである。** `exec()`（CVE-2023-34540）、コード生成の実行（CVE-2023-44467）、クロール URL（CVE-2023-46229）、リクエスト先 URL（CVE-2025-2828）、シリアライズ構造（CVE-2025-68664）——すべて「LLM/外部データを信頼できる入力として扱った」ことが病理だ。プロンプトインジェクションが間接的な「入力操作手段」になるため、境界は常に untrusted 側にある。
2. **ブロックリストは破れ、allowlist と安全なデフォルトが効く。** PALChain のブロックリスト方式は `__import__` で回避された。対して RequestsToolkit / LangGrinch は「危険機能はデフォルト無効・明示オプトイン」「デシリアライズ対象を allowlist 化」という安全側デフォルトへ転換した。
3. **アプリ層の緩和には限界があり、多層防御が要る。** SSRF の同一ドメイン制限は同居ホストで破れる。根本対策は「クローラー/リクエストツールに内部ネットワークへの到達性を与えないネットワーク分離」であり、コード上のフィルタはその一枚にすぎない。

**利用側の実務**としては、(a) `PALChain`・`PythonREPLTool`・`allow_dangerous_requests` などリスクの高い実験的・危険機能を設計段階で回避する、(b) `langchain-core` を含む依存を常に最新パッチへ更新し、特に CVE-2025-68664 は `astream_events` の version 指定や `load()` のデフォルト変更に留意する、(c) LLM とツールに与える権限・ネットワーク到達性を最小化する、(d) LLM 出力を後段の危険な sink（コード実行・デシリアライズ・HTTP リクエスト）へ流す経路をレビューし、必要なら中間で検証・サンドボックス化する、という順で優先度を付けるとよい。
