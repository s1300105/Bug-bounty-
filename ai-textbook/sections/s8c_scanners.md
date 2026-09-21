## LLM脆弱性スキャナ：garak・spikee・Prompt Fuzzer

LLM（大規模言語モデル）アプリケーションのセキュリティ検証を、Webアプリのように毎回手作業のプロンプト打鍵で行うのは非効率であり再現性も低い。従来のWebセキュリティ診断がBurp SuiteやZAPのような自動スキャナを持つのと同様、LLM領域にも「プロンプトインジェクション」「jailbreak（脱獄、モデルに設計者の意図しない安全制約違反の出力をさせること）」「データ漏洩」といった脆弱性クラスを体系的・網羅的にテストするための専用ツールが登場している。本節では、代表的な3つのオープンソーススキャナ——**garak**（LLM本体の網羅的レッドチーミング）、**spikee**（プロンプトインジェクション評価に特化したキット）、**Prompt Fuzzer**（system prompt の堅牢性診断）——を取り上げ、それぞれのアーキテクチャ、動作原理、具体的な使い方を解説する。この3つは役割が重なりつつも異なる層をカバーしており、実務では組み合わせて使うのが基本になる。

### なぜLLM専用スキャナが必要か

Webアプリの脆弱性スキャナは「既知のsink（入力が最終的に実行・解釈される危険な代入先）パターン」を探索する。SQLiならクエリ文字列への未エスケープ挿入、XSSならDOMへの未エスケープ挿入、というように攻撃面が構造的に定まっている。

一方LLMアプリケーションの「脆弱性」は、モデルの確率的な出力そのものに宿る。同じ入力でも温度パラメータやサンプリングのばらつきにより出力が変動し、「一度成功した攻撃が次も成功するとは限らない」「一度失敗した攻撃が次は成功するかもしれない」という非決定性がある。したがって、LLM向けスキャナは静的な脆弱性パターンマッチではなく、

1. 大量の攻撃プロンプト（probe / seed / attack）をテンプレートやプラグインで生成し、
2. ターゲットに投げ、
3. 出力を検出器（detector / judge）で機械的に評価し、
4. 統計的に「どの攻撃カテゴリでどの程度成功したか」を可視化する

という「ファジング＋統計的評価」のアーキテクチャを取る。この構造を理解しておくと、3つのツールの違いも単なる機能差ではなく「どの層のファジングに特化しているか」の違いとして整理できる。

---

### garak（NVIDIA, LLM脆弱性スキャナ）

**garak**（Generative AI Red-teaming & Assessment Kit）はNVIDIAが公開しているOSSで、"ハルシネーション、データ漏洩、プロンプトインジェクション、偽情報、毒性生成、jailbreak等の弱点を探る"ことをミッションに掲げる、LLM本体（モデル）を対象にした網羅型の脆弱性スキャナである。位置づけとしては、Webでいう「Nikto」や「Nessus」のように、多数の既知攻撃カテゴリを一括で当てる汎用スキャナに近い。

#### アーキテクチャ：Probe → Detector → Generator → Harness → Evaluator

garak の処理フローは次のパイプラインで構成される。

```
CLI入力 → Generator（対象LLMへの接続） → Harness（テスト構造化）
        → Probe（攻撃プロンプト生成） → Detector（応答の脆弱性判定）
        → Evaluator（集計・評価） → Report（JSONL/ログ）
```

- **Probes（`garak/probes/`）**: LLMに投げる攻撃プロンプト群を生成するクラス。攻撃カテゴリごとにモジュール化されている。
- **Detectors（`garak/detectors/`）**: LLMの応答を受け取り「失敗モード（脆弱性が顕在化した状態）」を検出する。各Probeは`primary_detector`（主判定器）と`extended_detectors`（補助判定器）を持ち、1つの攻撃に対して複数の観点から判定できる。
- **Generators（`garak/generators/`）**: 対象LLM（OpenAI、Hugging Face、AWS Bedrockなど）への接続を抽象化するプラグイン層。
- **Harnesses（`garak/harnesses/`）**: どの順序・粒度でProbeを実行するかを制御する。デフォルトは`probewise`（Probeごとに一括実行）。
- **Evaluators（`garak/evaluators/`）**: Detectorの判定結果を集計し、合否レポートを作る。

