## mXSS補足: XMLパーサ差分によるDOMPurifyバイパス

本節では、前節までに学んだmXSS（Mutation XSS）の原理を踏まえ、**HTMLパーサとXMLパーサの構文解釈の違い**を突いたDOMPurifyバイパスの実例を深掘りする。主題となるのは、Flatt Security（現 GMO Flatt Security）のセキュリティエンジニアRyotaK氏が2024年4月に公開した研究「Bypassing DOMPurify with good old XML」である。この研究は、DOMPurifyの**XMLパースモード**において、Processing Instruction（処理命令）とCDATAセクションという2つのXML固有構文がmXSSベクタとなることを実証し、2段階にわたるバイパスと修正の攻防を記録した貴重な事例である。

> **サニタイザが見ている「木構造」と、ブラウザが最終的に描画する「木構造」が食い違うと、その差分がXSSになる。**

この一文が、本節で扱うすべての事例の共通原理である。

---

### 1. 背景: DOMPurifyのXMLパースモード

DOMPurifyは通常、入力をHTMLとしてパースする（`text/html`）。しかし`PARSER_MEDIA_TYPE`オプションに`"application/xhtml+xml"`を指定すると、内部で**XMLパーサ**（`DOMParser`のXMLモード）を使ってDOMツリーを構築する。XHTML準拠のアプリケーション、あるいはSVGやMathMLを多用する環境では、このモードが選択されることがある。

問題は、DOMPurifyがXMLパーサで構築したDOMツリーをサニタイズし、結果をシリアライズ（文字列化）した後、その文字列がアプリケーション側で`innerHTML`経由――つまり**HTMLパーサ**によって――再パースされるケースである。XMLパーサとHTMLパーサは構文の解釈規則が根本的に異なるため、同じ文字列が異なるDOMツリーに変換されうる。これがmXSSの温床となる。

RyotaK氏の研究は、セキュリティ研究者 @slonser\_ が発見したDOMPurifyの先行バイパスに対するパッチを調査する中で、**追加の2つのバイパス**を発見したという経緯で始まった。

---

### 2. 第1のバイパス: Processing Instruction（処理命令）の解釈差（DOMPurify 3.0.10）

#### Processing Instructionとは

XMLには**Processing Instruction（PI、処理命令）**と呼ばれる構文がある。形式は次の通りだ。

```
'<?' PITarget (S (Char* - (Char* '?>' Char*)))? '?>'
```

つまり `<?` で始まり、ターゲット名（PITarget）が続き、`?>` で終端する。XMLパーサはこの全体を1つのProcessing Instructionノードとして扱い、中身にどんな文字列が含まれていてもマークアップとしては解釈しない。

#### HTMLパーサにおける `<?` の扱い: bogus comment

HTMLの仕様にはProcessing Instructionという概念がない。HTMLパーサが `<?` に遭遇すると、HTML仕様のトークナイゼーション規則により**bogus comment state（不正なコメント状態）**に遷移する。bogus commentの終端は `?>` ではなく、**最初に出現する `>`（山括弧）** である。

この差が致命的な食い違いを生む。

#### 解釈差の具体例

次の文字列を考える。

```
<?xml-stylesheet ><h1>Hello</h1> ?>
```

**XMLパーサの解釈:**

XMLパーサにとって、これは `<?xml-stylesheet` で始まるPI全体（`?>` まで）が1つのノードである。`<h1>Hello</h1>` はPIの内部テキストに過ぎず、タグとしては認識されない。結果として、DOMツリーには**ProcessingInstructionノードが1つだけ**存在する。

**HTMLパーサの解釈:**

HTMLパーサにとって、`<?xml-stylesheet ` は bogus comment の開始であり、最初の `>` で即座にコメントが閉じる。つまり `<?xml-stylesheet >` がコメント部分となり、それ以降の `<h1>Hello</h1> ?>` は**通常のHTMLマークアップとして解釈**される。`<h1>` タグが生きた要素として出現する。

#### バイパスの実証

DOMPurify 3.0.10において、この解釈差を利用した以下のPoCが成立した。

```javascript
document.documentElement.innerHTML = DOMPurify.sanitize(
  "<?img ><img src onerror=alert(1)>?",
  { PARSER_MEDIA_TYPE: "application/xhtml+xml" }
);
```

**攻撃の流れ:**

