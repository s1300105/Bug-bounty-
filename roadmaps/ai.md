# AI／LLMセキュリティ脆弱性を「極める」ための段階的学習ロードマップ

## TL;DR

- バグバウンティで実際に受理される本命は「LLMを引き金にした従来型Web脆弱性（Insecure Output Handling由来のXSS／Markdown画像経由のデータ窃取、LLM出力経由のSSRF/RCE/SQLi）」「間接プロンプトインジェクション（IPI）によるデータ窃取・エージェント乗っ取り」「AIエージェント／MCPの過剰権限・tool poisoning」「モデルファイルのpickleデシリアライズRCEとMLOpsツールの実CVE」の4本柱。これらを軸にLv1→Lv9で学べば、理論に偏らず実運用のAIプロダクトに刺さる脆弱性を発見・報告できるレベルに到達できる。
- 最短の実戦ルートは「PortSwigger Web LLM attacksラボ（無料・実ラボ）→ Gandalf／Prompt Airlines／Crucibleでプロンプト注入の手を動かす → Embrace The Red（Johann Rehberger）の実例を全部読む → huntr.comでAI/ML OSSの実バグを狩る」。
- 対象プラットフォームはHackerOne／Bugcrowd（LLM統合Webアプリ）とhuntr.com（AI/MLサプライチェーン特化、CVE付与・報奨あり）。IPI×insecure output handling×RAGの組み合わせは重複が少なく高額報奨が狙える空白地帯。

## Key Findings

- プロンプトインジェクションは、OWASP GenAI Security Project（600名超・18カ国以上の専門家、アクティブメンバー約8,000名）のTop 10で、初版2023年版から2025年版まで一貫して1位（LLM01）を維持している（Aembit解説：「Prompt injection holds the top spot for the second consecutive edition」）。なお「Improper Output Handling」は2位から5位に降格した。ただしバグバウンティで「受理される」には、単なるjailbreakではなく、データ窃取・権限昇格・RCEなど具体的な実害への接続が必須。
- 最も再現性が高い攻撃パターンは「IPI → LLM出力にimg／markdown混入 → ブラウザが攻撃者サーバへ自動リクエスト → 会話履歴・PII・RAG機密の窃取」。Bing Chat、Google Bard、GitHub Copilot Chat、M365 Copilot、ChatGPTなど大手で実際に修正された事例が多数ある。
- プロンプトインジェクションを起点とした実運用CVEも増加している。Vectra AIの集計では、Microsoft Copilot（CVSS 9.3）、GitHub Copilot（CVSS 9.6）、Cursor IDE（CVSS 9.8）が2025〜2026年に本番環境で悪用実証されており、攻撃成功率はシステム構成・試行回数により50〜84%とされる（出典：Vectra AI「Prompt injection: types, real-world CVEs, and enterprise defenses」）。
- MLOps／AI開発ツール（MLflow, H2O-3, Ray, LangChain, vLLM等）には実CVE（CVSS 10.0級のRCE含む）が多発しており、huntr経由でCVE付与＋報奨が支払われている。ここは「従来型のWeb／デシリアライズ脆弱性の知識がそのまま通用する」ため、既存スキル保持者に最適。
- モデルファイルのpickleデシリアライズRCEは現実の脅威。CVE-2025-32444（vLLMのMooncake統合、影響バージョン0.6.5〜0.8.4、v0.8.5で修正、2025年4月29日公開）はCVSS 3.1で満点10.0（CWE-502、ベクトルAV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H）。ZeroMQソケットを0.0.0.0でバインドし無認証でpickleデシリアライズRCEに至る（Wiz脆弱性DB：「received a CVSS v3.1 score of 10.0」）。safetensorsが安全な代替として推進されている。
- MCP（Model Context Protocol）のtool poisoningは2025年以降急増中の現実的攻撃面。学術ベンチマークMCPTox（arXiv:2508.14925、中国科学技術大学・北京航空航天大学、AAAI 2026採録）は45の実運用MCPサーバ・353の実ツール・20のLLMで評価し、平均攻撃成功率（ASR）36.5%、最高はOpenAI o1-miniの72.8%を報告している（論文：「widespread vulnerability to Tool Poisoning, with o1-mini, achieving an attack success rate of 72.8%」。最も拒否率が高いClaude-3.7-Sonnetでも拒否は3%未満）。