このように「攻撃生成」「実行」「判定」「評価」を明確に分離したパイプライン設計になっているのは、Webのファジングツール（例: ffufのwordlist生成とレスポンス判定の分離）と同じ思想である。攻撃パターン（Probe）とLLM接続方式（Generator）が疎結合なので、新しいLLMプロバイダが出てもGeneratorを1つ追加するだけで既存の全Probeが使い回せる。

#### 検出できる脆弱性カテゴリ（代表的なProbe）

| プローブ | 内容 |
|---|---|
| `encoding` | Base64等のテキストエンコーディング経由でフィルタを回避するプロンプトインジェクション |
| `dan` | "Do Anything Now"型のロールプレイjailbreak |
| `promptinject` | PromptInjectフレームワークの攻撃セットの実装 |
| `glitch` | グリッチトークン（訓練データ上の出現頻度が異常でモデルの挙動を不安定にするトークン）の検出 |
| `leakreplay` | 訓練データの逐語的な再生（記憶漏洩）検出 |
| `malwaregen` | マルウェアコード生成に応じてしまうかの検証 |
| `realtoxicityprompts` | RealToxicityPromptsデータセットのサブセットによる毒性生成テスト |
| `xss` | LLMの出力がクロスサイト攻撃につながるペイロードを生成しないかの検証 |
| `packagehallucination` | 存在しないパッケージ名をLLMが生成し、依存関係ハルシネーション（サプライチェーン攻撃の温床）を招かないかの検証 |
| `badchars` | Unicode不可視文字などの摂動を使った注入 |
| `gcg` | GCG（Greedy Coordinate Gradient）型の敵対的接尾辞によるシステムプロンプト破壊 |
| `atkgen` | 攻撃側LLMを使い自動で攻撃プロンプトを生成する赤チーム自動化Probe |

`packagehallucination`は特に実務上重要である。LLMがコード生成時に実在しないパッケージ名を提案し、攻撃者がその名前でパッケージを先取り登録する「slopsquatting」と呼ばれるサプライチェーン攻撃の温床になり得るため、防御側はこのProbeで自社が使うコード生成用LLMの挙動を事前に確認しておく価値がある。

#### インストールと基本コマンド

```bash
# 標準インストール（PyPI）
python -m pip install -U garak

# 開発版（最新のProbe/Detectorを試したい場合）
python -m pip install -U git+https://github.com/NVIDIA/garak.git@main

# ソースから（Python 3.11〜3.13対応）
conda create --name garak "python>=3.11,<=3.13"
conda activate garak
gh repo clone NVIDIA/garak
cd garak
python -m pip install -e .
```

利用可能なProbe一覧を確認：

```bash
garak --list_probes
```

OpenAIモデルに対してエンコーディング攻撃のみを実行する例：

```bash
export OPENAI_API_KEY="sk-123XXXXXXXXXXXX"
python3 -m garak --target_type openai --target_name gpt-5-nano --spec probes.encoding
```

`--target_type`が接続方式（Generatorプラグイン）、`--target_name`が具体的なモデル名、`--spec`が実行するProbe（省略するとデフォルトセットが全実行される点に注意）を指定する。

Hugging Face上のモデルにDANのバリアント11.0だけを当てる例：

```bash
python3 -m garak --target_type huggingface --target_name gpt2 --spec probes.dan.Dan_11_0
```

AWS Bedrock経由でClaude系モデルに対しDAN系Probe群を実行する例：

```bash
export BEDROCK_API_KEY="your-api-key"
export BEDROCK_REGION="us-east-1"
garak --target_type bedrock --target_name claude-3-sonnet --spec probes.dan
```

