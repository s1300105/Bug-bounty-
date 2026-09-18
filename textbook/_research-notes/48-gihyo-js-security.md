# [48] JavaScriptセキュリティの基礎知識 第7回 DOM-based XSS その2（はせがわようすけ／gihyo.jp）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
| --- | --- | --- | --- |
| https://gihyo.jp/dev/serial/01/javascript-security/0007 | partial（原典の直接取得は failed／内容は二次情報で再構成） | WebFetch → `EGRESS_BLOCKED`／curl → `CONNECT tunnel failed, response 403`／web.archive.org も 403／最終的に WebSearch（検索エンジンが当該ページを読んだ要約）を10回以上実行して内容を再構成 | **gihyo.jp ドメイン全体がこの実行環境の egress プロキシで遮断されている**。TLS 検証の無効化・プロキシ迂回は行っていない。したがって本ノートの本文・コードは**原文逐語ではなく、検索エンジン要約に基づく再構成**である。逐語引用が必要な箇所は読者が原典を開く必要がある。 |

### 取得試行の記録（再現可能な事実）

| 手段 | 結果 |
| --- | --- |
| `WebFetch(https://gihyo.jp/dev/serial/01/javascript-security/0007)` | `{"error_type":"EGRESS_BLOCKED","domain":"gihyo.jp","message":"Access to gihyo.jp is blocked by the network egress proxy."}` |
| `curl -sSL --max-time 90 -A "Mozilla/5.0 ..." https://gihyo.jp/...0007` | `curl: (56) CONNECT tunnel failed, response 403` / agent-proxy: `connect_rejected` |
| `https://web.archive.org/...` / `archive.org/wayback/available` | `Host not in allowlist: web.archive.org` / CONNECT 403 |
| 到達性プローブ（`gihyo.jp` `www.gihyo.jp` `codezine.jp` `www.codegrid.net` `utf-8.jp` `blog.tokumaru.org` `qiita.com` `zenn.dev` `b.hatena.ne.jp` `archive.ph` `timetravel.mementoweb.org`） | すべて HTTP コード `000`（CONNECT 拒否）。到達できたのは `github.com`（400）と `raw.githubusercontent.com`（301）のみ |
| `mcp__github__search_code("javascript-security/0007" gihyo)` | `total_count: 0`（GitHub 上にミラー・引用なし） |
| `WebSearch`（gihyo.jp 限定クエリを含め11回） | 成功。記事の節構成・扱う sink 一覧・対策方針・連載全8回のタイトルと公開日を回収できた |

#### 補完工程での再試行（2026-09-18）— 結論：原典は依然取得不可、ただし代替一次資料の全文取得に成功

| 手段 | 結果 |
| --- | --- |
| `WebFetch(https://gihyo.jp/.../0007)` 再試行 | 再度 `{"error_type":"EGRESS_BLOCKED","domain":"gihyo.jp"}`。**変化なし** |
| `WebFetch(https://jpcertcc.github.io/OWASPdocuments/...)` | `EGRESS_BLOCKED`（`jpcertcc.github.io` も遮断） |
| `curl "$HTTPS_PROXY/__agentproxy/status"` でプロキシ状態を確認 | `recentRelayFailures` に `web.archive.org:443` / `r.jina.ai:443` / `portswigger.net:443` / `developer.mozilla.org:443` / `developer.chrome.com:443` がいずれも `connect_rejected`（"gateway answered 403 to CONNECT (policy denial or upstream failure)"）として記録されていた。`/root/.ccr/README.md` は **「403/407 は組織の egress ポリシーによる拒否であり、再試行も迂回もせず報告せよ」** と明記しているため、これ以上の迂回試行は行っていない |
| `WebSearch` 追加実行 | **不可**。セッションの検索予算を消尽（200/200 calls）。前工程が使い切ったため、本工程では検索による新規情報の追加ができなかった |
| `raw.githubusercontent.com` 経由の代替資料取得 | **成功（本工程の主要成果）**。OWASP 公式チートシート2本（英語原文）、JPCERT/CC 日本語訳、DOMPurify・Trusted Types の公式 README、および gihyo 連載を紹介している日本語コミュニティ資料2本を全文取得・精読した。詳細は末尾の「【補完工程】」各節を参照 |
| `mcp__github__search_code` 再検索（別クエリ） | gihyo 記事本文のミラーは**依然見つからず**。ただし連載を**紹介・評価している**第三者の日本語資料2件を発見（下記「独立した裏付け」節） |

> **補完工程の結論**: 原典 `https://gihyo.jp/dev/serial/01/javascript-security/0007` の本文・コードの逐語取得は**最終的に不可能**と判定する。したがって本ノート本体の「再構成（原文逐語ではない）」という留保は**すべてそのまま有効**であり、格上げしていない。一方で、(a) 記事が扱うテーマ（DOM-based XSS の sink 別対策）については OWASP 公式チートシートの全文を取得できたため、教科書の技術的裏付けは原典なしでも十分な精度で書ける状態になった。(b) 連載の著者・扱う範囲については第三者の日本語資料で独立に裏付けが取れた。

## 要約（3〜10行）

- 本記事は はせがわようすけ 氏による gihyo.jp 連載「JavaScriptセキュリティの基礎知識」の**第7回「DOM-based XSS その2」（2016年11月16日公開）**。全8回連載の7本目で、DOM-based XSS を扱う3部作（第6回・第7回・第8回）の中核回である。
- 第6回で「DOM-based XSS の原因（source から sink への到達）と、`innerHTML` への HTML 代入・`location` オブジェクトへの URL 代入という代表例」を扱ったのを受け、第7回は**実際に DOM-based XSS の原因となる代表的な sink（シンク）を個別に取り上げ、それぞれの危険な書き方と対策を示す**構成になっている。
- 第7回が扱う sink は **`document.write` / `document.writeln`、`eval`、`setTimeout` / `setInterval`、`Function`、jQuery の `jQuery()` / `$()` / `.html()`** の5系統。
- 対策の基本思想は「**サーバ側で行っていた XSS 対策と同じことを、ブラウザ上の JavaScript でも行う**」＝テキストノード用・属性値用の HTML エスケープ関数を用意し、`document.write` に渡す HTML を必ずエスケープして組み立てる。ただし「`document.write` の呼び出し中で1か所でもエスケープ漏れがあれば DOM-based XSS が発生する」ため、そもそも `document.write` ではなく DOM 操作 API を使うことを推奨している。
- `eval` は現在のブラウザなら `JSON.parse` を使う、`setTimeout` / `setInterval` には文字列ではなく関数（関数オブジェクト）を渡す、`Function` コンストラクタには攻撃者が制御可能な文字列を渡さない、jQuery は「コードから挙動が見えにくい」ため特に注意する——というのが各 sink の結論。
- **注意：gihyo.jp が遮断されているため、以下の詳細ノートは検索エンジンが当該ページを読んで生成した要約の集約であり、逐語引用ではない。** 節タイトル・扱う sink・対策方針・公開日・連載構成は複数クエリで一致したため信頼度は高いが、コード例は逐語ではなく再構成である。

## 詳細ノート

### 連載「JavaScriptセキュリティの基礎知識」全回一覧（出典: https://gihyo.jp/dev/serial/01/javascript-security ／WebSearch経由）

著者：はせがわようすけ。連載は**第8回で完結（全8回）**。第9回以降は存在しない。

| 回 | タイトル | URL | 公開日 |
| --- | --- | --- | --- |
| 第1回 | Webセキュリティのおさらい その1 | https://gihyo.jp/dev/serial/01/javascript-security/0001 | 2016-06-14 |
| 第2回 | Webセキュリティのおさらい その2 XSS | https://gihyo.jp/dev/serial/01/javascript-security/0002 | 2016-06-28 |
| 第3回 | Webセキュリティのおさらい その3 CSRF・オープンリダイレクト・クリックジャッキング | https://gihyo.jp/dev/serial/01/javascript-security/0003 | 2016-07-13 |
| 第4回 | URLとオリジン | https://gihyo.jp/dev/serial/01/javascript-security/0004 | 2016-07-26 |
| 第5回 | 問題を発生させにくくするURLの扱い方 | https://gihyo.jp/dev/serial/01/javascript-security/0005 | 2016-09-21 |
| 第6回 | DOM-based XSS その1 | https://gihyo.jp/dev/serial/01/javascript-security/0006 | 2016-10-14 |
| **第7回（担当）** | **DOM-based XSS その2** | **https://gihyo.jp/dev/serial/01/javascript-security/0007** | **2016-11-16** |
| 第8回（最終回） | DOM-based XSS その3 | https://gihyo.jp/dev/serial/01/javascript-security/0008 | 2016-11-29 |