## Details

### Lv1：基礎 ― LLMアプリのアーキテクチャとAIセキュリティ全体像

**なぜ必要か**：攻撃面（プロンプト、システムプロンプト、RAG、tool／function calling、エージェント、MCP）を構造的に把握しないと、どこに脆弱性が入るか当たりをつけられない。脅威分類の共通言語（OWASP／ATLAS／NIST）を持つと報告書の説得力が上がる。
**習得できること**：LLM統合アプリのデータフロー、信頼境界、脅威分類の全体像。

- OWASP Top 10 for LLM Applications 2025（公式ランディング）: https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/
- OWASP Top 10 for LLMs 2025 PDF（公式）: https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf
- OWASP LLM Top 10 解説（Aembit, 2次資料・変更点の要点整理）: https://aembit.io/blog/owasp-top-10-llm-risks-explained/
- OWASP LLM Top 10 解説（Mend, quick guide）: https://www.mend.io/blog/2025-owasp-top-10-for-llm-applications-a-quick-guide/
- OWASP LLM Top 10 各項目のテスト観点（DeepTeam）: https://www.trydeepteam.com/docs/frameworks-owasp-top-10-for-llms
- OWASP／MITRE ATLAS／NIST AI RMF比較解説（Giskard, 2次資料）: https://www.giskard.ai/knowledge/risk-assessment-for-llms-and-ai-agents-owasp-mitre-atlas-and-nist-ai-rmf-explained
- 3フレームワーク比較（Speakeasy, どこまでカバーしどこで止まるか）: https://www.speakeasy.com/resources/ai-security-frameworks
- MITRE ATLAS概説（Vectra AI, タクティクス／テクニクスの最新数）: https://www.vectra.ai/topics/mitre-atlas
- 日本語：LLM／生成AIアプリのセキュリティリスクと対策（GMO Flatt Security）: https://blog.flatt.tech/entry/llm_application_security
- 日本語：LLMアプリセキュリティ登壇資料（Flatt Security, Speaker Deck）: https://speakerdeck.com/flatt_security/llm-application-security

### Lv2：プロンプトインジェクション（直接／間接）

**なぜ必要か**：全AI脆弱性の起点。特にIPI（外部データ経由）はユーザーの修論テーマであり、バグバウンティで実害に繋げやすい本命ベクトル。
**習得できること**：直接／間接注入の違い、なぜ根本解決が困難か、実害への接続方法。

- Simon Willison「prompt injection」シリーズ（概念整理の原典的2次資料）: https://simonwillison.net/series/prompt-injection/
- Simon Willison「Prompt injection explained（動画・スライド・書き起こし）」: https://simonw.substack.com/p/prompt-injection-explained-with-video
- Simon Willison「the lethal trifecta」概念（RedMonk対談ページ）: https://redmonk.com/videos/a-redmonk-conversation-simon-willison-on-industrys-tardy-response-to-the-ai-prompt-injection-vulnerability/
- Kai Greshake et al.「Not what you've signed up for」IPIの2次解説（Athina AI）: https://blog.athina.ai/not-what-you-ve-signed-up-for-compromising-real-world-llm-integrated-applications-with-indirect-prompt-injection
- 同論文のPoCデモ集（GitHub, greshake/llm-security）: https://github.com/greshake/llm-security
- 同論文アブストラクト（1次・要点確認用）: https://arxiv.org/abs/2302.12173
- IPI攻撃クラス総まとめ（PolicyLayer, 2次資料）: https://policylayer.com/attacks/indirect-prompt-injection
- Bugcrowd「prompt injectionの隠れた脅威」（バグバウンティ視点で何が受理されるか）: https://www.bugcrowd.com/blog/a-guide-to-the-hidden-threat-of-prompt-injection/
- Promptfoo「Prompt Injection 総合ガイド」（実例豊富な2次資料）: https://www.promptfoo.dev/blog/prompt-injection/
- Black Hills「Getting Started with AI Hacking Part 2: Prompt Injection」: https://www.blackhillsinfosec.com/getting-started-with-ai-hacking-part-2/
- LLM Hacking: prompt injection techniques（payload splitting等の技法）: https://medium.com/@austin-stubbs/llm-security-types-of-prompt-injection-d7ad8d7d75a3
- 日本語：プロンプトインジェクション対策（実CVEも紹介, Flatt Security）: https://blog.flatt.tech/entry/prompt_injection