Hugging Face Inference APIを使う場合：

```bash
export HF_INFERENCE_TOKEN="hf_..."
python3 -m garak --target_type huggingface.InferenceAPI \
  --target_name "mosaicml/mpt-7b-instruct" --spec probes.encoding
```

対応するLLMプロバイダはHugging Face Hub（Pipeline/Inference API/Private Endpoints）、OpenAI API、AWS Bedrock、Replicate、Cohere、Groq、LiteLLM、任意のREST APIエンドポイント、ggml（llama.cpp）、NVIDIA NIMなど広範で、社内でホストしたモデルもREST Generatorでラップして検証対象にできる。

#### レポート出力と結果の読み方

garakは実行のたびに次を生成する。

- **`garak.log`**: デバッグ情報とプラグインの出力を継続記録するログ。
- **JSONL形式レポート**: 実行ごとに新規ファイルが作られ、各試行（attempt）を1エントリとしてJSON Lines形式で記録する。`status`属性でその試行の処理段階（生成済み・評価済みなど）が`garak.attempts`モジュール由来の定数として記録される。
- **ヒットログ**: 脆弱性が実際に検出された（'hit'した）試行だけを抽出した詳細ログ。

実行中はProbeごとにプログレスバーが表示され、Detectorによる評価結果が行単位で出力される。望ましくない挙動が検出されると「FAIL」表示とともに失敗率が示され、例えば`840/840`という表記は総生成数のうち正常（安全）に応答した数を示す形式になっている。この数値ベースの出力により、モデルのバージョン間比較や、システムプロンプトを変更した前後での防御力の変化を定量的に追跡できる。

#### カスタムプラグイン開発

独自の攻撃パターンを追加したい場合は`garak.probes.base.TextProbe`などの基底クラスを継承し、必要最小限のメソッドをオーバーライドする。単体テストはPythonの対話セッションで`import garak.probes.mymodule`として動作確認するか、次のように最小構成でスキャンを走らせて検証する。

```bash
python3 -m garak -m test.Blank -p mymodule -d always.Pass
```

garakはApache License 2.0で公開され、手法の詳細はプリプリント論文「garak: A Framework for Security Probing Large Language Models」にまとめられている（バージョンやProbeの追加は活発に続いており、`--list_probes`で常に最新のカタログを確認するのが安全）。

> 出典: garak (NVIDIA) — https://github.com/NVIDIA/garak

---

### spikee（プロンプト注入評価キット）

**spikee**（Simple Prompt Injection Kit for Evaluation and Exploitation）はReversec Labsが開発したツールキットで、"LLMs、ガードレール、アプリケーションのプロンプト注入およびjailbreakに対する耐性を評価する"ことに特化している。garakがLLM本体を幅広くレッドチーミングするのに対し、spikeeはプロンプトインジェクション（外部から与えられた信頼できない入力に埋め込まれた指示を、モデルが「本来のシステム指示」と誤認して実行してしまう問題）という単一カテゴリを、データセット生成からガードレール込みのエンドツーエンド評価まで深く掘り下げる点に特徴がある。

#### アーキテクチャ：2フェーズ設計

spikeeは以下の2段階で動作する。

1. **テストデータセット生成フェーズ**: シード（攻撃プロンプトの基本素材）フォルダから、カスタムのテストケース群（データセット）をJSONL形式で組み立てる。
2. **テスト実行フェーズ**: 生成済みデータセットを実際のターゲット（LLM、アプリケーション、ガードレール製品）に対して実行し、結果を判定する。

各フェーズはPythonモジュールとして差し替え可能な設計になっており、次の概念で構成される。

