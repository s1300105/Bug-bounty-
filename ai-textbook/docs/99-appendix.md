# 付録

本付録は、本書が原典としたロードマップ（`roadmaps/ai.md`）の全参考URL（付録A）、自動取得できなかった資料の一覧（付録B）、用語集（付録C）、参考書籍（付録D）で構成される。

## 付録A：全参考URL一覧（レベル別）

以下は原典ロードマップに掲載された全107件のURLを、ロードマップのレベル（Lv1〜Lv9）どおりに再掲したものである。本文の各節はこれらを一次資料として参照している。

### Lv1：基礎 ― LLMアプリのアーキテクチャとAIセキュリティ全体像

- https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/
- https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf
- https://aembit.io/blog/owasp-top-10-llm-risks-explained/
- https://www.mend.io/blog/2025-owasp-top-10-for-llm-applications-a-quick-guide/
- https://www.trydeepteam.com/docs/frameworks-owasp-top-10-for-llms
- https://www.giskard.ai/knowledge/risk-assessment-for-llms-and-ai-agents-owasp-mitre-atlas-and-nist-ai-rmf-explained
- https://www.speakeasy.com/resources/ai-security-frameworks
- https://www.vectra.ai/topics/mitre-atlas
- https://blog.flatt.tech/entry/llm_application_security
- https://speakerdeck.com/flatt_security/llm-application-security

### Lv2：プロンプトインジェクション（直接／間接）

- https://simonwillison.net/series/prompt-injection/
- https://simonw.substack.com/p/prompt-injection-explained-with-video
- https://redmonk.com/videos/a-redmonk-conversation-simon-willison-on-industrys-tardy-response-to-the-ai-prompt-injection-vulnerability/
- https://blog.athina.ai/not-what-you-ve-signed-up-for-compromising-real-world-llm-integrated-applications-with-indirect-prompt-injection
- https://github.com/greshake/llm-security
- https://arxiv.org/abs/2302.12173
- https://policylayer.com/attacks/indirect-prompt-injection
- https://www.bugcrowd.com/blog/a-guide-to-the-hidden-threat-of-prompt-injection/
- https://www.promptfoo.dev/blog/prompt-injection/
- https://www.blackhillsinfosec.com/getting-started-with-ai-hacking-part-2/
- https://medium.com/@austin-stubbs/llm-security-types-of-prompt-injection-d7ad8d7d75a3
- https://blog.flatt.tech/entry/prompt_injection

### Lv3：LLMを起点とした従来型Web脆弱性（★バグバウンティ受理の本命）

- https://portswigger.net/web-security/learning-paths/llm-attacks
- https://portswigger.net/web-security/llm-attacks
- https://portswigger.net/web-security/llm-attacks/lab-exploiting-vulnerabilities-in-llm-apis
- https://portswigger.net/web-security/llm-attacks/lab-indirect-prompt-injection
- https://portswigger.net/web-security/llm-attacks/lab-exploiting-insecure-output-handling-in-llms
- https://safeai.blog/portswigger-s-insights-understanding-web-llm-attacks
- https://www.youtube.com/watch?v=WGZFlvObRvk
- https://github.com/HackTricks-wiki/hacktricks/pull/2852
- https://hacktricks.wiki/en/AI/AI-Prompts.html
- https://developer.nvidia.com/blog/practical-llm-security-advice-from-the-nvidia-ai-red-team/
- https://www.hackerone.com/blog/how-prompt-injection-vulnerability-led-data-exfiltration
- https://blog.flatt.tech/entry/llm_ext_collab_security

### Lv4：AIエージェント／ツール／MCPの脆弱性（★実運用で急増）

- https://simonwillison.net/2025/Feb/17/chatgpt-operator-prompt-injection/
- https://embracethered.com/blog/
- https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks
- https://owasp.org/www-community/attacks/MCP_Tool_Poisoning
- https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-auto-execution-20260701/
- https://munderdiffl.in/blog/mcp-security-tool-poisoning/
- https://blog.trailofbits.com/categories/machine-learning/
- https://tao-hpu.medium.com/agent-security-boundaries-from-prompt-injection-to-tool-misuse-d25b6dbaad60
- https://blog.flatt.tech/entry/llm_ext_collab_security

### Lv5：RAG・データ・埋め込みの脆弱性

- https://embracethered.com/blog/posts/2024/google-aistudio-mass-data-exfil/
- https://embracethered.com/blog/tags/prompt-injection/
- https://www.trydeepteam.com/docs/frameworks-owasp-top-10-for-llms
- https://blog.flatt.tech/entry/llm_guardrail
- https://arxiv.org/pdf/2406.00199