### Lv3：LLMを起点とした従来型Web脆弱性（★バグバウンティ受理の本命）

**なぜ必要か**：HackerOne／Bugcrowdで最も受理されやすい。XSS/SSRF/RCE/SQLiという既存スキルがそのまま活き、LLMが「新しい注入口」になるだけ。ユーザーの既存経験（XSS／クライアントサイド）と直結。
**習得できること**：Insecure Output Handling由来のXSS、Markdown画像URLでのexfiltration、LLM出力経由のSSRF/RCE/SQLi、API攻撃面のマッピング。

- PortSwigger「Web LLM attacks」ラーニングパス（無料・実ラボ付き）: https://portswigger.net/web-security/learning-paths/llm-attacks
- PortSwigger「Web LLM attacks」トピック解説（insecure output handling→XSS等）: https://portswigger.net/web-security/llm-attacks
- ラボ：Exploiting LLM APIs: https://portswigger.net/web-security/llm-attacks/lab-exploiting-vulnerabilities-in-llm-apis
- ラボ：Indirect prompt injection: https://portswigger.net/web-security/llm-attacks/lab-indirect-prompt-injection
- ラボ：Insecure output handling: https://portswigger.net/web-security/llm-attacks/lab-exploiting-insecure-output-handling-in-llms
- PortSwigger Web LLM attacks 解説記事（2次資料・攻略の流れ）: https://safeai.blog/portswigger-s-insights-understanding-web-llm-attacks
- 動画：Web LLM Attacks 攻略（Tyler Ramsbey, YouTube）: https://www.youtube.com/watch?v=WGZFlvObRvk
- HackTricks「From Prompt to Pwned」LLM出力→XSS→IDOR→管理者奪取のチェーン: https://github.com/HackTricks-wiki/hacktricks/pull/2852
- HackTricks「AI Prompts」ページ（コード注入・出力処理の観点）: https://hacktricks.wiki/en/AI/AI-Prompts.html
- NVIDIA AI Red Team「Practical LLM Security Advice」（exec/evalへのLLM出力投入の危険等）: https://developer.nvidia.com/blog/practical-llm-security-advice-from-the-nvidia-ai-red-team/
- HackerOne「How a Prompt Injection Vulnerability Led to Data Exfiltration」（実受理事例）: https://www.hackerone.com/blog/how-prompt-injection-vulnerability-led-data-exfiltration
- 日本語：LLMの外部通信・連携におけるセキュリティ観点（SSRF等, Flatt Security）: https://blog.flatt.tech/entry/llm_ext_collab_security

### Lv4：AIエージェント／ツール／MCPの脆弱性（★実運用で急増）

**なぜ必要か**：エージェントは「prompt injection × 自律性 × 実行権限（lethal trifecta）」が揃い、実害が最大化する。MCPの普及で攻撃面が急拡大しており、現実的かつ空白の多い領域。MCPToxは平均ASR36.5%、最高72.8%（OpenAI o1-mini）を報告している。
**習得できること**：excessive agency、confused deputy、tool poisoning、rug pull、意図しないアクション（メール送信・ファイル操作・購買）の悪用。