関連ページ:
- 連載トップ: https://gihyo.jp/dev/serial/01/javascript-security
- 記事一覧（グループ）: https://gihyo.jp/list/group/JavaScript%E3%82%BB%E3%82%AD%E3%83%A5%E3%83%AA%E3%83%86%E3%82%A3%E3%81%AE%E5%9F%BA%E7%A4%8E%E7%9F%A5%E8%AD%98
- 著者ページ: https://gihyo.jp/author/%E3%81%AF%E3%81%9B%E3%81%8C%E3%82%8F%E3%82%88%E3%81%86%E3%81%99%E3%81%91
- 各記事は複数ページ構成（`?page=2`、`?page=3` が存在する。第8回は `?page=3` まで確認できた）

### 第7回の位置づけ（出典: https://gihyo.jp/dev/serial/01/javascript-security/0007）

- 前回（第6回）で DOM-based XSS の**原因と対策**を、`innerHTML` への HTML 代入と `location` オブジェクトへの URL 代入という2つのケースで説明した。第7回はその続きとして、**実際に DOM-based XSS の原因として見られる代表的な sink** を順に取り上げる。
- 第6回で示された DOM-based XSS の本質的な特徴として「**DOM-based XSS ではクライアント上で JavaScript が動作するまで XSS が発生しない**」（＝サーバ側のレスポンスを見るだけでは検出できない）点が強調されている。これは従来のサーバ側で検出できる XSS との決定的な違いである。
- また第6回では「sink の大半は『文字列から HTML を生成する』機能である」という整理がなされている（`write` 系がその典型）。
- 第6回の代表的な脆弱コード例：`location.hash.substring(1)` を `div.innerHTML` に直接代入する。攻撃 URL は `http://example.jp/#<img src=1 onerror=alert(1)>`。対策は `innerHTML` ではなく `textContent` / `createTextNode()` を使うこと。

### 第7回が取り上げる sink 一覧（記事の節構成に対応）

| # | sink | 記事での要点 | 推奨される対策 |
| --- | --- | --- | --- |
| 1 | `document.write` / `document.writeln` | 文字列から HTML を生成して document に書き込む。攻撃者が制御可能な変数を引数に渡すと DOM-based XSS になる | HTML エスケープ関数を用意し、テキストノード部分・属性値部分の両方をエスケープしてから HTML を組み立てる。ただし**1か所でもエスケープ漏れがあれば DOM-based XSS が発生する**ため、DOM に文字列や要素を追加するなら `document.write` を使わず **DOM 操作 API を利用する**ことを推奨 |
| 2 | `eval` | 文字列を JavaScript コードとして実行する。JSON 文字列を JavaScript オブジェクトに変換する目的で `eval("(" + json + ")")` と書く古い手法が危険な例として挙げられている | 現在のブラウザなら **`JSON.parse` を利用する** |
| 3 | `setTimeout` / `setInterval` | 第1引数に文字列を渡すとその文字列がコードとして実行される | **引数には文字列ではなく関数（関数オブジェクト）を渡す**。コールバックへ引数を渡す機能は IE9 では使えなかったため、IE9 互換が必要な場合は**クロージャを使う** |
| 4 | `Function`（Function コンストラクタ） | 文字列から動的にコードを生成する。攻撃者が制御可能な文字列を引数に渡すと DOM-based XSS が発生する | **Function コンストラクタの引数に攻撃者が制御可能な文字列を渡さない** |
| 5 | `jQuery()` / `$()` / `.html()` | jQuery の API 自体が DOM-based XSS の sink になる。脆弱な例として `$("#element").html(text)`（text が攻撃者制御）、`$(text).append("<div>news</div>")`（text が `<img src=# onerror='alert(1)'>` のような HTML だとスクリプトが実行される）が挙げられている。`$()` は引数が HTML 文字列とみなされると要素を生成してしまう | **jQuery の引数に攻撃者が制御可能な文字列を渡さない**。jQuery の API は「直接コードを書く場合に比べて挙動が見えにくい（表に出にくい）」ため、とくに注意が必要 |

### HTMLエスケープの基本方針（第7回の中核・出典: 同上）

- 考え方は「**従来サーバ側で行っていた XSS 対策と同じことを、ブラウザ上の JavaScript で実装する**」。
- HTML エスケープ関数は、メタキャラクタ `&` `<` `>` `"` `'` をそれぞれ `&amp;` `&lt;` `&gt;` `&quot;` `&#x27;` に変換する。これにより攻撃者が制御可能な文字列を安全に出力できる。
- 実装は文字列に対して `replace` メソッドを使い、`&` `<` `>` `"` `'` を対応する文字参照へ置換する方式が推奨されている。
- **属性値を含む HTML を生成する場合でも同じ HTML エスケープ関数を使う**ことで、引用符（クォート）による属性値からの脱出を防げる（`"` と `'` の両方をエスケープするのがポイント）。
- そのうえで「`document.write` の呼び出し中で1か所でもエスケープの漏れがあると DOM-based XSS が発生してしまう」ため、**DOM へ文字列や要素を追加するのであれば `document.write` を使用せず DOM 操作 API を利用する**ことが結論として示されている。

#### コード/コマンド

**重要：以下のコードは原文逐語ではない。** gihyo.jp が遮断されており原文の逐語取得ができなかったため、検索要約に現れた要素（関数名・置換対象文字・攻撃ペイロード文字列）を元にした**再構成**である。教科書に「はせがわ氏のコード」として逐語掲載してはならない。逐語が必要なら原典（https://gihyo.jp/dev/serial/01/javascript-security/0007 ）を参照すること。

〔再構成（原文逐語ではない）〕検索要約で確認できた攻撃ペイロード・危険なコード断片:

```
http://example.jp/#<img src=1 onerror=alert(1)>          ← 第6回の攻撃URL例（location.hash → innerHTML）
<img src=# onerror='alert(1)'>                            ← 第7回 jQuery 節で挙げられたペイロード
eval("(" + json + ")")                                    ← 第7回 eval 節で挙げられた危険な古い手法
$("#element").html(text)                                  ← 第7回 jQuery 節の脆弱例（text が攻撃者制御）
$(text).append("<div>news</div>")                          ← 第7回 jQuery 節の脆弱例
location.hash.substring(1)                                 ← 第6回の source 取得（→ div.innerHTML へ代入）
```

〔再構成（原文逐語ではない）〕HTML エスケープ関数（記事では `htmlEscape` という名前で登場。置換対象と変換先は検索要約で確認済み、実装の書き方は再構成）:

```javascript
function htmlEscape(s) {
  return s.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;');
}
```

〔補足（一般知識）〕上記エスケープの適用順序は `&` を最初に置換することが必須（後回しにすると `&lt;` の `&` が二重エスケープされる）。また属性値は必ず引用符で囲み、`"` `'` の両方をエスケープする。

〔再構成（原文逐語ではない）〕各 sink の安全な書き換え方針（記事の結論に対応）:

```javascript
// eval の代替
var obj = JSON.parse(json);          // eval("(" + json + ")") は使わない

// setTimeout の代替：文字列ではなく関数を渡す
setTimeout(function () { doSomething(value); }, 1000);   // setTimeout("doSomething('" + value + "')", 1000) は使わない
// 引数渡し（setTimeout(fn, ms, arg)）は IE9 で使えないため、クロージャで値を閉じ込める

// document.write の代替：DOM 操作 API を使う
var el = document.createElement('div');
el.textContent = value;              // innerHTML ではなく textContent
document.getElementById('target').appendChild(el);

// jQuery：HTML として解釈させない API を使う
$('#element').text(value);           // .html(value) は使わない
```

### 隣接回の内容（第7回を教科書化する際の文脈。出典: 各回URL／WebSearch経由）

