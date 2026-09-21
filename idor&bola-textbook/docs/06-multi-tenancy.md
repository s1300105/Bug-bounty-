# 第6章 マルチテナンシーと組織境界の脆弱性

## マルチテナント分離モデルと設計観点

マルチテナント（multi-tenant）アーキテクチャとは、複数の顧客組織（テナント: tenant、SaaSを契約する単位となる顧客組織や部門）が、共有のインフラ・コードベース・多くの場合は共有のデータベースを利用してサービスを受ける構成のことである。運用効率とコスト削減の面で優れる一方、「単一の脆弱性や設定ミスが全テナントのデータを一度に露出させる」という根本的なリスクを内包する。IDOR/BOLA（Broken Object Level Authorization、オブジェクトレベル認可の欠如）はテナント境界においても最頻出の脆弱性クラスであり、本章ではその土台となる分離モデルと設計観点を、防御者・診断者双方の視点で整理する。

### なぜテナント境界がIDOR/BOLAの主戦場になるのか

単一テナント（オンプレミス1社1インスタンス）のアプリケーションでは、認可の失敗は「同一組織内のユーザー同士の水平権限昇格」にとどまる。しかしマルチテナントSaaSでは、認可の失敗は「契約上まったく無関係な別会社・別組織のデータへの到達」を意味する。攻撃者から見れば、境界を破る労力に対してリターン（到達できるデータの範囲と価値）が桁違いに大きいため、マルチテナントSaaSは意図的にテナント越境を狙う偵察・悪用の対象になりやすい。したがって、この章で扱う「分離モデル」を理解することは、後続の章で扱う具体的なIDOR/BOLA検出手法の前提知識となる。

### 3つの基本分離モデル：Silo / Pool / Bridge

`systemshardening.com` の整理によれば、マルチテナントの分離アーキテクチャは大きく3つのモデルに分類できる。

#### Silo（完全分離）モデル

テナントごとに独立したデータベース、場合によっては独立したアプリケーションインスタンスやクラウドアカウントそのものを割り当てる構成である。

- **隔離強度**: 最大。あるテナントのコード内脆弱性やクエリバグが発生しても、そもそも別テナントのデータが物理的・論理的に同じ実行コンテキストに存在しないため、越境が起こり得ない。
- **コスト**: 最も高い。テナント数がN社であれば、パッチ適用・監視・バックアップなどの運用作業が理論上N倍になる。
- **用途**: 金融・医療など規制が厳しい業界の顧客、あるいは大口契約で専有インフラを要求する顧客向けに採用されることが多い。

#### Pool（論理分離）モデル

全テナントが同一のインフラ（同一DB、同一テーブル、同一アプリケーションプロセス）上で稼働し、行単位・レコード単位のソフトウェアロジックで分離する構成である。

- **隔離強度**: 実装の規律に完全に依存する。記事は「一つの漏れたクエリ（tenant_idのWHERE句を書き忘れたSQL）が全体を破壊する」と端的に表現している。これはまさにIDOR/BOLAが生まれる温床であり、本教科書がPoolモデルの内部実装を重点的に扱う理由でもある。
- **コスト**: 最も低い。運用対象が単一のスタックに集約される。
- **必須実装**: すべてのクエリへのテナントフィルタの強制、テナント識別子を含んだキャッシュキー設計など、「漏れなく全経路を塞ぐ」ことが要求される。

#### Bridge（ハイブリッド）モデル

大口・高セキュリティ要件のテナントはSiloで、小口テナントはPoolで収容する、あるいは複数の独立したPool群（しばしば「Pod」や「Cell」と呼ばれる）に段階的に分割する構成である。

- **実装課題**: どのテナントをどのPod/スタックへルーティングするかを決定する「ルーティング層」自体が新たな攻撃対象になる。ルーティング層のロジックにバグがあれば、テナントAのリクエストが誤ってテナントBのSiloやPodに配送されてしまう可能性がある。

> 出典: Multi-tenancy security patterns — https://www.systemshardening.com/articles/cross-cutting/multi-tenancy-security-patterns/

これら3モデルは、OWASP Multi Tenant Security Cheat Sheetが挙げる「独立DB／スキーマ分離／行レベル分離／ハイブリッド」というデータベース分離戦略のマトリックスとも対応関係にある。独立DBはSiloに、行レベル分離（Row-Level Security, RLS）はPoolに、スキーマ分離やハイブリッドはBridgeに近い性質を持つ。設計者はデータの機密度・脅威モデル・運用コストのバランスで、どのモデルをどのデータクラスに適用するかを決定する必要がある。

