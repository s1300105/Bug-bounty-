## ガジェットチェーンの内部を読み解く（CommonsCollections1）

前節では「信頼できないバイト列を `ObjectInputStream.readObject()` に渡すと危険だ」という原理を学んだ。しかし多くの人が誤解しているのは、「デシリアライズ＝即座に任意コード実行」ではない、という点である。`readObject()` は攻撃者が指定した任意のコードを直接呼ぶわけではない。攻撃者にできるのは、**アプリケーションのクラスパス上に既に存在するクラス群**を組み合わせて、オブジェクトのグラフ（相互に参照し合うオブジェクトの木）を復元させることだけである。

そこで問われるのが「**ガジェットチェーン**（gadget chain）」という発想だ。ガジェット（gadget）とは、それ単体では無害だが、デシリアライズ時に自動的に呼ばれる特定のメソッド（`readObject`、`hashCode`、`equals`、`get`、`toString` など）を持ち、その中で「次のガジェット」のメソッドを呼び出してくれる**部品クラス**のことである。攻撃者はこれらの部品を数珠つなぎにして、最終的に `Runtime.exec()` のような**sink（入力が最終的に実行・解釈される危険な到達点）**へ制御を導く。ROP（Return-Oriented Programming）でメモリ上の命令片をつなぐのと発想が似ていることから「チェーン」と呼ばれる。

本節では、歴史的にもっとも有名で、教材として最良の題材である **CommonsCollections1（通称 CC1）** を、ysoserial の実際のソースコードを1行ずつ追いながら分解する。これを完全に理解できれば、他のガジェットチェーンも同じ思考法で読めるようになる。

> ⚠️ **未取得の資料**: 「K logix Scorpion Labs: Gadget Chains」の記事本文は自動取得できましたが、記事内の図版（クラス関係図）は画像のため取得できませんでした（理由: 画像はテキスト抽出不可）。詳細な図は次のURLからご自身で直接ご覧ください: https://www.klogixsecurity.com/scorpion-labs-blog/gadget-chains

### 前提となるライブラリとバージョン

CC1 が成立する条件は、**Apache Commons Collections 3.1**（`commons-collections:commons-collections:3.1`）がクラスパスに存在し、かつ **JDK が 8u72 未満**であることだ。理由は後述するが、この2つのバージョン依存は極めて重要なので最初に押さえておく。

- **Commons Collections 3.1**: 危険な「Transformer」系クラス（`InvokerTransformer` など）が制限なくシリアライズ可能だった。3.2.2（2016年公開）以降は、これらの危険なクラスがデフォルトでデシリアライズ拒否されるよう修正された。
- **JDK 8u72 未満**: CC1 の「起点」となる `sun.reflect.annotation.AnnotationInvocationHandler` の `readObject` が、後述する型チェックを持っていなかった。8u72 以降はこの穴が塞がれ、CC1 の**この起点**は使えなくなった（部品自体は残るため、別の起点を使う CC5/CC6 などが後継として登場した）。

> 出典: ysoserial（frohoff オリジナル）— https://github.com/frohoff/ysoserial
> 出典: CommonsCollections1 ソース — https://github.com/frohoff/ysoserial/blob/master/src/main/java/ysoserial/payloads/CommonsCollections1.java

### まず「実行したい終着点」から逆算する

ガジェットチェーンは、**ゴール（sink）から逆向きに設計する**と理解しやすい。CC1 の最終目標は次のJavaコードを実行させることである。

```java
Runtime.getRuntime().exec(command);
```

しかし攻撃者はシリアライズ経由でこの1行を「そのまま」書けない。`Runtime` はそもそもシリアライズ可能ではないし、`readObject` は任意のメソッド呼び出しを許さない。そこで CC1 は、この1行を**リフレクション（実行時にクラス・メソッドを名前で操作するJavaの機能）で分解し、「データ」として組み立てられる形**に変換する。上のコードは、リフレクションを使うと次のように書き換えられる。

```java
// (1) Runtime クラスそのものを得る（定数）
Class runtimeClass = Runtime.class;
// (2) getRuntime メソッドを名前で取り出す
Method getRuntime = runtimeClass.getMethod("getRuntime", new Class[0]);
// (3) getRuntime を呼んで Runtime インスタンスを得る（static なので第1引数 null）
Runtime runtime = (Runtime) getRuntime.invoke(null, new Object[0]);
// (4) exec を呼ぶ
runtime.exec(command);
```