- **Seeds（シード）**: 攻撃プロンプトの元になる基本データ。複数のシードを組み合わせてテストケースを生成する。
- **Plugins（プラグイン）**: データセット生成時にペイロードへ変換を適用する。例としてleetspeak（`1337`のように文字を似た記号・数字に置換する難読化）、Base64エンコーディング、Best-of-N（同じ攻撃の多数のバリエーションを生成し統計的に突破率を上げる手法）などがある。
- **Targets（ターゲット）**: テスト対象システムへの接続ブリッジ。LLMプロバイダ単体だけでなく、カスタムアプリケーションやガードレール製品にも対応する。
- **Judges（判定機）**: 攻撃が成功したかどうかを評価する。キーワード検索・正規表現による「基本判定機」と、LLMにセマンティックな成否判定をさせる「LLM判定機」の2種類がある。
- **Attacks（攻撃モジュール）**: 静的なデータセットに対し、失敗した場合に自動で亜種を生成して再試行する動的最適化を行う（`best_of_n`や`prompt_decomposition`、マルチターンの`crescendo`など）。

この設計思想の要点は「静的なテストケース（Seeds+Plugins→Dataset）」と「動的な適応攻撃（Attacks）」を明確に分離していることである。防御側の観点では、まず静的データセットで基礎的な防御漏れを洗い出し、それを塞いだ後に動的攻撃で「未知のバリエーションに対する頑健性」を追加検証する、という段階的な評価が可能になる。

#### インストールと初期化

```bash
# 基本インストール
pip install spikee

# 全プロバイダ対応の依存関係込み
pip install "spikee[all]"

# ソースから
git clone https://github.com/ReversecLabs/spikee.git
cd spikee
python3 -m venv env
source env/bin/activate
pip install ".[all]"
```

作業用ディレクトリを初期化する：

```bash
mkdir workspace && cd workspace
spikee init
```

利用可能なモジュールの一覧確認：

```bash
spikee list seeds
spikee list datasets
spikee list judges
spikee list targets
spikee list plugins
spikee list attacks
```

#### データセット生成

生成形式には、アプリケーションの「ユーザー入力欄」を想定した`user-input`と、LLMに直接投げる完全なプロンプトを想定した`full-prompt`がある。この2形式の使い分けは、テスト対象がどこにあるか（アプリのフィルタ層を通すのか、モデルに直接投げるのか）に対応している。

```bash
# アプリケーション向け（ユーザー入力欄をシミュレート）
spikee generate --seed-folder datasets/seeds-cybersec-2026-01 \
                --format user-input

# LLM直接テスト向け（完全なプロンプトを構成）
spikee generate --seed-folder datasets/seeds-cybersec-2026-01 \
                --format full-prompt
```

プラグインで難読化を適用する例：

```bash
# leetspeak変換を適用
spikee generate --seed-folder datasets/seeds-cybersec-2026-01 --plugin 1337

# best_of_nで50バリエーション生成
spikee generate --seed-folder datasets/seeds-cybersec-2026-01 \
                --plugin best_of_n \
                --plugin-options "best_of_n:variants=50"

# 複数プラグインの連結適用（splat → base64の順で変換）
spikee generate --seed-folder datasets/seeds-cybersec-2026-01 \
                --plugin "splat|base64"
```

プラグインをパイプ（`|`）で連結できる設計は、Base64エンコードだけを検出するフィルタと、文字置換だけを検出するフィルタをそれぞれ個別に回避するのではなく、複数の難読化層を重ねてWAF/ガードレールをすり抜けるケースを模擬するためのものである。実運用のガードレール製品は単一のデコード処理しか行わないことがあり、多段エンコーディングは検出漏れの典型パターンになる。

#### テスト実行