### テナント識別子の抽出と伝播：信頼できる情報源はどこか

IDOR/BOLA診断で最初に確認すべきは、「サーバーはどこからテナントIDを取得しているか」である。ここに欠陥があると、以降のあらゆる認可チェックが無意味になる。

#### 信頼できないパターン（アンチパターン）

```python
# 危険：クライアントが送ってきたヘッダをそのまま信用する
tenant_id = request.headers.get("X-Tenant-ID")
db.execute("SELECT * FROM data WHERE tenant_id = :tid", {"tid": tenant_id})
```

なぜ危険なのか。HTTPヘッダやリクエストボディ中のパラメータは、攻撃者が任意に書き換えられるクライアント制御下の値である。この値を「認可の根拠」として使ってしまうと、攻撃者は単に `X-Tenant-ID` を別テナントのIDに書き換えるだけで越境アクセスが成立する。OWASP Cheat Sheetは「クライアント提供のテナントIDは “セレクタ”（表示上の切り替え候補）としてのみ扱い、認可の証拠にしてはならない」と明記している。

#### 信頼できるパターン

- **署名済みトークンのクレーム**: ログイン時に発行されるJWTに `tenant_id` クレームを含め、各サービスが署名検証（例: `jwt.decode(token, public_key, algorithms=["RS256"])`）を行った上でこのクレームを抽出する。署名鍵を持たない攻撃者はクレームを偽造できない。
- **信頼済みIngressヘッダ**: サブドメインルーティング（`alice.saas.example.com` のようにテナントごとにホスト名を分ける）を、境界のリバースプロキシ／Ingressが検証・書き換えて内部ヘッダに注入する構成。ここで重要なのは「アプリケーション層に到達する前に境界で検証済みである」という点であり、内部ネットワークに直接アクセスできない前提が成り立っている必要がある。

```python
# 正しい例：検証済みJWTクレームからテナントを導出する
token_claims = request.state.verified_claims  # 署名検証済み
tenant_id = token_claims.get("tenant_id")
principal_id = token_claims.get("sub")

membership = await tenant_service.get_active_membership(principal_id, tenant_id)
if not membership:
    return JSONResponse(status_code=403)
```

この例のポイントは、単にJWTからtenant_idを取り出すだけでなく、「そのユーザー（principal）が現時点でそのテナントの有効なメンバーであるか」を都度DBやサービスに問い合わせて再確認している点である。JWTは発行時点のスナップショットであり、発行後にユーザーがテナントから除名された場合でも、トークンの有効期限内はクレームだけを信じると除名後もアクセスが継続してしまう（後述の「頻出ミス」にも関連する）。

抽出したテナントコンテキストは、リクエスト処理の最初期段階でミドルウェア／インターセプタによって確立し、以降のハンドラ関数へは明示的なパラメータではなく、リクエストスコープの状態（例: `request.state.tenant_id`、Pythonの `contextvars`）として束縛することが推奨される。

```python
from contextvars import ContextVar
current_tenant = ContextVar('current_tenant', default=None)

class TenantMiddleware:
    async def __call__(self, request, call_next):
        # ...検証済みクレームからmembershipを確認...
        ctx = TenantContext(tenant_id, principal_id, membership.roles)
        token = current_tenant.set(ctx)
        try:
            return await call_next(request)
        finally:
            current_tenant.reset(token)
```

なぜハンドラの引数としてテナントIDを受け取らせないのか。関数シグネチャに `def get_invoice(tenant_id: str, invoice_id: str)` のように直接テナントIDを含めてしまうと、呼び出し側のどこか一箇所で誤って別の変数やリクエストパラメータをうっかり渡してしまうミスが起こり得る。コンテキスト変数やミドルウェアで一元的に束縛すれば、「渡し忘れ」「渡し間違い」というヒューマンエラーの入り込む余地を構造的に減らせる。

> 出典: Multi Tenant Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
> 出典: Multi-tenancy security patterns — https://www.systemshardening.com/articles/cross-cutting/multi-tenancy-security-patterns/

### データベース層での分離：スキーマ分離とRow-Level Security(RLS)の仕組み

#### スキーマ分離（Schema-Per-Tenant）とその落とし穴

PostgreSQLではテナントごとに別スキーマを割り当て、セッションの `search_path`（未修飾のテーブル名をどのスキーマから解決するかを決めるパス設定）を切り替えることで分離を実現できる。

```sql
SET search_path = tenant_alice, public;
SELECT * FROM orders WHERE id = $1;
```