このように「クラス → メソッド取得 → メソッド呼び出し → 別メソッド呼び出し」という**4段の手続き**に分解できた。あとは、この4段を「シリアライズ可能なオブジェクトの並び」として表現する仕掛けが必要になる。それを担うのが Commons Collections の **Transformer** である。

### Transformer：処理を「データ」に変える部品

`Transformer` は Commons Collections が持つインターフェースで、`Object transform(Object input)` という1メソッドだけを持つ。「入力を受け取って別のものへ変換して返す」という関数を、**オブジェクトとして持ち運べる**ようにしたものだと考えればよい。CC1 が悪用するのは次の3種類だ。

- **`ConstantTransformer(x)`**: 入力を無視して、常に固定値 `x` を返す。上の (1) に対応。
- **`InvokerTransformer(methodName, paramTypes, args)`**: 入力オブジェクトに対して、リフレクションで `methodName` メソッドを `args` を引数に呼び出し、その戻り値を返す。上の (2)(3)(4) に対応する**核心の部品**。
- **`ChainedTransformer(transformers[])`**: Transformer の配列を受け取り、**先頭の出力を次の入力へ**と順に流す（パイプライン）。これで4段を1本につなぐ。

`InvokerTransformer.transform()` の内部実装は、概念的には次の通りである。ここが「なぜコードが動くのか」の心臓部だ。

```java
public Object transform(Object input) {
    Class cls = input.getClass();
    Method method = cls.getMethod(iMethodName, iParamTypes);
    return method.invoke(input, iArgs);
}
```

`input` に何が来ても、その `input` に対して指定メソッドを反射呼び出しする。つまり `InvokerTransformer` は「**任意オブジェクトの任意メソッドを、シリアライズされたデータの指示だけで呼べる**」万能ガジェットなのだ。これがデシリアライズ経由で発火できる時点で勝負はほぼ決まっている。

### ysoserial の実物コードを読む

では ysoserial の `CommonsCollections1.java` の `getObject()` 本体を見よう（frohoff オリジナル、`master` ブランチ）。

```java
final String[] execArgs = new String[] { command };
// (A) いったん「無害」な仮のチェーンを作る
final Transformer transformerChain = new ChainedTransformer(
    new Transformer[]{ new ConstantTransformer(1) });
// (B) 本物の悪意あるチェーン部品を用意する
final Transformer[] transformers = new Transformer[] {
    new ConstantTransformer(Runtime.class),
    new InvokerTransformer("getMethod", new Class[] {
        String.class, Class[].class }, new Object[] {
        "getRuntime", new Class[0] }),
    new InvokerTransformer("invoke", new Class[] {
        Object.class, Object[].class }, new Object[] {
        null, new Object[0] }),
    new InvokerTransformer("exec",
        new Class[] { String.class }, execArgs),
    new ConstantTransformer(1) };

final Map innerMap = new HashMap();
// (C) LazyMap でラップ：未知キーの get 時に transformerChain を発火させる
final Map lazyMap = LazyMap.decorate(innerMap, transformerChain);
// (D) LazyMap を Map インターフェースの動的プロキシで包む
final Map mapProxy = Gadgets.createMemoitizedProxy(lazyMap, Map.class);
// (E) 起点となる AnnotationInvocationHandler を生成
final InvocationHandler handler = Gadgets.createMemoizedInvocationHandler(mapProxy);

// (F) リフレクションで仮チェーンを本物にすり替える
Reflections.setFieldValue(transformerChain, "iTransformers", transformers);
return handler;
```

> 出典: CommonsCollections1 ソース — https://github.com/frohoff/ysoserial/blob/master/src/main/java/ysoserial/payloads/CommonsCollections1.java

#### なぜ (A) と (F) で「二度手間」をするのか

初学者が最初につまずくのがここだ。なぜ最初に無害な `ConstantTransformer(1)` だけのチェーンを作り (A)、後からリフレクションで本物の配列に差し替える (F) のか。

理由は「**ペイロードを構築している自分自身のマシンで、うっかりチェーンが発火してコマンドが動いてしまうのを防ぐ**」ためだ。この節で作る `lazyMap` や各種オブジェクトは、生成の過程で `hashCode()` や `equals()`、`toString()` が内部的に呼ばれることがある。もし最初から本物の悪意チェーンを仕込んでおくと、ペイロード生成中に攻撃者の手元で `exec()` が走ってしまう。そこで生成中は無害な状態にしておき、**シリアライズ直前の最後**に、`Reflections.setFieldValue` で `ChainedTransformer` の `private` フィールド `iTransformers` を本物に上書きする。リフレクションを使うのは、このフィールドが `private` で通常は書き換えられないからだ。この「無害な状態で組み立て、最後に武装する」パターンは、多くのガジェットチェーン実装に共通する定石である。

