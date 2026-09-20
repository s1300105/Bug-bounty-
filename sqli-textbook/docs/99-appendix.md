# 付録

- [付録A — 全URL一覧](#付録a-全url一覧)
- [付録B — 未取得の資料](#付録b-未取得の資料)
- [付録C — 用語集](#付録c-用語集)
- [付録D — 参考書籍](#付録d-参考書籍)

## 付録A — 全URL一覧

本書の土台となったロードマップ（`roadmaps/sqli.md`）に登場する全URLです（章横断で重複を排除、アルファベット順）。各資料の位置づけは本文の該当章を参照してください。

### 学習パス・入門（PortSwigger / OWASP / 日本語）

- PortSwigger — What is SQL Injection: <https://portswigger.net/web-security/sql-injection>
- PortSwigger — SQL injection 学習パス: <https://portswigger.net/web-security/learning-paths/sql-injection>
- PortSwigger — UNION attacks: <https://portswigger.net/web-security/sql-injection/union-attacks>
- PortSwigger — 可視エラーベースのラボ: <https://portswigger.net/web-security/sql-injection/blind/lab-sql-injection-visible-error-based>
- PortSwigger — SQL injection チートシート: <https://portswigger.net/web-security/sql-injection/cheat-sheet>
- PortSwigger — Blind SQL injection: <https://portswigger.net/web-security/sql-injection/blind>
- PortSwigger — boolean（conditional responses）ラボ: <https://portswigger.net/web-security/sql-injection/blind/lab-conditional-responses>
- PortSwigger — time-based ラボ: <https://portswigger.net/web-security/sql-injection/blind/lab-time-delays>
- PortSwigger — OOB/OAST ラボ: <https://portswigger.net/web-security/sql-injection/blind/lab-out-of-band>
- PortSwigger — conditional-errors ラボ（Oracle）: <https://portswigger.net/web-security/sql-injection/blind/lab-conditional-errors>
- PortSwigger — second-order SQLi（KB）: <https://portswigger.net/kb/issues/00100210_sql-injection-second-order>
- PortSwigger — NoSQL injection 学習パス: <https://portswigger.net/web-security/learning-paths/nosql-injection>
- PortSwigger Research: <https://portswigger.net/research>
- OWASP — SQL Injection（コミュニティ）: <https://owasp.org/www-community/attacks/SQL_Injection>
- OWASP WSTG — Testing for SQL Injection: <https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Injection_Testing/05-Testing_for_SQL_Injection>
- OWASP — SQL Injection Bypassing WAF: <https://owasp.org/www-community/attacks/SQL_Injection_Bypassing_WAF>
- OWASP WSTG — ORM injection: <https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Input_Validation_Testing/05.7-Testing_for_ORM_Injection.md>
- OWASP — SQL Injection Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html>
- OWASP — Injection Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html>
- （日本語）IPA「安全なウェブサイトの作り方」SQLインジェクション: <https://www.ipa.go.jp/security/vuln/websecurity/sql.html>
- （日本語）IPA「安全なウェブサイトの作り方」トップ: <https://www.ipa.go.jp/security/vuln/websecurity/about.html>
- （日本語）secutils — SQLインジェクション入門: <https://secutils.jp/learn/security/sql-injection>
- （日本語）徳丸本 要約（SlideShare）: <https://www.slideshare.net/kwatch/sql-53624630>

### チートシート・ペイロード集・リファレンス

- PayloadsAllTheThings — SQL Injection README: <https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/SQL%20Injection/README.md>
- PayloadsAllTheThings — MySQL Injection: <https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/SQL%20Injection/MySQL%20Injection.md>
- PayloadsAllTheThings — MSSQL Injection: <https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/SQL%20Injection/MSSQL%20Injection.md>
- PayloadsAllTheThings — SQLite Injection: <https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/SQL%20Injection/SQLite%20Injection.md>
- PayloadsAllTheThings — GraphQL Injection: <https://swisskyrepo.github.io/PayloadsAllTheThings/GraphQL%20Injection/>
- HackTricks — SQL Injection（ミラー）: <https://hacktricks.wiki/en/pentesting-web/sql-injection/index.html>
- HackTricks — MSSQL Injection: <https://book.hacktricks.xyz/pentesting-web/sql-injection/mssql-injection>
- HackTricks — MS Access Injection: <https://hacktricks.wiki/en/pentesting-web/sql-injection/ms-access-sql-injection.html>
- pentestmonkey — MySQL: <https://pentestmonkey.net/cheat-sheet/sql-injection/mysql-sql-injection-cheat-sheet>
- pentestmonkey — MSSQL: <https://pentestmonkey.net/cheat-sheet/sql-injection/mssql-sql-injection-cheat-sheet>
- pentestmonkey — Oracle: <https://pentestmonkey.net/cheat-sheet/sql-injection/oracle-sql-injection-cheat-sheet>
- Bobby Tables（言語別パラメータ化クエリ集）: <https://bobby-tables.com/>

### WAF回避・現代研究

- Secjuice — 高度な boolean ベース SQLi フィルタバイパス: <https://www.secjuice.com/advanced-sqli-waf-bypass/>
- Picus — JSONベース SQLi による WAF バイパス: <https://www.picussecurity.com/resource/blog/waf-bypass-using-json-based-sql-injection-attacks>
- nav1n GitBook — SQLi の WAF バイパス技法: <https://nav1n0x.gitbook.io/advanced-sql-injection-techniques/waf-bypass-techniques-for-sql-injection>
- Claroty Team82 — {JS-ON: Security-OFF}（JSON WAF バイパス原典）: <https://claroty.com/team82/research/js-on-security-off-abusing-json-based-sql-to-bypass-waf>

### 応用・SQLi→RCE

- NetSPI — ストアドプロシージャ＋DNSエグレスによる second-order SQLi: <https://www.netspi.com/blog/technical-blog/web-application-pentesting/second-order-sql-injection-with-stored-procedures-dns-based-egress/>
- Praetorian — GraphQL API における SQLi: <https://www.praetorian.com/blog/identifying-sql-injections-in-a-graphql-api/>
- insidersecurity — xp_cmdshell の悪用と防御: <https://insidersecurity.co/exploitation-of-xp_cmdshell-in-ms-sql-critical-risks-how-to-defend/>
- securitypentester.ninja — MySQL UDF Injection: <https://securitypentester.ninja/mysql-udf-injection/>
- lib_mysqludf_sys（ソース）: <https://github.com/mysqludf/lib_mysqludf_sys>
- Source Incite — Double Uppercut（PostgreSQL RCE）: <https://srcincite.io/blog/2020/06/26/sql-injection-double-uppercut-how-to-achieve-remote-code-execution-against-postgresql.html>
- sec-88 — SQL to RCE まとめ: <https://sallam.gitbook.io/sec-88/web-appsec/sql-injection/sql-to-rce>

### ツール（sqlmap / Ghauri）

- sqlmap wiki — Usage: <https://github.com/sqlmapproject/sqlmap/wiki/Usage>
- sqlmap wiki — Techniques: <https://github.com/sqlmapproject/sqlmap/wiki/Techniques>
- sqlmap wiki — FAQ: <https://github.com/sqlmapproject/sqlmap/wiki/FAQ>
- sqlmap — tamper スクリプト集: <https://github.com/sqlmapproject/sqlmap/tree/master/tamper>
- Cybr — sqlmap チートシート: <https://cybr.com/ethical-hacking-archives/sqlmap-cheat-sheets-to-help-you-find-sql-injections/>
- カスタム tamper スクリプトのガイド（nav1n / Medium）: <https://medium.com/@nav1n/how-to-create-your-own-sqlmap-tamper-scripts-step-by-step-guide-5dd3c299c210>
- Ghauri: <https://github.com/r0oth3x49/ghauri>

### 練習環境・ハンズオン

- PortSwigger ラボ（SQLi 全般・入口）: <https://portswigger.net/web-security/sql-injection>
- sqli-labs（Audi-1）: <https://github.com/Audi-1/sqli-labs>
- TryHackMe — SQL Injection Lab（初心者）: <https://tryhackme.com/room/sqlilab>
- TryHackMe — SQL Injection ルーム: <https://tryhackme.com/room/sqli>
- HTB Academy — SQL Injection Fundamentals: <https://academy.hackthebox.com/course/preview/sql-injection-fundamentals>
- HTB Academy — Blind SQL Injection: <https://academy.hackthebox.com/course/preview/blind-sql-injection>
- HTB Academy — SQLMap Essentials: <https://academy.hackthebox.com/course/preview/sqlmap-essentials>
- PentesterLab — From SQL Injection to Shell: <https://pentesterlab.com/exercises/from_sqli_to_shell/>
- PentesterLab — SQLi 01: <https://pentesterlab.com/exercises/sqli-01>
- Root-Me — Web-Server チャレンジ: <https://www.root-me.org/en/Challenges/Web-Server/>
- Root-Me — SQL Injection Second Order: <https://www.root-me.org/en/Challenges/Web-Server/SQL-Injection-Second-Order>
- HackerOne — Hacktivity（公開レポート）: <https://hackerone.com/hacktivity>

### 長文リファレンス（書籍）

- Elsevier — SQL Injection Attacks and Defense（Clarke-Salt）: <https://shop.elsevier.com/books/sql-injection-attacks-and-defense/clarke-salt/978-1-59749-424-3>

## 付録B — 未取得の資料

以下は自動取得（WebFetch）が失敗し、本文に完全反映できなかった資料です。理由を添えて一覧化します。本文の該当箇所には警告を挿入したうえで、一般知識に基づく補足を添えています。**正確な最新情報は必ず下記URLからご自身で直接ご確認ください。**

| 資料 | URL | 理由（取得時: 2026-09） |
|---|---|---|
| HTB Academy — Blind SQL Injection | <https://academy.hackthebox.com/course/preview/blind-sql-injection> | モジュール本文はログイン／サブスクリプション必須。未認証では概要・難度・16セクションのタイトル一覧のみ取得可能。 |
| カスタム tamper スクリプト ガイド（nav1n / Medium） | <https://medium.com/@nav1n/how-to-create-your-own-sqlmap-tamper-scripts-step-by-step-guide-5dd3c299c210> | medium.com / nav1n.medium.com とも HTTP 403 Forbidden。Google キャッシュも本文取得不可。WebSearch由来の構造的事実（priority/dependencies/tamperテンプレート）と一般知識で補完。 |
| IPA「安全なSQLの呼び出し方」PDF（about.html からリンク） | <https://www.ipa.go.jp/security/vuln/websecurity/about.html> | 別冊PDF（website_security_type1_7.pdf）への直接取得が HTTP 404。言語別（Java/Oracle, PHP/PostgreSQL, Perl/MySQL, Java/MySQL, ASP.NET/SQL Server）のコード例は未抽出。一般知識で補足。 |
| TryHackMe — SQL Injection ルーム | <https://tryhackme.com/room/sqli> | WebFetch が HTTP 429（Too Many Requests）を返し直接取得不可。WebSearch の二次情報で代替。 |
| Root-Me — Web-Server チャレンジ | <https://www.root-me.org/en/Challenges/Web-Server/> | Anubis Bot対策ミドルウェアにより Access Denied（403相当）。GitHub上の解法まとめとWeb検索で補完。 |
| Root-Me — SQL Injection Second Order | <https://www.root-me.org/en/Challenges/Web-Server/SQL-Injection-Second-Order> | 同上（Anubis Bot対策で403相当）。一般知識で second-order の仕組みを補足。 |
| HackerOne — Hacktivity | <https://hackerone.com/hacktivity> | 一覧はJavaScriptで描画されるSPAのため、静的HTML（タイトルのみ）しか取得できず。個別レポート・公式ブログ・コミュニティ集計で再構成。 |

## 付録C — 用語集

- **SQLi（SQL Injection / SQLインジェクション）**: ユーザー入力がSQLクエリの構文として解釈され、アプリが意図しないクエリを実行させられる脆弱性。
- **in-band SQLi（帯域内）**: 攻撃に使ったのと同じ経路（HTTPレスポンス本文）に結果が返る形態。UNIONベース、エラーベースが代表。
- **UNIONベース**: `UNION SELECT` で別のクエリ結果を元の結果に連結し、任意データを反射させる技法。カラム数と型の一致が前提。
- **エラーベース**: DBのエラーメッセージ内に抽出データを埋め込ませて漏出させる技法（例: MySQLの `extractvalue()`、SQL Serverの変換エラー）。
- **Blind SQLi（ブラインド）**: 直接の出力が無く、真偽・遅延・外部通信といった間接シグナルから1ビットずつ情報を推測する形態。
- **boolean-based（条件応答）**: 注入した条件の真偽で、ページの応答（有無・差分）が変わることを利用する推測法。
- **time-based（時間遅延）**: `SLEEP()` / `WAITFOR DELAY` / `pg_sleep()` 等で条件成立時に遅延を発生させ、応答時間から真偽を判定する推測法。
- **OOB / OAST（Out-of-Band / Out-of-band Application Security Testing）**: DNSやHTTPなど別チャネルへDBから通信を発生させ、その着信でデータを漏出・検知する技法（例: Burp Collaborator）。
- **second-order（二次）SQLi**: 入力時には安全に保存され、後で別の処理がその値を使ってクエリを組み立てる際に発火するSQLi。
- **stacked queries（スタックドクエリ）**: `;` で複数文を連結して実行する技法。DBドライバやAPIが多文実行を許すかに依存。
- **information_schema / sqlite_master**: テーブル・カラムなどのメタデータを保持するビュー／表。スキーマ列挙の起点。
- **プリペアドステートメント（パラメータ化クエリ）**: クエリの構文と値を分離し、値をプレースホルダ経由でバインドすることでSQLiを原理的に防ぐ仕組み。第8章の防御の要。
- **WAF（Web Application Firewall）**: HTTPリクエストをシグネチャ等で検査し攻撃を遮断する防御層。回避技法（第5章）の対象。
- **tamper スクリプト（sqlmap）**: ペイロードを変形してWAF/フィルタを回避するためのsqlmap用変換モジュール。
- **UDF（User-Defined Function）**: DBに独自関数を登録する仕組み。MySQLでは共有ライブラリを介したOSコマンド実行（SQLi→RCE）の足がかりになり得る。
- **sink / source**: source は信頼できない入力の入口、sink は入力が最終的に実行・解釈される危険な到達先（ここではSQL実行）。

## 付録D — 参考書籍

- Justin Clarke-Salt ほか『SQL Injection Attacks and Defense』第2版（Syngress/Elsevier, 2012年7月, 576頁, ISBN 9781597499637）— SQLiのみに丸ごと割いた唯一の専門書。全11章。
- Dafydd Stuttard & Marcus Pinto『The Web Application Hacker's Handbook』第2版 — SQL injection章はより広いWebアプリ攻撃の文脈での古典的長文解説。
- 徳丸浩『体系的に学ぶ 安全なWebアプリケーションの作り方』第2版（SBクリエイティブ, 2018年6月, ISBN 9784797393163）— 日本語Webセキュリティの標準テキスト。防御・基礎に最強。

---

[📖 目次](index.md) ｜ [← 第10章 リファレンス](10-reference.md)
