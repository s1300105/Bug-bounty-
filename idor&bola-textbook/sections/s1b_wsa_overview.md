## Web Security Academy 全体像と学習パス

IDOR（Insecure Direct Object References、安全でない直接オブジェクト参照）やBOLA（Broken Object Level Authorization、オブジェクトレベル認可の破綻）を体系的に学ぶうえで、PortSwigger社が無償公開している「Web Security Academy（WSA）」は事実上の業界標準教材である。本章では、後続の各章で個別のラボや技術詳細に踏み込む前に、この教材全体の構造・学習の進め方・アクセス制御カテゴリの位置づけを俯瞰し、読者が以降の章をどう位置づけて読めばよいかの地図を提供する。

### Web Security Academyとは何か

PortSwigger社（Webアプリケーション脆弱性診断ツールBurp Suiteの開発元）が提供するWeb Security Academyは、「Burp Suiteの開発元による無料のオンラインWebセキュリティ学習コンテンツ」と公式に位置づけられている。単なる読み物ではなく、実際に脆弱性を仕込んだ疑似アプリケーション（ラボ環境）を、受講者自身のブラウザとBurp Suiteから攻撃して「ラボをクリア（solve）する」ことで学習が完了する、ハンズオン型の教材である点が最大の特徴である。

学習コンテンツは30以上のトピックカテゴリに分かれており、SQLインジェクション、クロスサイトスクリプティング（XSS）、CSRF、XXEインジェクション、SSRF（サーバーサイドリクエストフォージェリ）といった古典的な脆弱性クラスに加え、OAuth認証、認証（authentication）全般、そして本教科書の主題である**アクセス制御（access control）の脆弱性**、さらにはAPIテスト、NoSQLインジェクション、Web LLM攻撃、Webキャッシュデセプション、GraphQL脆弱性、JWT攻撃、リクエストスマグリングなど、比較的新しいトピックまで幅広くカバーしている。各トピックには通常4〜30個程度の実践的なラボが用意されており、テキストによる解説（多くは動画による要約付き）とセットで提供される。

受講にはアカウント登録（無料）が推奨されており、登録すると進捗がトラッキングされ、早期にラボをクリアした受講者向けの「Hall of Fame（殿堂）」というゲーミフィケーション要素（ノベルティグッズの提供など）も用意されている。ラボの攻略にはBurp Suite Community Edition（無料版）で十分対応できるよう設計されており、有料版（Professional）が必須のラボは一部の高度なトピックに限られる。

> 出典: Web Security Academy: Free Online Training from PortSwigger — https://portswigger.net/web-security

### コンテンツの三層構造：概念解説・ラボ・学習パス

WSAのコンテンツは大きく三つの層で構成されていると捉えると理解しやすい。

1. **概念解説ページ**（例: `/web-security/access-control` のようなトピックのトップページ）。ここでは脆弱性クラスの定義、発生原理、分類、典型的な攻撃パターン、そして防御策がテキストと図解でまとめられている。
2. **個別ラボ**（例: `/web-security/access-control/lab-insecure-direct-object-references`）。実際に脆弱なアプリケーションが1つずつ用意されており、受講者はそれぞれ独立したラボ環境（一定時間で自動リセットされる使い捨てインスタンス）に対して攻撃を行い、フラグに相当する「Solved（解決）」のステータスを得ることでクリアとなる。
3. **学習パス（Learning Paths）**。複数のトピック・ラボを横断して、初学者から上級者までの学習順序を提示する「カリキュラム」のレイヤーである。

この三層構造を理解しておくことは重要である。なぜなら、単発のラボだけをつまみ食いすると「攻撃手法は再現できるが、なぜその防御モデルが破綻したのかという原理理解が抜け落ちる」という事態に陥りやすいためである。概念解説ページ→学習パスの推奨順序→個別ラボ、という順で辿ることで、原理→体系→実践の順に知識が積み上がる設計になっている。

### 学習パス（Learning Paths）の位置づけ

`/web-security/learning-paths` ページでは、WSAが提供する学習パスが「carefully curated pathways（丹念に作り込まれた学習経路）」として紹介されており、公式には次のように説明されている。

> 学習パスは、Webセキュリティを学ぶための構造化されたアプローチを提供し、受講者が自分のペースで進みながらも、対象分野の深い理解を確実に得られるようにするものである。

⚠️ **未取得の資料**: 学習パス一覧ページ（https://portswigger.net/web-security/learning-paths）は、自動取得ツールでは各学習パスの個別タイトル・説明文・対象トピックの一覧までは抽出できませんでした（ページ本文がJavaScriptで動的に構築されており、取得結果には上記の紹介文のみが含まれ、パス自体の詳細リストは反映されませんでした）。学習パスの正確な現行ラインナップ（例えば「初心者向けパス」「APIセキュリティパス」「認証・アクセス制御パス」等の名称や含まれるラボの具体的な組み合わせ）は、上記URLからご自身で直接ご確認ください。

（以下は未取得資料の補足として一般知識に基づく解説です）WSAの学習パスは、経験レベル（初心者〜経験者）や興味領域（例えばモバイル/APIセキュリティ、認証、アクセス制御など）に応じて複数用意されており、それぞれが「このトピックのこのラボから始め、次にこのラボへ」という順序でラボ群をキュレーションしている。アクセス制御・IDOR・BOLAを学ぶ受講者にとって実務的に重要なのは、学習パスの正式名称そのものよりも、「アクセス制御カテゴリの概念解説ページを起点に、垂直方向の権限昇格→水平方向の権限昇格→IDOR→文脈依存の（多段階処理の順序を悪用する）アクセス制御という順序で難易度が上がっていく」という設計思想を把握しておくことである。この順序は次章以降で扱う個々のラボの並びにもそのまま反映されている。学習パスは公式サイト上でログイン状態と連動して進捗が可視化される仕組みになっているため、実際に手を動かしながら本教科書を読み進める読者は、WSAのアカウントでログインしたうえで該当パスを開き、進捗バーを見ながら章を辿ることを推奨する。

