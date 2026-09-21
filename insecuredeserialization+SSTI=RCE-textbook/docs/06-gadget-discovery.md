# 第6章 ガジェットチェーン発見の自動化と方法論

## GadgetInspectorによる静的ガジェット探索

Java のデシリアライゼーション脆弱性を「実際に悪用できるか」を左右するのは、アプリ自身が書いたコードではなく、クラスパス上に載っている**ライブラリ群の組み合わせ**である。攻撃者は `readObject()` などの入口（後述する magic method）から、最終的に `Runtime.exec()` のような危険な呼び出し（**sink**: 攻撃者の制御下にある入力が最終的に実行・解釈される危険な到達先）へと至る、一連のメソッド呼び出しの連鎖 ＝ **ガジェットチェーン**を組み立てる。この連鎖探しは長らく手作業の職人芸だった。

本節で扱う **GadgetInspector**（作者: Ian Haken／JackOfMostTrades、Netflix Platform Security チーム、Black Hat USA 2018 で発表）は、この連鎖探しを**バイトコードの静的解析で自動化**した最初期の実用ツールである。ソースコードが手元になくても（＝ WAR に固められた第三者のプロプライエタリ JAR でも）、クラスパス全体を舐めて「このクラスパスなら、どんなガジェットチェーンが成立しうるか」を機械的に列挙する。以下では、その5ステップの解析アルゴリズムを内部の仕組みレベルで解説する。

> ⚠️ **未取得の資料**: 「Ian Haken: Automated Discovery of Deserialization Gadget Chains 白書（wp PDF, data.hackinn.com）」は自動取得できませんでした（理由: ホスト名が名前解決できず DNS エラー `ENOTFOUND data.hackinn.com`）。以下のURLからご自身で直接ご覧ください: https://data.hackinn.com/ppt/BlackHat-USA-2018/us-18-Haken-Automated-Discovery-of-Deserialization-Gadget-Chains-wp.pdf
>
> なお本節の技術内容は、白書と同一の発表に基づくスライドPDF（i.blackhat.com）と GitHub リポジトリから取得できたため、実質的な欠落はありません。白書は同スライドをより詳細に文章化したものです。

### なぜ「ツールで自動化」する動機が生まれたのか

デシリアライゼーション脆弱性の探索（＝「攻撃者の入力が `ObjectInputStream.readObject()` / `XStream.fromXML()` / `ObjectMapper.readValue()` などの sink に流れ込むか？」という**エントリポイント発見**）は、既存の静的・動的解析ツールがそれなりに得意としている。しかし、脆弱性が「見つかった」あとに残る本当の難問は、**それが実際に悪用可能（exploitable）なのか**という判定だった。

Haken の問題意識は「リスク評価ツールが欲しい」というものだ。デシリアライゼーションの穴を見つけても、修正の優先度を決めるには次を知りたい。

- この脆弱性は本当に悪用可能か？
- 可能なら何が起きるか（RCE／SSRF／DoS）？
- ツールは完璧でなくてよい。むしろこの用途では、リスクを**過大評価する（＝取りこぼしより誤検知を選ぶ）**方が有用。
- 実際にペイロードを生成する必要すらない。「連鎖が存在する」と示せれば十分。

既存ツールとの差もこの動機で説明できる。ysoserial は既知のガジェットチェーンを収録した「攻撃コード集」であり、JDK の `ObjectInputStream` を中心に**特定ライブラリの既知の連鎖**に限られる。marshalsec は代替デシリアライズ・ライブラリ向けにより広い攻撃を持つが、やはり既知の連鎖のカタログだ。これらは「自分のクラスパス**固有の組み合わせ**」や「非標準の自作デシリアライズ・ライブラリ」には答えてくれない。GadgetInspector はまさにそこ、**目の前のクラスパスに対して連鎖が成立するか**を自前で探索する。

> 出典: Automated Discovery of Deserialization Gadget Chains（Ian Haken, Black Hat USA 2018 スライド）— https://i.blackhat.com/us-18/Thu-August-9/us-18-Haken-Automated-Discovery-of-Deserialization-Gadget-Chains.pdf

#### magic method と「入口」

前提の確認をしておく。デシリアライズが危険なのは、**magic method がデシリアライザによって自動的に、しかもデシリアライズが完了する前に実行される**からだ。Java 標準では `readObject()` / `readResolve()` が代表で、`finalize()` も忘れてはならない。さらに JDK の多くの Serializable クラスがこれら magic method を実装し、その中で別のメソッドを呼ぶため、「既知の入口（known entrypoints）」が芋づる式に増える。

- `HashMap` → デシリアライズ時にキーの `Object.hashCode()` / `Object.equals()` を呼ぶ
- `PriorityQueue` → 要素の `Comparator.compare()` / `Comparable.compareTo()` を呼ぶ

つまり攻撃者は「HashMap の中に、悪意ある `hashCode()` を持つオブジェクトを仕込む」だけで、任意クラスの `hashCode()` を起点にできる。この「入口の橋渡し」を GadgetInspector は既知トリックとして利用する（Step 4）。

### 設計要件 ―― なぜバイトコードを見るのか

GadgetInspector が満たすべき要件は、そのまま設計判断に直結している。

1. **脆弱性探し自体はしない。** 脆弱性が見つかった前提で、悪用可能性を評価するツール。
2. **クラスパス全体を見る。** 成立しうる連鎖は、アプリのコードではなく**推移的依存の総体**で決まるため。
3. **誤検知寄りに倒す。** 取りこぼし（false negative）より誤検知（false positive）を許容する。リスクの過大評価は安全側。
4. **バイトコードで動く。** クラスパスは WAR に固められ、ソースがないことが多い（proprietary な第三者ライブラリを含む）。さらに Groovy / Scala / Clojure など JVM 上の別言語で書かれたライブラリも含まれうる。ソースに依存できない以上、コンパイル済み `.class` を直接読むのが唯一堅牢な選択肢。

要件4が本質的だ。バイトコードを対象にすることで、ソース非公開ライブラリも、別言語製ライブラリも、区別なく解析できる。GadgetInspector は入力として **WAR ファイル（自動で展開される）**または**1つ以上の JAR** を受け取り、「発見したガジェットチェーンをメソッド呼び出しの列として」報告する。内部では引数から後続のメソッド呼び出しへのデータフローを追う**簡易なシンボリック実行**を行うが、解析を軽くするために大胆な単純化の仮定を置く（後述の3つの Assumption）。

### 5ステップの解析アルゴリズム