このモデルの危険性は、`search_path` 自体がセッション変数であり、アプリケーション層のバグ（他テナント処理後のリセット漏れ、接続プールでの使い回し時の設定残留など）によって攻撃者が意図せず別テナントのスキーマを参照してしまう余地がある点にある。対策として、DBロール自体に `search_path` を固定してしまう方法が有効である。

```sql
ALTER ROLE tenant_alice_role SET search_path = tenant_alice;
```

こうすることで、アプリケーションコードが `SET search_path` を発行し忘れても、そのDBロールで接続している限り常に正しいスキーマが優先される。

#### Row-Level Security（RLS）：DBエンジンによる多層防御

RLS（行レベルセキュリティ）は、PostgreSQLなどのRDBMSが提供する機能で、テーブルの各行に対して「どの条件を満たすセッションだけがその行を見られるか」というポリシーをDBエンジン自身が強制する仕組みである。

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders
  FOR ALL USING (tenant_id = current_setting('app.current_tenant')::uuid);
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
```

ここでの核心は「なぜこれが多層防御として機能するのか」である。アプリケーション層のORMやSQL生成コードが `WHERE tenant_id = ?` を書き忘れるバグ（=典型的なBOLAの根本原因）を作り込んでしまったとしても、RLSポリシーが有効であればDBエンジン自身がクエリ実行時にこの条件を暗黙的にAND結合して評価する。つまり、アプリケーションコードの認可ロジックが単一障害点にならず、データベースという別レイヤーが最後の砦として機能する。

RLSを機能させる上で理解しておくべき重要な制限がある。

- **スーパーユーザーと `BYPASSRLS` 権限を持つロールはRLSをすり抜ける。** 通常のアプリケーションが使う接続ロールには、決してこれらの権限を与えてはならない。マイグレーションや管理ジョブなど、明示的に許可された特権接続のみがこの権限を持つべきである。
- **テナントコンテキストは `SET LOCAL` でトランザクションスコープに設定する。** `SET app.current_tenant = ...`（`LOCAL` なし）はセッション全体に効いてしまうため、コネクションプーリングで接続が使い回された際に、前のリクエストのテナント設定が後続のリクエストに漏れ残る危険がある。`SET LOCAL` を使えば設定はトランザクションの終了と同時に自動的に破棄される。

```sql
-- トランザクションローカルなテナント設定（漏洩防止）
SET LOCAL app.tenant_id = 'uuid-value';
```

- **設定が存在しない場合はfail-close（拒否側に倒す）。** `current_setting()` にNULLフォールバックを与えてしまうと、テナントコンテキストが未設定のリクエストが「制限なし」として扱われてしまう危険があるため、テナント設定が欠落している状態を明示的にエラーとして扱う設計が必要である。

#### 独立データベース（Database-Per-Tenant）

接続文字列自体をテナントごとに管理し、リクエスト時に解決する方式。共有DBという攻撃対象そのものを排除できる最も強い分離だが、Siloモデル同様に運用コストが高い。

> 出典: Multi Tenant Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
> 出典: Multi-tenancy security patterns — https://www.systemshardening.com/articles/cross-cutting/multi-tenancy-security-patterns/

### クロステナントIDOR/BOLAの典型パターンと修正

#### 単純な欠落パターン

```python
# 脆弱：tenant_idチェックが存在しない
@app.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: str):
    return db.query(Invoice).filter(Invoice.id == invoice_id).first()
```

このエンドポイントは、リクエストしてきたユーザーがどのテナントに属しているかに関わらず、有効な `invoice_id` さえ知っていれば任意のテナントの請求書を取得できてしまう。これはIDOR/BOLAの最も基本的な形である。

```python
# 修正：認証済みテナントIDと複合キーでフィルタする
@app.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: str, request: Request):
    tenant_id = request.state.tenant_id  # 検証済みコンテキストから取得
    invoice = db.query(Invoice).filter(
        Invoice.id == invoice_id,
        Invoice.tenant_id == tenant_id  # 所有権の確認
    ).first()
    if not invoice:
        raise HTTPException(status_code=404)  # 存在確認と権限確認を同一の404に統一
    return invoice
