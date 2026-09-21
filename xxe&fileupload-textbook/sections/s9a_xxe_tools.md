## XXE検出・OOXML編集ツール

XXE(XML External Entity、XML外部実体参照)は原理さえ理解すれば手作業でも検証できるが、実際の診断では「候補となるsink(入力が最終的にパーサへ渡され解釈される危険な代入先)を大量に洗い出す」「Office文書やSVGなど、圧縮・変換を挟むファイル形式にペイロードを埋め込む」「Burpの標準機能では扱いにくい多重エンコードされたXMLを素早く書き換える」といった作業が発生し、これらは専用ツールを使うことで大幅に効率化できる。本節では、XXE診断の現場で広く使われる3つのツール群を、それぞれの内部動作の仕組みとともに解説する。いずれも「防御側が自社アプリケーションを検証する」「許可を得たペンテストで使う」ことを前提とした解説であり、実在サービスへの無許可の検証は行わないこと。

### 1. PayloadsAllTheThings「XXE Injection」に列挙されたツール群

PayloadsAllTheThingsのXXE Injectionページは、単一のペイロード集ではなく、XXE診断のワークフロー全体を支える複数の補助ツールへのリンク集としても機能している。ここでは代表的なものを、用途別に整理して説明する。

#### 1-1. アウトオブバンド(OOB)検出を助けるサーバ系ツール

古典的なXXEは、レスポンスに外部実体の展開結果がそのまま反映される「in-band(帯域内)」型であれば検出は容易だが、実際の脆弱なアプリケーションの多くはレスポンスに何も反映しない「blind XXE」である。この場合、攻撃者が制御するサーバへ向けてDNSクエリやHTTP/FTPリクエストを発生させ、それが届いたかどうかで脆弱性の有無を判定する「アウトオブバンド(OOB、帯域外)検出」が必要になる。このOOB検出を支えるのが以下のツール群である。

**staaldraad/xxeserv** は、FTPプロトコルに対応したミニWebサーバで、次のように起動する。

```bash
xxeserv -o files.log -p 2121 -w -wd public -wp 8000
```

このコマンドはポート2121でFTPリクエストを待ち受け、同時にポート8000でHTTPサーバとしても振る舞い、受信した内容を`files.log`に記録する。なぜFTPが重要かというと、HTTPでOOB通信を行うと外部実体のGETリクエストのレスポンスボディが(パーサの設定によっては)ローカルDTDの一部として再解釈され、複雑な多段階の「OOB経由でのファイル窃取(Out-of-Band Data Exfiltration)」を組み立てる必要が出てくる。FTPは単純な平文プロトコルであり、`ftp://attacker.com/`のようなURLに対してXMLパーサがどのようなリクエスト(ファイル名を含むUSERコマンドやパス指定など)を投げてくるかをそのまま記録できるため、盗み出したいファイルの内容をFTPのファイル名やパスの一部としてエンコードして送出させる手法(後述するOOB窃取の1パターン)の検証に向いている。

**lc/230-OOB** は「FTP経由でファイル内容を取得し、ペイロードも生成できるアウトオブバンドXXEサーバ」で、`http://xxe.sh/` というホスティング版も提供されている。自前でリスナーを立てずに、公開されているコラボレータ的なサービスを使って即座に外部実体参照が届くかを確認できる点が特徴である。Burp Suiteに標準搭載されている「Burp Collaborator」も原理は同じで、一意なサブドメインへのDNS/HTTP到達を監視することでOOB検出を行う。診断対象が社内ネットワークに閉じている場合は外部のCollaboratorやxxe.shが使えないため、xxeservのような自前ホスト型のリスナーが必要になる。

> 出典: PayloadsAllTheThings XXE Injection README — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XXE%20Injection/README.md

#### 1-2. 自動化された悪用ツール

