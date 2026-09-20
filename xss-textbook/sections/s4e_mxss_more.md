## mXSS補足（Flatt XML / Beyond XSS / HackerOne）

本節では、mXSS（Mutation XSS。サニタイズ直後は無害に見えたHTML文字列が、その後ブラウザに**再パース**される過程で構造が変化し、危険なマークアップへと「変異」してしまう攻撃）について、実際の研究3件をもとにさらに掘り下げる。共通する核心は次の一点に尽きる。

> **サニタイザが見ている「木構造」と、ブラウザが最終的に描画する「木構造」が食い違うと、その差分がXSSになる。**

DOMPurifyのような主要サニタイザは、入力文字列をパースしてDOMツリーを作り、危険なノード・属性を削除し、最後に`innerHTML`（シリアライズ）として文字列に戻す。この「パース→クリーニング→再シリアライズ」というパイプラインのどこかで、パーサの解釈ルールに食い違い（HTML史上の互換性のための奇妙な仕様、名前空間の切り替え、XMLとHTMLの構文差など）があると、クリーニング後は安全だった文字列が、ブラウザに実際に挿入された瞬間に別の（危険な）木として再構築されてしまう。

---

### 1. RyotaK: XMLを使ったDOMPurifyバイパス（Flatt Security）

> ⚠️ **取得状況に関する注記**: 本記事（flatt.tech）はこの環境のegressプロキシでブロックされており、WebFetchによる本文取得はできませんでした。GitHubミラーも存在しないため、WebSearchで得られた要約と、mXSS/DOMPurifyに関する筆者の専門知識を組み合わせて解説します。詳細な検証コードは必ず一次情報でご確認ください。原文URL: https://flatt.tech/research/posts/bypassing-dompurify-with-good-old-xml/

**概要（2024年4月公開、研究者: RyotaK / GMO Flatt Security）**

この記事は、セキュリティ研究者 @slonser_ が発見した先行パッチ（DOMPurifyの過去のバイパス修正）を調査する中で、RyotaKがさらに2つの追加バイパスを発見した、という位置づけの研究である。攻撃の核心は「**HTMLパーサとXMLパーサの構文解釈の違い**」を突くことにある。

#### 仕組み: HTML/XMLパーサの「処理命令（Processing Instruction）」解釈の差

DOMPurifyは設定（`PARSER_MEDIA_TYPE`オプション）によって、入力を`text/html`としてだけでなく`application/xhtml+xml`など**XMLとして**パースするモードを持つ。XMLの構文には「処理命令」と呼ばれる `<?xxx ... ?>` という記法があり、これはXMLパーサでは `?>` まで丸ごと1つのノード（Processing Instructionノード）として扱われる。

一方、この文字列が最終的に**HTMLパーサ**（例えば`innerHTML`経由）に渡ると話が変わる。HTMLの構文には処理命令という概念がなく、`<?` から始まる記述は「bogus comment（不正なコメント）」状態として扱われ、コメントの終端は `?>` ではなく **`>`（山括弧が閉じた時点)** とみなされる。

つまり、同じ文字列 `<?foo bar="baz">evil</tag>?>` が

- **XMLパーサ**では: `<?foo bar="baz">evil</tag>?>` 全体が1つのProcessing Instructionノード（中身はテキストとしてしか扱われない＝無害）
- **HTMLパーサ**では: `<?foo bar="baz">` の時点で最初の `>` でコメントが終わり、続く `evil</tag>?>` は**通常のマークアップとして再解釈**される

という食い違いが生じる。DOMPurifyがXMLパーサでこの文字列を「安全な1ノード」と判定してツリーに残した後、その結果がシリアライズされ、被害者のページで`innerHTML`（HTMLパーサ）に渡された瞬間、コメントの終端位置のズレによって「隠れていたはずのタグ」が生きた要素として立ち上がる。これが典型的なmXSSのトリガーパターンである。

```html
<!-- サニタイズ時（XMLパーサ視点）: 1つのPIノードとして無害に見える -->
<?xml-stylesheet type="text/xsl" href="x"?><img src=x onerror=alert(1)>

<!-- 上記がシリアライズされ、後段でHTMLパーサ(innerHTML)に渡ると… -->
<!-- HTMLの bogus comment は "?>" ではなく最初の ">" で終わるため、
     <img onerror=...> が「コメントの外」の生きたタグとして再解釈される -->
```

*なぜ動くか*: XMLパーサの「PIは`?>`で終端」というルールと、HTMLパーサの「`<?`はbogus commentであり`>`で終端」というルールがずれているため、サニタイザ（XML視点）が安全と判断した境界と、ブラウザ（HTML視点）が実際に区切る境界が異なり、サニタイズ後には見えなかったタグ・属性が生きて出現する。