以降、発表で使われた具体例（Clojure の `AbstractTableModel$ff19274a` を起点に `Runtime.exec()` へ至る連鎖）を軸に、各ステップの内部動作を説明する。理解を助けるため、まず登場するクラス群を示す。これらは概念を説明するための最小化された擬似コードである。

```java
// IFn を実装した関数オブジェクト群（Clojure 由来のクラスを単純化）
public class FnConstant implements IFn {
    private Object value;
    public Object invoke(Object arg) {
        return value;                 // 引数を無視し、フィールドの定数を返す
    }
}
public class FnEval implements IFn {
    public Object invoke(Object arg) {
        return Runtime.exec(arg);     // ← これが sink（危険な到達先）
    }
}
public class FnCompose implements IFn {
    private IFn f1, f2;
    public Object invoke(Object arg) {
        return f2.invoke(f1.invoke(arg));  // 関数合成: f1 の結果を f2 に渡す
    }
}
// HashMap から hashCode() 経由で呼ばれる入口クラス
public class AbstractTableModel$ff19274a {
    private IPersistentMap __clojureFnMap;
    public int hashCode() {
        IFn f = __clojureFnMap.get("hashCode");
        return (int)(f.invoke(this));  // マップから引いた関数に this を渡して呼ぶ
    }
}
```

#### Step 1: クラス／メソッド階層の列挙

まず WAR を展開し、`WEB-INF/classes`（アプリ自身のクラス）と `WEB-INF/lib`（依存 JAR）を走査して、全クラスの継承関係・実装インターフェースを列挙する。これはあらゆる静的解析の土台であり、「どのクラスが `java.io.Serializable` を実装しているか」「どのクラスがどのインターフェースの実装なのか」を把握するために必要だ。

例えば `clojure/FnEval` は `clojure/IFn`・`java/io/Serializable`・`java/lang/Object` を実装／継承している、という階層情報を各クラスについて記録する。この「Serializable か否か」は、後の Step 5 で「どのメソッド実装へジャンプしてよいか」を決める鍵になる。

#### Step 2: 「passthrough（通り抜け）」データフローの発見

次に、各メソッドについて **「どの引数が戻り値に影響するか」** を求める。これが GadgetInspector の心臓部にあたる**passthrough 解析**である。「passthrough（通り抜け）」とは、入力（引数）が加工されつつも戻り値へ透過的に流れ出ることを指す。攻撃者が制御できるデータ（tainted、汚染された値）が、あるメソッドを通り抜けて次の呼び出しへ伝播するかを判定するのが目的だ。

引数の番号付けの規約が重要だ。**引数0は `this`（レシーバ自身）**、引数1が第1仮引数、引数2が第2仮引数……となる。この規約と、次の2つの単純化仮定が passthrough を軽量に計算可能にする。

- **Assumption #1: 汚染オブジェクトの全メンバも汚染されている（再帰的に）。** `this`（引数0）が攻撃者制御なら、`this` のフィールド、そのフィールドのフィールド……もすべて攻撃者制御とみなす。
- **Assumption #2: すべての分岐条件は充足可能。** `if` の真偽を SMT ソルバ等で解いたりせず、**両方の枝に到達しうる**と楽観的に扱う。

この2仮定で、先の例は次のように解析される。

```
FnConstant.invoke() -> 0
FnDefault.invoke()  -> 1
FnDefault.invoke()  -> 0
```

なぜこうなるか。

- `FnConstant.invoke(arg)` は `return value;`。`value` は `this` のフィールドであり、Assumption #1 により `this`（引数0）の一部として汚染されている。よって戻り値は**引数0から通り抜ける**（`-> 0`）。引数1（`arg`）は無視されるので通り抜けない。
- `FnDefault.invoke(arg)` が `return arg != null ? arg : f.invoke(arg);` の形だとすると、戻り値は `arg`（引数1）そのものか、または `f.invoke(arg)` の結果になりうる。`f` は `this` のフィールド（引数0の一部）。Assumption #2 で両枝とも到達可能とみなすため、**引数1経由**（`-> 1`）と**引数0経由**（`-> 0`）の両方が passthrough として記録される。

このステップは、条件の充足可能性を実際には評価しない。だからこそ「両方あり得る」で押し切れて解析が軽くなる一方、成立しない連鎖も拾う（＝誤検知の主因）ことになる。要件3の「誤検知寄り」はこの設計から自然に導かれる。

#### Step 3: 「passthrough コールグラフ」の列挙

Step 2 が「引数→戻り値」の内部フローだったのに対し、Step 3 は **「あるメソッドの引数が、そのメソッド内で呼ぶ別メソッドのどの引数位置に流れ込むか」** を列挙する。これがガジェットを繋ぐ辺（エッジ）になる、汚染伝播つきのコールグラフである。

例を見る。

```
AbstractTableModel$ff19274a.hashCode() が呼ぶ先:
  0 -> IFn.invoke() @ 1     // this(引数0) が invoke の引数1(=渡す this) へ
  0 -> IFn.invoke() @ 0     // this(引数0) が invoke のレシーバ(引数0) へ

FnCompose.invoke() が呼ぶ先:
  1 -> IFn.invoke() @ 1     // 引数1(arg) が f1.invoke(arg) の引数1 へ
  0 -> IFn.invoke() @ 0     // this(引数0=f1を持つ) がレシーバ(引数0) へ
  0 -> IFn.invoke() @ 1     // this の一部が invoke の引数1 へ
```

読み方は「`(呼び出し元の引数番号) -> 呼び先メソッド() @ (呼び先の引数番号)`」。`AbstractTableModel$ff19274a.hashCode()` は本体で `f.invoke(this)` を呼ぶ。ここで `f` は `this` のフィールド（引数0）なので**呼び先のレシーバ（`@ 0`）へ引数0が流れる**。同時に実引数の `this`（引数0）が**呼び先の引数1（`@ 1`）へ流れる**。だから2本の辺 `0 -> IFn.invoke() @ 1` と `0 -> IFn.invoke() @ 0` が張られる。

`FnCompose.invoke()` の `f2.invoke(f1.invoke(arg))` も同様に分解され、外側の実引数 `arg`（引数1）が内側 `f1.invoke` の引数1へ、`f1`/`f2`（`this` のフィールド＝引数0）がそれぞれのレシーバ（引数0）へ流れる、という複数の辺になる。こうして「汚染がどの呼び出しのどの位置へ伝わるか」を保持したグラフが完成する。

#### Step 4: 既知トリックによる source（入口）の列挙

**source（ソース）** とは、デシリアライズ時に自動起動される magic method、およびそこから連鎖の起点になれるメソッドを指す。GadgetInspector は Step 0 で述べた「既知トリック」を使って、これらの入口を列挙する。