- Simon Willison「ChatGPT Operator: Prompt Injection Exploits & Defenses」: https://simonwillison.net/2025/Feb/17/chatgpt-operator-prompt-injection/
- Embrace The Red「ChatGPT Operator」等エージェント攻撃（ブログ全体のインデックス）: https://embracethered.com/blog/
- Invariant Labs「MCP Tool Poisoning Attacks」（tool poisoning発見の原典的2次資料）: https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks
- OWASP「MCP Tool Poisoning」コミュニティ解説: https://owasp.org/www-community/attacks/MCP_Tool_Poisoning
- CSA「MCP Attack Surface: Tool Poisoning and IDE Auto-Execution」（実IDE事例・成功率データ）: https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-auto-execution-20260701/
- MCP tool poisoning／rug pull／command injectionと多層防御（Munder Difflin）: https://munderdiffl.in/blog/mcp-security-tool-poisoning/
- Trail of Bits「machine-learning」カテゴリ（mcp-context-protector, MAS hijacking等）: https://blog.trailofbits.com/categories/machine-learning/
- エージェント境界：prompt injectionからtool misuseまで（Medium, 2次総説）: https://tao-hpu.medium.com/agent-security-boundaries-from-prompt-injection-to-tool-misuse-d25b6dbaad60
- 日本語：MCPやAIエージェントに必須の外部連携セキュリティ観点（Flatt Security）: https://blog.flatt.tech/entry/llm_ext_collab_security

### Lv5：RAG・データ・埋め込みの脆弱性

**なぜ必要か**：RAGはIPIの主要な注入ベクトルであり、マルチテナントでの機密漏洩・システムプロンプト抽出が実害に直結。OWASP 2025で「System Prompt Leakage」「Vector and Embedding Weaknesses」が新設された。
**習得できること**：RAG経由の機密漏洩、embedding／vector DBの弱点、system prompt extraction、prompt leaking。

- Embrace The Red「Google AI Studio: Mass Data Exfiltration」（RAG／文書経由の大量窃取実例）: https://embracethered.com/blog/posts/2024/google-aistudio-mass-data-exfil/
- Embrace The Red「Prompt Injection」タグ（Google NotebookLM等RAG事例も辿れる）: https://embracethered.com/blog/tags/prompt-injection/
- OWASP LLM Top 10 2025でのVector/Embedding・System Prompt Leakage解説（DeepTeam）: https://www.trydeepteam.com/docs/frameworks-owasp-top-10-for-llms
- 日本語：LLMガードレールの活用法（RAG外部DB経由のIPI検知例, Flatt Security）: https://blog.flatt.tech/entry/llm_guardrail
- 学術寄りだが要点確認用：ChatGPTからのPII窃取（arXiv PDF, 事例整理あり）: https://arxiv.org/pdf/2406.00199

### Lv6：AIサプライチェーン／モデルファイル／MLOpsの脆弱性（★実CVE多発の現実的領域）

**なぜ必要か**：既存のWeb／デシリアライズ知識が最も直接的に通用し、huntr経由でCVE付与＋報奨が得られる。CVSS 10.0級のRCEが実在する。SecurityWeek「Over a Dozen Exploitable Vulnerabilities Found in AI/ML Tools」（2023年11月17日）によれば、H2O-3のCVE-2023-6016（無認証で悪意あるJavaオブジェクトを実行しRCE、CVSS 10）に加え、MLflowのCVE-2023-6018／6015（CVSS 10）、RayのCVE-2023-6019（cpu_profileコード注入、CVSS 10）が報告され、「could allow attackers to completely take over the server and steal models, credentials, and other data」とされる。
**習得できること**：pickle／PyTorch／joblibのデシリアライズRCE、safetensors導入の背景、MLflow/H2O-3/Ray/LangChain等の実CVE、モデルハブのリスク。