**enjoiz/XXEinjector** は、「直接的(direct)手法と各種のアウトオブバンド手法の両方を使って、XXE脆弱性の悪用を自動化するツール」である。典型的な使い方は、Burpなどでキャプチャした生のHTTPリクエストファイルを与え、そのリクエスト中のXML部分に対して自動的に複数のペイロードパターン(パラメータ実体を使ったもの、UTF-7エンコードを使ったWAF回避版、OOB版など)を試行させるというものである。手作業では「同じ脆弱性候補に対して数十通りのペイロードを1つずつ試す」という繰り返し作業が発生するが、これを自動化することで検証の網羅性と速度が大きく向上する。なぜこの自動化が有効かというと、XXEはXMLパーサの実装(libxml2、Xerces、.NETのXmlDocument、JavaのDocumentBuilderFactoryなど)によって、外部実体の展開を許可するデフォルト設定や、パラメータ実体(`%`で始まる実体、DTD内部でのみ参照可能な実体)のサポート状況が異なるため、「1つのペイロードが通らない=脆弱性がない」とは言い切れず、複数パターンの総当たりが必要になるからである。

**whitel1st/docem** は「docx、odt、pptxなどにXXEおよびXSSペイロードを埋め込むためのユーティリティ」で、後述するOOXML/ODF形式へのペイロード埋め込みを支援する、oxml_xxeと同系統のツールである。

**bytehope/wwe** は、特定のPHP libxml関連フラグ(`LIBXML_NOENT`など、実体展開を有効にするフラグ)が設定された状態でのXXE悪用を示すPoC(概念実証)である。PHPの`simplexml_load_string()`や`DOMDocument::loadXML()`は、明示的に`LIBXML_NOENT`を指定しない限り既定では外部実体を展開しない実装になっている場合があり、このPoCは「開発者がどのフラグを誤って有効化するとXXEが発生するか」を示す教材的な役割を持つ。

> 出典: PayloadsAllTheThings XXE Injection README — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XXE%20Injection/README.md

#### 1-3. DTD探索・ペイロード生成ツール

**GoSecure/dtd-finder** は「ローカルDTD(Document Type Definition、XML文書の構造を定義するファイル)を列挙し、それを使ってXXEペイロードを生成する」ツールである。これは「XXE OOB通じない環境でのローカルDTDを使ったデータ窃取(いわゆる Out-of-Band 不要の Error-Based XXE)」というテクニックを自動化するものである。仕組みを説明すると、多くのLinuxディストリビューションやアプリケーションのインストール先には、`/usr/share/yelp/dtd/`や特定のフレームワークが同梱するDTDファイルなど、パラメータ実体を定義したDTDが標準で存在している。攻撃者が外部からDTDをロードできない(アウトバウンド通信が遮断されている)環境でも、ターゲットサーバ上に既に存在するこれらのDTDファイル内のパラメータ実体を悪用し、エラーメッセージにファイル内容を混入させて外部に漏らす手法が知られている。dtd-finderは、既知のOS/ソフトウェアパッケージが同梱するDTDのデータベースを持っており、対象環境で使われていそうなDTDを特定した上で、それに対応するペイロードを自動生成する。この手法が成立する理由は、XML仕様上パラメータ実体は別のパラメータ実体を「内部」で参照でき、かつエラーメッセージ生成時にパーサがその実体を展開してしまう実装がある(いわゆる「Error-based XXE」)ためである。

**NetSPI/Content-Type Converter** はBurp拡張で、JSON⇔XML間の相互変換を行う。REST APIがJSONを受け付ける前提でも、Content-Typeヘッダを`application/xml`に変更し、ボディをXML形式に変換して送信すると、バックエンドの一部の実装(特に複数フォーマットを自動判別するフレームワーク)がXMLとしてパースしてしまい、想定外の攻撃面が開くケースがある。この拡張は「JSON前提のAPIに対してXXEの糸口がないか」を機械的に洗い出す際に使われる。

> 出典: PayloadsAllTheThings XXE Injection README — https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XXE%20Injection/README.md

#### 1-4. これらのツールを使う際の注意(スコープ)

いずれのツールも「本来はXMLとして解釈されるべきでない入力や、パーサが外部実体を安全に無効化していない設定」を検出するための補助であり、実運用では必ず許可されたスコープ内でのみ使用する。特にOOBサーバ系のツールは、DNS/HTTP/FTPリクエストという形で対象サーバに外部通信を発生させるため、本番環境や第三者のインフラに対して無断で実行してはならない。