1. DOMPurifyはXMLパーサで入力をパースする。`<?img ><img src onerror=alert(1)>?` 全体が `<?img` をターゲットとするProcessing Instructionノードとなる（終端の `>?` はXML的には `?>` の前に `>` があるだけで、PIの内部テキスト）。
2. DOMPurifyのサニタイズロジックはこのPIノードを走査するが、当時のバージョンでは**Processing Instructionノードに対する除去処理が実装されていなかった**。PIの中身はテキストとして扱われるため、`<img onerror=...>` は要素ノードとしては存在せず、サニタイザの目には無害に映る。
3. サニタイズ後の文字列がシリアライズされ、`innerHTML`（HTMLパーサ）に渡される。
4. HTMLパーサは `<?img >` の時点でbogus commentを閉じ、続く `<img src onerror=alert(1)>` を**通常のHTML要素として解釈**する。
5. `onerror` イベントハンドラが発火し、`alert(1)` が実行される。

---

### 3. 最初のパッチとnodeName混同

DOMPurifyの開発チームはこのバイパスを受け、Processing Instructionノードをフィルタリングするパッチを適用した。具体的には、ツリーウォーカーの`whatToShow`に`NodeFilter.SHOW_PROCESSING_INSTRUCTION`フラグを追加し、PIノードがサニタイズ対象として走査されるようにした。

しかし、この修正には**仕様由来の落とし穴**があった。

#### nodeNameの仕様

DOM仕様では、各ノードタイプの`nodeName`プロパティが返す値は次のように定義されている。

| ノードタイプ | `nodeName` の返り値 |
|---|---|
| Element | タグ名（`"div"`, `"img"` 等） |
| Text | `"#text"` |
| Comment | `"#comment"` |
| **ProcessingInstruction** | **そのターゲット名（PITarget）** |

ここで重要なのは、ProcessingInstructionノードの`nodeName`は`"#processing-instruction"`のような固定値ではなく、**PITargetの文字列そのものを返す**という点である。

つまり `<?img ?>` というPIの`nodeName`は `"img"` になる。

#### nodeName混同によるバイパス継続

DOMPurifyのサニタイズロジックは、ノードの`nodeName`を許可リスト（allowed tags）と照合して、許可されたタグかどうかを判定する。PIノードが走査対象に加わっても、`<?img ?>` のnodeNameは `"img"` であり、`<img>` はDOMPurifyの既定許可リストに含まれている。その結果、PIノードは「許可されたタグである」と誤判定され、**除去されずに残存した**。

つまり最初のパッチは、PIノードを「見る」ようにはなったが、PIノードと通常のElement要素を**nodeNameだけでは区別できない**という仕様上の特性により、実質的にバイパスが継続した。

---

### 4. 第2のパッチ: Processing Instructionの完全除去

この問題を根本的に解決するため、DOMPurifyは**ノードタイプによる判定**を追加した。

```javascript
if (currentNode.nodeType === 7) {
  _forceRemove(currentNode);
  return true;
}
```

`nodeType === 7` はProcessing Instructionノードを示す定数であり、nodeNameの内容にかかわらず、PIノードであれば無条件に除去する。これにより、Processing Instructionを利用したバイパスは塞がれた。

---

### 5. 第2のバイパス: CDATAセクションの解釈差（DOMPurify 3.0.11）

PIの問題が修正されたDOMPurify 3.0.11に対し、RyotaK氏は**CDATAセクション**という別のXML固有構文を用いた第2のバイパスを発見した。

#### CDATAセクションとは

XMLにおけるCDATAセクションは、以下の形式でテキストをリテラル（文字通り）に保持する構文である。

```
<![CDATA[ ... ]]>
```

`<![CDATA[` と `]]>` で囲まれた内容は、XMLパーサによって**エスケープ処理なしの生テキスト**として扱われる。内部に `<` や `&` が含まれていても、マークアップやエンティティ参照としては解釈されない。

#### HTMLパーサにおけるCDATAの扱い

HTMLパーサはCDATAセクションを**ネイティブには認識しない**。ただし、HTML仕様には名前空間に応じた分岐規則がある。

HTML仕様のトークナイゼーション規則には次のように定義されている。

> **"If there is an adjusted current node and it is not an element in the HTML namespace, switch to the CDATA section state. Otherwise, this is a parse error. Create a comment token... Switch to the bogus comment state."**

つまり:

- **SVG/MathML名前空間内**（非HTML名前空間）: CDATAセクションとして正しく認識される。
- **HTML名前空間内**: `<![CDATA[` はパースエラーとなり、**bogus comment state** に遷移する。bogus commentの終端は（PIの場合と同様に）**最初に出現する `>`** である。

#### 解釈差の具体例

次の文字列を考える。

```
<![CDATA[ ><img src onerror=alert(1)> ]]>
```

**XMLパーサの解釈:**