```

ここで404を返す設計には理由がある。「対象のIDが存在するが権限がない」場合に403を返し、「そもそも存在しない」場合に404を返すよう作り分けてしまうと、レスポンスの違いから攻撃者はIDの有効性（＝他テナントのリソースが実在するかどうか）を推測できてしまう（IDOR探索における一種の情報漏洩=oracleとなる）。両ケースを404に統一することで、この推測を防ぐ。

補助的な対策として、連番の整数IDではなくUUID v4のような予測困難なIDを採用することも有効だが、これはあくまで「総当たりを困難にする」補助策であり、認可チェックそのものの代替にはならない。連番IDと組み合わせて認可が抜けている場合、攻撃者はID空間を線形にスキャンするだけでテナント数やレコード数を推測できてしまう点にも注意が必要である。

#### Confused Deputy（サービス間呼び出しでのコンテキスト喪失）

マイクロサービス構成では、フロントのAPIゲートウェイでテナント検証を行っても、内部のgRPC呼び出しなどでそのコンテキストを引き継がなければ意味がない。

```
gRPCのメタデータに x-tenant-id を毎回含めることが必須であり、
呼び出される側のサービスも、そのJWTのテナントクレームを独立に再検証しなければならない。
```

「ゲートウェイで検証したから内部サービスは信用してよい」という発想は誤りである。内部サービスへのアクセス経路が複数存在する場合（デバッグ用の直接呼び出し、別チームが追加した新しい呼び出し元など）、ゲートウェイを経由しない経路からテナント検証をバイパスされる可能性があるため、各サービスが独立してテナントクレームを検証する“ゼロトラスト”的な設計が推奨される。

#### 共有キャッシュ・ジョブキューへの汚染

```python
# 脆弱：テナントを跨いでキーが衝突する
cache_key = f"user:{user_id}:profile"

# 正しい：テナントIDをキーに含める
cache_key = f"tenant:{tenant_id}:user:{user_id}:profile"
```

`user_id` がテナントをまたいで一意でない場合（あるいは一意であっても認可判定に使えない場合）、キャッシュキーにテナントIDを含めないと、テナントAのために計算・認可された結果がテナントBのリクエストにそのまま返却されてしまう可能性がある。非同期ジョブキューについても同様で、タスクの最初のアクションとしてテナントコンテキストを再設定し、以降のDB操作すべてにRLSなどの制約を効かせる設計が必要である。

> 出典: Multi-tenancy security patterns — https://www.systemshardening.com/articles/cross-cutting/multi-tenancy-security-patterns/
> 出典: Multi Tenant Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html

### OWASP Cloud Tenant Isolationプロジェクトが示す脅威像

> ⚠️ **一部未取得情報の補足**: OWASPのプロジェクトページ本体（`owasp.org/www-project-cloud-tenant-isolation/`）は、プロジェクト概要と目的の記載にとどまり、具体的な分離ドメインの分類体系や成果物一覧などの詳細情報は掲載されていませんでした（Incubatorステージのプロジェクトであり詳細情報はGitHubリポジトリに委ねられているため）。以下はページ本文とWeb検索で得られた情報を統合した要約です。

本プロジェクトは「クロステナント脆弱性は、クラウドベースアプリケーションに特有の新しいカテゴリのセキュリティリスクである」と位置づけ、SaaS/PaaS開発者向けの実践的な「隔離逃避（isolation escape）」防止ガイダンスの整備を目標に掲げている。挙げられている典型的な脆弱性カテゴリは、本節でこれまで説明してきた内容と一致する。

- **Cross-Tenant Data Leakage**: バグや設定ミスによる他テナントデータの露出
- **Tenant Impersonation**: 他テナントのコンテキストやリソースへの攻撃者のなりすまし
- **Broken Tenant Isolation**: データベース・キャッシュ・ストレージ・計算層での分離不足
- **IDOR**: テナントIDやリソースIDの操作によるリソースアクセス
- **Noisy Neighbor攻撃**: 共有リソースを1テナントが専有することによる他テナントへのDoS的影響

また、コンテナの設定ミスや過度に緩いファイアウォールルール、データ衛生（data hygiene、削除・分離・ラベル付けの徹底）の欠如といった、PaaS/SaaS基盤特有の設定ミスがクロステナント脆弱性の温床になりやすいと指摘している。分離戦略としては、テナントデータがプールされたテーブル・テナント専用スキーマ／DB・専用スタックのいずれか、あるいはそのハイブリッドで存在し得ることを述べ、「分離戦略はリクエストとデータの経路全体に一貫して適用されなければならない」という原則を示している。この「経路全体での一貫性」という考え方は、前節までに見たテナントコンテキストの伝播（ミドルウェア→DB→キャッシュ→キュー→ストレージ→監査ログの全経路）の重要性と直接対応する。

> 出典: OWASP Cloud Tenant Isolation Project — https://owasp.org/www-project-cloud-tenant-isolation/

### テスト観点：クロステナント分離を自動検証する

分離モデルがどれほど堅牢に設計されていても、実装の劣化（リグレッション）を継続的に検知する仕組みがなければ、時間の経過とともに穴が生まれる。`systemshardening.com` は以下のようなテスト手法を紹介している。

```python
def test_invoice_not_accessible_across_tenants(tenant_a, tenant_b):
    invoice = tenant_a_client.post("/invoices", json={"amount": 100})
    invoice_id = invoice.json()["id"]
    response = tenant_b_client.get(f"/invoices/{invoice_id}")
    assert response.status_code == 404  # 200でデータが返る、あるいは403で存在を認めることも許さない