### 2. BuffaloWill/oxml_xxe — Office/ODF/SVG向けペイロード埋め込みツール

#### 2-1. 位置づけと目的

`oxml_xxe`は、Black Hat USA 2015の講演「Exploiting XXE in File Upload Functionality」に合わせて公開されたツールで、ファイルアップロード機能に対するXXE攻撃を専門に扱う。多くのXXE教材は「生のXMLをそのままPOSTする」単純なケースを扱うが、実際の攻撃対象となるファイルアップロード機能(履歴書アップロード、画像アップロード、Officeテンプレートのインポートなど)では、アップロードされるファイルの多くがZIPベースのコンテナ形式であり、その中に複数のXMLファイルが格納されている。oxml_xxeは、この「コンテナの中のXMLを書き換えて再パッケージする」という定型作業を自動化するツールである。

#### 2-2. 対応フォーマットと仕組み

対応するファイル形式は次の通りである。

- Microsoft Office Open XML形式: DOCX, XLSX, PPTX
- OpenDocument形式: ODT, ODG, ODP, ODS
- その他: SVG, 生のXMLファイル, さらにPDFやJPG/GIFといった、XMLを内包しうる、あるいはメタデータ領域に細工が可能な形式

なぜこれらの形式がXXEの標的になりうるかを、仕組みレベルで説明する。DOCX/XLSX/PPTXなどのOOXML形式は、実体はZIPアーカイブであり、内部に`[Content_Types].xml`、`docProps/core.xml`、`word/document.xml`といった複数のXMLファイルを含んでいる。多くのアプリケーションは、アップロードされたOfficeファイルからメタデータ(作成者名、タイトルなど)を抽出したり、プレビュー生成のために内部XMLをパースしたりする処理を持っており、このパース処理で使われるXMLパーサの設定次第でXXEが成立する。ODF系(ODT等)も同様にZIP+XMLの構造を持つ。SVGはXMLのサブセットそのものであり、画像として扱われがちだが実体はXML文書であるため、サーバサイドでSVGをラスタライズ(画像化)する際にImageMagick/librsvgなどが内部でXMLパーサを呼び出し、そこでXXEが発生する事例が多数報告されている。

oxml_xxeはこれらの形式について、あらかじめ用意されたXXEペイロードのテンプレートを、対象ファイル内の適切なXML(例えばOOXMLなら`[Content_Types].xml`や`docProps/core.xml`、ODFなら`meta.xml`など)に注入し、ZIPとして再圧縮して出力する。手作業でこれを行うと「ZIPを展開する→該当XMLをテキストエディタで編集する→DOCTYPE宣言と外部実体参照を正しい位置に挿入する→ZIP形式の要件(圧縮方式や`mimetype`ファイルの扱いなど、形式によって異なる)を壊さないように再圧縮する」という工程を毎回手動で行う必要があり、ミスが起きやすい。oxml_xxeはこの一連の工程をツール化することで、様々なペイロードパターンを高速に試すことを可能にしている。

#### 2-3. 導入方法

READMEで推奨されている導入方法はDockerを使う方式である。

```bash
docker build --tag oxml_xxe .
docker run --name oxml_xxe -p 4567:4567 --rm oxml_xxe
```

Docker Composeを使う場合は次の通りである。

```bash
docker-compose up --build
```

Ubuntu上で手動セットアップする場合は、Ruby 3.2系および関連する開発用ライブラリ、bundlerを用意した上で`ruby server.rb`を実行する。起動後はWebブラウザから`http://localhost:4567/`にアクセスすることでツールのWeb UIを利用できる。ツール自体はRubyで実装されており、Webフレームワークとして軽量な`Sinatra`、UIには`Bootstrap`、テンプレートエンジンには`Slim`が使われている。リポジトリにはペイロード設定ファイルとテストサンプルが含まれており、対象フォーマットごとにどのXMLファイルへどのようなペイロードを注入するかを設定できる。

#### 2-4. なぜこの種のツールが重要か(防御的観点)