#### 前提・影響・修正

- 前提: DOMPurifyを`PARSER_MEDIA_TYPE: "application/xhtml+xml"`等、**XMLパースモード**で使っている構成（HTMLとして解析される既定設定のみを使うアプリは対象外）。
- 影響: 設定次第でDOMPurifyのサニタイズをすり抜け、任意のHTML/JSを注入できる（フルXSS）。
- 対応: DOMPurifyはこの報告を受けてXMLパース時のノード再帰チェック・PI/コメントの扱いを強化するパッチをリリースしている（cure53/DOMPurifyのバイパス修正履歴に複数回登場する「XML関連の名前空間・PI混同」系の一つ）。

> 出典: RyotaK: XMLでのDOMPurifyバイパス（Flatt） — https://flatt.tech/research/posts/bypassing-dompurify-with-good-old-xml/

---

### 2. Beyond XSS: Mutation XSS章

> ⚠️ **取得状況に関する注記**: 本ページ（aszx87410.github.io）および対応するGitHubリポジトリ内ファイルへのWebFetchは、いずれもこの環境のegressプロキシでブロックされ取得できませんでした。WebSearchで得られた要約と、mXSSに関する一般知識を基に、章の骨子を再構成して解説します。原文URL: https://aszx87410.github.io/beyond-xss/en/ch2/mutation-xss/

**この章の位置づけ**: 「Beyond XSS」（著者 aszx87410）は、単純な反射型/格納型XSSを卒業した読者向けに、より高度なXSSの成因を体系立てて説明する教材である。Mutation XSS章では、DOMPurifyのような業界標準サニタイザを対象に、「パース→浄化→シリアライズ→再パース」という多段パイプラインそのものに内在するリスクを解説している。

#### mXSSの一般原理（章の核心）

1. サニタイザは入力文字列を（多くの場合`DOMParser`や隠しiframe/templateの`innerHTML`を使って）DOMツリーへパースする。
2. ツリー上で危険なタグ・属性・イベントハンドラを除去する（この時点のツリーは安全）。
3. 除去後のツリーを`innerHTML`（シリアライズ）で**文字列に戻す**。
4. **その文字列**をアプリケーションが最終的に別の場所（実際のDOM、`innerHTML`、別の要素の中）へ挿入する際、**再度HTMLパーサに通る**。

問題は3→4の間で「文字列としては同じでも、挿入先のパースコンテキスト（名前空間、親要素の種類、quirks/no-quirksモードなど）が変わると、まったく別の木に組み上がる」ケースがあることだ。具体例として章で扱われる典型パターンは次の通り。

```html
<!-- サニタイズ対象（SVG名前空間内） -->
<svg><p><style><a id="</style><img src=x onerror=alert(1)>">

<!-- SVG内のtitle/style/desc要素はHTMLの"raw text"要素と扱いが異なり、
     子要素のテキスト解釈規則がタグごとに変わるため、
     いったんDOMに"安全"な形でパースされた属性値の中身が、
     シリアライズ後に別コンテキストへ挿入されると
     "閉じタグ文字列"として再解釈され、外側にエスケープする -->
```

*なぜ動くか*: `<style>`や`<title>`のようなHTML「raw text/escapable raw text要素」は、子ノードを通常のタグとしてではなく生テキストとして保持する特殊なパース規則を持つ。SVG内ではこの規則がさらに名前空間依存で変化する。サニタイザがパースした時点の属性値（安全な文字列）が、シリアライズ→別コンテキストでの再パース時には「属性値の外側」に飛び出し、閉じタグとして機能してしまう。これが「属性値の中身がテキストノードに“昇格”する」ような変異であり、mXSSの典型例として繰り返し登場するパターンである。

#### 防御としての章の結論

- サニタイズ結果を**再パースが起きない形**（例: `textContent`への格納、あるいは信頼できるTrusted Types経由でのみDOM操作）で扱う。
- サニタイザの出力をそのまま`innerHTML`に代入するのではなく、可能であれば**サニタイズと最終挿入を同一パースコンテキストで完結させる**（DOMPurifyの`RETURN_DOM`/`RETURN_DOM_FRAGMENT`オプションで実DOMノードのまま扱い、文字列化を経由しない）。
- サニタイザのバージョンを最新に保ち、既知のmXSSクラス（名前空間混同、raw text要素混同、テンプレート要素の扱い）に対するパッチを追随する。

> 出典: Beyond XSS: Mutation XSS章 — https://aszx87410.github.io/beyond-xss/en/ch2/mutation-xss/