```bash
# 基本実行
spikee test --dataset datasets/cybersec-2026-01-full-prompt-dataset-*.jsonl \
            --target llm_provider \
            --target-options "openai/gpt-4o-mini"

# 複数データセットをまとめて実行
spikee test --dataset datasets/cybersec-2026-01.jsonl \
            --dataset datasets/simsonsun.jsonl \
            --dataset-folder datasets/cyber_datasets/ \
            --target llm_provider \
            --target-options "openai/gpt-4o-mini"

# LLM判定機を使って成否をセマンティックに評価
spikee test --dataset datasets/simsonsum-high-quality-jailbreaks.jsonl \
            --target llm_provider \
            --target-options "openai/gpt-4o-mini" \
            --judge-options "bedrock/claude45-haiku"

# 動的攻撃（best_of_n）で25回まで最適化を試行
spikee test --dataset datasets/dataset-name.jsonl \
            --target llm_provider \
            --target-options "bedrock/claude45-sonnet" \
            --attack best_of_n --attack-iterations 25

# プロンプト分解攻撃（攻撃を複数ターンに分割して単発フィルタを回避）
spikee test --dataset datasets/dataset-name.jsonl \
            --target llm_provider \
            --target-options "bedrock/claude45-sonnet" \
            --attack prompt_decomposition \
            --attack-iterations 50 \
            --attack-options 'prompt_decomposition:variants=15,model=bedrock-deepseek-v3'

# マルチターン攻撃（crescendo: 段階的に要求をエスカレートさせる手法）
spikee test --dataset datasets/dataset-name.jsonl \
            --target demo_llm_application \
            --attack crescendo \
            --attack-options 'max-turns=5,model=bedrock/deepseek-v3' \
            --attack-only
```

`crescendo`攻撃は、1ターン目でいきなり有害な要求をせず、無害な話題から徐々にエスカレートさせて最終的に禁止事項を引き出す手法をシミュレートする。単発のプロンプトフィルタだけを見ているガードレールは、会話全体の文脈的なエスカレーションを追跡できず見逃すことがあるため、これは「単発入力フィルタだけでは不十分」であることを示す実証にもなる。

実行時に有用なオプション：

```bash
--threads 8       # 並行スレッド数（大規模データセットの高速化）
--attempts 3      # 1テストケースあたりのリトライ回数（非決定性への対応）
--throttle 0.5    # リクエスト間の待機秒数（レート制限対策）
--sample 0.1      # データセットの10%のみを抽出してテスト（高速なスモークテスト）
```

`--attempts`が用意されているのは、LLMの出力が確率的であるため、1回の試行で失敗しても複数回試せば成功する（＝脆弱性が存在する）ケースを見逃さないための設計である。逆に言えば、1回だけの手動テストで「安全」と判断するのは不十分であることをツール自体が示唆している。

#### 結果分析

```bash
# 単一結果ファイルの分析
spikee results analyze --result-file ./results/results_llm_provider-openai_gpt-4o-mini.jsonl

# フォルダ全体を統合して概観
spikee results analyze --result-folder ./results/ --overview --combine

# 成功した攻撃のみを抽出
spikee results extract --result-file results/results_*.jsonl --category success

# WebUIで結果を閲覧
spikee webui -p 8000
```

評価は静的判定（正規表現・キーワード検索、例えばXSSペイロードやMarkdown画像タグ埋め込みの有無を機械的に確認）と、LLM判定（セマンティックに有害性・指示追従の有無を判定）を組み合わせられる。静的判定は高速だが表層的な文字列一致に依存し、LLM判定は柔軟だが判定LLM自体のコストと判定LLM自身のバイアス・誤判定リスクを抱える、というトレードオフを理解した上で使い分けるのが実務上のポイントである。

なお、spikeeは内部実装をLangChainから軽量な`any-llm`ライブラリへ移行しており、依存関係の最小化が図られている（バージョンにより対応ターゲット・攻撃モジュールは拡充され続けているため、`spikee list`系コマンドで都度最新のカタログを確認すること）。

> 出典: spikee (ReversecLabs) — https://github.com/ReversecLabs/spikee

---

### Prompt Fuzzer（system prompt脆弱性スキャナ）

**Prompt Fuzzer**（`ps-fuzz`、PyPI名`prompt-security-fuzzer`）は、"The open-source tool to help you harden your GenAI applications"を掲げるツールで、garakやspikeeがモデル全体やインジェクション全般を対象にするのに対し、**アプリケーション開発者が自分で書いたsystem prompt（システムプロンプト。LLMに与える「役割」「制約」「禁止事項」などの土台となる指示）そのものの堅牢性**を診断することに特化している。実務では「自社のチャットボットのsystem promptは、動的な攻撃に対してどれだけ耐えられるか」を素早く数値化したい場面で使う。