### 発火の連鎖：readObject からコマンド実行まで

ソースの構造がわかったので、いよいよ**被害者側でデシリアライズされたときに何が起こるか**を、呼び出し順に追う。ysoserial のコメントにも記されている流れは次の通りだ。

```
ObjectInputStream.readObject()
  └─> AnnotationInvocationHandler.readObject()
        └─> (proxy) Map.entrySet()
              └─> AnnotationInvocationHandler.invoke()
                    └─> LazyMap.get()
                          └─> ChainedTransformer.transform()
                                └─> InvokerTransformer.transform() ×3
                                      └─> Runtime.exec(command)
```

#### 段階1：起点 AnnotationInvocationHandler.readObject()

チェーンの一番外側は `sun.reflect.annotation.AnnotationInvocationHandler` というJDK内部クラスだ。これはアノテーション（`@Override` のような注釈）を実行時に表現するための動的プロキシのハンドラで、`memberValues` という `Map` フィールドを持つ。重要なのは、このクラスが**カスタムの `readObject` を持ち、その中で `memberValues` のメソッド（実装により `entrySet()` など）を呼ぶ**点だ。

CC1 は、この `memberValues` に**普通の Map ではなく、悪意ある Map プロキシ (D) を差し込む**。JDK 8u72 未満の `AnnotationInvocationHandler.readObject()` は「`memberValues` に何が入っているか」を検証しなかったため、攻撃者が用意した任意の Map を受け入れてしまった。デシリアライズが完了して `readObject` が走った瞬間、`memberValues.entrySet()`（に相当する呼び出し）が実行され、それが Map プロキシへ制御を渡す。ここが「自動で動き出す最初のトリガ」である。

> 8u72 以降の修正では、`memberValues` が想定するアノテーション型と整合するかをチェックし、`LinkedHashMap` に安全にコピーするようになった。これにより CC1 の**この起点**は封じられた。ただし後述のように、`LazyMap` 以降の部品はそのまま残るため、別の `readObject` から `LazyMap.get()` に到達する CC5・CC6 などが考案された。「1つのリンクを塞いでも、ガジェット部品自体を排除しない限り根絶できない」という教訓である。

#### 段階2：動的プロキシ経由で invoke() へ

(D) の `mapProxy` は `java.lang.reflect.Proxy` による**動的プロキシ**で、`Map` インターフェースを実装しているように振る舞う。動的プロキシの本質は「そのオブジェクトのどのメソッドが呼ばれても、すべて `InvocationHandler.invoke(proxy, method, args)` という**単一の関門**にリダイレクトされる」ことだ。

CC1 では、このプロキシの `InvocationHandler` に**もう1つの `AnnotationInvocationHandler`**（(E) の `handler`）を割り当てている。つまり段階1で `memberValues.entrySet()` が呼ばれると、実体は「プロキシに対する `entrySet()` 呼び出し」であり、それが `AnnotationInvocationHandler.invoke()` に飛ぶ。この `invoke()` の内部実装は、渡された Map（= `LazyMap`）に対して `memberValues.get(メソッド名)` を呼ぶ構造になっている。

```java
// AnnotationInvocationHandler.invoke の要点（概念）
public Object invoke(Object proxy, Method method, Object[] args) {
    String member = method.getName();      // 例: "entrySet"
    Object value = this.memberValues.get(member);  // ← LazyMap.get() が呼ばれる
    ...
}
```

こうして、外から見れば「アノテーションの値を引く」だけの無害な操作が、内部では `LazyMap.get()` の呼び出しにすり替わる。

#### 段階3：LazyMap.get() がチェーンを点火する

`LazyMap` は Commons Collections のクラスで、「**まだ存在しないキーを get されたら、その場でファクトリ（Transformer）を呼んで値を作る（遅延生成する）**」という便利機能を持つ。その `get()` は概念的に次の通りだ。

```java
public Object get(Object key) {
    if (!map.containsKey(key)) {       // キーが未登録なら…
        Object value = factory.transform(key);  // ← ファクトリ = 悪意チェーンを発火
        map.put(key, value);
        return value;
    }
    return map.get(key);
}
```

(C) で `LazyMap.decorate(innerMap, transformerChain)` としたので、この `factory` は攻撃者の `ChainedTransformer` である。段階2で `get("entrySet")` のような**未登録キー**が渡されると、`containsKey` が `false` を返し、`factory.transform(key)` すなわち `ChainedTransformer.transform()` が起動する。ここでついに、無害なMap操作の皮を被った制御が、悪意ある Transformer チェーンへ完全に到達する。