- **第6回 DOM-based XSS その1**（https://gihyo.jp/dev/serial/01/javascript-security/0006 ）: DOM-based XSS の定義と原因。source（`location.hash` など）から sink（`innerHTML` など）への到達というモデル。「クライアント上で JavaScript が動作するまで XSS が発生しない」＝サーバ側レスポンスの検査では見つからないという特徴。sink の大半は「文字列から HTML を生成する機能」。脆弱例 `location.hash.substring(1)` → `div.innerHTML`、攻撃 URL `http://example.jp/#<img src=1 onerror=alert(1)>`、対策 `textContent` / `createTextNode()`。`location` オブジェクトへの URL 代入（`javascript:` スキームによる実行）も扱う。
- **第8回 DOM-based XSS その3（最終回）**（https://gihyo.jp/dev/serial/01/javascript-security/0008 ／`?page=2`・`?page=3` あり）: より発展的なテーマ。URL のハッシュフラグメントを `XMLHttpRequest` の接続先に使ってしまうパターン（source が通信先になるケース）、テンプレートエンジン／データバインディングを行うライブラリ・フレームワーク（jQuery・AngularJS など）経由での XSS、外部データをテンプレート処理で HTML として埋め込む際の問題、**JavaScript ライブラリを最新に保つことの重要性**（古い jQuery / AngularJS 由来の脆弱性）。
- **第4回 URLとオリジン** / **第5回 問題を発生させにくくするURLの扱い方**: DOM-based XSS の source 側（URL・オリジン）の基礎。オープンリダイレクトや `javascript:` スキームの扱いに直結するため、第7回の前提知識として参照価値が高い。
- **第2回 Webセキュリティのおさらい その2 XSS**（`?page=2` あり）: 反射型・格納型 XSS とエスケープの基礎。第7回の「サーバ側で行っていた対策と同じことを JavaScript で行う」という主張の土台。

### 〔補足（一般知識）〕DOM-based XSS の source / sink 早見表

原文には（少なくとも検索要約で確認できた範囲には）この形の完全表は無い。教科書の実務チェックリストとして下記を**一般知識として**補う。原文由来の項目には「(第6/7/8回)」を付す。

| 区分 | 該当 API / プロパティ |
| --- | --- |
| source（攻撃者が制御しうる入力） | `location.hash`(第6/8回), `location.search`, `location.href`, `location.pathname`, `document.URL`, `document.documentURI`, `document.referrer`, `window.name`, `postMessage` の `event.data`, `localStorage` / `sessionStorage`, Cookie, `XMLHttpRequest` / `fetch` のレスポンス(第8回) |
| sink（HTML 生成系） | `innerHTML`(第6回), `outerHTML`, `insertAdjacentHTML`, `document.write` / `document.writeln`(第7回), `iframe.srcdoc`, `Range.createContextualFragment`, `DOMParser.parseFromString` |
| sink（コード実行系） | `eval`(第7回), `Function` コンストラクタ(第7回), `setTimeout` / `setInterval` の文字列引数(第7回), `setImmediate`, `execScript`(旧IE) |
| sink（URL 系） | `location` への代入(第6回), `location.href` / `assign` / `replace`, `a.href`, `iframe.src`, `script.src`, `form.action`, `window.open`（いずれも `javascript:` / `data:` スキームに注意） |
| sink（jQuery） | `$()` / `jQuery()` の引数(第7回), `.html()`(第7回), `.append()` / `.prepend()` / `.after()` / `.before()` / `.replaceWith()`(第7回で `.append` 例あり), `.wrap()`, `$.parseHTML()`, `$.globalEval()` |
| 安全側の API | `textContent`(第6回), `createTextNode()`(第6回), `setAttribute` による属性設定, jQuery `.text()`, `JSON.parse`(第7回) |

## 読者が自分で開くべき資料

原典 https://gihyo.jp/dev/serial/01/javascript-security/0007 は本環境の egress プロキシが gihyo.jp を全面遮断しているため取得できなかった（WebFetch: `EGRESS_BLOCKED`、curl: CONNECT 403、web.archive.org も allowlist 外）。**gihyo.jp は無料公開・ログイン不要のページなので、読者の通常のブラウザなら問題なく閲覧できる。**

読みどころ（第7回を開いたら必ず確認すべき点）:

1. **HTML エスケープ関数（`htmlEscape`）の逐語コード**——本ノートの版は再構成。原文の実装（置換の順序、`'` を `&#x27;` にしている点、テキストノード用と属性値用を同一関数で兼ねているかどうか）を必ず原文で確認すること。
2. **`document.write` の脆弱例と安全例のビフォー／アフターの完全なコード**——どの変数がどこから来てどこでエスケープされるか、原文のコードで追うこと。「1か所でも漏れると DOM-based XSS になる」という主張の具体的な根拠部分。
3. **`eval` 節の JSON 変換の例**（`eval("(" + json + ")")` → `JSON.parse`）と、`eval` をやめられない場合の記述があるか。
4. **`setTimeout` / `setInterval` 節のクロージャによる書き換え例**と IE9 に関する注記（当時のブラウザ事情。2016年の記事であることを踏まえて読む）。
5. **jQuery 節の `$()` が引数を HTML と解釈する条件**——原文が jQuery のどのバージョンを前提にしているか、`$(text)` がセレクタか HTML かの判定に関する記述の有無。ここは jQuery のバージョンで挙動が変わる最重要ポイント。
6. **記事末尾の「次回」への接続**（第8回で扱う XMLHttpRequest／テンプレートエンジン／ライブラリ更新の予告）と、ページ分割（`?page=2` 以降）に残りの節がある可能性。第6回・第8回も併読すること（DOM-based XSS 3部作で1つの解説になっている）。

### 原典に到達するための代替手段（読者向け・優先順）

1. **通常のブラウザで直接開く（推奨・これで足りる）**——gihyo.jp は無料公開・ログイン不要。遮断はこの実行環境の egress ポリシー固有の問題であり、記事側の制限ではない。**必ず `?page=2`、`?page=3` も確認する**（gihyo の連載記事は複数ページ構成で、`document.write` 節以降が2ページ目に載っている可能性がある。同連載の第8回では `?page=3` の存在が確認されている）。
2. **Wayback Machine**——`https://web.archive.org/web/2017/https://gihyo.jp/dev/serial/01/javascript-security/0007` （年を `2017`／`2019`／`2024` と変えて試す）。2016年の記事なので複数スナップショットが期待できる。ページ分割版は `?page=2` を付けた URL で別途スナップショットを探す必要がある。
3. **archive.today**——`https://archive.ph/https://gihyo.jp/dev/serial/01/javascript-security/0007`。無ければ同サイトで新規保存を実行する。
4. **連載トップから辿る**——https://gihyo.jp/dev/serial/01/javascript-security （全8回のリンクが並ぶ。第6回・第8回も併読するため結局ここを経由するのが早い）。
5. **書籍版は存在しない見込み**——js-primer の2016年議事録に「hasegawaさんが本とか書いてくれると…」という記述があり（下記 E 節）、少なくとも当時この連載の書籍化はされていない。連載単体の書籍版を探すのは徒労になる可能性が高い。

### 原典が読めなかった場合の等価な代替資料（本ノートで検証済み・これだけで技術内容は足りる）

**結論から言えば、第7回の技術的内容を学ぶ目的であれば、原典が読めなくても下記2本で完全に代替できる**（本ノート末尾の【補完工程】A・B節で全文を精読・引用済み）。原典が必要なのは「はせがわ氏自身の日本語の説明・コードを逐語で引用したい場合」だけである。

- **OWASP「DOM based XSS Prevention Cheat Sheet」**（英語・最重要）
  - 読みやすい公開版: https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
  - Markdown 原本（到達性が高い）: https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.md
  - **第7回の5系統の sink のうち jQuery 以外の4系統を公式に網羅**し、`RULE #7`（正しい sink に変えるのが正解）と `GUIDELINE #10`（`eval` でなく `JSON.parse`）が第7回の結論とほぼ一対一で対応する。
- **OWASP「Cross Site Scripting Prevention Cheat Sheet」**（英語・上の前提文書）
  - 公開版: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
  - Markdown 原本: https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.md
  - **第7回のエスケープ5文字の変換表（`&`→`&amp;` … `'`→`&#x27;`）がここに公式に載っており、本ノートの再構成と完全一致する。**
- **OWASP「DOM ベース XSS 対策チートシート」（JPCERT/CC 日本語訳）**
  - 公開版: https://jpcertcc.github.io/OWASPdocuments/CheatSheets/DOMbasedXSSPrevention.html （**本環境からは遮断**）
  - HTML 原本: https://raw.githubusercontent.com/JPCERTCC/OWASPdocuments/master/CheatSheets/DOMbasedXSSPrevention.html
  - **⚠ 古い版であることを確認済み**（`ルール 1`〜`6` のみ。英語版の `RULE #7` と `GUIDELINE #1`〜`#10` が欠落）。**用語の対訳表として使い、技術内容は英語版で確認すること。** 詳細は【補完工程】C-2 節。