### Lv6：AIサプライチェーン／モデルファイル／MLOpsの脆弱性（★実CVE多発の現実的領域）

- https://secdim.com/blog/post/llm-to-rce-using-broken-pickles-9359/
- https://afine.com/blogs/pickle-deserialization-in-ml-pipelines-the-rce-that-wont-go-away
- https://www.egnworks.com/blog/pickle-deserialization-rce-how-a-malicious-ai-model-runs-code-the-moment-you-load-it/
- https://huggingface.co/blog/huseyingulsin/ai-for-organizations-2-risk-of-pickle
- https://hivesecurity.gitlab.io/blog/huggingface-ai-supply-chain-attacks-2026/
- https://huntr.com/guidelines
- https://huntr.com/bounties/hacktivity
- https://huntr.com/bounties/1fe8f21a-c438-4cba-9add-e8a5dab94e28
- https://www.securityweek.com/over-a-dozen-exploitable-vulnerabilities-found-in-ai-ml-tools/
- https://www.securityweek.com/critical-vulnerabilities-found-in-ai-ml-open-source-platforms/
- https://www.csoonline.com/article/1293302/frequent-critical-flaws-open-mlflow-users-to-imminent-threats.html
- https://www.scworld.com/news/ai-bug-bounty-program-yields-34-flaws-in-open-source-tools
- https://unit42.paloaltonetworks.com/langchain-vulnerabilities/
- https://advisories.gitlab.com/pkg/pypi/langchain-community/CVE-2025-2828/
- https://advisories.gitlab.com/pkg/pypi/langchain/CVE-2023-34540/
- https://cyata.ai/blog/langgrinch-langchain-core-cve-2025-68664/
- https://trailofbits.com/services/ai-ml/
- https://developer.nvidia.com/blog/analyzing-the-security-of-machine-learning-research-code
- https://blog.flatt.tech/entry/llm_framework_security

### Lv7：実例・ライトアップ・バグバウンティ事例（★受理された脆弱性を学ぶ）

- https://embracethered.com/blog/
- https://embracethered.com/blog/tags/prompt-injection/
- https://embracethered.com/blog/posts/2023/bing-chat-data-exfiltration-poc-and-fix/
- https://embracethered.com/blog/posts/2023/google-bard-data-exfiltration/
- https://embracethered.com/blog/posts/2024/github-copilot-chat-prompt-injection-data-exfiltration/
- https://embracethered.com/blog/posts/2024/m365-copilot-prompt-injection-tool-invocation-and-data-exfil-using-ascii-smuggling/
- https://embracethered.com/blog/posts/2025/chatgpt-chat-history-data-exfiltration/
- https://embracethered.com/blog/posts/2025/github-copilot-remote-code-execution-via-prompt-injection/
- https://www.hackerone.com/blog/how-prompt-injection-vulnerability-led-data-exfiltration
- https://www.hackerone.com/blog/hackerone-and-owasp-top-10-llm-powerful-alliance-secure-ai
- https://learnprompting.org/blog/prompt-injection-exploits-in-chatgpt-operator
- https://www.eccouncil.org/cybersecurity-exchange/ethical-hacking/what-is-prompt-injection-in-ai-real-world-examples-and-prevention-tips/
- https://mlsecops.com/podcast/indirect-prompt-injections-and-threat-modeling-of-llm-applications

### Lv8：ハンズオン／演習環境／ツール（★手を動かす）

- https://gandalf.lakera.ai/
- https://play.lakera.ai/agent-breaker
- https://www.promptairlines.com/
- https://crucible.dreadnode.io
- https://learnprompting.org/hackaprompt-playground
- https://portswigger.net/web-security/llm-attacks
- https://github.com/ReversecLabs/damn-vulnerable-llm-agent
- https://labs.reversec.com/tools/damn-vulnerable-llm-agent
- https://github.com/dhammon/ai-goat
- https://github.com/orcasecurity-research/AIGoat
- https://github.com/harishsg993010/DamnVulnerableLLMProject
- https://github.com/greshake/llm-security
- https://github.com/NVIDIA/garak
- https://github.com/ReversecLabs/spikee
- https://github.com/prompt-security/ps-fuzz
- https://appsecsanta.com/ai-security-tools/llm-red-teaming
- https://ringsafe.in/ai-red-teaming-pyrit-garak/
- https://ransomnews.com/red-team-llm-app-garak-pyrit-promptfoo-tutorial/
- https://wgilescyber.medium.com/ai-pentesting-practicing-prompt-injection-with-the-gandalf-challenge-01f10400d7bb