例えば「`HashMap` は要素の `hashCode()` を呼ぶ」という既知事実から、`AbstractTableModel$ff19274a.hashCode() @ 0`（＝ hashCode を、汚染された this を引数0として呼ぶ）を**有効な source**として登録できる。攻撃者は HashMap にこのクラスのインスタンスを入れるだけで、この hashCode を起点にできるからだ。

```
Sources:
  AbstractTableModel$ff19274a.hashCode() @ 0
```

> **Limitation #1（設計上の限界）: 既知トリックへの依存。** `HashMap` → `hashCode` のような一部のトリックは解析からも導出できるが、`DynamicProxy`（動的プロキシ）のように**導出できず、人手で知識を与えるしかない**トリックもある。ここは元研究（オリジナルの手作業リサーチ）が依然として新しい入口を開拓しうる領域である。

#### Step 5: コールグラフ上の幅優先探索（BFS）による連鎖発見

最後に、Step 3 のコールグラフ上で、**source（入口）から sink（危険な到達先）へ向けた幅優先探索（BFS）**を行う。BFS を使うのは、より短い（＝ホップ数の少ない）連鎖を優先的に見つけたいからだ。

例の完成した連鎖は次の4段になる。

```
1. AbstractTableModel$ff19274a.hashCode() @ 0   ← source（HashMap の hashCode トリック）
2. FnCompose.invoke() @ 0
3. FnEval.invoke() @ 1
4. Runtime.exec() @ 1                             ← sink
```

hashCode から出発し、passthrough コールグラフの辺を辿って `FnCompose.invoke` → `FnEval.invoke` と進み、最終的に `Runtime.exec()` という「面白い（interesting）sink」に到達する経路が見つかった、というわけだ。

- **Assumption #3: 任意のメソッド実装へジャンプしてよい（そのクラスが「serializable」である限り）。** 仮想メソッド呼び出し（`IFn.invoke()` のようなインターフェース経由の呼び出し）の解決先を厳密に特定せず、**Serializable なあらゆる実装候補へ飛べる**と過大近似する。攻撃者は具象型を自由に指定できるので、これは攻撃者視点では妥当な over-approximation（過大近似）である。
- **Limitation #2: 連鎖発見は「面白い sink」の既知リストに依存する。** `Runtime.exec()` などの危険関数はハードコードされており、リストに載っていない sink は見つけられない。

##### 生成される攻撃ペイロードの形

GadgetInspector 自身はペイロードを生成しないが、発見された連鎖から人手で組み立てるペイロードは次の構造になる（JSON デシリアライズを例にした概念図）。

```json
{
  "@class": "java.util.HashMap",
  "members": [
    2,
    {
      "@class": "AbstractTableModel$ff19274a",
      "__clojureFnMap": {
        "hashCode": {
          "@class": "FnCompose",
          "f2": { "@class": "FnConstant", "value": "/usr/bin/calc" },
          "f1": { "@class": "FnEval" }
        }
      }
    },
    "val"
  ]
}
```

`HashMap` がデシリアライズ時にキー（`AbstractTableModel$ff19274a` インスタンス）の `hashCode()` を呼び、それが `__clojureFnMap.get("hashCode")` で `FnCompose` を引き当て、`FnConstant`（定数 `/usr/bin/calc`）→ `FnEval`（`Runtime.exec`）へと連鎖が発火する。「データ型を制御できれば、コードを制御できる」というデシリアライゼーションの本質がそのまま現れている。

### デシリアライズ・ライブラリごとの差異への対応

GadgetInspector の実用上の強みは、解析を**対象ライブラリの流儀に合わせてカスタマイズできる**点にある。デシリアライズ・ライブラリごとに「何を Serializable とみなすか」「どの magic method が入口になるか」「どのメソッド実装を考慮すべきか」が異なるため、この差異を吸収しないと正確な連鎖判定ができない。

- **何が「serializable」か（＝入口クラスの候補）**
  - JRE 標準デシリアライズ: `java.io.Serializable` を実装するもの。
  - XStream: 有効化された converter（コンバータ）に依存。カスタム converter を使うとさらに繊細になる。
  - Jackson: **引数なしコンストラクタ（no-arg constructor）を持つ任意のクラス**。
- **どれが source（magic method）か**
  - Jackson では**コンストラクタからのみ**解析を開始する（＝入口はコンストラクタ）。
- **どのメソッド実装を考慮するか（Step 5 のジャンプ先）**
  - JRE デシリアライズ: serializable なクラス内の全実装。
  - Jackson: アノテーションと設定に依存。

この柔軟性のおかげで、標準の `ObjectInputStream` だけでなく、XStream・Jackson・さらには社内製の非標準ライブラリ（`readResolve()` は呼ぶが `readObject()` は呼ばない、フィールド名に `$` を含められない、配列や汎用 Map を扱えない、null メンバを許さない、等の独自制約を持つもの）に対しても、その制約をモデル化して連鎖探索を回せる。

> 出典: Automated Discovery of Deserialization Gadget Chains（Ian Haken, Black Hat USA 2018 スライド）— https://i.blackhat.com/us-18/Thu-August-9/us-18-Haken-Automated-Discovery-of-Deserialization-Gadget-Chains.pdf

### 実行結果 ―― 既知チェーンの再発見と新規発見

Haken は Gadget Inspector を **mvnrepository.com / javalibs.com 基準の人気 Java ライブラリ上位100件**に対して、標準 Java デシリアライズ向けに実行した。主な知見は次の通り（対象バージョン・時期は陳腐化に注意）。

- **既知チェーンの再発見。** commons-collections（Maven 人気38位）に対し、`CompositeInvocationHandlerImpl.invoke` → `LazyMap.get` → `InvokerTransformer.transform` → `Method.invoke` という、ysoserial の CommonsCollections1 相当の連鎖を自動で再発見した。
- **意外に少ない Serializable 実装。** そもそも `java.io.Serializable` を実装するクラスを持つライブラリはさほど多くなかったが、新発見もあった。
- **誤検知は予想より少なかった。** ただし残った誤検知の大半は「リフレクションの扱いが難しい」ことに起因する。

#### 新規発見: Clojure（RCE）

Clojure（Maven 人気6位）で、標準デシリアライズ経由の RCE 連鎖が新規発見された。

```
1. clojure.inspector.proxy$javax.swing.table.AbstractTableModel$ff19274a.hashCode() (0)
2. clojure.main$load_script.invoke(Object) (1)
3. clojure.main$load_script.invokeStatic(Object) (0)
4. clojure.lang.Compiler.loadFile(String) (0)
5. FileInputStream.<init>(String) (1)
```