- 「LLM to RCE using broken pickles」（picklescanバイパスの技術解説）: https://secdim.com/blog/post/llm-to-rce-using-broken-pickles-9359/
- AFINE「Pickle Deserialization in ML Pipelines: RCE That Won't Go Away」（vLLM CVE-2025-32444等）: https://afine.com/blogs/pickle-deserialization-in-ml-pipelines-the-rce-that-wont-go-away
- Egnworks「Pickle Deserialization RCE in AI Model Loading」（実CVE・PoC・safetensors対策）: https://www.egnworks.com/blog/pickle-deserialization-rce-how-a-malicious-ai-model-runs-code-the-moment-you-load-it/
- Hugging Face公式ブログ「Risk of Pickle」（safetensors文脈の2次解説）: https://huggingface.co/blog/huseyingulsin/ai-for-organizations-2-risk-of-pickle
- Hive Security「Poisoned AI: Hugging Faceのサプライチェーン攻撃」（nullifAI事例）: https://hivesecurity.gitlab.io/blog/huggingface-ai-supply-chain-attacks-2026/
- huntr（AI/ML特化バグバウンティ、参加ガイドライン）: https://huntr.com/guidelines
- huntr Hacktivity（実際の受理事例一覧）: https://huntr.com/bounties/hacktivity
- huntr 実例：MLflow SSHキー窃取からRCE（PoC付き）: https://huntr.com/bounties/1fe8f21a-c438-4cba-9add-e8a5dab94e28
- SecurityWeek「AI/MLツールに十数件の脆弱性（H2O-3/MLflow/Ray, いずれもCVSS 10）」: https://www.securityweek.com/over-a-dozen-exploitable-vulnerabilities-found-in-ai-ml-tools/
- SecurityWeek「MLflow/ClearML/Hugging Faceの重大脆弱性」: https://www.securityweek.com/critical-vulnerabilities-found-in-ai-ml-open-source-platforms/
- CSO Online「MLflowの頻発する重大欠陥」: https://www.csoonline.com/article/1293302/frequent-critical-flaws-open-mlflow-users-to-imminent-threats.html
- SC Media「huntrで34件公開（2024年10月）」— 最重要はLunary AIのCVE-2024-7474（IDOR, CVSS 9.1）とCVE-2024-7475（SAML設定改ざんによる不正ログイン, CVSS 9.1）、およびChuanhu Chatの重大脆弱性。18件がhigh severity（DoS〜RCE）: https://www.scworld.com/news/ai-bug-bounty-program-yields-34-flaws-in-open-source-tools
- Unit42「LangChain Gen AIの脆弱性（SSRF CVE-2023-46229等）」: https://unit42.paloaltonetworks.com/langchain-vulnerabilities/
- LangChain Community SSRF（CVE-2025-2828, GitLab Advisory）: https://advisories.gitlab.com/pkg/pypi/langchain-community/CVE-2025-2828/
- LangChain OS Command Injection（CVE-2023-34540, GitLab Advisory）: https://advisories.gitlab.com/pkg/pypi/langchain/CVE-2023-34540/
- Cyata「LangChain Core デシリアライズRCE（CVE-2025-68664, 発見者解説）」: https://cyata.ai/blog/langgrinch-langchain-core-cve-2025-68664/
- Trail of Bits「AI/ML Security」サービス＆研究インデックス: https://trailofbits.com/services/ai-ml/
- NVIDIA「Analyzing the Security of ML Research Code」（lintML等）: https://developer.nvidia.com/blog/analyzing-the-security-of-machine-learning-research-code
- 日本語：LLMフレームワークのセキュリティリスク（LangChain等の実CVEに学ぶ, Flatt Security）: https://blog.flatt.tech/entry/llm_framework_security

### Lv7：実例・ライトアップ・バグバウンティ事例（★受理された脆弱性を学ぶ）