併せて開くべき関連資料（本ノート作成時に検索結果で確認できた、同テーマの日本語公開記事。**いずれも本環境からは未取得のため内容は未検証**——読者が開いて確認する必要がある）:

- CodeZine「Webアプリへの攻撃「XSS」とは？フロントエンドと関連の強い「DOM-based XSS」を解説」 https://codezine.jp/article/detail/17342
  - 読みどころ: 第7回と同じテーマの、より新しい日本語解説。2016年の記事との差分（現代のフレームワーク事情）を掴む目的で読む。
- CodeGrid「DOM Based XSSの基礎と実例 第1回 DOM Based XSSとは」 https://www.codegrid.net/articles/2018-xss-1/ ／「第7回 XSSにどう向き合うのか-1」 https://www.codegrid.net/articles/2018-xss-7/
  - 読みどころ: 2018年の連載で、gihyo 連載の2年後。**フロントエンド実務者向けに「XSS にどう向き合うか」という方針論**を扱っており、第7回の「規律による対策」の実務的な続きとして読む価値がある。
- PortSwigger Web Security Academy「DOM-based XSS」 https://portswigger.net/web-security/cross-site-scripting/dom-based
  - **ラボ「DOM XSS in document.write sink using source location.search」** https://portswigger.net/web-security/cross-site-scripting/dom-based/lab-document-write-sink
  - 読みどころ: **第7回の `document.write` 節に完全対応する無料の実習環境**（source が `location.search`、sink が `document.write`）。読むだけでなく手を動かして再現するために開く。第7回を教科書化する際の演習問題の元ネタとして最適。
- はせがわようすけ氏の関連スライド「これからのフロントエンドセキュリティ」 https://speakerdeck.com/hasegawayosuke/korekarafalsehurontoendosekiyuritei ／「JavaScript Security beyond HTML5」 https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823
  - 読みどころ: **著者本人による、連載より後年の資料**。2016年の連載では触れられていない Trusted Types・CSP・現代フレームワークについて著者がどう述べているかを確認するために開く。第7回の主張が著者自身の中でどう発展したかを追える唯一の資料。
- **日本の脆弱性診断士向けガイドラインによる本連載の評価**（本ノートで全文取得・検証済み。【補完工程】D 節参照）
  - https://github.com/WebAppPentestGuidelines/WebAppPentestGuidelines
  - 読みどころ: OWASP Japan × JNSA の共同WGが作った「Webアプリケーション脆弱性診断ガイドライン」の推薦図書リストで、**本連載が「開発系」の第1項目に挙げられている**。連載の位置づけを客観的に確認できる。

## 教科書執筆時の注意（後工程への申し送り）

- **逐語引用は不可**。本ノートのコードは再構成であり、原文のコードとして提示してはならない。教科書では「はせがわようすけ『JavaScriptセキュリティの基礎知識』第7回では〜という方針が示されている（URL）」という要約・参照の形にとどめ、コードは教科書独自のものとして書くのが安全。
- 確実に原文由来として書ける事実：**記事タイトル・著者・公開日（2016-11-16）・連載全8回の構成と各回タイトル／URL／公開日・第7回が扱う5系統の sink・各 sink の対策方針（`JSON.parse` を使う／文字列でなく関数を渡す／Function に攻撃者制御文字列を渡さない／jQuery の引数に渡さない／`document.write` をやめて DOM 操作 API を使う）・エスケープ対象文字と変換先（`&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, `"`→`&quot;`, `'`→`&#x27;`）**。
- 記事は**2016年**のものである点を明記すること。IE9 への言及、jQuery 中心の記述、`DOMPurify` や Trusted Types・CSP `require-trusted-types-for` への言及が無い（当時未普及）という時代背景を、教科書側で〔補足〕として補うべき。

---

# 【補完工程】原典の代わりに使える一次資料（本工程で全文取得・精読済み）

以下は**本工程で実際に全文をダウンロードして読んだ**資料である。gihyo 第7回の本文ではないが、**第7回が扱うテーマ（DOM-based XSS の sink 別の危険な書き方と対策）を公式・権威ある形で完全にカバーしている**。したがって教科書の技術的記述はこれらを典拠にすれば、原典未取得のままでも捏造なしに書ける。

> 取得方法の注記: `jpcertcc.github.io` や `owasp.org` などの Web ホストは遮断されているが、**これらの文書の原本は GitHub リポジトリで管理されており `raw.githubusercontent.com` が到達可能**だったため、そこから取得した。以下の引用はすべて取得したファイルの実内容である。

## A. OWASP「DOM based XSS Prevention Cheat Sheet」（英語原文・全文取得済み）

- 取得元: `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.md`
- 公開ページ（読者向け）: https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
- リポジトリ: https://github.com/OWASP/CheatSheetSeries

### A-1. 全体の節構成（実ファイルの見出しそのまま）

`RULE #1`〜`RULE #7` と `GUIDELINE #1`〜`GUIDELINE #10`、および「Common Problems」の3部構成。

| 区分 | 見出し |
| --- | --- |
| RULE #1 | HTML Escape then JavaScript Escape Before Inserting Untrusted Data into HTML Subcontext within the Execution Context |
| RULE #2 | JavaScript Escape Before Inserting Untrusted Data into HTML Attribute Subcontext within the Execution Context |
| RULE #3 | Be Careful when Inserting Untrusted Data into the Event Handler and JavaScript code Subcontexts within an Execution Context |
| RULE #4 | JavaScript Escape Before Inserting Untrusted Data into the CSS Attribute Subcontext within the Execution Context |
| RULE #5 | URL Escape then JavaScript Escape Before Inserting Untrusted Data into URL Attribute Subcontext within the Execution Context |
| RULE #6 | Populate the DOM using safe JavaScript functions or properties |
| RULE #7 | Fixing DOM Cross-site Scripting Vulnerabilities |
| GUIDELINE #1〜#10 | 下記 A-4 |
| Common Problems | Complex Contexts / Inconsistencies of Encoding Libraries / Encoding Misconceptions / Usually Safe Methods / Detect DOM XSS using variant analysis |

### A-2. サーバ側 XSS と DOM-based XSS の違い（Introduction より・逐語引用）

> "Reflected and Stored XSS are server side injection issues while DOM based XSS is a client (browser) side injection issue."
>
> "All of this code originates on the server, which means it is the application owner's responsibility to make it safe from XSS, regardless of the type of XSS flaw it is. Also, XSS attacks always **execute** in the browser."
>
> "With Reflected/Stored the attack is injected into the application during server-side processing of requests where untrusted input is dynamically added to HTML. For DOM XSS, the attack is injected into the application during runtime in the client directly."

**教科書上の意義**: gihyo 第6回の「DOM-based XSS ではクライアント上で JavaScript が動作するまで XSS が発生しない」という主張と、**独立した権威ある典拠で完全に一致する**。教科書ではこの OWASP の文言を引用して裏付けにできる。

またチートシートは「rendering context（HTML パーサ側）」と「execution context（JavaScript パーサ側）」を区別し、execution context の内部に **HTML / HTML 属性 / URL / CSS** の4つの「subcontext」があるという枠組みを採る。gihyo 第7回の「テキストノード用と属性値用でエスケープを考える」という話は、この subcontext 概念の一部に対応する。

### A-3. 危険な sink の公式リスト（RULE #1「Example Dangerous HTML Methods」より・逐語）

```javascript
// Attributes
 element.innerHTML = "<HTML> Tags and markup";
 element.outerHTML = "<HTML> Tags and markup";

// Methods
 document.write("<HTML> Tags and markup");
 document.writeln("<HTML> Tags and markup");
```

さらに本文中（RULE #3 の解説）に、**文字列をコードとして受け取る系の sink** が明示されている（逐語）:

> "Other JavaScript methods which take code as a string types will have a similar problem as outline above (`setTimeout`, `setInterval`, new Function, etc.)."

→ **gihyo 第7回が取り上げる5系統（`document.write`/`writeln`, `eval`, `setTimeout`/`setInterval`, `Function`, jQuery）のうち、jQuery 以外の4系統が OWASP 公式でも同じ危険 sink として挙がっている**ことが確認できた。これは本ノートの sink 一覧の妥当性を独立に裏付ける。