```

さらに一歩進めて、プロパティベーステスト（無数のランダム入力に対して不変条件=propertyが常に成り立つかを検証する手法。Pythonでは`Hypothesis`ライブラリが有名）を用いて、あらゆるUUID形式のIDに対して「テナントBは常に404を得る」という性質を検証する例も紹介されている。

```python
@given(invoice_id=st.uuids())
def test_random_invoice_ids_not_accessible_cross_tenant(invoice_id, tenant_b):
    response = tenant_b_client.get(f"/invoices/{invoice_id}")
    assert response.status_code == 404
```

こうしたクロステナント分離テストをCIパイプラインに組み込み、プルリクエストごとに実行し、失敗をマージブロッカーとして扱うことで、認可ロジックの劣化を早期に検出できる。これは「1回の手動ペンテストで安全性を確認して終わり」にするのではなく、継続的に自動検証し続けるという発想の転換であり、マルチテナントセキュリティを機能ではなく「規律（discipline）」として運用に組み込む考え方の実践形である。

> 出典: Multi-tenancy security patterns — https://www.systemshardening.com/articles/cross-cutting/multi-tenancy-security-patterns/

### 設計時に陥りやすい頻出ミス

複数資料を横断して共通して指摘されている、実装時の典型的な誤りを以下にまとめる。

1. **連番整数IDの使用**: テナント数やレコード数の推定を許してしまう。UUID v4等の予測困難なIDへの置き換えが望ましいが、前述の通りこれは認可チェックの代替にはならない。
2. **管理系エンドポイントのスコープ漏れ**: 一般ユーザー向けAPIにはテナントフィルタを実装していても、管理者向けAPIや内部向けAPIには同等の分離が適用されていないケースが多い。管理系エンドポイントほど強い権限を持つため、越境時の被害は一般APIより大きくなりやすい。
3. **Hostヘッダーの信頼**: サブドメインでテナントを判定する構成において、HTTPの `Host` ヘッダーはリバースプロキシの設定次第でクライアントが偽装できる場合がある。TLSのSNI（Server Name Indication）やIngress層で検証・注入されたヘッダー、あるいはJWTクレームなど、より信頼できる情報源を使うべきである。
4. **テナント情報の無期限キャッシュ**: 契約解除・アクセス停止されたテナントのメンバーシップ情報が長時間キャッシュされたままだと、停止後もアクセスが継続してしまう。秒〜分単位の短いTTL（Time To Live、キャッシュの有効期限）を設定し、鮮度と認可の正確性を両立させる必要がある。
5. **マイグレーションのスコープ漏れ**: スキーマ変更やデータ移行のスクリプトが全テナントに対して無秩序に同時実行され、途中で失敗した場合に一部テナントだけが不整合な状態に陥る。テナント単位で順序立てて実行し、失敗時のロールバック手順を用意しておく必要がある。

これらのミスは、いずれも「認可判定に使う情報源の信頼性」「情報の鮮度」「処理の網羅性（全経路・全テナントへの一貫適用）」という3つの軸に集約できる。次節以降では、これらの分離モデルの破れ目を実際にどう探索し、どう検証するかというテスト手法をより具体的に掘り下げていく。

## cross-tenant アクセス制御バグの実例

マルチテナント SaaS（1つのアプリケーション基盤を複数の顧客企業=テナントで共有する構成）では、「どのユーザーが」だけでなく「どのテナントに属するデータか」という軸でもアクセス制御を行う必要がある。IDOR/BOLA（Broken Object Level Authorization、オブジェクトレベル認可の欠落）の典型形は「他人のリソースIDを指定すれば見える」だが、マルチテナント環境ではこれが「他社（他テナント）のリソースIDを指定すれば見える」という、被害範囲がテナント丸ごとに広がる形で現れる。本節では、ロールを横断してテナント分離をテストした実例と、AIを活用したキャンペーン管理機能でテナント分離が破られた実例を通じて、なぜこの種のバグが生まれるのか、どう見つけるのか、どう防ぐのかを整理する。

### 事例1: ロールを総当たりして見つかった cross-tenant アクセス制御バグ（CRM）

対象は、企業ごとに顧客・請求書・リード（見込み客）・案件を管理するクラウド型CRMである。マルチテナント設計であり、各企業（テナント）は自社のサブドメイン（例: `company1.crm.com`）でログインし、自社データのみが見えることが前提になっている。

筆者はまず、最も権限の強い **Admin ロール**でこのテナント境界を突破できないか検証した。手順は次の通りである。

1. `company1.crm.com` に Admin としてログインし、セッションクッキーを取得する。
2. Burp Suite でリクエストをインターセプトし、**Host ヘッダーだけを `company2.crm.com` に書き換えて**再送する。

```http
GET /api/invoices/1042 HTTP/1.1
Host: company2.crm.com
Cookie: session=<company1のAdminセッション>
```

この発想の背景には、マルチテナントSaaSでよく使われる実装パターンがある。アプリケーションはサブドメイン（またはHostヘッダー）を見て「今どのテナント宛のリクエストか」を判定し、そのテナントのDBスキーマやテナントIDでクエリをフィルタする、という設計である。もしテナント判定に **Hostヘッダーの値をそのまま信用する**実装になっていて、かつ「このセッションのユーザーは本当にそのテナントに属しているか」を突き合わせるチェックが漏れていれば、Hostヘッダーの差し替えだけで別テナントに“出向”したふりができてしまう。

しかしこのCRMでは、Admin ロールに対してはテナントIDの整合性チェックが効いており、`company1` のセッションで `company2` 宛のリクエストを送っても拒否された。次に **Support ロール**で同様に、Leadの閲覧やContactの編集を狙って同じ手口を試したが、これも同様にブロックされた。

ここで筆者が得た教訓は重要である。「Adminで防がれていたから、このアプリは安全」と結論づけず、**ロールごとに認可ロジックが別々に実装されている可能性を疑って、他のロールも totally 潰す**という姿勢である。実際、開発チームが権限の強いAdminやサポート担当のSupportロールには入念にテナントチェックを実装していても、相対的に「弱い」「よく使われるだけの」ロールへのチェックが手薄になっているケースは珍しくない。認可ロジックがロールごとに個別に(コピー&ペーストで、あるいは異なる担当者によって)実装されていると、一部のパスだけチェックが漏れる。

最後に試した **Sales ロール**で、この予想が的中する。Sales ユーザーのセッションクッキーのまま Host ヘッダーだけを他社ドメインに差し替えたところ、Invoice の閲覧だけでなく **編集・削除**まで通ってしまった。

```http
PUT /api/invoices/1042 HTTP/1.1
Host: company2.crm.com
Cookie: session=<company1のSalesセッション>
Content-Type: application/json