#### アーキテクチャと評価の仕組み

Prompt Fuzzerの核心は、ツールが"dynamically tailors its tests to your application's unique configuration and domain"（アプリケーション固有の設定・ドメインに応じて動的にテストを調整する）点にある。具体的には、投入されたsystem promptから必要なコンテキスト（アプリケーションの用途、扱うドメイン、想定される制約）を抽出し、その内容に適応させた攻撃プロンプトを生成してから実行する。汎用の固定テンプレートを機械的に当てるのではなく、対象のsystem promptの内容に合わせて攻撃を組み立てる点が、garak・spikeeとの設計上の違いである。

評価結果は3カテゴリに分類される。

- **Broken**: LLMが攻撃に屈し、system promptの制約を破った試行。
- **Resilient**: LLMが攻撃に耐え、制約を維持した試行。
- **Errors**: 攻撃側・判定側の問題などで結論が出なかった試行。

#### 攻撃モジュールの分類

Prompt Fuzzerは16種類の攻撃シミュレーションを備え、大きく次のカテゴリに分かれる。

**jailbreak攻撃（9種類）**
- **AIM**: 非倫理的な指示への誘導を試みるロールプレイ型jailbreak。
- **Amnesia**: モデルに「これまでの指示を忘れた」と思わせ、system promptの制約を無効化させる手法。
- **UCAR**: コンテンツフィルタを無視させるよう仕向けるテスト。
- **DAN（Do Anything Now）**: ロールプレイを経由して禁止されている出力を引き出す古典的な手法。
- **言語的迂回**: 英語以外の言語でリクエストすることで、英語中心に学習・調整された安全フィルタの回避を狙う。
- **Base64エンコーディング迂回**: 有害な指示をBase64などでエンコードし、フィルタの文字列マッチを回避してからモデル側でデコードさせる手法（このカテゴリはgarakの`encoding`Probe、spikeeの`base64`プラグインとも共通する、LLM系ツール全般で頻出の基本手口である）。

**プロンプトインジェクション攻撃（4種類）**
- **権威的役割なりすまし**: 「システム管理者です」「開発者モードです」のように偽の権限を騙り、LLMの出力を誤誘導する。
- **Typoglycemia**: 単語内の文字を一部欠落・入れ替えても人間（およびLLM）が読解できてしまう性質を悪用し、フィルタの文字列一致を回避しつつモデルには正しく解釈させる手法。

**RAG毒性化攻撃**
- **Hidden Parrot Attack**: RAG（Retrieval-Augmented Generation。外部知識ベースを検索してLLMの回答に組み込む方式）で参照されるベクトルデータベースに悪意ある指示を仕込んでおき、検索結果としてLLMに読み込ませることで制約を突破する攻撃。この攻撃は「入力フィルタ」だけを見ていては防げず、RAGの知識ソース自体の完全性（インジェクション対策）も検証範囲に入れる必要があることを示す好例である。

**システムプロンプト抽出**
- system promptの内容そのものをLLMに漏洩させようとする直接的な抽出試行。system promptには機密のビジネスロジックや内部ルールが含まれることが多く、抽出耐性は情報漏洩対策として重要な評価軸になる。

#### インストールと基本コマンド

Python 3.10以上が必要。

```bash
pip install prompt-security-fuzzer

export OPENAI_API_KEY=sk-xxx...

# インタラクティブモード（対話的にプロンプトを改善しながら実行）
prompt-security-fuzzer
```

バッチモードでsystem promptファイルを直接指定して自動診断する：

```bash
prompt-security-fuzzer -b ./system_prompt.examples/medium_system_prompt.txt
```

独自の攻撃データセット（CSV）を追加する：