### A-4. GUIDELINE #1〜#10 のうち第7回に直結するもの（逐語・要点）

| GUIDELINE | 内容（逐語または逐語に近い要約） | gihyo 第7回との対応 |
| --- | --- | --- |
| #1 | "Untrusted data should only be treated as displayable text" / "Avoid treating untrusted data as code or markup within JavaScript code." | 全 sink に共通する大原則 |
| #3 | "`document.createElement("...")`, `element.setAttribute("...","value")`, `element.appendChild(...)` and similar are safe ways to build dynamic interfaces." ただし **"`element.setAttribute` is only safe for a limited number of attributes."**「危険な属性は `onclick` や `onblur` のようなコマンド実行コンテキストになる属性すべて」 | **第7回の結論「`document.write` をやめて DOM 操作 API を使う」の公式版**。ただし OWASP は「DOM API なら無条件に安全」ではなく `setAttribute` の属性名に制限があると明示している点が重要 |
| #4 | "Avoid sending untrusted data into HTML rendering methods": `element.innerHTML`, `element.outerHTML`, `document.write(...)`, `document.writeln(...)` の4つを列挙 | 第7回 `document.write` 節に対応 |
| #5 | "Avoid the numerous methods which implicitly `eval()` data passed to it" — 渡す場合は (1) 文字列デリミタで区切る (2) クロージャで包むか使用に応じて N 段 JavaScript エンコードする (3) カスタム関数でラップする | 第7回 `setTimeout`/`eval`/`Function` 節に対応 |
| #6 | "Use untrusted data on only the right side of an expression, especially data that looks like code and may be passed to the application (e.g., `location` and `eval()`)." | 第6回の `location` 代入の話に対応 |
| #10 | **"Don't `eval()` JSON to convert it to native JavaScript objects. Use the built-in `JSON.parse()` ... `JSON.parse()` rejects anything that is not valid JSON, so it cannot execute attacker-supplied code the way `eval()` can."** | **第7回 `eval` 節（`eval("(" + json + ")")` → `JSON.parse`）と完全に一致する公式勧告** |

### A-5. `JSON.stringify` に関する重要な警告（GUIDELINE #10 の WARNING ブロック・逐語）

> "`JSON.stringify()` is **not** an output-encoding function. Its output is valid JSON but is not safe to embed directly in an HTML, HTML-attribute, or inline `<script>` context — characters like `<`, `>`, `&`, `"`, `'` ... can break out of the surrounding context and enable XSS. When embedding the output of `JSON.stringify()` in a page, either (a) deliver it as a separate JSON response and parse it client-side with `JSON.parse()`, or (b) HTML-encode (or JavaScript-string-encode, depending on the sink) the serialized string before injecting it."

**教科書への示唆**: 「`eval` の代わりに `JSON.parse`」だけを教えると、逆方向（オブジェクト→ページ埋め込み）で `JSON.stringify` を安全だと誤解する読者が出る。**2016年の gihyo 記事には無い論点**なので、教科書側で補うべき重要な〔補足〕である。

### A-6. RULE #6 / RULE #7 — 安全な sink に置き換えるのが正解（逐語）

RULE #6:
> "The most fundamental safe way to populate the DOM with untrusted data is to use the safe assignment property `textContent`."

```html
<script>
element.textContent = untrustedData;  //does not execute code
</script>
```

RULE #7（逐語、強調は原文）:
> "The best way to fix DOM based cross-site scripting is to use the right output method (sink). For example if you want to use user input to write in a `div tag` element don't use `innerHtml`, instead use `innerText` or `textContent`. This will solve the problem, and it is the right way to re-mediate DOM based XSS vulnerabilities."
>
> "**It is always a bad idea to use a user-controlled input in dangerous sources such as eval. 99% of the time it is an indication of bad or lazy programming practice, so simply don't do it instead of trying to sanitize the input.**"

修正後コードの例（逐語）:
```html
<b>Current URL:</b> <span id="contentholder"></span>
...
<script>
document.getElementById("contentholder").textContent = document.baseURI;
</script>
```

**これは gihyo 第7回の結論（「エスケープを頑張るのではなく `document.write` をやめる」）と同じ思想であり、教科書ではこの OWASP RULE #7 を主典拠にするのが最も安全**（原典逐語引用を回避できる）。

### A-7. `setTimeout` をクロージャで書き換える公式パターン（"Utilizing an Enclosure" より・逐語）

```javascript
 var ESAPI = require('node-esapi');
 setTimeout((function(param) { return function() {
          customFunction(param);
        }
 })("<%=ESAPI.encoder().encodeForJavascript(untrustedData)%>"), y);
```

対比として、文字列を渡す「N 段エンコード」方式（逐語）:
```javascript
setTimeout("customFunction('<%=doubleJavaScriptEncodedData%>', y)");
function customFunction (firstName, lastName)
     alert("Hello" + firstName + " " + lastName);
}
```
> "The `doubleJavaScriptEncodedData` has its first layer of JavaScript encoding reversed (upon execution) in the single quotes. Then the implicit `eval` of `setTimeout` reverses another layer of JavaScript encoding to pass the correct value to `customFunction`"

さらに、`customFunction` の中でまた `eval` 系に渡すなら**三重**エンコードが必要になり、二重・三重エンコードされた値は `if` の文字列比較で false になる、という落とし穴まで書かれている。

**教科書への示唆**: gihyo 第7回が「IE9 互換が必要ならクロージャを使う」と書いていた点は、OWASP でも**クロージャこそが推奨で、文字列＋N段エンコードは破綻しやすい**という形で裏付けられる。「なぜ文字列を渡してはいけないか」を N 段エンコードの破綻として説明できるので、教科書の説明力が上がる。

### A-8. 「安全そうに見えて安全でない」— `innerText` の罠（"Usually Safe Methods" より・逐語）

> "One example of an attribute which is thought to be safe is `innerText`. Some papers or guides advocate its use as an alternative to `innerHTML` to mitigate against XSS in `innerHTML`. However, depending on the tag which `innerText` is applied, code can be executed."

```html
<script>
 var tag = document.createElement("script");
 tag.innerText = "<%=untrustedData%>";  //executes code
</script>
```
> "The `innerText` feature was originally introduced by Internet Explorer, and was formally specified in the HTML standard in 2016 after being adopted by all major browser vendors."

**教科書への示唆**: 非常に重要な落とし穴。`textContent`/`innerText` は「要素が `<script>` でない限り安全」であって無条件安全ではない。gihyo 第6回の `textContent` 推奨をそのまま書くと読者が誤解するため、教科書ではこの反例を必ず添えるべき。

### A-9. `document.write` + `location.hash` の脆弱コード（"Detect DOM XSS using variant analysis" より・逐語）

```
<script>
var x = location.hash.split("#")[1];
document.write(x);
</script>
```
> "Semgrep rule to identify above dom xss [link](https://semgrep.dev/s/we30)."

**これは gihyo 第7回の `document.write` 節が扱っている脆弱パターンそのもの（source=`location.hash` → sink=`document.write`）である。** 原典のコードが取得できなかった本ノートにとって、**教科書に載せられる「本物の」脆弱例**として最も価値が高い。OWASP 出典として逐語引用可能。

---

## B. OWASP「Cross Site Scripting Prevention Cheat Sheet」（英語原文・全文取得済み）

- 取得元: `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.md`
- 公開ページ: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

DOM 版チートシートが「(assumes comprehension of) the XSS Prevention Cheatsheet」と明記している**前提文書**。gihyo 第7回の「サーバ側で行っていた XSS 対策と同じことを JavaScript で行う」という主張の、その「サーバ側の対策」に当たる部分。

### B-1. 【最重要】エスケープ対象文字と変換先の公式テーブル（逐語・"Output Encoding for HTML Contexts"）

```
&    &amp;
<    &lt;
>    &gt;
"    &quot;
'    &#x27;
```

"Output Encoding Rules Summary" にも再掲されている（逐語）:
> "Encoding Mechanism: Convert `&` to `&amp;`, Convert `<` to `&lt;`, Convert `>` to `&gt;`, Convert `"` to `&quot;`, Convert `'` to `&#x27`"