`<![CDATA[` から `]]>` までが1つのCDATAセクションノードであり、内部の `><img src onerror=alert(1)>` は単なるテキストとして扱われる。タグとしては認識されない。

**HTMLパーサの解釈（HTML名前空間内）:**

`<![CDATA[` はbogus commentの開始となり、最初の `>` で即座にコメントが閉じる。つまり `<![CDATA[ >` がコメント部分であり、続く `<img src onerror=alert(1)>` は**通常のHTMLマークアップとして生きた要素になる**。残りの ` ]]>` はテキストノードとして処理される。

#### バイパスの実証

DOMPurify 3.0.11において、以下のPoCが成立した。

```javascript
document.documentElement.innerHTML = DOMPurify.sanitize(
  "<![CDATA[ ><img src onerror=alert(1)> ]]>",
  { PARSER_MEDIA_TYPE: "application/xhtml+xml" }
);
```

**攻撃の流れ:**

1. DOMPurifyはXMLパーサで入力をパースする。全体が1つのCDATAセクションノードとなり、内部はテキスト扱い。
2. DOMPurifyのサニタイズロジックはCDATAセクションノードを走査するが、3.0.11時点では**CDATAセクションノードに対する除去処理が未実装**だった（PIの修正で追加されたのは `nodeType === 7` の判定のみで、CDATAセクションは `nodeType === 4` という別の値を持つ）。
3. サニタイズ後の文字列がシリアライズされ、`innerHTML`（HTMLパーサ）に渡される。
4. HTMLパーサはHTML名前空間で `<![CDATA[ >` をbogus commentとして処理し、続く `<img src onerror=alert(1)>` を通常の要素として構築する。
5. `onerror` が発火し、任意のJavaScriptが実行される。

---

### 6. 最終パッチ: CDATAセクションの完全除去

DOMPurifyはこの報告を受け、ツリーウォーカーに`NodeFilter.SHOW_CDATA_SECTION`フラグを追加し、CDATAセクションノードも走査・除去の対象とした。

PIの場合と異なり、CDATAセクションノードの`nodeName`は仕様上`"#cdata-section"`という固定文字列を返す。この値はDOMPurifyの許可リスト上のどのタグ名とも一致しないため、nodeName混同によるバイパスは成立しない。したがって、CDATAセクションについてはnodeTypeによる追加判定がなくても、`NodeFilter.SHOW_CDATA_SECTION`で走査対象に含めるだけで正しく除去できた。

---

### 7. 2つのバイパスの技術的対比

| | 第1のバイパス（PI） | 第2のバイパス（CDATA） |
|---|---|---|
| **対象バージョン** | DOMPurify 3.0.10 | DOMPurify 3.0.11 |
| **XML構文** | `<?target ... ?>` | `<![CDATA[ ... ]]>` |
| **XMLパーサの解釈** | PIノード1つ（内部はテキスト） | CDATAノード1つ（内部はテキスト） |
| **HTMLパーサの解釈** | bogus comment（`>` で終端）→ 後続がマークアップ化 | bogus comment（`>` で終端）→ 後続がマークアップ化 |
| **nodeType** | 7（PROCESSING_INSTRUCTION_NODE） | 4（CDATA_SECTION_NODE） |
| **nodeName** | PITargetの文字列（タグ名と衝突しうる） | `"#cdata-section"`（固定、衝突しない） |
| **修正方法** | `nodeType === 7` による無条件除去 | `SHOW_CDATA_SECTION` による走査追加 |
| **nodeName混同リスク** | あり（`<?img ?>` → nodeName `"img"`） | なし |

両バイパスに共通するのは、**HTMLのbogus comment stateの終端規則**（`>` で閉じる）とXML構文の終端規則（`?>` または `]]>`で閉じる）のズレを利用している点である。この食い違いにより、XMLパーサが「1ノードの内部テキスト」として無害と判定した領域の一部が、HTMLパーサでは「コメントの外側」に位置する生きたマークアップとして再解釈される。

---

### 8. 攻撃の前提条件と実際の影響

このバイパスが成立するには、以下の条件が必要である。

1. **DOMPurifyがXMLパースモードで使用されている**: `PARSER_MEDIA_TYPE: "application/xhtml+xml"` が設定されていること。デフォルトの `text/html` モードのみを使用するアプリケーションは影響を受けない。
2. **サニタイズ結果がHTMLコンテキストで挿入される**: `innerHTML` や `outerHTML` など、HTMLパーサによる再パースが発生する形で出力されること。