自動発見された連鎖はファイルを読み込む形だったが、`clojure.main$load_script` の代わりに `clojure.main$eval_opt` を呼ぶよう**人手で微調整**することで任意コード実行に到達した。この問題は **2017年7月に clojure-dev へ報告**され、**Clojure 1.8.0 以前の全バージョンに影響**、**`AbstractTableModel$ff19274a` のシリアライズは 1.9.0（2017年12月）で無効化**された。さらに発表準備時に最新版 1.10.0-alpha4 で再実行したところ、`clojure.lang.ASeq.hashCode()` → `clojure.lang.Iterate.first()` → … という**別の入口**が見つかり、同じ `eval_opt` への微調整で **1.8.0 以降の全リリースに対し**任意コード実行が成立することが確認された（Clojure2 チェーン）。

#### 新規発見: Scala（DoS と SSRF）

Scala（Maven 人気3位）では、RCE ではないが実害のある連鎖が見つかった。

- **ファイル書き込みによる DoS。** `scala.math.Ordering$$anon$5.compare` → `PartialFunction$OrElse.apply` → `processInternal$$anonfun$onIOInterrupt$1.applyOrElse` → `ProcessBuilderImpl$FileOutput...apply` → `java.io.FileOutputStream.<init>(File, boolean)`。任意ファイルを **0バイトで書き込み／上書き**できる。ブラックリスト設定ファイルをゼロクリアする、といった悪用が考えられる。
- **SSRF。** 末端が `ProcessBuilderImpl$URLInput...apply` → `java.net.URL.openStream()` になる連鎖では、**アプリに任意 URL への GET を実行させる**ことができる。

これらは「RCE 以外の悪用（DoS／SSRF）が可能か」という Step 5 の sink 選定次第で、リスクの幅が変わることを示す好例である。

#### Netflix 社内アプリでの実運用

社内アプリ2件への適用結果も示された。

- **Webapp 1（Jackson 使用）。** `objectMapper.readValue(body, Class.forName(queryParam))` という危険な使い方があり、約200MBのクラスパスを持つが、Jackson は「引数なしコンストラクタを持つクラス」しかデシリアライズできず入口もコンストラクタに限られるため、**誤検知が数件と、実害のある連鎖は無し**。結論として修正の優先度は低いと判定できた ―― これはまさに「悪用可能性でリスクを判断する」という当初の目的が機能した例だ。
- **Webapp 2（非標準ライブラリ使用）。** `readResolve()` は呼ぶが `readObject()` は呼ばない、Serializable 実装不要、フィールド名に `$` 不可（非静的内部クラスは暗黙の `$outer` を持つため実質不可）、配列・汎用 Map 非対応、null メンバ不可、といった独自制約をモデル化した上で12段の連鎖を発見。`StreamPumper.run()` を核に、`StringBufferInputStream`（JSP ペイロード `<% ... %>` を含む）を `SafeChunkyOutputStream`（`filePath = /webappdir/foo.jsp`）へポンプする、Web シェル書き込み型の連鎖だった。

### 限界と改善余地 ―― 防御者はここを理解して使う

防御目的でこのツールを使う際は、以下の限界を踏まえて結果を解釈することが重要だ。誤検知を承知の上でリスク評価の入力とし、ツールが「連鎖なし」と言っても安全の証明にはならない、という姿勢が求められる。

- **リフレクションが誤検知の主因。** リフレクション呼び出しの多くを一律「面白い」と扱うため誤検知が出る。例えばクラスは制御できてもメソッド名は制御できない（あるいはその逆）場合でも連鎖とみなしてしまう。また `foo.getClass().getMethod("bar").invoke(...)` のような形はコールグラフ列挙の**盲点**になり、逆に取りこぼしも生む。
- **仮定が誤検知を生む。** Assumption #2（全分岐が充足可能）と Assumption #3（任意実装へジャンプ可）は解析を軽くする代わりに、**分岐条件の充足可能性**や**仮想メソッド呼び出しの解決**を評価しないため誤検知を残す。ここを少しでも精密化すれば誤検知は減らせる、と Haken 自身が改善余地として挙げている。
- **入口は既知トリック頼み（Limitation #1）。** `DynamicProxy` のように導出できない入口があり、新しい入口を見つけるオリジナル研究の価値は残る。
- **sink はハードコード（Limitation #2）。** 「面白い挙動」を持つ sink は手書きのリストに依存し、新しい sink を発見・追加する余地が大きい。
- **設計上、誤検知に倒している。** 上記は欠陥というより、要件3「取りこぼしより誤検知」に沿った意図的トレードオフである。GitHub の README も「`no gadget chains were found`（連鎖は見つからなかった）は安全の保証ではない ―― 検知範囲外の危険パターンは存在しうる」と明記する。

### ツールの動かし方（防御・調査目的）

自組織のクラスパスに対して悪用可能性を調べる、というスコープ内での基本操作は次の通り。**実在の他者サービスや本番環境への無許可の検証には用いないこと。**

```bash
# ビルド（JDK と Gradle が必要。shadowJar で依存込みの単一 JAR を作る）
./gradlew shadowJar

# 実行: 入力は WAR（自動展開される）または1つ以上の JAR。
# メモリを大量に使うため、小さなライブラリでも最低 2GB ヒープを割り当てる。
java -Xmx2G -jar build/libs/gadget-inspector-all.jar path/to/app.war
```

- **出力**は `gadget-chains.txt`。発見された連鎖が、メソッドシグネチャと引数位置（深さ／引数インデックス）付きで列挙される。
- 解析途中の中間結果は `.dat` ファイルとして保存され、開発中に前段の再計算をスキップできる。解析後は安全に削除してよい。
- 対象が大きいほど必要ヒープは増える。約200MB級のクラスパスでは相応のメモリを見込む。

> 出典: GadgetInspector（JackOfMostTrades, GitHub リポジトリ／README）— https://github.com/JackOfMostTrades/gadgetinspector

### まとめ ―― 本節の到達点

GadgetInspector は、「デシリアライゼーションの穴が悪用可能か」という判定を、**バイトコードの静的解析＋簡易シンボリック実行**で自動化した。その核は次の5ステップである。

1. **クラス／メソッド階層の列挙**（誰が Serializable で、誰が何を実装するか）
2. **passthrough 解析**（引数→戻り値のフロー。引数0＝this、Assumption #1/#2 で軽量化）
3. **passthrough コールグラフの構築**（汚染伝播つきの呼び出し辺）
4. **既知トリックによる source 列挙**（HashMap→hashCode など）
5. **BFS による source→sink の連鎖探索**（Assumption #3 で仮想呼び出しを過大近似）