> **これは本ノート本体（「HTMLエスケープの基本方針」節）が WebSearch 要約から再構成した5文字の変換表と完全に一致する。** つまり**この変換表だけは、gihyo 原典に依存せず OWASP 公式を典拠に教科書へ堂々と載せられる**。特に `'` を（`&apos;` ではなく）`&#x27;` にするという細部まで一致しており、本ノートの再構成の信頼性を裏付ける。

### B-2. Dangerous Contexts — エスケープしても守れない場所（逐語）

> "Output encoding is not perfect. It will not always prevent XSS. These locations are known as **dangerous contexts**."

```HTML
<script>Directly in a script</script>
<!-- Inside an HTML comment -->
<style>Directly in CSS</style>
<div ToDefineAnAttribute=test />
<ToDefineATag href="/test" />
```
> "Other areas to be careful with include: Callback functions / Where URLs are handled in code such as this CSS { background-url : "javascript:alert(xss)"; } / All JavaScript event handlers (`onclick()`, `onerror()`, `onmouseover()`). / **Unsafe JS functions like `eval()`, `setInterval()`, `setTimeout()`**"
>
> "Don't place variables into dangerous contexts as even with output encoding, it will not prevent an XSS attack fully."

**教科書への示唆**: gihyo 第7回の「`eval`/`setTimeout` にはそもそも攻撃者制御文字列を渡さない」という結論の根拠がここにある。**エスケープは万能ではなく、コンテキストによっては無効**という一段深い説明を教科書に入れられる。

### B-3. Safe Sinks の公式リスト（逐語）

> "Security professionals often talk in terms of sources and sinks. If you pollute a river, it'll flow downstream somewhere. It's the same with computer security. XSS sinks are places where variables are placed into your webpage."
>
> "Thankfully, many sinks where variables can be placed are safe. This is because these sinks treat the variable as text and will never execute it. Try to refactor your code to remove references to unsafe sinks like innerHTML, and instead use textContent or value."

```js
elem.textContent = dangerVariable;
elem.insertAdjacentText(dangerVariable);
elem.className = dangerVariable;
elem.setAttribute(safeName, dangerVariable);
formfield.value = dangerVariable;
document.createTextNode(dangerVariable);
document.createElement(dangerVariable);
elem.innerHTML = DOMPurify.sanitize(dangerVar);
```

安全な HTML 属性の公式列挙（`setAttribute` の `safeName` に当たるもの。逐語）: `align`, `alink`, `alt`, `bgcolor`, `border`, `cellpadding`, `cellspacing`, `class`, `color`, `cols`, `colspan`, `coords`, `dir`, `face`, `height`, `hspace`, `ismap`, `lang`, `marginheight`, `marginwidth`, `multiple`, `nohref`, `noresize`, `noshade`, `nowrap`, `ref`, `rel`, `rev`, `rows`, `rowspan`, `scrolling`, `shape`, `span`, `summary`, `tabindex`, `title`, `usemap`, `valign`, `value`, `vlink`, `vspace`, `width`
> "For attributes not reported above, ensure that if JavaScript code is provided as a value, it cannot be executed."

**→ 本ノート本体の「source / sink 早見表」の「安全側の API」行を、この公式リストで置き換え・補強できる（一般知識ではなく OWASP 出典になる）。**

### B-4. HTML を許可したい場合＝サニタイズ（逐語）

> "When users need to author HTML, developers may let users change the styling or structure of content inside a WYSIWYG editor. Output encoding in this case will prevent XSS, but it will break the intended functionality of the application. The styling will not be rendered. In these cases, HTML Sanitization should be used."
>
> "HTML Sanitization will strip dangerous HTML from a variable and return a safe string of HTML. **OWASP recommends [DOMPurify](https://github.com/cure53/DOMPurify) for HTML Sanitization.**"

```js
let clean = DOMPurify.sanitize(dirty);
```
注意点（逐語）:
> "- If you sanitize content and then modify it afterwards, you can easily void your security efforts.
> - If you sanitize content and then send it to a library for use, check that it doesn't mutate that string somehow. Otherwise, again, your security efforts are void.
> - You must regularly patch DOMPurify or other HTML Sanitization libraries that you use. Browsers change functionality and bypasses are being discovered regularly."

**教科書への示唆**: gihyo 第7回は「エスケープするか、DOM API を使う」の二択で終わっている（＝ユーザに HTML を書かせたいケースの答えが無い）。**サニタイズという第三の道**は教科書で必ず補うべき論点。

---

## C. JPCERT/CC による OWASP DOM ベース XSS チートシート日本語訳（全文取得済み）

- 取得元: `https://raw.githubusercontent.com/JPCERTCC/OWASPdocuments/master/CheatSheets/DOMbasedXSSPrevention.html`
- 公開ページ（読者向け・**本環境からは遮断**）: https://jpcertcc.github.io/OWASPdocuments/CheatSheets/DOMbasedXSSPrevention.html
- リポジトリ: https://github.com/JPCERTCC/OWASPdocuments

### C-1. 日本語の定訳（実ファイルの見出しそのまま）

教科書の用語統一に使える、**JPCERT/CC 公認の日本語訳語**。

| 英語原文 | JPCERT/CC 訳 |
| --- | --- |
| DOM based XSS Prevention Cheat Sheet | DOM ベース XSS 対策チートシート |
| Example Dangerous HTML Methods | 危険な HTML メソッドの例 |
| RULE #1 | ルール 1: 信頼できないデータを実行コンテキスト内の HTML サブコンテキストに挿入する前に HTML エスケープし、JavaScript エスケープする |
| RULE #2 | ルール 2: 信頼できないデータを実行コンテキスト内の HTML 属性サブコンテキストに挿入する前に JavaScript エスケープする |
| RULE #3 | ルール 3: 信頼できないデータを実行コンテキスト内のイベントハンドラーサブコンテキストや JavaScript コードサブコンテキストに挿入するときは注意が必要 |
| SAFE but BROKEN example | 安全ながら表示が崩れる例 |
| SAFE and FUNCTIONALLY CORRECT example | 完全で機能的にも適切な例 |
| HTML Encoding's Disarming Nature | HTML エンコードが持つ安全化という性質 |
| RULE #4 | ルール 4: 信頼できないデータを実行コンテキスト内の CSS 属性サブコンテキストに挿入する前に JavaScript エスケープする |
| RULE #5 | ルール 5: 信頼できないデータを実行コンテキスト内の URL 属性サブコンテキストに挿入する前に、URL エスケープし、さらに JavaScript エスケープする |
| RULE #6 | ルール 6: DOM にデータを入力するときには安全な JavaScript 関数またはプロパティを使用する |
| Common Problems Associated with Mitigating DOM Based XSS | DOM ベースの XSS 軽減に関連する一般的な問題 |
| Complex Contexts | 複雑なコンテキスト |
| Inconsistencies of Encoding Libraries | エンコードライブラリの不整合 |
| Encoding Misconceptions | エンコードに関する誤解 |
| Usually Safe Methods | 通常は安全なメソッド |
| （execution context / subcontext） | 実行コンテキスト / サブコンテキスト |
| （untrusted data） | 信頼できないデータ |

### C-2. 【重要な注意】この日本語訳は古い版である

取得したファイルの見出しを検証した結果、**日本語訳は `ルール 1`〜`ルール 6` までしか存在せず、英語原文にある `RULE #7 - Fixing DOM Cross-site Scripting Vulnerabilities` と `GUIDELINE #1`〜`#10` の番号付き見出しが無い**（「JavaScript を使用してセキュアなアプリケーションを開発するためのガイドライン」という親見出しのみ）。また旧 OWASP Wiki 由来のページ構造（`Navigation menu` / `Personal tools` / `Namespaces` / `Variants` などの Wiki UI 要素が HTML 内に残存）である。

> **後工程への申し送り**: 日本語訳は**用語の対訳表としてのみ**使い、**技術的内容は必ず英語原文（上記 A）を典拠にすること**。特に本ノートが最も重視する `RULE #7`（＝「正しい sink に変えるのが正解」）と `GUIDELINE #10`（＝`JSON.parse` を使う）は**日本語訳には無い**ので、日本語訳を典拠に書くと誤りになる。

---

# 【補完工程】gihyo 連載に関する独立した裏付け（第三者の日本語資料・全文取得済み）

原典本文は取得できなかったが、**連載の著者・扱う範囲・DOM-based XSS を後半で深く扱っているという構成**については、第三者の日本語資料から独立に裏付けが取れた。いずれも `raw.githubusercontent.com` 経由で実際に全文取得している。