### Lv9：発展・最先端・方法論

- https://github.com/requie/AI-Red-Teaming-Guide
- https://developer.nvidia.com/blog/nvidia-ai-red-team-an-introduction/
- https://developer.nvidia.com/blog/ai-red-team-machine-learning-security-training
- https://github.com/N372unn32/AI-ML-LLM-security-resources
- https://adversa.ai/blog/llm-security-top-digest-from-red-teaming-ai-tools-to-training-courses-vc-reviews-and-books/
- https://github.com/nukIeer/AI-Prompt-Injection-Cheatsheet
- https://www.packtpub.com/en-us/product/ai-native-llm-security-9781836203742
- https://www.practical-devsecops.com/best-ai-security-books/

## 付録B：自動取得できなかった資料

以下は生成時に一次取得が不完全だった（HTTPエラー・SPA動的描画・ペイウォール・リダイレクト等）資料である。本文では該当箇所に `⚠️ 未取得の資料` として注記し、可能な範囲でGitHub原本・二次資料・検索結果・一般知識で補足している。**必ず原典に直接あたること**を推奨する。

| 節 | URL | 理由（要約） |
| --- | --- | --- |
| 第1章 owasp-llm-top10 | https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf | WebFetchでHTTP 404。GitHub raw ミラー(raw.githubusercontent.com/OWASP/.../LLM01_PromptInjection.md)も404で代替取得不可だったため、本文中に未取得の注記を挿入し、他の入手済み資料と一般知識で補足した。 |
| 第2章 injection-techniques | https://medium.com/@austin-stubbs/llm-security-types-of-prompt-injection-d7ad8d7d75a3 | WebFetchでHTTP 403 Forbidden（Medium側のボット/自動アクセス制限と推定）。WebSearchで得られた記事要旨（Payload Splitting, Virtualization, Obfuscation, Indirect Prompt Injectionの定義）を代替情報として本… |
| 第3章 portswigger-web-llm | https://www.youtube.com/watch?v=WGZFlvObRvk | WebFetchはYouTubeの字幕・文字起こしを取得できず、フッターのナビゲーション情報のみが返された。WebSearchで概要（公開日、扱うテーマ）のみ確認し、本文中に未取得資料として明記した。 |
| 第3章 insecure-output-handling | https://hacktricks.wiki/en/AI/AI-Prompts.html | レンダリング版が課金プロキシ tollbit.hacktricks.wiki への302リダイレクト経由でHTTP 402 Payment Requiredを返し自動取得不可。ただし同一内容のGitHub原本Markdown（raw.githubusercontent.com/HackTricks-wiki/hac… |
| 第3章 exfil-external-comm | https://www.hackerone.com/blog/how-prompt-injection-vulnerability-led-data-exfiltration | WebFetchで要約は取得できたが、レポート本文の詳細情報（Triage詳細・識別子・報奨金額・修正コミット等）までは記事本文の範囲で確認できず、本文中に未取得資料の注記と補足を挿入した |
| 第4章 agent-prompt-injection | https://tao-hpu.medium.com/agent-security-boundaries-from-prompt-injection-to-tool-misuse-d25b6dbaad60 | WebFetchがHTTP 403 Forbiddenで拒否。WebSearchのスニペットから要旨のみ取得し、本文に未取得資料の注記を挿入して補足知識で対応した。 |
| 第6章 huntr | https://huntr.com/guidelines | JavaScriptで描画されるSPAのためWebFetchで実質コンテンツを取得できず(骨格のみ)。WebSearchで代替情報を取得し本文中に明記の上補完。 |
| 第6章 huntr | https://huntr.com/bounties/hacktivity | SPAでHacktivity一覧はクライアントサイドでAPI取得・描画されるためWebFetchでは静的な骨格ページしか得られず。WebSearchで代替情報を取得し本文中に明記の上補完。 |
| 第6章 huntr | https://huntr.com/bounties/1fe8f21a-c438-4cba-9add-e8a5dab94e28 | 同じくSPAのため本文取得不可。WebSearch経由でCSO Online記事等から技術詳細(CVE-2023-1177)を補完。 |
| 第6章 huntr | https://www.scworld.com/news/ai-bug-bounty-program-yields-34-flaws-in-open-source-tools | HTTP 403 Forbiddenで直接取得不可。WebSearchの要約結果で補完。 |
| 第6章 langchain-cves | https://advisories.gitlab.com/pkg/pypi/langchain-community/CVE-2025-2828/ | JavaScriptレンダリング前提で本文が空。GitHub Advisory GHSA-h5gc-rm8j-5gpr と修正コミットe188d4eから同内容を取得・検証し補完、警告ブロック挿入済み |
| 第6章 langchain-cves | https://advisories.gitlab.com/pkg/pypi/langchain/CVE-2023-34540/ | JavaScriptレンダリング前提で本文が空。GitHub Advisory GHSA-x32c-59v5-h7fg と修正コミットa2f191aから同内容を取得・検証し補完、警告ブロック挿入済み |
| 第6章 langchain-cves | https://cyata.ai/blog/langgrinch-langchain-core-cve-2025-68664/ | cyata.aiが checkpoint.com/ai-security へ301リダイレクトし本文取得不可、Waybackも429。GitHub Advisory GHSA-c67j-w6g6-q2cm と The Hacker News の Cyata取材記事から技術内容を取得・再構成し補完、警告ブロック挿入済み |
| 第7章 bugbounty-reports | https://mlsecops.com/podcast/indirect-prompt-injections-and-threat-modeling-of-llm-applications | mlsecops.comドメインが301で無関係な第三者ページ(paloaltonetworks.com/ai-security/prisma-airs)へ恒久リダイレクトしており、原文取得不可。WebSearchとKai Greshake氏の一次研究(ブログ・Black Hat論文)を代替情報源として本文に明記の… |
| 第8章 ctf-games | https://www.lakera.ai/blog/inside-agent-breaker | ページ本文がJS動的描画のためWebFetchで概要文しか抽出できず |
| 第8章 ctf-games | https://crucible.dreadnode.io | app.dreadnode.ioへリダイレクトされ、ログイン画面のみでコンテンツ非公開 |
| 第8章 ctf-games | https://learnprompting.org/hackaprompt-playground | トップページに簡潔な説明のみで詳細情報がページ本文になし |
| 第8章 ctf-games | https://wgilescyber.medium.com/ai-pentesting-practicing-prompt-injection-with-the-gandalf-challenge-01f10400d7bb | HTTP 403 Forbiddenで直接取得不可、WebSearchの抜粋で代替補足 |
| 第8章 redteam-tool-comparison | https://ringsafe.in/ai-red-teaming-pyrit-garak/ | 記事の中〜上級者向け詳細部分がRingSafeアカウント登録必須のペイウォールになっており、6段階プロセスの概要以外の具体的なコード例・アーキテクチャ詳細は取得できなかった |
| 第9章 books | https://www.packtpub.com/en-us/product/ai-native-llm-security-9781836203742 | WebFetchがHTTP 403 Forbiddenを返した。O'Reilly/Amazon/reference-global.com/検索結果を代替情報源として突き合わせ、本文中に未取得の注記と代替リンクを明示した。 |