条件が限定的に見えるかもしれないが、XHTMLベースのアプリケーション、SVG/MathMLを多用するリッチテキストエディタ、あるいはサーバサイドでXMLとしてサニタイズしたHTMLをクライアントに送信する構成などでは、この条件を満たしうる。影響はフルXSS（任意のJavaScript実行）であり、深刻度は高い。

---

### 9. HackerOne #1024734: DOMPurifyの名前空間混同バイパス

RyotaK氏の研究がXML/HTMLパーサ間の**構文差**（PI、CDATA）を突くものであったのに対し、mXSSには**名前空間混同（namespace confusion）**という別の大きな攻撃クラスが存在する。HackerOneレポート#1024734（報告者: Daniel Santos）は、DOMPurify 2.2.2未満に存在したこの系統の脆弱性を報告したものである。

名前空間混同の核心は、HTML5パーシングアルゴリズムにおける**integration point（統合点）**の扱いにある。`<svg>` や `<math>` 要素の内部では、パーサはそれぞれSVG名前空間・MathML名前空間で解析を行うが、`<mglyph>` や `<mtext>` などの特定要素は**HTML integration point**として機能し、その子要素はHTML名前空間で解析される。このHTML名前空間への「復帰」のタイミングについて、サニタイザのツリー走査ロジックとブラウザの実際のパース挙動がずれていると、サニタイザが「まだ外来名前空間（SVG/MathML）の中にいる」と判定した要素が、ブラウザ描画時には「すでにHTML名前空間に戻っている」ことになり、HTMLのイベントハンドラとして有効化されてしまう。

DOMPurifyはこの報告を含む一連のフィードバックを受け、名前空間遷移の追跡ロジックを複数バージョンにわたって強化している。名前空間混同系のmXSSは2020年から2025年にかけて継続的に報告・修正が行われた長期的な攻撃クラスであり、このレポートはその初期の事例にあたる。

> 出典: Internet Bug Bounty DOMPurify バイパス報告 #1024734 — https://hackerone.com/reports/1024734

---

### 10. mXSSの先にあるもの: Electron RCEへの展開

mXSSの影響は「Webページ上でJavaScriptが実行される」ことにとどまらない。Electronアプリケーション（デスクトップメールクライアント、チャットアプリ、ノートアプリなど）では、レンダラプロセスがNode.js APIへのアクセスを持つ場合がある。このような環境でmXSSによるXSSが成立すると、`require('child_process').exec(...)` のようなコードを注入でき、**リモートコード実行（RCE）**に直結する。

前節（s4d）で扱ったMailspringのmXSSは、まさにこのパターンの実例であった。HTMLメール内のサニタイズ不備がmXSSを引き起こし、Electron環境でのRCEに至った事例である。DOMPurifyバイパスの研究が重要なのは、こうした「XSSの先にある被害」を見据えた上で、サニタイザの信頼性がセキュリティチェーン全体の要になっているからである。

---

### まとめ: 本節の教訓

| 資料 | 食い違いの発生源 | 悪用されたパーサ間の差 |
|---|---|---|
| Flatt（RyotaK）PI | XMLパースモード vs HTML再パース | PIの終端: `?>` vs bogus commentの `>` |
| Flatt（RyotaK）CDATA | XMLパースモード vs HTML再パース | CDATAの終端: `]]>` vs bogus commentの `>` |
| HackerOne #1024734 | SVG/MathML名前空間 vs HTML名前空間 | integration pointでの名前空間復帰タイミング |

いずれも「サニタイザがパースした瞬間のコンテキスト」と「ブラウザが最終的に描画する瞬間のコンテキスト」が一致していない、という一点に帰着する。防御側の一般原則は次の通りだ。

- **サニタイズと最終挿入を同一のパース経路で完結させる**: 文字列化（シリアライズ）を挟まず、`RETURN_DOM` / `RETURN_DOM_FRAGMENT` オプションでDOMノードのまま扱う。
- **サニタイザのバージョンを常に最新化する**: PI混同、CDATA混同、名前空間混同といった既知のmXSSクラスへのパッチを確実に追随する。
- **Trusted Typesを併用する**: 「サニタイズ済み文字列を無条件にinnerHTMLへ渡す」経路自体を型レベルで制限し、意図しない再パースの入り口を減らす。
- **XMLパースモードの使用を最小限にする**: `PARSER_MEDIA_TYPE: "application/xhtml+xml"` が本当に必要かを検討し、不要であれば既定のHTMLパースモードを使う。これだけでPI/CDATAクラスのバイパスリスクを排除できる。

> 出典: RyotaK, "Bypassing DOMPurify with good old XML"（Flatt Security, 2024年4月） — https://flatt.tech/research/posts/bypassing-dompurify-with-good-old-xml/