3つの単純化仮定（全メンバ汚染・全分岐充足可能・任意実装へジャンプ可）は、解析を実用的な速度に保ちつつ、要件どおり**誤検知寄り**に倒すための意図的な設計だ。結果として commons-collections の既知連鎖を再発見し、Clojure の RCE・Scala の DoS/SSRF といった新規連鎖を実際に掘り当てた。

防御者にとっての示唆は明快だ。第一に、成立しうる連鎖は自分のコードでなく**推移的依存の総体**で決まる。第二に、脆弱性の有無だけでなく**悪用可能性**でリスクと修正優先度を判断できる。第三に、ツールが「連鎖なし」と言っても、それはリフレクション盲点・既知トリック依存・sink リストの限界ゆえの**過小報告でありうる**――安全の証明ではない。この道具立てと限界の理解こそ、次節以降で扱う、より高度な自動探索手法（制御フローグラフを併用する後続研究など）へ進むための基盤になる。

> 出典: Automated Discovery of Deserialization Gadget Chains（Ian Haken, Black Hat USA 2018 発表動画）— https://www.youtube.com/watch?v=fdctNIt8OIw

## ODDFuzzと自動化ツールの限界・起点資料

前節までで、ガジェットチェーン（`readObject()` などの「入口メソッド」から `Method.invoke()` のような「危険な最終実行地点＝sink」まで、既存ライブラリのメソッドを数珠つなぎにして RCE を成立させる一連の呼び出し）を、人手ではなく静的解析で自動発見する発想を見てきた。本節では、その自動化アプローチの到達点として 2023 年の研究 **ODDFUZZ** を精読し、静的解析だけでは越えられない壁（偽陽性・偽陰性・動的多態性）と、それを「ファジング」で補う設計思想を仕組みレベルで解説する。あわせて、これら自動化ツールがそろって「正解データ（ground truth）」として参照する起点資料 **ysoserial** を押さえ、ガジェットチェーン研究の系譜を確認する。

用語を先に一つ整理する。本節で **ODD**（Open Dynamic Deserialization、開かれた動的デシリアライズ）と呼ぶのは、いわゆる安全でないデシリアライズ（insecure deserialization / Object Injection）そのものである。ODDFUZZ 論文では「攻撃者が制御できるバイト列がアプリに注入され（open）、デシリアライズ時にクラスに応じた多態的メソッドが動的に呼ばれる（dynamic）」という二つの性質を強調するためこの語を使う。

---

### ysoserial ― ガジェットチェーン研究の起点

#### 何を生成するツールか

**ysoserial** は Chris Frohoff 氏らによる PoC（概念実証）ツールで、「安全でないデシリアライズを行うアプリを攻撃するための、シリアライズ済み Java ペイロード」を生成する。使い方の骨子は次の通り極めて単純である。

```bash
java -jar ysoserial.jar [ペイロード名] '[実行したいコマンド]'
# 例（防御検証用・自分の管理下のラボでのみ）:
java -jar ysoserial.jar CommonsCollections1 'id' > payload.bin
```

第 1 引数で「どのガジェットチェーンを使うか」、第 2 引数で「デシリアライズ時に実行させたい OS コマンド」を指定する。ツールは指定コマンドを選んだガジェットチェーンの中に埋め込み、シリアライズして標準出力へ吐き出す。脆弱なアプリがこのバイト列を `ObjectInputStream.readObject()` 等でデシリアライズし、かつ必要なライブラリがクラスパス上に存在すると、チェーンが自動的に発火してコマンドが実行される。

#### 「脆弱性はガジェットの存在ではなく、無検証デシリアライズの側にある」

ysoserial の README が明確に述べる原則は、この分野の思想の核心なので引用しておく。

> the vulnerability lies in the application performing unsafe deserialization and NOT in having gadgets on the classpath.
> （脆弱性は、アプリが無検証デシリアライズを行っていることにあり、クラスパスにガジェットが存在すること自体にあるのではない）

ここでいう **ガジェット（gadget）** とは、Apache Commons Collections や Spring、Groovy といった正規ライブラリ内の、それ自体は無害なメソッド断片である。危険になるのは、これらがデシリアライズを通じて特定の順序で連鎖（chain）され、最終的に `Method.invoke()` や `Runtime.exec()` のような sink（入力が最終的に実行・解釈される危険な代入先）へデータを流し込むように仕立てられたときだけだ。したがって「脆弱なライブラリを消す」対策は本質的でなく、「信頼できないバイト列をそもそもデシリアライズしない／許可リストで制限する」ことが本筋になる。

#### POP（Property-Oriented Programming）

ysoserial のペイロードが使う技法は **POP（Property-Oriented Programming、プロパティ指向プログラミング）** と呼ばれる。攻撃者は注入オブジェクト（injection object）の各フィールド（プロパティ）を注意深く設定し、特定のクラスの入れ子オブジェクトを組み上げることで、デシリアライズ後に呼ばれる多態的メソッドの連鎖と、sink へ渡すデータを制御する。ROP（Return-Oriented Programming）が「既存コード断片を戻り番地でつなぐ」のに対し、POP は「既存メソッド断片をオブジェクトの入れ子構造でつなぐ」点が対応している。

#### 収録ガジェットと歴史的位置づけ

ysoserial は 30 種類以上のペイロードを収録し、対象ライブラリは Apache Commons Collections（3.x / 4.x）、Spring Beans/Core、Groovy、JBoss Interceptors、ROME、Vaadin、Wicket、Hibernate などに及ぶ。各ペイロードには必要な依存ライブラリとバージョンが明記されている。

このツールは 2015 年の **AppSecCali 2015** における講演「**Marshalling Pickles: how deserializing objects will ruin your day**」（Chris Frohoff, Gabriel Lawrence）で公開され、そこから Java デシリアライズ RCE の実務・研究が一気に広がった。以後の自動発見ツール（後述の GadgetInspector、SerHybrid、FUGIO、そして ODDFUZZ）は、ほぼ例外なく ysoserial のガジェットチェーン集合を「既知の正解」として再現できるかどうかで自らの検出力を測っている。本節でこれを起点資料と位置づける理由がここにある。

> 出典: ysoserial（README、Marshalling Pickles / AppSecCali 2015 起点） — https://github.com/frohoff/ysoserial

---

### ODDFUZZ ― 構造対応の有向グレイボックスファジング