{"status": "paid", "amount": 0}
```

さらに Leads、Contacts、Campaigns といった他のモジュールでも同じ手口を横展開したところ、**Sales ロールのAPIエンドポイントはほぼ全面的にテナントチェックが欠落していた**ことが判明した。つまりこれは単発のIDORではなく、「Salesロール用のミドルウェア／デコレータにテナント検証が組み込まれていない」という**アーキテクチャレベルの欠陥**であった。攻撃者（あるいは不正な社内Salesユーザー)が他社のリードを盗み見たり、請求書を書き換えたり、キャンペーンを改ざんしたりできることを意味する。

筆者は、全モジュールを1つずつ網羅的に検証することはせず、複数モジュールで再現することを確認した時点でテストを打ち切っている。これは実務上重要な判断で、**被害立証に必要な最小限の検証で止め、それ以上は報告先の開発チームに委ねる**という責任ある開示の姿勢である（本教科書のスコープ制約と同様、許可のない本番環境への広範な検証や破壊的操作は避けるべきである）。

#### なぜこの設計はここまで壊れやすいのか（仕組みの解説）

この種のバグが起きる根本原因は次の3点に整理できる。

- **テナント識別をクライアント提供の値（Host ヘッダー、サブドメイン、Cookie、リクエストボディ中の `tenant_id` など）に依存し、それをサーバー側の「このユーザーがそのテナントに属することの証明」と紐付けずに信用してしまう**こと。Host ヘッダーはHTTPリクエストの一部としてクライアントが自由に書き換えられるため、本来は「どのテナントの静的コンテンツ／設定を返すか」を決めるルーティングの手がかりに過ぎず、認可の根拠にはならない。認可の根拠にできるのは、**サーバー側でセッション（あるいはJWTなどの署名付きトークン）から復元した「このユーザーIDは、このテナントIDに属する」という事実**だけである。
- **認可チェックが共通のミドルウェア／デコレータではなく、エンドポイントごと・ロールごとに個別実装されている**こと。これにより「Adminは安全でもSalesは危険」という非対称な穴が生まれる。認可ロジックは横断的関心事(cross-cutting concern)としてフレームワークレベルで一元化し、個々のコントローラが「オプトインで書き忘れる」余地をなくすべきである。
- **オブジェクトレベルの認可（このリソースIDはこのテナントの所有物か）と、テナントレベルの認可（このリクエストはこのテナント宛か）が別々の実装になっており、片方だけ実装されて他方が漏れる**こと。理想的には、リソースを取得するクエリ自体に `WHERE tenant_id = :current_user_tenant_id` を必ず含める（ORMのグローバルスコープ機能や、Row Level Security のようなDBレベルの強制も有効）ことで、アプリケーションコード側のうっかりミスに依存しない防御ができる。

> 出典: I Found a Massive Cross-Tenant Access Control Bug by Testing Multiple Roles — Here's What I Learned! — https://medium.com/@mrro0o0tt/i-found-a-massive-cross-tenant-access-control-bug-by-testing-multiple-roles-heres-what-i-learned-ed9c7b7f8b92

### 事例2: Stripo「AI Hub Campaign」の cross-tenant データ漏洩（削除済みプロジェクト経由）

> ⚠️ **未取得の資料**: 「Breaking Tenant Isolation: Critical Cross-Tenant Data Access in Stripo's AI Hub Campaign」（InfoSec Write-ups, Krishna Kumar 著）は、記事本体が自動取得ではブロックされ（WebFetchが403 Forbiddenを返し、代替の検索経由でも記事本文の全文は取得できませんでした）、直接の取得ができませんでした。詳細は下記URLからご自身で直接ご覧ください: https://infosecwriteups.com/breaking-tenant-isolation-critical-cross-tenant-data-access-in-stripos-ai-hub-campaign-ef9d69378314
>
> 検索により確認できた事実関係は次の通りである。本件は HackerOne 上で Stripo Inc.（メールデザイン／メールマーケティングプラットフォーム、世界で100万人以上のユーザーを抱える）に対して報告されたレポート「[Critical] Unauthorized Cross-Tenant Data Access in Stripo AI Hub Campaign via Deleted Project」であり、CWE-284（Improper Access Control、不適切なアクセス制御）に分類される。報告者は HackerOne 上のハンドル `@srcode`（"No Code"）で、記事は2026年2月に InfoSec Write-ups で公開されている。タイトルが示す通り、脆弱性は「削除済みプロジェクト（Deleted Project）」を経由して、Stripo の AI を使ったメールキャンペーン生成機能（AI Hub Campaign）で他テナントのキャンペーンデータに不正アクセスできる、というものである。

（以下は未取得資料の補足として一般知識に基づく解説です。上記の記事タイトルとCWE分類から読み取れる構造をもとに、同種のバグがどのような仕組みで起きるかを一般論として説明する。実際のStripoの実装詳細を保証するものではない。）

「削除済みプロジェクト経由の cross-tenant アクセス」というタイトルから読み解ける典型的な脆弱性パターンは、**論理削除（soft delete）とIDの再利用／持ち越しの組み合わせによる認可チェックの迂回**である。多くのSaaSは、ユーザーがプロジェクトやキャンペーンを「削除」しても、実際にはDBの行を即座に消さず、`deleted_at` や `is_deleted` のようなフラグを立てるだけの論理削除を行う。理由は監査ログの保持や「ゴミ箱」機能の提供、誤削除からの復旧のためである。

このとき、次のいずれかの実装ミスがあると、削除済みリソースのIDを起点にテナント境界を越えられる。

- **通常の一覧表示・アクセス経路ではテナントIDによる絞り込みが正しく行われているが、「削除済みプロジェクトの復元」や「AIキャンペーン生成の再開」といった別経路の処理では、その絞り込みクエリが省略されている**。例えば正常系は次のようにテナントスコープ付きで実装されているが、

```sql
-- 通常のプロジェクト取得（正しい実装）
SELECT * FROM projects
WHERE id = :project_id AND tenant_id = :current_tenant_id AND deleted_at IS NULL;
```

削除済みプロジェクトを扱う特別なコードパス（復元、AI再生成、キャンペーン紐付けなど）だけが、レガシーコードや後から追加された機能のために、次のように `tenant_id` の絞り込みを欠いたまま実装されてしまうことがある。

```sql
-- 削除済みプロジェクトを扱う別経路（欠陥のある実装の典型例）
SELECT * FROM projects
WHERE id = :project_id AND deleted_at IS NOT NULL;
```

このクエリは「削除済みであること」しか確認しておらず、**どのテナントの所有物かを一切検証していない**。攻撃者が自テナント内で正規に作成・削除したプロジェクトのID採番規則（連番IDなど）から他テナントのプロジェクトIDを推測できれば（これは典型的なIDOR、すなわち連番や予測可能なIDに起因する脆弱性である）、APIリクエストのプロジェクトIDだけを差し替えることで、他テナントの「削除済みプロジェクト」に紐づくAIキャンペーンデータ（生成済みのメール文面、顧客リスト、マーケティング戦略など機微な情報を含みうる）を閲覧・操作できてしまう可能性がある。

- もう一つの典型パターンは、**AI機能特有の非同期処理**に起因するものである。AIによるキャンペーン生成は多くの場合、リクエストを受けてジョブキューに投入し、生成完了後に結果を返す非同期処理として実装される。この非同期ジョブの実行コンテキスト（ワーカープロセス）に「どのテナントの依頼か」という情報が正しく伝搬しなかったり、ジョブの結果を取得するポーリングAPI（例: `GET /api/ai-hub/jobs/{job_id}/result`）がテナントチェックを欠いていたりすると、ジョブIDやプロジェクトIDを推測・総当たりすることで他テナントの生成結果にアクセスできる余地が生まれる。同期処理に比べて非同期処理は経路が複数に分岐しやすく、認可チェックの実装漏れが起きやすいポイントである。

このように「削除」「復元」「AI生成」「非同期ジョブ」といった、**アプリケーションの“主要動線”から外れた副次的な機能ほど、テナントチェックの実装が漏れやすい**という点は、cross-tenant バグ全般に共通する教訓である。設計・実装・テストのいずれの段階でも、正常系のCRUDだけでなく、削除・復元・エクスポート・共有・AI連携といった周辺機能についても同じ厳格さでテナントスコープを検証する必要がある。

> 出典: Breaking Tenant Isolation: Critical Cross-Tenant Data Access in Stripo's AI Hub Campaign — Krishna Kumar, InfoSec Write-ups — https://infosecwriteups.com/breaking-tenant-isolation-critical-cross-tenant-data-access-in-stripos-ai-hub-campaign-ef9d69378314

### 2つの事例から導かれる共通の防御原則

- **テナントIDはクライアントからの入力（Hostヘッダー、Cookie値、URLパラメータ、JSONボディ）から信用せず、認証済みセッション／トークンからサーバー側で解決した値のみを認可判定に使う。** クライアント提供の値はルーティングの補助情報に留め、「誰が」「どのテナントの」を決めるのは常にサーバー側の真実の情報源（source of truth）でなければならない。
- **認可チェックをロールごと・エンドポイントごとに個別実装せず、共通のミドルウェア／クエリビルダー・ORMのグローバルスコープ・DBのRow Level Securityのような、書き忘れが起きない仕組みに寄せる。** 「Adminは安全だがSalesは危険」「通常経路は安全だが削除済みリソース経路は危険」という非対称性は、認可ロジックが一元化されていないことの兆候である。
- **ロール横断・機能横断でテスト観点を広げる。** 一つのロール・一つの機能でテナント分離が機能していても、それは「そのロール・その機能に限って」正しいだけであり、他のロールや周辺機能(削除、復元、エクスポート、AI連携、非同期処理)まで同じ保証があるとは限らない。監査・診断・バグバウンティのいずれにおいても、代表的な全ロール×代表的な全機能カテゴリでテナント境界のテストを行うべきである。
- **オブジェクトIDの推測可能性（連番など）そのものも、テナントチェック漏れと組み合わさると被害を増幅させる。** IDOR対策としてのランダムなUUID採用は、テナントチェック実装の代替にはならないが、多層防御(defense in depth)の一枚として被害の発見しやすさ・悪用しやすさを下げる効果がある。

---

[← 第5章 レースコンディション](05-race-conditions.md) ｜ [目次](index.md) ｜ [第7章 API/GraphQL特有のアクセス制御 →](07-api-graphql.md)