### 全ラボ一覧ページ（All Labs）の役割

`/web-security/all-labs` は、WSAに存在するすべてのラボをトピック別に一望できる索引ページである。取得結果では、アクセス制御カテゴリを含む28前後のトピックカテゴリがアルファベット順（正確には基礎的なトピックから高度なトピックへという実務的な順序）に並んでいることが確認できたが、各カテゴリ配下の個別ラボ名・難易度ラベルまではこのページの静的な取得結果には十分に反映されなかった。

⚠️ **未取得の資料**: 全ラボ一覧ページ（https://portswigger.net/web-security/all-labs）のうち、「Access control vulnerabilities（アクセス制御の脆弱性）」カテゴリ配下の個別ラボ名・難易度（Apprentice/Practitioner/Expert）の完全な一覧は、自動取得では展開できませんでした（同カテゴリの詳細リストがページ内で折りたたみ表示または動的読み込みされており、取得結果にはカテゴリの見出しのみが含まれました）。正確な現行のラボ一覧・難易度表示は、上記URLから直接ご確認ください。

（以下は未取得資料の補足として一般知識と別ソースの検索結果に基づく解説です）補助的なWeb検索により、アクセス制御カテゴリには少なくとも次のようなラボが実在することが確認できた（本教科書執筆時点、2026年9月）。

- Unprotected admin functionality（保護されていない管理機能）― Apprentice
- Unprotected admin functionality with unpredictable URL（推測困難URLの管理機能）― Apprentice
- User role controlled by request parameter（リクエストパラメータでユーザー役割が制御される）― Apprentice
- User ID controlled by request parameter（リクエストパラメータでユーザーIDが制御される）― Apprentice
- User ID controlled by request parameter, with unpredictable user IDs（同、ただしIDが推測困難）― Practitioner
- User ID controlled by request parameter with data leakage in redirect（リダイレクトでのデータ漏えいを伴う）― Practitioner
- User ID controlled by request parameter with password disclosure（パスワード漏えいを伴う）― Practitioner
- Insecure direct object references（IDORそのものを扱う代表ラボ）― Practitioner
- URL-based access control can be circumvented（URLベースのアクセス制御回避）― Practitioner
- Method-based access control can be circumvented（HTTPメソッドベースの回避）― Practitioner
- User role can be modified in user profile（プロフィール経由でロールを改ざん）― Practitioner
- Referer-based access control（Refererヘッダーに依存したアクセス制御）― Practitioner
- Multi-step process with no access control on one step（多段階処理の一部にアクセス制御漏れ）― Expert

これらは典型的に、**垂直権限昇格**（一般ユーザーが管理者専用機能に到達できてしまう一連のラボ）、**水平権限昇格／IDOR**（自分のリソースIDを他人のIDに書き換えるだけで他人のデータへ到達できてしまう一連のラボ）、**文脈依存のアクセス制御漏れ**（多段階のウィザード的な処理のうち、途中のステップだけ認可チェックが欠落しているケース）という3つの系統に分類できる。この分類は、本教科書の第2章以降で扱う「アクセス制御モデルの分類」ともそのまま対応しており、ラボ名を眺めるだけでも、IDOR/BOLAが「アクセス制御という大きな傘の中の、リソース識別子の検証漏れという特定のサブパターン」であることが直感的に理解できる構成になっている。

> 出典: All labs | Web Security Academy — https://portswigger.net/web-security/all-labs
> 出典: Access control vulnerabilities and privilege escalation | Web Security Academy — https://portswigger.net/web-security/access-control（個別ラボ名の裏取りに使用した補助検索の到達先）

### 読者がこの教材をどう使うべきか（実務上の位置づけ）

本教科書はWSAのラボ攻略手順そのものを再掲するものではない（スコープ制約により、実在サービス・本番環境への無許可検証や、特定ラボの手順そのものの詳細な攻略記述は行わない）。その代わりに、WSAが体系化しているアクセス制御・IDOR・BOLAの分類、脆弱性が生まれる原理、そして防御の考え方を、読者が自分自身の診断・開発・レビュー業務に転用できる形で整理することを目的とする。

実務的には、次の順序で活用することを推奨する。

1. 本教科書の第1章〜第3章（概念・分類・原理）を読み、アクセス制御の破綻がどのようなメンタルモデルで起きるかを理解する。
2. WSAの `access-control` トピックページの概念解説を自分の言葉で説明できるか確認する（本章で要約した「垂直・水平・文脈依存」の3分類が基礎になる）。
3. 実際に手を動かす場合は、WSAの公式アカウントでログインし、学習パスに沿ってラボを進める（本教科書はその際の「なぜこの防御が破綻するのか」という原理面の副読本として使う）。
4. API文脈でのIDOR/BOLA（OWASP API Security Top 10でのBOLAの扱い）については、本教科書の後続章で別途、WSAのAPIテスト関連トピックと接続して解説する。

なお、WSAはバージョンやラボ構成が継続的に更新されるサービスである。本章に記載したラボ名・カテゴリ数・難易度分類は2026年9月時点で補助的なWeb検索により確認できた情報に基づくものであり、将来的にラボの追加・改廃・難易度の見直しが行われる可能性がある点に留意されたい。最新かつ正確な一覧は、必ず公式サイト（https://portswigger.net/web-security/all-labs 、https://portswigger.net/web-security/access-control）で確認すること。