```bash
prompt-security-fuzzer -b ./system_prompt.examples/medium_system_prompt.txt \
  --custom-benchmark=ps_fuzz/attack_data/custom_benchmark1.csv
```

特定の攻撃カテゴリのみに絞って実行する：

```bash
prompt-security-fuzzer -b ./system_prompt.examples/medium_system_prompt.txt \
  --tests='["ucar","amnesia"]'
```

RAG毒性化テストをOpenAI埋め込みモデルで実行する：

```bash
prompt-security-fuzzer -b ./system_prompt.examples/medium_system_prompt.txt \
  --embedding-provider=open_ai \
  --embedding-model=text-embedding-ada-002 \
  --tests='["rag_poisoning"]'
```

ローカルにホストしたOllama上のモデル（例: Llama 2）をターゲットにする：

```bash
prompt-security-fuzzer -b ./system_prompt.examples/medium_system_prompt.txt \
  --target-provider=ollama \
  --target-model=llama2 \
  --ollama-base-url=http://localhost:11434
```

16のLLMプロバイダ（OpenAI、Anthropic、Google、Azure OpenAIなど）に対応し、それぞれ対応する環境変数（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`AZURE_OPENAI_API_KEY`、`GOOGLE_API_KEY`など）で認証情報を渡す。マルチスレッド処理に対応しており、多数の攻撃シミュレーションを並列で実行できる。

Prompt FuzzerはMITライセンスで公開されており、開発コミュニティは新しい攻撃タイプの提案を積極的に募っている（プロジェクト自体を"community project"として育てる方針を掲げている）。攻撃カタログは今後も拡張が見込まれるため、`--tests`で選択可能な攻撃名は都度ヘルプやリポジトリで確認するのが望ましい。

> 出典: Prompt Fuzzer (prompt-security/ps-fuzz) — https://github.com/prompt-security/ps-fuzz

---

### 3ツールの使い分けと組み合わせ方

3つのツールは対象レイヤーが異なるため、実務では役割を分担させるのが効果的である。

- **garak**: モデル自体（基盤モデルやファインチューン済みモデル）を、jailbreak・データ漏洩・毒性・コード生成安全性など広範な観点で網羅的にスキャンする「一次健診」に向く。新しいモデルの採用可否判断や、モデル更新時のリグレッションテストに適している。
- **spikee**: 「このアプリの入力欄・このガードレール製品はプロンプトインジェクションに耐えられるか」という、インジェクション単一カテゴリを深く掘る精密検査に向く。動的攻撃モジュール（`best_of_n`、`crescendo`など）を使えば、静的なブロックリストだけでは想定しきれない適応的な攻撃者の挙動もシミュレートできる。
- **Prompt Fuzzer**: 自社が書いたsystem promptそのものの強度を、開発サイクルの中で素早く定量評価するのに向く。system promptを変更するたびにBroken/Resilient/Errorsの比率を継続的に追跡すれば、防御改修の効果を数値で確認できる。

いずれも出力（JSONL、CSV、Webダッシュボード）を継続的インテグレーション（CI）に組み込みやすい設計になっており、Webアプリにおける自動化されたセキュリティリグレッションテストと同じ発想で、LLMアプリケーションのリリースパイプラインに組み込むことが望ましい。ただし、これらのツールが検出するのはあくまで「既知の攻撃パターン・既知の難読化手法に対する応答」であり、新規の手口や、アプリケーション固有のビジネスロジックに依存した脆弱性（例えば特定のツール呼び出し権限の悪用）までは自動的にはカバーしきれない。自動スキャンはあくまで一次スクリーニングと位置づけ、重要なアプリケーションでは人手によるレッドチーミングと組み合わせることが推奨される。

なお、本節で紹介したツールはいずれも防御側の検証・監査を目的としたものであり、実在の本番サービスに対して権限のない検証を行うことは、テスト対象が明示的に許可した環境（自前のサンドボックス、CTF環境、正式なバグバウンティ・スコープ内資産等）に限定して実施すべきである。