> 論文: 「ODDFUZZ: Discovering Java Deserialization Vulnerabilities via Structure-Aware Directed Greybox Fuzzing」Sicong Cao ほか（Yangzhou University / Ant Group / Tsinghua University / East China Normal University）、arXiv:2304.04233v1、2023 年 4 月 9 日。ツール: https://github.com/ODDFuzz/ODDFuzz

#### なぜ「静的解析だけ」では足りないのか ― 三つの難題

ODDFUZZ が解こうとした問題は、「既知・未知のガジェットチェーンを、偽陽性を出さずに、大規模アプリでも現実的な時間で発見する」ことである。従来手法には次の三つの壁があった。

**難題1: ランタイム多態性（Runtime Polymorphism）。** Java では仮想メソッド呼び出しの実体が、宣言型ではなく実行時の実クラスで決まる。ガジェットチェーンは「クラスパス上の任意のオーバーライドメソッド（gadget）」を利用して構築されうるため、静的解析で実体を正確に推定するのは難しい。ここで二つの誤りが生じる。

- **偽陰性（false negative、見逃し）**: 純粋な静的解析でオーバーライド先を絞りすぎると、実際には悪用可能なガジェットを取りこぼす。ODDFUZZ 論文は、GadgetInspector が手続き内（intra-procedural）解析にとどまり Java の実行時多態性を考慮しないため、攻撃者制御プロパティがサブクラス引数に伝播するケースを追えず見逃す、と指摘する。
- **偽陽性（false positive、誤検知）**: 逆にクラス継承階層上の「全オーバーライドメソッド」を無差別に列挙すると、候補ガジェットが「経路長に対して指数的（exponentially）」に爆発し（path explosion）、実行不能な経路まで報告してしまう。

**難題2: 構造化された入力の構築（Structured Input Construction）。** ガジェットチェーンを発火させる注入オブジェクトは、多階層のクラス階層を持つ入れ子構造でなければならない。例えば `PriorityQueue` の `comparator` フィールドに `TransformingComparator` のインスタンスを代入し、さらにその `transform` フィールドに `InvokerTransformer` を代入する、というように「構文的に（デシリアライズ可能で）かつ意味的に（制御・データフロー制約を満たす）」正しい構造を作らねばならない。ビット単位でランダムに変異させる従来のファザーは、こうした複雑な入れ子構造をまず生成できない。

**難題3: 目標指向ファジング（Target-Directed Fuzzing）。** ガジェットチェーンは「デシリアライズ時に自動実行される一連の攻撃者制御メソッド」からなる。従来のコードカバレッジ最大化型ファジング（coverage-guided）は「より多くのコードを踏む」ことを目指すため、sink に到達しない浅いガジェットや到達不能経路の探索に予算を浪費する。目標（sink）へ最短で近づく方向性が要る。

#### 全体設計 ― 二つのモジュール

ODDFUZZ は「軽量な静的解析」と「有向グレイボックスファジング」を組み合わせたハイブリッド解である。ワークフローは二つのモジュールからなる。

1. **Identifier（識別器）**: テスト対象プログラム（Jar / War / Class）を入力とし、**軽量な静的テイント解析**で疑わしい候補ガジェットチェーンを列挙する。ここは「recall（見逃しの少なさ）」を優先し、多少の偽陽性は許容する。
2. **Validator（検証器）**: Identifier が挙げた候補それぞれについて、**構造対応の有向グレイボックスファジング**で実際に注入オブジェクトを生成し、動的に sink 到達を試す。到達できたチェーンだけを「悪用可能」と報告する。ここで偽陽性を落とす。

この「静的で広く拾い、動的で厳密に絞る」二段構えが ODDFUZZ の骨格である。下表は論文が整理した自動ガジェットチェーン発見ツールの設計比較で、ODDFUZZ の立ち位置がよく分かる。

| ツール | 静的解析 | シード生成 | シード変異 | シード優先度付け |
|---|---|---|---|---|
| GadgetInspector | Intra-TA（手続き内テイント） | ― | ― | ― |
| SerHybrid | PTA（ポインタ解析） | heap graph（ヒープグラフ） | ― | ― |
| FUGIO | Inter-TA（手続き間テイント） | property tree | ヒューリスティック | フィードバック駆動 |
| **ODDFUZZ** | Intra-TA | property tree | step-forward（前進変異） | target-directed（目標指向） |

（TA = taint analysis。Intra-/Inter- は手続き内／間、PTA = points-to analysis）

#### Identifier ― 軽量テイント解析でチェーンを列挙する仕組み

**メソッド要約（method summary）の計算。** ODDFUZZ はまずクラスパス上の各メソッドについて静的要約を計算する。具体的には、各メソッドの引数と `this` を「テイント源（攻撃者が値を制御しうる起点）」の候補として抽出し、Assign（代入）・Load（ロード）・Store（ストア）・Call（呼び出し）の 4 種の基本文に注目して、変数間の情報伝播を追跡する。ある引数にデータ依存する変数はメソッド要約に含まれる。これにより「注入オブジェクトのプロパティ値を変えることで、どの引数の値を攻撃者が制御できるか」を後段のチェーン構築に使えるようになる。

**ガジェットチェーンの識別。** ガジェットチェーンは「magic method（デシリアライズ時に自動で呼ばれる魔法のメソッド。`readObject` など）」から sink までの、スタックトレースに相当するメソッド呼び出し列である。ODDFUZZ は合計 **16 個の magic method** と **30 個の security-sensitive sink（危険な最終呼び出し地点）** を事前に定義し（論文 Appendix A）、既知の magic method がクラスパス上に見つかると、そこを起点にメソッド要約に基づいて**深さ優先探索（DFS）**でガジェットを連結していく。

ここが GadgetInspector との決定的な違いである。GadgetInspector は幅優先探索（BFS）を採り、「一度たどった実行不能経路上のメソッド」を以後スキップしてしまうため、そのメソッドが別経路では悪用可能でも二度と検討されず、偽陰性を生む。ODDFUZZ の DFS はこれを避ける。無限ループ（再帰など）対策として候補チェーンの最大長には閾値を設ける（評価では 15 ガジェット）。

さらにランタイム多態性への対処として、ODDFUZZ は**呼び出し文の呼び手（caller）がテイントされているときだけ**クラス階層解析（CHA, Class Hierarchy Analysis）を適用する。すなわち `r = x.k(a, …)` で呼び手変数 `x` がテイントされている場合のみ、メソッド `k` の全オーバーライド実装を候補に挙げ、それ以外は通常の呼び出しグラフベースのテイント解析として振る舞う。これにより「全メソッドを無差別に多態展開する」ことによる経路爆発を避けつつ、攻撃者が制御できる箇所に限って多態性を考慮する。

