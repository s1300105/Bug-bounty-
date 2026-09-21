# 安全でないデシリアライゼーション & SSTI → RCE を極める教科書

信頼できない入力が「データ」から「コード実行」へと化ける2つの脆弱性クラス —— **安全でないデシリアライゼーション**と**サーバサイドテンプレートインジェクション（SSTI）** —— を、原典に忠実に日本語で体系化した教科書です。バグバウンティで Critical / RCE として受理される武器化の核、すなわち**ガジェットチェーン構築**と**サンドボックス脱出**を、言語・エンジンごとに読み解きます。

!!! warning "利用上の前提（必読）"
    本書は**防御・検知・安全な設計の理解を目的**とした教材です。実在するサービスや本番環境への**無許可の検証・攻撃は法律で禁じられています**。手を動かす学習は、必ず自分で用意した検証環境か、PortSwigger Web Security Academy などの**許可されたラボ**に限定してください。ysoserial / phpggc / ysoserial.net / SSTImap 等のツールは、各リポジトリの disclaimer が示すとおり「許可された対象のみ」で使用してください。本書はラボの解答手順そのものは記載しません。

## この本の読み方

各段階には実在する原典URL（PortSwigger、OWASP、Black Hat / DEF CON 白書、著名研究者ブログ、HackerOne 実報告、arXiv 論文など）を対応させ、**原典を直接取得して**要点を日本語で再構成しています。原典リンクは各章本文と[付録A](99-appendix.md)に集約しました。

推奨する学習順序は、ロードマップの設計どおり **Part A（デシリアライゼーション）→ Part B（SSTI）→ Part C（統合・防御）** です。

## 目次

### Part A：安全でないデシリアライゼーション

1. [第1章 デシリアライゼーションの基礎とRCE到達の枠組み](01-deserialization-basics.md) —— シリアライズ／マジックメソッド／POPチェーン／OWASPでの位置づけ
2. [第2章 PHPオブジェクトインジェクションとPHARデシリアライゼーション](02-php-object-injection.md) —— 人間可読なserialize文字列でPOPチェーンの直感を得る
3. [第3章 Javaデシリアライゼーションとガジェットチェーン](03-java-deserialization.md) ★中核 —— CommonsCollections1／JNDI・Log4Shell／marshalsec／検出ツール
4. [第4章 .NETデシリアライゼーションとViewState](04-dotnet-deserialization.md) —— ysoserial.net／MachineKey／Friday the 13th JSON Attacks
5. [第5章 Python/Ruby/Node.jsのデシリアライゼーション](05-python-ruby-node.md) —— pickle `__reduce__`／AIモデル／Rubyユニバーサルガジェット
6. [第6章 ガジェットチェーン発見の自動化と方法論](06-gadget-discovery.md) —— GadgetInspector／ODDFuzz／自動化の限界

### Part B：サーバサイドテンプレートインジェクション（SSTI）

7. [第7章 SSTIの基礎と検出・エンジン特定](07-ssti-basics.md) —— James Kettleの起点研究／`{{7*7}}`／decision tree
8. [第8章 エンジン別SSTIエクスプロイトとサンドボックス脱出](08-ssti-engines.md) ★核心 —— Jinja2フィルタ回避／Twig・Smarty／FreeMarker・SpEL
9. [第9章 SSTIツールと実バグバウンティ報告](09-ssti-tools-reports.md) —— SSTImap／tplmap／実報告の型

### Part C：統合・発展

10. [第10章 実例・ライトアップ・CVEによる統合](10-real-world-cases.md) —— Orange Tsaiの多重チェーン／CVE実装
11. [第11章 防御の理解と回避技術の最前線](11-defense-and-evasion.md) —— allowlist／look-ahead／safetensors／CodeQL

### 補遺

- [序章：この分野をどう学ぶか](00-introduction.md)
- [付録（全URL一覧・未取得資料・用語集・参考書籍）](99-appendix.md)

## この本の限界

- 原典の一部（403/402/JS描画ページ等）は直接取得できず、同一研究の別資料・WebSearch・一般知識で補完しています。該当箇所は本文の注記と[付録B](99-appendix.md)に明示しました。
- **バージョン依存性が極めて強い**分野です。Javaのガジェットチェーンはclasspath上のライブラリ版に、RubyのユニバーサルガジェットはRuby/RubyGems版に強く依存します。「古い記事のペイロードがそのまま通らない」のは正常です。
- 本書は概念・原理・防御の理解に主眼を置き、特定環境で動く完全なエクスプロイトコードの提供を目的としません。