## 付録C：用語集

AI／LLMセキュリティに固有の用語を中心に、本書で頻出するものを整理する。従来型Web脆弱性の用語（XSS、SSRF、コマンドインジェクション等）は各章の初出箇所を参照。

| 用語 | 説明 |
| --- | --- |
| LLM（Large Language Model） | 大量のテキストで学習した大規模言語モデル。プロンプト（入力トークン列）に続く尤もらしいトークンを生成する。指示とデータを構造的に区別しないことが多くの脆弱性の根本原因。 |
| プロンプトインジェクション | 攻撃者が入力（またはLLMが読み込むデータ）に指示を紛れ込ませ、開発者の意図した動作を上書きする攻撃。OWASP LLM Top 10でLLM01（第1位）。 |
| 直接／間接プロンプトインジェクション | 直接=攻撃者自身がLLMに指示を打ち込む。間接（IPI）=攻撃者が事前に仕込んだ外部データ（レビュー・Web・文書・メール等）を別ユーザーのLLMが読み込んで実行してしまう。 |
| lethal trifecta（致命的な三要素） | Simon Willisonの整理。①機密データへのアクセス、②信頼できない入力への曝露、③外部通信能力、の3つが揃うとデータ窃取が現実化する、というエージェント設計上の危険条件。 |
| Insecure Output Handling（安全でない出力処理） | LLMの生成物を検証せず下流（HTML描画・シェル・SQL・コード実行等）へ渡すことで、XSS・RCE・SSRF等に発展させる脆弱性。OWASP LLM Top 10でLLM02→（2025でLLM05に降格）。 |
| RAG（Retrieval-Augmented Generation） | 外部の知識ベース（ベクトルDB等）から関連文書を検索してプロンプトに注入し、回答生成に用いる構成。取り込んだ文書が間接注入の運び手になりうる。 |
| Embedding／Vector DB | テキストを数値ベクトルへ変換（embedding）し、類似度検索するためのデータベース。テナント分離不備・埋め込み逆転（inversion）等のリスクがある。 |
| System Prompt Leakage | システムプロンプト（開発者の設定した指示・制約）が攻撃者に漏洩する問題。それ自体より、漏洩したプロンプトに含まれる機密・防御ロジックの露出が実害。 |
| tool／function calling | LLMが外部関数・APIを呼び出せる仕組み。呼び出し先の実装不備や過剰な権限が、従来型脆弱性への新たな到達経路になる。 |
| AIエージェント | LLMがツール呼び出し・計画・記憶・自律ループを持ち、複数ステップのタスクを遂行する構成。excessive agency（過剰な権限・自律性）が主要リスク。 |
| MCP（Model Context Protocol） | LLM／エージェントに外部ツール・データソースを接続する標準プロトコル。tool poisoning（ツール説明への悪意注入）・rug pull（後から定義を差し替える）等が新たな攻撃面。 |
| tool poisoning | MCPツールの説明文（description）等に悪意ある指示を埋め込み、それを読むLLMを操作する攻撃。ベンチマークMCPToxで実運用サーバの高い攻撃成功率が報告された。 |
| pickleデシリアライズRCE | Pythonの`pickle`は逆シリアライズ時に任意コードを実行しうる。悪意あるモデルファイル（`.pkl`/`.bin`等）の読み込みでRCEに至る。safetensorsが安全な代替。 |
| safetensors | テンソルのみを格納しコード実行を伴わない安全なモデル保存形式。pickleベース形式の代替として推進されている。 |
| MLOps | 機械学習のライフサイクル（学習・追跡・デプロイ・提供）を運用する基盤（MLflow, Ray, H2O-3, ClearML等）。従来型Web脆弱性（パストラバーサル・デシリアライズ・SSRF等）の実CVEが多発。 |
| huntr | AI/MLのOSSに特化したバグバウンティ・プラットフォーム。CVE付与と報奨があり、既存のWeb/デシリアライズ知識がそのまま通用する。 |
| ASCII Smuggling | Unicodeのタグ文字（Tags block等）を使い、人間には見えない形で命令やデータをテキストに埋め込む手法。窃取データを不可視リンクに紛れ込ませる等に悪用。 |
| AIレッドチーミング | AIシステムに対し敵対的入力・攻撃シナリオを体系的に試し、脆弱性を発見・評価する営み。garak／PyRIT／Promptfoo等のツールがある。 |
| ガードレール | LLMの入出力を検査・制約する防御層（分類器・ルール・別モデル等）。単体では回避されうるため、最小権限・信頼境界・出力エンコード等と組み合わせる多層防御が前提。 |
| OWASP LLM Top 10 | LLMアプリ固有の代表的リスクを整理したOWASPの一覧（2025年版）。プロンプトインジェクション（LLM01）を筆頭に、本書の章立ての骨格になっている。 |
| MITRE ATLAS／NIST AI RMF | ATLAS=AIシステムへの攻撃をATT&CK流の戦術・技術で体系化した知識ベース。NIST AI RMF=AIリスク管理のフレームワーク。報告書の共通言語として有用。 |

## 付録D：参考書籍

原典ロードマップおよび本文で言及した書籍・長編資料。詳細と最新版は各出版社ページで確認すること。

- **The Developer's Playbook for Large Language Model Security** — Steve Wilson（O'Reilly）: OWASP LLM Top 10の主要著者による、開発者視点のLLMセキュリティ実務書。
- **AI-Native LLM Security**（Packt）: LLMネイティブなアプリのセキュリティ設計を扱う（付録Bに未取得注記あり。原典URLは付録A参照）。
- **OWASP Top 10 for LLM Applications 2025**（OWASP GenAI Security Project, 公式PDF）: 本書の章立ての土台。公式ランディングページから入手可能（PDF直リンクは付録Bのとおり取得不安定なため公式サイト経由を推奨）。

---

## ナビゲーション

[← 第9章 発展・最先端・方法論](09-advanced-methodology.md)  ｜  [📚 目次（ホーム）](index.md)