**なぜ必要か**：実際に修正された／報奨が出た事例を大量に読むことが、再現可能な攻撃レパートリーを増やす最短路。
**習得できること**：大手プロダクト（Copilot/Bard/Gemini/ChatGPT）での実際の攻撃チェーンと報告プロセス。

- Embrace The Red ブログ全体インデックス（Rehbergerの実例の宝庫）: https://embracethered.com/blog/
- Embrace The Red「Prompt Injection」タグ（時系列で全事例）: https://embracethered.com/blog/tags/prompt-injection/
- Bing Chat データ窃取PoC: https://embracethered.com/blog/posts/2023/bing-chat-data-exfiltration-poc-and-fix/
- Google Bard→データ窃取（IPI実例）: https://embracethered.com/blog/posts/2023/google-bard-data-exfiltration/
- GitHub Copilot Chat→データ窃取: https://embracethered.com/blog/posts/2024/github-copilot-chat-prompt-injection-data-exfiltration/
- M365 Copilot→PII窃取（ASCII Smuggling＋自動tool呼び出し）: https://embracethered.com/blog/posts/2024/m365-copilot-prompt-injection-tool-invocation-and-data-exfil-using-ascii-smuggling/
- ChatGPT会話履歴・メモリ窃取（url_safeバイパス, 2025）: https://embracethered.com/blog/posts/2025/chatgpt-chat-history-data-exfiltration/
- GitHub Copilot RCE via prompt injection（CVE-2025-53773, Rehberger）— 注入により`.vscode/settings.json`に`"chat.tools.autoApprove": true`（YOLOモード）を書き込ませ、確認なしで任意シェルコマンド実行に至る。CVSS 7.8、2025年8月Patch Tuesdayで修正: https://embracethered.com/blog/posts/2025/github-copilot-remote-code-execution-via-prompt-injection/
- HackerOne「How a Prompt Injection Led to Data Exfiltration」（Bard事例, 報告フロー）: https://www.hackerone.com/blog/how-prompt-injection-vulnerability-led-data-exfiltration
- HackerOne × OWASP LLM Top 10（受理されやすい分類との対応）: https://www.hackerone.com/blog/hackerone-and-owasp-top-10-llm-powerful-alliance-secure-ai
- ChatGPT Operator実例解説（Learn Prompting, 2次）: https://learnprompting.org/blog/prompt-injection-exploits-in-chatgpt-operator
- EC-Council「実世界のprompt injection事例集」（Jules RCE, ZombAI等Rehberger事例を網羅）: https://www.eccouncil.org/cybersecurity-exchange/ethical-hacking/what-is-prompt-injection-in-ai-real-world-examples-and-prevention-tips/
- MLSecOps Podcast「Indirect Prompt Injections & Threat Modeling」（Greshake×Rehberger対談）: https://mlsecops.com/podcast/indirect-prompt-injections-and-threat-modeling-of-llm-applications

### Lv8：ハンズオン／演習環境／ツール（★手を動かす）

**なぜ必要か**：読むだけでは発見力は上がらない。意図的脆弱環境とCTFで実際にペイロードを組み、スキャナで自動化する。
**習得できること**：プロンプト注入の実技、脆弱LLMアプリの攻略、garak/PyRIT等での自動探索。

CTF・ゲーム系（ブラウザで即開始）:

- Lakera Gandalf（プロンプト注入入門の定番）: https://gandalf.lakera.ai/
- Gandalf Agent Breaker（エージェント/MCP/RAG memory等の発展版）: https://play.lakera.ai/agent-breaker
- Wiz「Prompt Airlines」AI CTF: https://www.promptairlines.com/
- Dreadnode「Crucible」AIレッドチーミングCTF: https://crucible.dreadnode.io
- HackAPrompt Playground（Learn Prompting）: https://learnprompting.org/hackaprompt-playground
- PortSwigger Web LLM attacks ラボ（再掲・必修）: https://portswigger.net/web-security/llm-attacks

意図的脆弱アプリ／環境（GitHub）:

- Damn Vulnerable LLM Agent（ReversecLabs, LangChain ReActエージェント）: https://github.com/ReversecLabs/damn-vulnerable-llm-agent
- Damn Vulnerable LLM Agent 解説（Reversec Labs）: https://labs.reversec.com/tools/damn-vulnerable-llm-agent
- AI Goat（dhammon, ローカルで動くLLM CTF, OWASP LLM Top10）: https://github.com/dhammon/ai-goat
- AIGoat（Orca Security, Terraform/AWSの脆弱AI基盤, OWASP ML Top10）: https://github.com/orcasecurity-research/AIGoat
- DamnVulnerableLLMProject（harishsg993010）: https://github.com/harishsg993010/DamnVulnerableLLMProject
- greshake/llm-security（IPIのPoCデモ集）: https://github.com/greshake/llm-security

ツール（AIレッドチーミング／スキャナ）:

- garak（NVIDIA, LLM脆弱性スキャナ）: https://github.com/NVIDIA/garak
- spikee（ReversecLabs, プロンプト注入評価キット）: https://github.com/ReversecLabs/spikee
- Prompt Fuzzer（Prompt Security, system prompt脆弱性スキャナ）: https://github.com/prompt-security/ps-fuzz
- garak/PyRIT/Promptfoo比較・実運用（2次資料）: https://appsecsanta.com/ai-security-tools/llm-red-teaming
- garak/PyRIT/llm-guard方法論（RingSafe）: https://ringsafe.in/ai-red-teaming-pyrit-garak/
- garak/PyRIT/Promptfooハンズオンチュートリアル: https://ransomnews.com/red-team-llm-app-garak-pyrit-promptfoo-tutorial/
- 日本語：Gandalf攻略で学ぶプロンプト注入（Medium, Will Giles）: https://wgilescyber.medium.com/ai-pentesting-practicing-prompt-injection-with-the-gandalf-challenge-01f10400d7bb

### Lv9：発展・最先端・方法論

**なぜ必要か**：AIレッドチーミングの体系化、マルチモーダル注入、防御の最前線を知ることで、防御回避という攻撃視点を磨き、新規性のある発見に繋げる。
**習得できること**：AI pentest方法論、画像／音声／動画経由の注入、ガードレール／spotlighting／dual-LLM等の防御とその回避。

- OWASP GenAI Red Teaming Guide（AIレッドチーミングの実践方法論, まとめ＋リンク集）: https://github.com/requie/AI-Red-Teaming-Guide
- NVIDIA AI Red Team 概説（GRCベースの評価フレーム）: https://developer.nvidia.com/blog/nvidia-ai-red-team-an-introduction/
- NVIDIA AI Red Team ML security トレーニング（学習継続の導線）: https://developer.nvidia.com/blog/ai-red-team-machine-learning-security-training
- AI/ML/LLM security リソース集（GitHub, 動画・OWASP・MITRE等を集約）: https://github.com/N372unn32/AI-ML-LLM-security-resources
- Adversa AI「LLM Security Top Digest」（ツール・書籍・コースの最新動向）: https://adversa.ai/blog/llm-security-top-digest-from-red-teaming-ai-tools-to-training-courses-vc-reviews-and-books/
- マルチモーダル注入チートシート（画像／音声／動画経由, GitHub）: https://github.com/nukIeer/AI-Prompt-Injection-Cheatsheet
- 書籍「AI-Native LLM Security」（OWASP LLM Top 10共著者ら, Packt）: https://www.packtpub.com/en-us/product/ai-native-llm-security-9781836203742
- AIセキュリティ書籍まとめ（Practical DevSecOps, 2次）: https://www.practical-devsecops.com/best-ai-security-books/

## Recommendations