#### Validator ― 構造対応シード生成の仕組み

ここが本ツールの技術的な白眉である。複雑な入れ子オブジェクトを生成するために、ODDFUZZ は **property tree（プロパティツリー）** という階層データ構造を採用する。

- 根ノード = 一つ以上のガジェットを保持するクラスオブジェクト
- 葉ノード = そのクラスの各フィールド（型と名前を持つ）

リフレクションで各クラスの利用可能なプロパティを動的に収集し、あるフィールドの型が別のクラスオブジェクト（別の property tree の根）で表される（または継承する）場合、そのフィールドノードを相手ツリーの根に接続してツリーをマージする。例えば `PriorityQueue` の `comparator` フィールドの型はインタフェース `Comparator` であり、`TransformingComparator` がそれを実装するので、両者のツリーが `comparator` フィールドを介して結合される。これを孤立した関連サブツリーが無くなるまで繰り返し、ガジェットチェーン全体に対応する入れ子構造の骨格を得る。後続を持たないプロパティノード（例: `Object[] queue`）は `null` に初期化して変異対象とする。

**具体実装**では、Soot で Java バイトコードを中間表現 Jimple に変換してテイント解析を行い、ファジング基盤には JQF（パラメトリックファジング。構造化入力をビット列＝パラメータ列に写像する）と、その中の junit-quickcheck を用いる。特筆すべきは、コンストラクタや初期化・JVM のセキュリティチェックを一切呼ばずにインスタンスを生成するため **`sun.misc.Unsafe`** を使う点で、これにより「本来は生成できないような不正な内部状態を持つオブジェクト」を作ってガジェット構築時の硬い依存を満たせる。バイトコード計装は ASM で行い、クラスロード時にガジェットチェーン関連のバイトコードだけに実行トレース記録用の呼び出しを注入する（全体を計装しないのは効率のため）。距離計算には制御フローグラフ（CFG）を ASM から構築し、JGraphT ライブラリで手続き間距離を求める。

#### Validator ― フィードバックによる目標指向ファジングの仕組み

構造対応シードで「構文的に正しい入れ子」は作れるが、実行トレースは実行時にしか分からず、ランダム変異だけでは sink に到達しない。ODDFUZZ は二つのフィードバック指標でシードを優先付けする。

**(1) シード距離（seed distance）。** AFLGo の発想に倣い、シード `s` の実行トレースと、sink が属する目標基本ブロック `T_b` との距離を計算する。ただし ODDFUZZ の要点は、実行トレース上の**全基本ブロックではなく、目標チェーンのガジェット内で実行された基本ブロック `ξ(s)` だけ**を集めて距離を測る点にある。

```
d(s, T_b) = ( Σ_{m ∈ ξ(s)} d_b(m, T_b) ) / |ξ(s)|
```

これにより「sink に近いが無関係な経路」に釣られず、チェーン本来の実行経路に沿った距離が得られる。

**(2) ガジェットカバレッジ（gadget coverage）。** 目標チェーン内のガジェットが覆う分岐のうち、どれだけを踏んだかという別指標。初期段階では多様なシードを選んで局所最適を避け、電力割り当て（power scheduling）段階では「同じ距離ならより多くの分岐を覆うシード」を優遇する。

ODDFUZZ は全シードを距離の昇順にソートし、二段階の優先度キューを持つ。「距離が同じでカバレッジが異なるシード」は優遇キューへ、それ以外は非優遇キューへ入れ、優遇キューから優先的に変異対象を選ぶ。電力割り当ては次式で、シード `s` のガジェットカバレッジ `ψ(s)` と正規化距離 `d̃(s,T_b)` からエネルギー（生成する子シード数）を決める。

```
p(s, T_b) = ψ(s) · ( 1 − d̃(s, T_b) )
```

**Step-Forward（前進）変異。** 従来のビットフリップ変異は構造化入力に当てると構文を壊す。JQF が構造化入力をパラメータ列にマップしていることを利用し、ODDFUZZ は「プロパティツリーを辿りながら、各クラスオブジェクトノードに `identifier`（識別子）バイトを 1 個挿入」する。あるガジェットで実行が止まったら、その止まった箇所に対応する識別子バイトを `true` にセットし、そのクラスのプロパティ（構造的変異）へエネルギーを集中する。こうして「今つまずいているサブオブジェクトの構造」を重点的に変異させ、seed をステップごとに sink 方向へ前進させる。primitive 型（`int`, `boolean` など）は JQF の疑似乱数で、`class` 型は候補サブクラスから `random.choose()` で、配列は `random.nextInt()` でサイズを決めて要素を割り当てる、というように型に応じてテンプレートを使い分ける。変異後のシードが sink へ到達した時点で、そのガジェットチェーンを「悪用可能」と報告する。

#### 評価 ― 何個見つかり、既存ツールとどう違うか

**ベンチマーク。** ysoserial リポジトリ由来の、22 の一般的な Java ライブラリで発見された **34 個の既知ガジェットチェーン**を正解データとする。実験は Intel Core i9-12900k / 256GB RAM / Ubuntu 18.04 / JDK 1.8.0_152 上で各実験 10 回反復。各静的識別チェーンのファジング予算は 120 秒、ガジェット閾値 15。

**ODDFUZZ 単体の成績（Table II）。**

- 静的（Identifier）で **34 個中 20 個**の既知チェーンを正しく識別（recall 58.8%）。ただし候補は全体で 583 件挙がり、うち真陽性 20 件なので、静的段階の**偽陽性率は 96.6%（563/583）**。単純なテイント解析ゆえに、独自のデシリアライズプロトコル（XStream, Hessian など）を持つライブラリで全メソッドを候補化してしまうことが主因。
- 動的（Validator）で **34 個中 16 個**を、**偽陽性ゼロ**で悪用可能と確定。583 候補から 16 件を確証しても偽陽性が出ないことが、二段構えの威力を示す。
- **偽陰性は 34 個中 14 個（偽陰性率 41.2%）**。原因は Java の動的機能――**reflective call（リフレクション呼び出し）** と **dynamic proxy（動的プロキシ）**――のサポート不足。例えば Groovy1 では `ConvertedClosure` のコンストラクタがプロキシ `MethodClosure` を受け取り `MethodClosure.call()` へ渡すが、どのクラスがプロキシされうるかを ODDFUZZ は追えず見逃す。AspectJWeaver は sink `writeToPath()` が「ファイル」を引数に取り、プロパティツリーの走査では生成できないため動的検証に失敗する。CommonsCollections1 / CommonsCollections3 / Jython1 も動的プロキシ絡みで動的検証不能（ただし静的には識別可能）。