#### 段階4：ChainedTransformer が4段を流す

`ChainedTransformer.transform(input)` は、保持する Transformer 配列（段階Fで武装済み）を順に適用し、前段の出力を次段の入力へ渡す。実装は次のようにシンプルだ。

```java
public Object transform(Object object) {
    for (int i = 0; i < iTransformers.length; i++) {
        object = iTransformers[i].transform(object);
    }
    return object;
}
```

これに (B) の配列を流すと、冒頭で分解した4段のリフレクション手続きがそのまま再現される。各段を追う。

1. **`ConstantTransformer(Runtime.class).transform(...)`** → 入力を無視して `Runtime.class`（Class オブジェクト）を返す。次段の入力になる。
2. **`InvokerTransformer("getMethod", {String, Class[]}, {"getRuntime", new Class[0]})`** → 入力 `Runtime.class` に対し `getMethod("getRuntime", 引数なし)` を反射呼び出しし、`Method`（`getRuntime` メソッド）を返す。`getMethod` 自体が `Class` のメソッドなので、入力が `Runtime.class`（Class 型）であることが効いている。
3. **`InvokerTransformer("invoke", {Object, Object[]}, {null, new Object[0]})`** → 入力 `getRuntime` メソッドに対し `invoke(null, 引数なし)` を反射呼び出し。`getRuntime` は static メソッドなので第1引数は `null` でよく、戻り値として `Runtime` インスタンスが得られる。
4. **`InvokerTransformer("exec", {String}, execArgs)`** → 入力 `Runtime` インスタンスに対し `exec(command)` を反射呼び出し。ここで任意コマンドが実行される。

最後の `ConstantTransformer(1)` は末尾の後始末（戻り値を整える）用で、攻撃の本質には関与しない。段階4を終えた時点で、被害者プロセス上で `command` が実行済みになっている。

### なぜこの設計が「巧妙」なのか（原理のまとめ）

CC1 の核心は、**「自動で呼ばれるメソッド」を4回すり替えていく**点にある。

- `readObject` は開発者が意図した「アノテーション復元」のつもりで `memberValues` を触る。
- しかし `memberValues` は動的プロキシで、あらゆる呼び出しが `invoke()` に集約される。
- `invoke()` は `get()` を呼ぶが、その Map は `LazyMap` で、未知キーの `get()` がファクトリ発火に化ける。
- ファクトリは `Transformer` チェーンで、`InvokerTransformer` という「任意メソッド反射呼び出し装置」を通じて `Runtime.exec` に到達する。

各リンクは**それ単体では正当な機能**（アノテーション処理、動的プロキシ、遅延生成Map、汎用変換器）であり、どれもバグではない。攻撃者はこれらを「意図しない順序と組み合わせ」で連結しただけだ。だからこそ「特定のクラスを1つ修正する」対症療法では防ぎきれず、**信頼できないデータを一切デシリアライズしない／許可リスト方式でクラスを制限する**という設計レベルの対策（本書の防御章で詳述）が必要になる。

### 防御の観点での要点

本節はあくまで**防御・検知のための内部理解**を目的としている。実在サービスや本番環境への無許可の検証、破壊的な操作は行ってはならない。CC1 の理解から導かれる防御上の教訓は次の通りだ。

- **ネイティブJavaシリアライズを外部入力に使わない**のが根本対策。JSON など「コードを復元しない」データ形式へ移行する。
- やむを得ず使う場合は、`ObjectInputFilter`（JEP 290、JDK 9+／8u121+ にバックポート）で**デシリアライズ可能なクラスを許可リストで厳格に絞る**。`InvokerTransformer` などの既知ガジェットを含むパッケージを拒否する。
- **依存ライブラリを最新に保つ**。Commons Collections は 3.2.2／4.1 以降で危険な Transformer のデシリアライズをデフォルト無効化した。JDK も 8u72 以降を使う。
- **検知**: `AnnotationInvocationHandler`、`InvokerTransformer`、`ChainedTransformer` などのクラス名がシリアライズストリーム（マジックバイト `AC ED 00 05`、Base64 では多くの場合 `rO0AB` で始まる）中に現れないか監視する。

次節では、CC1 の起点封じ（8u72）を回避するために別の `readObject` を起点として `LazyMap.get()` に到達する後継チェーン（CommonsCollections5／6）を扱い、「1リンクの修正では根絶できない」という本節の教訓を具体的に確認する。