1. **まず手を動かす（1〜2週間）**：PortSwigger Web LLM attacksの全ラボを完走し、並行してGandalf→Prompt Airlines→Crucibleを進める。ここでinsecure output handling→XSS、IPI→データ窃取の「型」を体得する。ベンチマーク：PortSwigger 3ラボ＋Gandalf全レベルクリア。
2. **実例を大量にインプット（2〜4週間）**：Embrace The Redのブログを時系列で全読し、各事例を「注入口／出力シンク／exfil手段／影響」の4項目でノート化。修論のIPI静的検出のケースDBにも流用できる。ベンチマーク：20事例以上を構造化。
3. **既存スキルを転用して実バグを狩る（並行〜継続）**：huntr.comでAI/ML OSS（MLflow, LangChain, Lunary等）を対象に、SSRF／デシリアライズ／IDOR／path traversalを探す。既にOAuth/IDOR/XSSを実践中のユーザーには即効性が高い。ベンチマーク：huntrで1件validトリアージ。
4. **LLM統合Webアプリでの本命を狙う（継続）**：HackerOne／Bugcrowdのin-scopeなAI機能付きプロダクトで「IPI×insecure output handling×RAG」を体系的にテスト。重複が少なく高額報奨の空白地帯。
5. **自動化と方法論で差別化（継続）**：garak/PyRIT/spikeeを自分のワークフローに組み込み、OWASP GenAI Red Teaming Guideで体系化。修論の静的検出とレッドチーミング（動的検証）を相互補完させる。

**判断を変える閾値**：（a）huntrで1件でも受理されたら、MFV（モデルファイル脆弱性）プログラムやデシリアライズRCEにも横展開する。（b）IPI×output handlingで重複（duplicate）が増えてきたら、MCP／エージェント（Lv4）やマルチモーダル注入（Lv9）へ軸足を移す。（c）対象プログラムがAI脆弱性をout-of-scope明記している場合は、モデルハブ／OSS（huntr）側に集中する。

## Caveats

- **スコープと受理可否は要確認**：多くの主要ベンダーは「単なるjailbreak／モデルが不適切発言をする」だけの報告をout-of-scope扱いにする。受理には必ずデータ窃取・権限昇格・RCE等の具体的セキュリティ影響を示すこと。OpenAI等は「prompt injectionは本質的に完全解決困難」との立場を示しており、影響実証がより重要。
- **一部ベンダーは"insecure by design"として修正しない**：報告しても修正されない事例がある（EC-Council記事参照）。報奨を確実にするならhuntrのようにCVE付与・報奨フローが明確な場を優先。
- **2次資料の質にばらつき**：本ロードマップには小規模ブログ／AIまとめ系サイト（munderdiffl.in, egnworks, hivesecurity, ransomnews, appsecsanta等）を含む。要点は掴めるが、CVE番号・CVSS・日付は必ずNVDや一次アドバイザリ（GitLab Advisory, ベンダー公式, Wiz脆弱性DB等）で裏取りすること。特にCVE-2025-32444（vLLM, CVSS10.0, 2025年4月29日公開）、CVE-2025-68664（LangChain Core）、CVE-2025-53773（GitHub Copilot RCE, CVSS 7.8）は複数ソースで確認済みだが、報告時は一次情報を引くこと。
- **将来予測・研究段階の数値に注意**：MCPToxの成功率（平均36.5%／最高72.8%）やVectra AI集計の攻撃成功率（50〜84%）は研究・集計段階の数値で、環境依存。断定せず参考値として扱うこと。OWASP Top 10は2026年版も公開されているため（genai.owasp.org）、最新版を随時参照すること。
- **URLの実在性について**：本ロードマップのURLは調査時点で実在を確認したもの中心だが、ブログ記事は移動・削除されることがある。アクセス不能なものはドメイン内検索やWeb Archiveで再取得すること。特にReversecLabs系（旧WithSecureLabs）はorg名変更のため両パスが混在する。
- **学術1次資料は補助に留めた**：ユーザーの希望通り2次資料中心に構成。arXiv等の原論文リンクは要点確認用として最小限のみ掲載。