## D. 脆弱性診断士スキルマッププロジェクト（OWASP Japan × JNSA）による連載の紹介・評価

- 出典: `WebAppPentestGuidelines/WebAppPentestGuidelines` リポジトリの `README.md`
  - 取得元: `https://raw.githubusercontent.com/WebAppPentestGuidelines/WebAppPentestGuidelines/master/README.md`
  - リポジトリ: https://github.com/WebAppPentestGuidelines/WebAppPentestGuidelines
- 文書名: **「Webアプリケーション脆弱性診断ガイドライン 第1.2版」**（by 脆弱性診断士スキルマッププロジェクト＝特定非営利活動法人日本ネットワークセキュリティ協会 日本セキュリティオペレーション事業者協議会 セキュリティオペレーションガイドラインWG（WG1）と OWASP Japan の共同WG、代表 上野宣）
- 当該記述は README の「ガイドラインを使いこなすためのリンク集 > 開発系」の**冒頭（第1項目）**に置かれている

**逐語引用**（リンク先は `http://gihyo.jp/dev/serial/01/javascript-security`）:

> 「[JavaScriptセキュリティの基礎知識](http://gihyo.jp/dev/serial/01/javascript-security)
>
> はせがわようすけさんがJavaScriptに関連するセキュリティ上の問題について解説されている記事です。XSS、CSRFなどの受動的攻撃の手法や対策、Webアプリケーションを考える上にて必要となる基礎技術であるURLとオリジンについて学ぶことができます。また、本連載の後半ではDOM-based XSSに関して深い解説をされており、脆弱性を生まないための実装方法などについても記載されています。」

### この引用から**確実に裏付けられた**事実

1. **著者は「はせがわようすけ」** ← 本ノートの記載と一致（独立確認）。
2. 連載は **XSS・CSRF などの受動的攻撃の手法と対策**を扱う ← 本ノートの第2回・第3回の記載と一致。
3. 連載は **URL とオリジン**を「Webアプリケーションを考える上で必要となる基礎技術」として扱う ← 本ノートの第4回「URLとオリジン」・第5回「問題を発生させにくくするURLの扱い方」の記載と一致。
4. **「本連載の後半では DOM-based XSS に関して深い解説をされており、脆弱性を生まないための実装方法などについても記載されています」** ← 本ノートの「第6・7・8回が DOM-based XSS 3部作」「第7回は sink ごとの危険な書き方と対策（＝実装方法）を示す」という構成理解と一致（独立確認）。**「実装方法」に言及している点は、第7回がエスケープ関数や安全な書き換え方といった具体的コードを含むことの間接的裏付けでもある。**
5. この連載は**日本のプロの脆弱性診断士向けガイドラインが推奨する開発系の必読資料の第1項目**である＝教科書で扱う価値の高さが第三者評価として裏付けられた。

> ただし**第7回単体の節構成・扱う5系統の sink・公開日（2016-11-16）については、この資料は何も述べていない**。それらの本ノートの記載は依然として WebSearch 要約のみに依拠しており、格上げしていない。

## E. js-primer（Jsプライマー）2016-07-29 ミーティング議事録 — 連載の同時代的な位置づけ

- 出典: `js-primer/js-primer` リポジトリの `meetings/2016-07-29/README.md`
  - 取得元: `https://raw.githubusercontent.com/js-primer/js-primer/master/meetings/2016-07-29/README.md`
  - リポジトリ: https://github.com/js-primer/js-primer （azu 氏らによる日本語 JavaScript 入門書プロジェクト）

**逐語引用**（「XSSについて - @laco」節）:

> 「- @laco: エスケープの話をajaxで出している
> - DOM-based XSSの話をどこまでするか、どうするかの件 せめてリンクは出してあげたいが参考リンクがない
> - @azu: 海外だとOWASP
> - MDNも簡単な解説しかない
> - [クロスサイトスクリプティング - 用語集 | MDN](https://developer.mozilla.org/ja/docs/Glossary/Cross-site_scripting)
> - hasegawaさんが最近連載してる
> - [JavaScriptセキュリティの基礎知識：連載｜gihyo.jp … 技術評論社](http://gihyo.jp/dev/serial/01/javascript-security)
> - hasegawaさんが本とか書いてくれると…
> - [安全なウェブサイトの作り方：IPA 独立行政法人 情報処理推進機構](https://www.ipa.go.jp/security/vuln/websecurity.html)
>
> ### 結論
> - いいリンクを募集中」

### この引用から裏付けられた事実と、教科書に使える文脈

1. **2016年7月29日時点で連載が進行中だった**（「hasegawaさんが最近連載してる」）← 本ノートの「連載開始 2016-06-14」と整合する（証明ではないが矛盾しない）。
2. **2016年当時、DOM-based XSS の日本語の参考資料がほぼ存在しなかった**——日本語 JavaScript 入門書を書いているチームが「せめてリンクは出してあげたいが参考リンクがない」「海外だとOWASP」「MDNも簡単な解説しかない」と述べ、結論が「いいリンクを募集中」で終わっている。
3. **その空白を埋める資料として、はせがわ氏の gihyo 連載が挙げられている。**

> **教科書への示唆（強く推奨）**: この議事録は、**本教科書が扱う第7回の歴史的意義を説明する一次資料**として非常に価値が高い。「2016年、日本語圏には DOM-based XSS のまとまった解説が無く、OWASP（英語）を読むしかなかった。その状況で書かれたのがこの連載である」という導入を、実在する議事録の逐語引用で裏付けられる。同時に「だから本教科書では、当時無かった現代的な対策（サニタイズ、Trusted Types、CSP）を補って書く」という本書の立て付けの説明にもなる。

---

# 【補完工程】2016年→現在のギャップを埋める公式資料（全文取得済み）

本ノート本体の申し送りが「`DOMPurify` や Trusted Types・CSP `require-trusted-types-for` への言及が無い（当時未普及）という時代背景を教科書側で〔補足〕として補うべき」と指摘していた点について、**公式 README を実取得したので具体的に埋める**。

## F. DOMPurify（OWASP 推奨の HTML サニタイザ）

- 取得元: `https://raw.githubusercontent.com/cure53/DOMPurify/main/README.md`
- リポジトリ: https://github.com/cure53/DOMPurify
- 開発: Cure53（DOM-based XSS 研究で知られるドイツのセキュリティ企業）

基本的な使い方（逐語）:
```js
const clean = DOMPurify.sanitize(dirty);
```

### F-1. レガシーブラウザでの挙動 —— 2016年の記事との接続点（逐語）

> （"What about legacy browsers like Internet Explorer?"）"DOMPurify does nothing at all. It simply returns exactly the string that you fed it. DOMPurify exposes a property called `isSupported`, which tells you whether it will be able to do its job, so you can come up with your own backup plan."

**教科書への示唆**: gihyo 第7回が IE9 を気にしていた2016年当時、DOMPurify は「IE では何もしない＝素の文字列をそのまま返す」ため IE 対応案件では使えなかった。**これが「2016年の記事がサニタイズを選択肢に挙げていない」ことの技術的な理由づけになる**（推測ではなく、DOMPurify 公式の仕様として説明できる）。

### F-2. Trusted Types との連携（逐語）

> "In version 1.0.9, support for the [Trusted Types API](https://github.com/w3c/webappsec-trusted-types) was added to DOMPurify. In version 2.0.0, a config flag was added to control DOMPurify's behavior regarding this."
>
> "When `DOMPurify.sanitize` is used in an environment where the Trusted Types API is available and `RETURN_TRUSTED_TYPE` is set to `true`, it tries to return a `TrustedHTML` value instead of a string"

デフォルトポリシーの実装例（逐語）:
```js
window.trustedTypes.createPolicy('default', {
  createHTML: (to_escape) =>
    DOMPurify.sanitize(to_escape, { RETURN_TRUSTED_TYPE: false }),
});
```
> "When no `TRUSTED_TYPES_POLICY` is supplied, DOMPurify attempts to create its own internal Trusted Types policy named `dompurify`. If your page already defines its own policy together with a strict CSP (for example `trusted-types my-organization`) that does not allow a policy named `dompurify`, this attempt is blocked by the browser and logs a `TrustedTypes policy dompurify could not be created.` warning along with a CSP violation."

## G. Trusted Types（W3C）—— sink を型で守るという発想

- 取得元: `https://raw.githubusercontent.com/w3c/trusted-types/main/README.md`
- リポジトリ: https://github.com/w3c/trusted-types
- 仕様ドラフト: https://w3c.github.io/trusted-types/dist/spec/
- 開発者向け解説: https://web.dev/trusted-types/
- 対応状況: https://caniuse.com/trusted-types

ブラウザ対応（逐語）:
> "[Browser Support](https://caniuse.com/trusted-types) - The API is available natively in browsers based on Chromium version 83 and up."

CSP による強制の書き方（README のポリフィル利用例より逐語）:
```html
<script src="https://w3c.github.io/trusted-types/dist/es5/trustedtypes.build.js" data-csp="trusted-types foo bar; require-trusted-types-for 'script'"></script>
<script>
    trustedTypes.createPolicy('foo', ...);
    trustedTypes.createPolicy('unknown', ...); // throws
    document.body.innerHTML = 'foo'; // throws
</script>
```
API のみ（強制なし）の場合（逐語）:
```html
<script src="https://w3c.github.io/trusted-types/dist/es5/trustedtypes.api_only.build.js"></script>
<script>
     const p = trustedTypes.createPolicy('foo', ...)
     document.body.innerHTML = p.createHTML('foo'); // works
     document.body.innerHTML = 'foo'; // but this one works too (no enforcement).
</script>
```

**教科書への示唆（本教科書の締めとして最適）**: gihyo 第7回の結論は「エスケープ漏れが1か所でもあれば破綻するから、そもそも危険な sink を使うな」という**規律による対策**だった。Trusted Types はまさにこの規律を**ブラウザに強制させる**仕組みである（`require-trusted-types-for 'script'` を CSP で指定すると、生文字列を `innerHTML` 等に代入した時点で例外になる）。**「2016年に人間の規律として書かれた提言が、2020年代にプラットフォームの機能として実装された」**という物語で第7回を現代につなげられる。Chromium 83+ でネイティブ対応、それ以前・他ブラウザはポリフィル、という対応状況も公式 README から書ける。


---

# 【補完工程】教科書執筆戦略の更新（後工程への申し送り・最重要）

## 執筆戦略の推奨

補完工程で OWASP 公式2本の全文が手に入ったため、**執筆戦略を切り替えることを強く推奨する**。

**推奨戦略: 「gihyo 第7回の構成を骨格に、OWASP 公式を典拠に本文を書く」**

- 章の**構成・切り口・問題意識**は gihyo 第7回に従う（sink を5系統に分けて順に扱う／「エスケープを頑張るのではなく危険な sink をやめる」という結論に着地させる）。この構成自体は WebSearch で複数クエリが一致しており、かつ第三者資料（【補完工程】D節）が「脆弱性を生まないための実装方法」に言及していることで裏付けられている。
- 一方で**技術的な記述・コード・逐語引用はすべて OWASP 公式（【補完工程】A・B節）から取る**。これにより「原典未取得なのにコードを書いている」という問題が完全に解消し、かつ逐語引用可能な典拠が付く。
- 教科書での書き方の例:
  > 「はせがわようすけ『JavaScriptセキュリティの基礎知識』第7回「DOM-based XSS その2」（gihyo.jp, 2016年）は、DOM-based XSS の原因となる sink を `document.write`／`eval`／`setTimeout`・`setInterval`／`Function`／jQuery の5系統に分けて解説し、いずれについても最終的には『エスケープを徹底する』のではなく『危険な sink そのものを使わない』という結論を示している（https://gihyo.jp/dev/serial/01/javascript-security/0007 ）。同じ結論は OWASP のチートシートでも RULE #7 として明示されている——"The best way to fix DOM based cross-site scripting is to use the right output method (sink)."（OWASP DOM based XSS Prevention Cheat Sheet）」

**逐語引用可能になった要素の一覧**（すべて本工程で実ファイルを取得・確認済み）:

| 教科書に載せたい要素 | 使える典拠 | ノート内の該当節 |
| --- | --- | --- |
| エスケープ5文字の変換表 | OWASP XSS Prevention Cheat Sheet（gihyo 再構成と完全一致） | B-1 |
| `document.write` + `location.hash` の脆弱コード | OWASP DOM チートシート "variant analysis" 節 | A-9 |
| 危険 sink の列挙（`innerHTML`/`outerHTML`/`write`/`writeln`） | OWASP DOM チートシート RULE #1・GUIDELINE #4 | A-3, A-4 |
| `setTimeout`/`setInterval`/`new Function` が同種の危険 sink であること | OWASP DOM チートシート本文（逐語） | A-3 |
| `eval` でなく `JSON.parse` を使う理由 | OWASP GUIDELINE #10（逐語） | A-4 |
| `setTimeout` のクロージャ書き換えパターン | OWASP "Utilizing an Enclosure"（逐語コード） | A-7 |
| 「危険な sink をやめるのが正解」という結論 | OWASP RULE #6・RULE #7（逐語） | A-6 |
| 安全な sink のリスト | OWASP XSS Prevention "Safe Sinks"（逐語コード） | B-3 |
| DOM-based XSS とサーバ側 XSS の違い | OWASP Introduction（逐語） | A-2 |
| 日本語の定訳 | JPCERT/CC 訳（ただし古い版。用語のみ） | C-1, C-2 |
| 連載の著者・扱う範囲の客観的評価 | 脆弱性診断士スキルマッププロジェクト（逐語） | D |
| 2016年に日本語資料が無かったという時代背景 | js-primer 2016-07-29 議事録（逐語） | E |

**教科書に必ず補うべき、gihyo 第7回に無い論点**（いずれも本工程で典拠を確保済み）:

1. **`textContent`/`innerText` は無条件安全ではない**——`<script>` 要素に対して使うとコードが実行される（A-8、OWASP 逐語コードあり）。第6回の `textContent` 推奨をそのまま書くと読者を誤解させる。
2. **`JSON.stringify` は出力エンコード関数ではない**——「`eval` の代わりに `JSON.parse`」だけ教えると逆方向で事故る（A-5、OWASP の WARNING ブロック）。
3. **エスケープが効かない「dangerous contexts」が存在する**——`<script>` 内・HTML コメント内・`<style>` 内・属性名位置・タグ名位置、および `eval`/`setTimeout`/`setInterval`（B-2）。これが第7回の「そもそも渡さない」という結論の根拠になる。
4. **ユーザに HTML を書かせたい場合はサニタイズ（DOMPurify）**——第7回はこのケースの答えを持っていない（B-4、F）。
5. **`setAttribute` は属性名を選ばないと安全でない**——OWASP は安全な属性名を明示列挙している（A-4 の GUIDELINE #3、B-3）。「DOM API なら安全」と単純化してはいけない。
6. **Trusted Types による sink の型強制**——第7回の「人間の規律」を「ブラウザによる強制」に置き換える現代の仕組み。Chromium 83+ ネイティブ対応、CSP `require-trusted-types-for 'script'`（G）。**本章の締めに最適。**
7. **DOMPurify は IE では何もしない**——2016年当時サニタイズが選択肢になり得なかった技術的理由（F-1）。「なぜ当時の記事はサニタイズに触れないのか」を推測でなく事実として説明できる。

## 残る未解決事項（後工程が把握しておくべき限界）

以下は**本工程を経てもなお未検証**であり、教科書に断定的に書いてはならない。

- **第7回の公開日 2016-11-16**——WebSearch 要約のみが根拠。js-primer 議事録（2016-07-29 に「最近連載してる」）と整合はするが、証明ではない。教科書では「2016年」とだけ書くのが安全。
- **連載各回の個別の公開日**（第1〜8回の日付すべて）——同上。
- **第7回の節見出しの正確な文言**、および**節の順序**。
- **第7回が本当に5系統の sink のみを扱っているか**（他に節がある可能性。特に `?page=2` 以降の内容は完全に不明）。
- **jQuery 節の記述の詳細**——OWASP チートシートは jQuery に言及していないため、**jQuery に関する記述だけは代替典拠が無い**。教科書で jQuery を扱うなら、jQuery 公式ドキュメントや別途の典拠を後工程で探す必要がある（本工程では WebSearch 予算切れで未実施）。
- **記事中の `htmlEscape` 関数の実際の実装**（関数名すら WebSearch 要約由来）。**教科書では OWASP の変換表を典拠に独自実装として書くこと。**