oxml_xxeのようなツールの存在は、そのまま防御設計への示唆になる。「ファイルアップロード機能でOffice文書やSVGを受け付ける場合、そのファイルをパースする全ての処理(メタデータ抽出、プレビュー生成、変換処理)で外部実体解決を無効化する必要がある」という点、そして「拡張子や見た目のフォーマットチェックだけでは不十分で、コンテナ内部のXMLまで検査対象に含める必要がある」という点である。診断側としては、単純なXMLペイロードのテストだけでなく、実際に使われるであろうOffice文書形式でのテストも行うことで、防御側が見落としがちな経路を洗い出すことができる。

> 出典: BuffaloWill/oxml_xxe — https://github.com/BuffaloWill/oxml_xxe

### 3. PortSwigger/office-open-xml-editor — Burp Suite拡張

#### 3-1. 課題:なぜBurpの標準機能だけでは不十分か

Burp Suiteの標準的なRepeater/Intruderは、リクエストボディをテキストとしてそのまま編集できるが、OOXMLファイル(DOCX/XLSX/PPTXなど)はZIPでパッケージされたバイナリに近い扱いのため、Repeaterの生のテキストビューでは中身のXMLを直接編集できない。前述のoxml_xxeのようにローカルでファイルを再構築して都度アップロードし直す方法もあるが、「1つのパラメータだけを変えて再送する」といったBurpならではの反復的な試行が行いにくいという課題がある。`office-open-xml-editor`は、この課題を解決するためにPortSwigger自身が公開しているBurp拡張(Python 2.7で実装)である。

#### 3-2. 動作の仕組み

この拡張は、Burpが送受信するマルチパートPOSTリクエストを監視し、リクエストのContent-TypeがOOXML形式のものである(例えば`application/vnd.openxmlformats-officedocument.wordprocessingml.document`のようなMIMEタイプ)と判定すると、リクエストエディタに「Open Office XML tab」という専用タブを自動的に追加する。このタブを開くと、拡張がリクエストボディ中のZIP(=OOXMLファイル)をその場で展開し、内部に含まれるXMLファイルの一覧とその中身を表示・編集できるようにする。テスターがこのタブ上でXMLを直接書き換えると、拡張は裏側でファイルを再圧縮し、Repeaterからの送信時に正しいOOXML(ZIP)構造としてリクエストボディに反映する。つまり「ZIP展開→XML編集→再圧縮」という、本来なら手作業やスクリプトで行う工程を、Burpのリクエスト送信フローに透過的に統合している点が最大の価値である。

#### 3-3. 導入とセットアップ

導入手順は次の通りである。

1. GitHubリポジトリをクローンする。
2. BurpのExtenderタブ(バージョンによってはExtensionsタブ)から`OfficeOpenXMLEditor.py`をロードする。
3. `conf/conf.json`設定ファイルで、編集対象とするファイル(デフォルトは`[Content_Types].xml`)や、認識させたいOOXMLのContent-Typeを調整する。
4. 設定後は、OOXMLのリクエストが検出されると自動的に拡張が有効化される。

デフォルトで`[Content_Types].xml`が編集対象になっている理由は、この節2-2で述べた通り、この種のOOXMLコンテナ内XMLがパース処理の起点になりやすく、外部実体宣言を注入しやすい代表的な場所だからである。ただし脆弱性の性質によっては`docProps/core.xml`や`word/document.xml`など他のXMLファイルの方が適切な注入先になることもあるため、設定ファイルで対象を柔軟に変更できるようになっている。

#### 3-4. 主な機能と制約

- **編集対象ファイルのカスタマイズ**: OOXMLコンテナ内のどのXMLファイルを編集タブに表示するかを設定できる。
- **Content-Typeのカスタマイズ**: 拡張が「これはOOXMLリクエストだ」と認識する際の判定基準となるContent-Typeを追加・変更できる。
- **Burp Collaboratorとの連携**: 編集したXML内にBurp Collaboratorのペイロード(一意なサブドメインを含むURL)を挿入することで、前述のblind XXE、すなわちレスポンスに結果が現れないタイプのXXEを、Collaboratorへの到達有無で検出できる。