---

### 3. HackerOne #1024734: Internet Bug Bounty DOMPurifyバイパス報告

> ⚠️ **取得状況に関する注記**: hackerone.comへのWebFetchはこの環境のegressプロキシでブロックされ、レポート本文（PoC付き詳細）は取得できませんでした。WebSearchで得られた開示情報の要約と、同種の脆弱性クラスに関する一般知識を基に補足します。原文URL: https://hackerone.com/reports/1024734

**開示情報の要点**

- 報告者: `vovohelo`（Internet Bug Bounty プログラム宛て、2020年11月2日提出、後日公開）
- 内容: DOMPurifyにおける**SVG要素のサニタイズ時の名前空間混同（namespace confusion）**を悪用したmutationベースのバイパス。手法はMichał Bentkowski（Securitum）が公表した一連のmXSS研究と類似のテクニックとされる。
- 報告者はブログで既に詳細を公開済みであったため、レポート自体の非公開維持に意味がないとして開示に至った、という経緯が記録されている。
- **Internet Bug Bountyとしての判定**: このレポートは「コアなインターネットインフラ・プロトコルの脆弱性」を対象とするIBBの趣旨に合致しないとして、**報奨金の対象外（Not Applicable/対象外）**と判断された。単一製品（DOMPurifyというnpmライブラリ）に閉じた問題は、ベンダー（cure53/DOMPurify）へ直接報告すべき、という整理である。

#### 技術的背景（Bentkowski系のSVG/MathML名前空間mXSS一般論）

この系統の攻撃は、`<svg>`や`<math>`要素の中に`<mglyph>`や`<mtext>`、あるいは`<table>`のようなHTML専用の解析ルールを持つ要素を混在させることで、パーサが「今どの名前空間（HTML/SVG/MathML）にいるか」の判定を誤らせる、というものが定番になっている。

```html
<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>-->
```

*なぜ動くか（一般的な原理）*: HTML5パーシングアルゴリズムには「foreign content（SVG/MathML）からHTMLへ戻る」ための特別な分岐（integration point）があり、`<mglyph>`や`<malignmark>`のような一部のMathML要素は「HTML integration point」としてHTML解析ルールに戻す挙動を持つ。この復帰処理のタイミングとサニタイザ側のツリー走査ロジックがずれていると、サニタイザが「まだSVG/MathML名前空間内なので安全」と判定した要素が、実際のブラウザ描画時には「すでにHTML名前空間に戻っている」ため、通常のHTMLタグ・イベントハンドラとして有効化されてしまう。

*影響*: DOMPurifyの対象バージョン（2.0.17以前、報告当時）で、SVG/MathMLを許可リストに含む設定においてサニタイズ完全バイパスが成立し、任意JS実行に至る。

*修正状況*: cure53/DOMPurifyはこの系統の報告を受け、名前空間の遷移をより厳格に追跡する`NAMESPACE`検証ロジックの強化を複数バージョンにわたって行っている（同種の亜種が2020年〜2025年にかけて継続的に報告・修正されているクラスの脆弱性であり、本レポートはその初期の一件にあたる）。

> 出典: Internet Bug Bounty DOMPurifyバイパス報告 #1024734 — https://hackerone.com/reports/1024734

---

### まとめ: 3件に共通する教訓

| 資料 | 食い違いの発生源 | 悪用されたパーサ間の差 |
|---|---|---|
| Flatt (RyotaK) | XMLパースモード vs HTML再パース | 処理命令(PI)の終端規則(`?>` vs bogus commentの`>`) |
| Beyond XSS | raw text要素 vs 通常要素、SVG内外 | 属性値/テキストノードの解釈境界のコンテキスト依存性 |
| HackerOne #1024734 | SVG/MathML名前空間 vs HTML名前空間 | HTML integration pointでの名前空間復帰タイミング |

いずれも「サニタイザがパースした瞬間のコンテキスト」と「ブラウザが最終的に描画する瞬間のコンテキスト」が一致していない、という一点に帰着する。防御側の一般原則としては、

- サニタイズと最終挿入をできる限り**同一のパース経路・同一コンテキスト**で完結させる（文字列化を挟まない、`RETURN_DOM`系オプションの活用）。
- サニタイザのバージョンを常に最新化し、名前空間混同・PI混同・raw text要素混同といった**既知のmXSSクラス**のパッチを追随する。
- 可能であればTrusted Typesを併用し、「サニタイズ済み文字列を無条件に信頼してinnerHTMLへ渡す」経路自体を型レベルで塞ぐ。

が挙げられる。