**GadgetInspector との比較（Table III）。** GadgetInspector は 1 アプリ平均 41 秒で解析するが、疑わしいチェーンを **116 件**報告し、そのうち悪用可能はわずか **3 件**――**偽陽性率 97.4%**。純粋静的で多態性を考慮しないため精度が壊滅的に低い。ODDFUZZ は GadgetInspector が報告した 3 件を全て含め、静的に 17 件多く（合計 20 件）識別し、うち 15 件を偽陽性ゼロで動的確証した。

**SerHybrid との比較（Table III）。** SerHybrid（ヒープアクセス経路をポインタ解析で求め、fuzzing で検証する既存ハイブリッド研究）は静的に 9 件識別、動的確証は 2 件。34 個中 32 個を見逃す。SerHybrid は 22 アプリ中 13 アプリ（悪用可能チェーン 19 個を含む）をそもそも対象外（N/A）とし、Clojure と Jython は時間内に静的解析が終わらず Timeout。例えば Hibernate では静的に 3 件挙げても 30 分の予算内で 1 件も注入オブジェクトを生成できないのに対し、ODDFUZZ は構造対応 DGF により平均 2 分以内で Hibernate の 2 件を含む 16 件の有効な注入オブジェクトを生成できた。

**構造対応シードとフィードバックの寄与（アブレーション）。** 構造対応シードを無効化した ODDFUZZ-SU は「どの報告済みチェーンも検証できず」、初期ファジング段階で足踏みして数個のガジェットしか踏めなかった。フィードバックを削った変種との比較でも、ランダム変異版 ODDFUZZ-RM は 34 チェーン中 25 個で「ODDFUZZ の半分未満」の分岐しか踏めず、距離誘導はカバレッジ誘導に比べ有効分岐を場合により 40% 以上増やした。構造対応・step-forward 変異・ハイブリッドフィードバックの三つが揃って初めて目標指向性が成立することを示している。

#### 実世界での成果と CVE

ODDFUZZ は 4 つの実アプリ――**Oracle WebLogic Server**、**Sonatype Nexus**、**Apache Dubbo**、**protostuff**――に対し、**6 件の未知の悪用可能ガジェットチェーン**を発見した（3 件は WebLogic Server、残り 3 件が Nexus / Dubbo / protostuff）。全て責任ある開示を行い、論文執筆時点で **5 件に CVE が割り当てられた**。ケーススタディとして、Oracle Coherence（WebLogic Server 製品）の RCE 脆弱性 **CVE-2020-14756** を取り上げ、`PriorityQueue` の `readObject()` を magic method として再利用し、`comparator` に `ExtractorComparator.compare()` を POP でつなぎ、`Method.invoke()` へ到達させるチェーンを示している。

#### 限界 ― 自動化ツールが依然として越えられない壁

ODDFUZZ は最先端だが、論文自身が明確に限界を述べている。防御側がこの種のツールに過信しないために重要なので整理する。

- **偽陰性（見逃し）**: reflective call・dynamic proxy などの動的機能を静的に追えないため、それらを含むチェーン（Groovy1、CommonsCollections1/3、Jython1、AspectJWeaver 等）を検証できない。ファイル引数など「プロパティツリー走査で作れない sink 入力」も苦手。
- **偽陽性（静的段階）**: テイント解析ロジックが単純で、独自デシリアライズ実装や `transient`（デシリアライズ対象外を意味するキーワード）で変更されるべきでない変数などの特殊ケースを扱わないため、静的候補には大量の実行不能チェーンが混じる（96.6%）。この偽陽性は Validator が動的に落とすが、その分ファジング予算を消費する。
- **事前知識への依存**: 効果（recall）は「16 個の magic method・30 個の sink」という**専門家があらかじめ与えたソース／シンク集合**に大きく依存する。新しい入口・sink が登場すれば、その知識ベースを人手で更新しない限り発見できない（知識ベースは設定で追加可能とされる）。

言い換えれば、自動化ツールは「既知の magic method / sink から到達可能で、静的テイント解析が追える経路上にあり、プロパティツリーで構築可能な入れ子構造を持つ」チェーンを、偽陽性を抑えて効率的に見つけることに長けている一方、**動的多態性の深い部分・未知の入口や sink・特殊なシリアライズプロトコル**は依然として人手の分析を必要とする。第 6 章の他節で扱った手法（GadgetInspector の呼び出しグラフ解析、手動でのソース／シンク特定）と組み合わせ、ツールの出力を鵜呑みにせず「なぜそのチェーンが成立／不成立なのか」を仕組みから検証する姿勢が、防御側にとって不可欠である。

> 出典: ODDFUZZ: Discovering Java Deserialization Vulnerabilities via Structure-Aware Directed Greybox Fuzzing（arXiv:2304.04233v1, 2023-04-09）— https://arxiv.org/pdf/2304.04233

---

### 本節のまとめ

- **ysoserial**（AppSecCali 2015「Marshalling Pickles」起点）は、POP でガジェットチェーンを組み立てシリアライズ済みペイロードを生成する PoC ツールであり、以後の自動発見研究がそろって参照する「34 個の既知チェーン」という正解データの供給源になっている。原則は「脆弱性は無検証デシリアライズ側にあり、ガジェットの存在自体ではない」。
- **ODDFUZZ** は「軽量静的テイント解析（Identifier）で広く候補を挙げ、構造対応の有向グレイボックスファジング（Validator）で偽陽性ゼロに絞る」二段構え。property tree による構造対応シード生成、seed distance と gadget coverage のハイブリッドフィードバック、step-forward 変異が核心技術。
- 数値の要点: 既知 34 個中 **動的確証 16 個・偽陽性ゼロ**（静的 recall 58.8%、静的偽陽性率 96.6%、偽陰性率 41.2%）。対する GadgetInspector は 116 件報告中悪用可能 3 件（偽陽性 97.4%）、SerHybrid は確証 2 件。実世界で 6 件の未知チェーン発見・5 CVE。
- **限界**: 動的プロキシ・リフレクション・独自シリアライズプロトコル・未知の magic method/sink は依然として自動化の死角であり、事前知識（16 magic methods / 30 sinks）に強く依存する。ツール出力は「発見の起点」であって「網羅の保証」ではない。


---

### ナビゲーション

- ← 前の章: [第5章 Python/Ruby/Node.jsのデシリアライゼーション](05-python-ruby-node.md)
- 🏠 [目次（ホーム）](index.md)
- → 次の章: [第7章 SSTIの基礎と検出・エンジン特定](07-ssti-basics.md)
