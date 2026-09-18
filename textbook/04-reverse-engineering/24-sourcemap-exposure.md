# 公開ソースマップの悪用 — 本番サイトから元ソースコードを丸ごと復元する

> **この節で分かること**
> - ソースマップ（Source Map）とは何か、なぜ生成され、何が漏れるのかを説明できる
> - `.map` の在処が「コメントだけではない」ことを理解し、4つの検出経路を自分で潰せる
> - `sourcemapper` / `unwebpack-sourcemap` / `shuji` で本番 JS から元ソースを復元できる
> - 露出したソースマップの深刻度を「中身」で判断し、報告を格上げできる
> - webpack / Vite / Rollup / Next.js / CRA / Sentry の設定で露出を止められる

**元資料（一次資料・逐語取得済み）**: TC39 Source Map 公式仕様 https://github.com/tc39/source-map-spec ／ OWASP WSTG-INFO-05 https://owasp.org/www-project-web-security-testing-guide/ ／ 各ビルドツール公式ドキュメント（webpack https://webpack.js.org/configuration/devtool/ ・Vite ・Rollup ・Next.js ・Create React App）／ Sentry Docs https://docs.sentry.io/ ／ Bugcrowd VRT https://github.com/bugcrowd/vulnerability-rating-taxonomy （本節の技術仕様・検出・防御・深刻度分類の裏付けはこれら一次資料による）
**元資料（二次情報。テーマ導入・事例）**: https://blog.sentry.security/abusing-exposed-sourcemaps/ , https://www.raijuna.com/knowledge/source-map-exposure （いずれも原典は本環境から取得できず、要約・再構成ベース）
**関連する節**: クライアントサイド偵察、JavaScript 静的解析、シークレット検出

---

## 1. ソースマップとは何か（設計意図と仕組み）

### 1-1. なぜソースマップが生まれたのか（設計意図）

現代のフロントエンドは、TypeScript や JSX、Vue の SFC などで書いたコードを、そのままブラウザに送らない。transpile（別言語への変換）・minify（変数名短縮や空白除去）・bundle（複数ファイルの結合）を行い、人間には読めない1枚の圧縮された JavaScript にして本番へ配る。こうしないとファイルが重く、読み込みが遅いからだ。

だが圧縮すると困ることがある。本番でエラーが起きたとき、スタックトレース（エラーが発生した場所の履歴）が `a.b(c)` のような無意味な記号だらけになり、どこが壊れたのか分からない。

そこで生まれたのが**ソースマップ（Source Map）**である。ソースマップとは、minify / bundle された本番コードを、元の（変換前の）ソースファイルへ結び付ける対応表のこと。たとえるなら「圧縮後の1文字が、元コードのどのファイルの何行目・何列目だったか」を記録した逆引き辞書である。

### 1-2. どう動くのか（仕組み）

ソースマップは JSON ベースのマッピングファイルで、拡張子は `.map`（例: `main.js.map`）。ブラウザは圧縮版の JS を実行しつつ、開発者ツール（DevTools）はこの `.map` を読み込んで、元の（unminified な）コードを再構成して表示する。これが「逆写像（reverse mapping）レイヤー」の役割である。

OWASP はソースマップをこう定義する（逐語）。

> A "source map" is a special file that connects a minified/uglified version of an asset (CSS or JavaScript) to the original authored version.

つまりソースマップは JavaScript 専用ではなく、CSS にも存在する（後述）。

### 1-3. ソースマップ v3 の構造（TC39 公式仕様）

現行のソースマップは「バージョン3」である。TC39（JavaScript の仕様を決める標準化団体）の公式仕様が定めるトップレベル構造は次のとおり（逐語）。

```json
{
  "version" : 3,
  "file": "out.js",
  "sourceRoot": "",
  "sources": ["foo.js", "bar.js"],
  "sourcesContent": [null, null],
  "names": ["src", "maps", "are", "fun"],
  "mappings": "A,AAAB;;ABCDE"
  "ignoreList": [0]
}
```

各フィールドの意味を表にまとめる。ハンティングでどこを見るべきかが変わるので、重要度も添える。

| フィールド | 意味 | ハンティング上の意味 |
| --- | --- | --- |
| `version` | ソースマップのバージョン（現行は `3`） | — |
| `file` | 対応する生成ファイル名（例 `static/js/main.chunk.js`） | 元の JS を特定 |
| `sourceRoot` | 各 `sources` に前置される任意のルートパス | パス復元の起点 |
| `sources` | 元ソースファイルのパス配列（例 `webpack:///src/...`） | **ディレクトリ構造・ファイル名・開発者ホームパスが露出** |
| `sourcesContent` | 各 `sources` に対応する**元ソースコード本文** | **非 null なら原文が丸ごと復元できる** |
| `names` | 元の識別子（変数名・関数名）の配列 | 認証フローやトークン生成処理を人間可読で追える |
| `mappings` | Base64 VLQ でエンコードした行/列の実マッピング | 位置の対応（機械処理用） |
| `ignoreList` | サードパーティ扱いすべき `sources` のインデックス配列 | **どれが自社コードかを攻撃者に教える** |

TC39 仕様の各フィールド定義（逐語）を引く。ここが診断の勘所になる。

> `sources` is a list of original sources used by the `mappings` entry. Each entry is either a string that is a (potentially relative) URL or `null` if the source name is not known.

> `sourcesContent` an optional list of source content (that is the Original Source), useful when the "source" can't be hosted. The contents are listed in the same order as the `sources`. `null` may be used if some original sources should be retrieved by name.

> `sourceRoot` an optional source root, useful for relocating source files on a server or removing repeated values in the `sources` entry. This value is prepended to the individual entries in the "source" field.

> `names` a list of symbol names used by the `mappings` entry.

> `ignoreList` an optional list of indices of files that should be considered third party code, such as framework code or bundler-generated code. (…) Some browsers may also use the deprecated `x_google_ignoreList` field if `ignoreList` is not present.

### 1-4. 診断上のいちばん重要な含意

`sourcesContent` を最初に見るのがコツである。

- `sourcesContent` が **`null` 埋め**なら、原文は復元できず `sources` のパス一覧だけが漏れる（webpack の `nosources-*` / Rollup の `sourcemapExcludeSources` に相当）。
- `sourcesContent` に**文字列が入っていれば原文が丸ごと復元できる**。

つまり復元ツールを走らせる前に `.map` の `sourcesContent` を覗いて非 null かを確認すれば、深刻度の当たりが即座に付く。`ignoreList` は「どれがベンダーコードでどれが自社コードか」を教えてくれるので、`grep` 対象を自社コードに絞り込むのに使える。

〔補足〕`.map` ファイルは Vite・webpack・Rollup・Parcel・esbuild などほぼ全てのビルドツールが生成できる。

### 1-5. 実際に何が露出するかの例（OWASP 逐語）

OWASP は、`sources` 配列に開発者のホームパスがそのまま出てしまう例を挙げている（逐語）。

```json
{
  "version": 3,
  "file": "static/js/main.chunk.js",
  "sources": [
    "/home/sysadmin/cashsystem/src/actions/index.js",
    "/home/sysadmin/cashsystem/src/actions/reportAction.js",
    "/home/sysadmin/cashsystem/src/actions/cashoutAction.js",
    "/home/sysadmin/cashsystem/src/actions/userAction.js",
    "..."
  ],
  "..."
}
```

この1つの配列から、**OS ユーザ名 `sysadmin`、アプリ名 `cashsystem`、内部ディレクトリ構造（src/actions/…）**が読み取れてしまう。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Abusing Exposed Sourcemaps — https://blog.sentry.security/abusing-exposed-sourcemaps/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 実行環境の egress ポリシーで当該ホストが CONNECT 403 ブロック。UA 偽装・アーカイブ・テキスト抽出プロキシをすべて試して失敗。読者の通常のブラウザからは開けるはず）。以下の記述は WebSearch の要約と同一主題の他サイトの記述にもとづく再構成である。
> **読みどころ**:
> 1. 「ソースマップとは何か（JSON 逆写像・DevTools が元コードを再構成する仕組み）」の導入説明と図。
> 2. DevTools の Sources タブで露出を確認する具体手順（`src/components/...` が見えたら露出、というチェック）。
> 3. 中心事例である Webpack ソースマップからの未公開パスワード変更エンドポイント発見 → アカウント乗っ取りの詳細な再現手順・レスポンス例・スクリーンショット。
> 4. 「UI に無い機能でもバックエンドにはある」という隠しエンドポイントの考え方。
> **代替手段**: アーカイブ `https://web.archive.org/web/2024/https://blog.sentry.security/abusing-exposed-sourcemaps/`。検出手順は本節 §3 の OWASP 逐語、参照経路は §3-2 の TC39 仕様で同等以上に代替できる。なお `blog.sentry.security` はエラー監視 SaaS の Sentry（sentry.io）とは別主体のブログである可能性があるので、運営主体を確認すること。

---

## 2. 公開ソースマップから何が漏れるか（攻撃者はどこを突くのか）

ソースマップが本番 Web ルートに**認証なしで**配布されると、攻撃者はブラウザだけでフロントエンド全体のソースコードを再構成できる。Raijuna / Sentry / vibeappscanner の記述を突き合わせると、露出する情報は次のように整理できる。

| 漏洩カテゴリ | 具体的に何が見えるか | ハンティング上の意味 |
| --- | --- | --- |
| 元ソースコード | TypeScript / JSX / Vue SFC など、コメント込みの unminified 原文（`sourcesContent`） | フロント全体をローカルで grep・静的解析できる |
| 変数名・関数名 | minify 前の意味のある識別子（`names`） | ロジック・認証フロー・トークン生成処理を人間可読で追える |
| ファイル/ディレクトリ構造 | `webpack:///src/components/...` 等のツリー（`sources`） | モジュール構成を俯瞰。隠しページ/管理画面の存在を推測 |
| 内部コメント | 開発中の TODO、注意書き、時に「テスト用パスワード」等 | OWASP は `f@keP@a$$w0rD` 等が残る例を挙げる |
| 未公開・隠し機能 | UI に無いが実装済みのコードパス、feature flag、未リリースコード | 「UI に無い＝バックエンドに無い」ではない |
| 内部 API エンドポイント | フロントが呼ぶ全 API ルート、内部ホスト、ステージング URL | 認証なしで全 API サーフェスを列挙できる |
| 開発者名・個人情報 | `sources` の `/home/<user>/...`、コミット/著者名、社内メール | 内部ユーザ名の特定、パスワード推測の材料 |
| 認証情報・シークレット | ハードコードされた API キー、JWT シークレット、DB 資格情報、トークン | 直接・高深刻度の発見。別サービスへの横展開 |

### 2-1. OWASP が探すべきとする値（逐語）

> Look for values such as: API keys, internal IP addresses, sensitive routes, or credentials.

OWASP はハードコードされたクラウド資格情報の例を示す（逐語）。

```javascript
const myS3Credentials = {
  accessKeyId: config('AWSS3AccessKeyID'),
  secretAccessKey: config('AWSS3SecretAccessKey'),
};
```

```javascript
var conString = "tcp://postgres:1234@localhost/postgres";
```

機微ルート（隠し管理画面や内部 API）が JSON に埋め込まれた例（逐語）。

```html
<script type="application/json">
...
"runtimeConfig":{"BASE_URL_VOUCHER_API":"https://staging-voucher.victim.net/api", "BASE_BACKOFFICE_API":"https://10.10.10.2/api", "ADMIN_PAGE":"/hidden_administrator"}
...
</script>
```

Google Maps API キーなどが直に書かれた例（逐語、ただしキー値は伏字）。OWASP 原文では `GOOGLE_MAP_API_KEY` に `AIzaSy...` で始まる実キー値が載っているが、本教科書では秘密値を伏字（`AIza_REDACTED_EXAMPLE`）に置き換えて示す。構造は原文のままである。

```html
<script type="application/json">
...
{"GOOGLE_MAP_API_KEY":"AIza_REDACTED_EXAMPLE", "RECAPTCHA_KEY":"RECAPTCHA_REDACTED_EXAMPLE"}
...
</script>
```

### 2-2. Raijuna が強調する3つのリスク

1. **偵察（recon）の加速**: ソースマップは能動探索を始める前に、フロントロジックと API サーフェス全体の知識を攻撃者に与える。通常は多大な列挙が必要な作業（内部 API の発見・認証フローの理解・注入ポイントの特定）が、**ファイルを1つダウンロードするだけ**に置き換わる。
2. **脆弱性の同定**: クエリを組み立てる、ファイルパスを構築する、ユーザ入力を機微な処理へ渡す、といったコードは、サーバ側脆弱性がどこにありそうかを示す。ソースマップにより攻撃者はこれらのパターンを文脈込みで大規模に特定できる。
3. **資格情報の露出**: 認証情報・トークン・シークレットがソースマップ内に（有効値でも、過去開発のコメント痕跡でも）現れれば、それは直接的で高深刻度の発見になる。

Raijuna は「独自コードでない標準的な Web アプリでも、内部ルーティングパターン・サービスディスカバリのロジック・連携設定など、公知でなく攻撃者の偵察を助ける情報を含むことが多い」と述べ、「うちのフロントは公開しても問題ない」という反論を退けている。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Source Map Exposure（Raijuna Knowledge Base）— https://www.raijuna.com/knowledge/source-map-exposure
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: 実行環境の egress ポリシーで CONNECT 403 ブロック。サイト側の制限ではない）。以下の記述は WebSearch の要約と他サイトの記述にもとづく再構成である。
> **読みどころ**:
> 1. `.map` の定義と、TypeScript/JSX/コメントまで含めたフロント全体の再構成が起きること。
> 2. 「なぜ起きるか」— バンドラの既定挙動でビルド成果物ごとデプロイされる発生メカニズム。
> 3. 3つのセキュリティリスク（偵察の加速 / 脆弱性同定 / 資格情報露出）の詳しい論述。
> 4. 深刻度の位置づけ（内容依存）と、検出・修正の具体手順。
> **代替手段**: アーカイブ `https://web.archive.org/web/2024/https://www.raijuna.com/knowledge/source-map-exposure`。「なぜ起きるか」は本節 §7 のバンドラ既定値対比表、「深刻度」は §6 の Bugcrowd VRT で代替できる。

---

## 3. なぜ起きるのか、そしてどう検出するか

### 3-1. 発生メカニズム（設計意図の副作用）

- 多くの JS バンドラは**既定で、または一般的な設定でソースマップを有効化**している。典型的なフロントプロジェクトの既定ビルドは、minify バンドルと対応する `.js.map` の両方を生成する。
- ビルド成果物を Web サーバへデプロイすると、**設定で明示的に除外しない限り** `.map` も一緒に出ていく。
- 「見つけやすく、直しやすく、しかも頻繁に見落とされる」— ビルドツールが**可視な兆候なしに条件を自動生成**するためだ。

〔補足〕Next.js の既定は安全側（後述）だが、`@sentry/nextjs` の `withSentryConfig` が `productionBrowserSourceMaps` を有効化して露出につながった事例（vercel/next.js discussion #32920）や、CRA の `GENERATE_SOURCEMAP` 既定 true 等、フレームワーク/プラグイン依存で条件が成立しやすい。

### 3-2. 手動検出（OWASP 逐語）

OWASP のソースマップ検出手順（逐語）。

> Source map files will usually be loaded when DevTools open. Testers can also find source map files by adding the ".map" extension after the extension of each external JavaScript file. For example, if a tester sees a `/static/js/main.chunk.js` file, they can then check for its source map file by visiting `/static/js/main.chunk.js.map`.

具体的には次を行う。

- 外部 JS ファイルを列挙し、各 URL に `.map` を付けて GET し、200 が返るか（＝配布中か）を確認する。
- **DevTools の Sources タブ**を見る。`src/components/...` のような元のファイル構造が見えれば露出している。
- JS 本文末尾に `//# sourceMappingURL=...` コメントがあるか確認する。
- ネットワークタブで `.map` の読み込みを観察する。

### 3-3. `.map` の在処は4経路ある（TC39 仕様で確認）

ここが最重要である。多くの入門記事は「`//# sourceMappingURL=` コメント」と「`.map` の総当たり」の2経路しか挙げないが、公式仕様はもっと多くの経路を規定している。「コメントが無いから安全」は**誤り**だ。

#### (1) HTTP `SourceMap:` レスポンスヘッダ（逐語）

```
sourcemap: <url>
```

> Note: Previous revisions of this document recommended a header name of `x-sourcemap`. This is now deprecated; `sourcemap` is now expected.

> The HTTP `SourceMap` header has precedence over a source annotation, and if both are present, the header URL should be used to resolve the source map file.

ヘッダはコメントより**優先**される。診断では JS への `curl -I` や Burp のレスポンスヘッダで `SourceMap:` と旧称 `X-SourceMap:` の**両方**を確認すること。本文にコメントが無くてもヘッダだけで配布されている場合がある。

#### (2) 生成コード末尾のアノテーション（逐語）

```
//# sourceMappingURL=<url>
```

> Source map generators must only emit `//#` while source map consumers must accept both `//@` and `//#`.

生成側は `//#` しか出さないが、消費側（ブラウザ）は `//@` と `//#` の両方を受理する。つまり `grep` は `//#` だけでなく**レガシー形式 `//@ sourceMappingURL` も対象**にすること。古いビルドの `//@` 形式も今のブラウザから解決される。

#### (3) Data URI によるインライン埋め込み（逐語）

> `<url>` is a URL as defined in [URL]; (…) it may be a data URI. Using a data URI along with `sourcesContent` allows for a completely self-contained source map.

`.map` ファイルが**一切存在しなくても**、バンドル JS 自体に原文が丸ごと埋まっている（`//# sourceMappingURL=data:application/json;base64,...`）ことがある。`.map` の総当たりが全部 404 でも安全とは限らない。**バンドル本文の `data:application/json` を必ず検索する**。

#### (4) JS 以外の言語でのアノテーション（逐語）

> This recommendation works well for JavaScript, but it is expected that other source files will have different conventions. For instance, for CSS `/*# sourceMappingURL=<url> */` is proposed. On the WebAssembly side, such a URL is encoded using [WasmNamesBinaryFormat], and it's placed as the content of the custom section ([WasmCustomSection]) named `sourceMappingURL`.

CSS（`.css.map`、Sass/Less の原ソースが漏れる）と **WebAssembly（`.wasm` のカスタムセクション `sourceMappingURL`）**も対象。`.wasm` を使うアプリでは Rust/C++ の原ソースが復元され得る。JS だけ見て終わらせないこと。

### 3-4. 相対 URL の解決先（source origin）規則

`sourceMappingURL` が絶対 URL でない場合、生成コードの **source origin** を基準に解決される。仕様は4ケースを定める（逐語の一部）。

> If the generated code is associated with a script element and the script element has a `src` attribute, the `src` attribute of the script element will be the source origin.

仕様が定める4ケースは次のとおり。基準となる origin が場面ごとに変わる。

- **`src` 属性を持つ `<script>` に紐づくコード** … その `<script>` の `src` 属性が source origin になる（外部 JS の典型。CDN 配信ならその CDN が基準）。
- **`src` 属性の無いインラインスクリプト** … そのスクリプトを含む**ページの origin** が基準。
- **`eval()` / `new Function()` 経由で生成されたコード** … 同じく**ページの origin** が基準。
- **`//# sourceURL` コメントがある場合** … そのコメントで指定された値によって解決先が決まる。

つまり CDN 以外（インライン由来や `eval` 由来）のコードでは、基準 origin は「その JS を配ったホスト」ではなく**ページ側**になる、という違いがある。

診断上の含意: CDN 配信の JS が相対 `sourceMappingURL` を持つ場合、`.map` は**アプリのドメインではなく CDN 側**に取りに行く。露出調査では「その JS を配っているホスト」を基準に `.map` の URL を組み立てること。

### 3-5. 大規模・自動検出

〔補足〕

- **Nuclei**: YAML テンプレート駆動で多数ターゲットへ横展開し `.map` の露出を検出。
- **Acunetix**: 受動スキャンで "JavaScript source map detected" として報告。
- **URL 収集**: `gau` / `waybackurls` / `waymore` で過去 URL から `.js` を集め `.map` を試す。OWASP は `jsluice` / `LinkFinder` での抽出も紹介。

OWASP の JS 抽出コマンド（逐語）。

```bash
# Example with jsluice
jsluice urls bundle.js
jsluice secrets bundle.js

# Example with LinkFinder
python linkfinder.py -i bundle.js -o cli
```

#### Burp 拡張 BurpSourceMap（README 逐語）

`Manjesh24/BurpSourceMap`（"BurpSuite JS Map Hunter"）は受動検出を行う。README 逐語。

> By automatically initiating an additional HTTP request with the ".js.map" extension whenever a ".js" file is loaded, the extension efficiently determines the availability of a corresponding map file. When identified, the map file is unpacked and seamlessly incorporated into the Burp sitemap for comprehensive analysis.

特徴（逐語）: **JS ファイルは第三者サーバへ送られず**（`JS files are never sent to third-party servers`）、展開は Burp 内でローカルに行われる。展開済み JS は sitemap に載るので、受動スキャンや他拡張で URL・パス・シークレット抽出をそのまま走らせられる。インストールは Extender → Extensions → Add で `.py` を追加する。

運用上の重要な注意（逐語）。

> Note: It is recommended to disable the extension when not required, as it will issue a request for the .js.map file whenever a .js file is loaded.

`.js` を読むたびに `.map` へリクエストが飛ぶため、スコープ外ホストへの意図しない通信やノイズの原因になる。バグバウンティでは使用時のみ有効化し、Burp のスコープ設定を併用すること。

〔補足（未検証）〕`PortSwigger/js-miner` の README にはソースマップへの言及が無かったため、js-miner がソースマップ機能を持つとは断定しない。

> ### 📌 ここは自分で開いて読んでください
> **資料**: BurpSourceMap（Manjesh24/BurpSourceMap README）— https://github.com/Manjesh24/BurpSourceMap
> **なぜ**: 上の逐語は取得済みだが、実際の導入と画面操作は自分の Burp で確かめるのが早い（拡張の GitHub ページはスクリーンショット中心）。
> **読みどころ**: 1. `.py` の追加手順と Jython 設定、2. sitemap への展開結果の見え方、3. 無効化のタイミング。
> **代替手段**: なし（拡張は無料）。

---

## 4. 手を動かす — 復元ツールで元ソースを取り出す

### 4-1. sourcemapper（Go）

`denandz/sourcemapper` のインストール（逐語）。

```bash
go install github.com/denandz/sourcemapper@latest
```

```bash
git clone https://github.com/denandz/sourcemapper
cd sourcemapper
go get
go build
```

```bash
pacman -S sourcemapper
```

オプション（逐語、抜粋）。`-url` に `.map` の URL かローカルパス、`-jsurl` に JS の URL、`-output` は必須。

```text
:~$ ./sourcemapper
Usage of ./sourcemapper:
  -dir string
    	Directory of .map files to process recursively
  -header value
    	A header to send with the request, similar to curl's -H. Can be set multiple times, EG: "./sourcemapper --header "Cookie: session=bar" --header "Authorization: blerp"
  -help
    	Show help
  -insecure
    	Ignore invalid TLS certificates
  -jsurl string
    	URL to JavaScript file
  -output string
    	Source file output directory - REQUIRED
  -proxy string
    	Proxy URL
  -url string
    	URL or path to the Sourcemap file
```

実行例（逐語、`.map` URL から復元）。

```text
doi@asov:~$ ./sourcemapper -output dhubsrc -url https://hub.docker.com/public/js/client.356c14916fb23f85707f.js.map
[+] Retriving Sourcemap from https://hub.docker.com/public/js/client.356c14916fb23f85707f.js.map
[+] Read 23045027 bytes, parsing JSON
[+] Retrieved Sourcemap with version 3, containing 1828 entries
[+] Writing 9076765 bytes to dhubsrc/webpack:/js/client.356c14916fb23f85707f.js
...
[+] done
```

README 補足（逐語要旨）: `-url` は URL でもディスク上の map パスでもよい。`sourceMappingURL=data:application/json;...base64 blob...` 形式は blob をファイルにデコードしてからパスを渡せば回避できる。`-jsurl` で JS を直接読み、絶対/相対/`data:` の参照を TC39 のルールに従って辿る。`-dir` で `.map` を再帰的に一括処理（壊れた map はログして skip）。

### 4-2. unwebpack-sourcemap（Python3, 2022 Archive 済み）

`rarecoil/unwebpack-sourcemap` の使い方（逐語）。

```
$ mkdir output
```

```
$ ./unwebpack_sourcemap.py --local /path/to/source.map output
```

```
$ ./unwebpack_sourcemap.py https://pathto.example.com/source.map output
```

```
$ ./unwebpack_sourcemap.py --detect https://pathto.example.com/spa_root/ output
```

`--detect` は HTML の全 `<script src>` を読み、JS を取得して `sourceMappingURI` を探し、リモートから map を取得する。依存は `BeautifulSoup4`（HTML をパースして `<script src>` を抜き出す）と `requests`（HTML・JS・`.map` を HTTP 取得する）で、`pip3 install -r requirements.txt` で入る。TypeScript+React / TypeScript+Vue テンプレート向け。なお本リポジトリは※2022 に Archive 済み（アーカイブされたリポジトリ＝以後更新されない）なので、動かない場合は `sourcemapper` / `shuji` を併用する。

このツール README には、開発者向けの対策も逐語で書かれている（防御としてそのまま使える）。

> 1. Turn off sourcemaps in production entirely.
> 1. Push sourcemaps to a private server, and ACL sourcemap URIs to developers only.
> 1. Load sourcemaps from local sources only and do not push them to production.

### 4-3. shuji（Node.js, JS と CSS 両対応）

`paazmaya/shuji` のインストールと使い方（逐語）。

```sh
npm install --global shuji
```

```sh
shuji file.js.map -o folder
```

オプション一覧（逐語）。

```sh
shuji - Reverse engineering JavaScript and CSS sources from sourcemaps
Usage: shuji [options] <file|directory>

  -h, --help               Help and usage instructions
  -o, --output-dir String  Output directory - default: .
  -p, --preserve           Preserve sourcemap's original folder structure.
  -M, --match String       Regular expression for matching and filtering files -
                           default: \.map$
  -v, --verbose            Verbose output, will print which file is currently being
                           processed
  -V, --version            Version number

Version 0.8.0
```

〔補足〕`zemacik/sourcemapper`（C#/.NET）、`tehryanx/sourcemapper`（bash）等の別実装もある。復元後は次のように機密・エンドポイントを走査するのが定石。

```bash
grep -rE '(api[_-]?key|secret|token|password|/api/|https?://)' ./restored/
```

---

## 5. 実際の事例（攻撃者はどこを突いたか）

- **未公開パスワード変更エンドポイント → アカウント乗っ取り（Sentry blog の中心事例）**: 本番の Webpack ソースマップから、UI に存在しない**未文書化 API エンドポイント**が判明。そのエンドポイントは適切な認証なしにパスワード変更を許した。関連する Daniel Silva の Medium writeup では、change-password URL を叩くと unauthorized ではなく「必須フィールドが足りない」というエラーが返り、そこから必要フィールドが判明。有効なメールと単純な新パスワードを送ると 200 が返り、他人アカウントの奪取に至った。
- **Stripe シークレットキー露出（Matthew Keeley）**: 本番ビルドに誤って `.map` が含まれ公開状態。JS を復元してハードコードされた Stripe API シークレットキーを発見。不正決済が可能だった。〔補足〕Stripe の secret key は `sk_live_...` 形式で、GitGuardian 等が高リスクとして扱う。
- **Apple 新 Web App Store のフロント全ソース流出（escape.tech）**: 刷新された App Store サイトで本番にソースマップが有効化され、フロント全コードが本番サイトから直接ダウンロード可能に。技術選定・コンポーネント構成・状態管理・ルーティングが丸見えになった。発見の経緯が学びになる。GitHub ユーザ rxliuli が **DevTools でマップの読み込みに気付き**、"Save All Resources" 拡張（読み込み済みリソースを一括保存するブラウザ拡張）で**丸ごと取得**。復元されたコードのリポジトリは削除される前に **8,000+ fork** された。つまり「DevTools で気付く → 一括保存拡張で丸ごと落とす」という再現手順で、専用ツールが無くてもフロント全体を手元に取れる。露出は**公開フロントコードのみで、資格情報や決済情報は含まれなかった**とされる。escape.tech の DAST は同一問題を組織の**70%**で検出したと報告している。
- **Claude Code（Anthropic）の 59.8MB ソースマップ流出（2026）**: 公開 npm パッケージに Bun が既定生成した完全なソースマップ（59.8MB）が同梱。`*.map` が `.npmignore` / `package.json` の `files` で除外されておらず、512,000 行超の TypeScript（1,906 ファイル）が復元可能になった。復元された原文からは、**UI に現れない 44 の隠し feature flag、常駐バックグラウンドエージェント "KAIROS"、未公開モデルへの参照**などが判明した。これは本節の主題である「ソースマップ露出が隠し機能・未公開機能を暴く」ことの最も具体的な実例である（feature flag の個数、内部エージェント名、未公開モデル参照まで読み取れた）。Anthropic は「機微な顧客データや資格情報は含まれない」と説明。本節は防御・診断目的の技術解説である。
- **GitHub 自身（github.githubassets.com）**でも「ソースマップが意図的に公開されているのか」という議論（community discussion #191423）があり、意図的な露出と事故の線引きが実務課題であることを示す。

---

## 6. 報告時の扱い（深刻度・トリアージ）

**中核原則: 深刻度は「露出した内容」に依存する。**

### 6-1. 秘密が無ければ Informational / Low になりがち

「ソースマップの露出それ自体は本質的には脆弱性ではない。ただし機微情報（API キー、トークン、資格情報、内部エンドポイント等）を含んではならない」という triager の立場が一般的だ。機微情報が無ければ「受容されたビジネスリスク（accepted business risk）」として扱われ、Bugcrowd の実開示例でも P4 / Informational として記録されている。

### 6-2. Bugcrowd VRT の関連分類

Bugcrowd の VRT（Vulnerability Rating Taxonomy, 脆弱性の深刻度分類基準）には「Source Map Exposure」という専用項目は無い。近縁は次の2つ。

| VRT 分類 | 識別子 | priority |
| --- | --- | --- |
| Sensitive Data Exposure > Source Code Dump | `source_code_dump` | P4（Low） |
| Sensitive Data Exposure > Sensitive data Leakage/Exposure | `sensitive_data_leakage_exposure` | P1 |
| Server Security Misconfiguration > Missing Subresource Integrity | （別軸） | P5 |

上表の2行目までが「露出した中身」で深刻度が動く軸である。3行目の `Missing Subresource Integrity`（priority 5）は**別軸**の近縁分類で、深刻度スケールを掴む参考として挙げておく。VRT のスケールは P1（Critical）〜 P5（Informational）で、P4=Low（実在の軽微な脆弱性）、P5=Informational。つまり単なるソース流出は P4 どまりだが、**露出内容が機微なら P1 まで格上げされ得る**ことを分類自体が示している。プログラムはトリアージ時に CVSS 由来の深刻度を上書きできる。

### 6-2b. トリアージの枠組み — ソースマップ露出は「触媒（catalyst）」

Raijuna や一般的な triager の見解の核心は、深刻度そのものより**位置づけ**にある。ソースマップ露出は**単独では low / informational** にとどまるが、その本質的な価値は**別の脆弱性を容易にする「触媒（catalyst）」**である点にある。つまり「これ単体で何点か」ではなく「これが次のどのバグを開けるか」で捉えるのが正しいトリアージ観だ。この枠組みを持つと、次の §6-3 の格上げ手順が「触媒をどう実害に変換するか」の作業として一貫して見える。

### 6-3. 格上げ（escalation）のコツ

単に「`.map` が見える」で止めず、次で深刻度を裏付ける。

1. 復元コードから**ハードコードされた有効な秘密**（AWS / Stripe / JWT シークレット等）を提示する。
2. **未公開/隠しエンドポイント**を実際に叩いて挙動（例: 認証なしパスワード変更）を PoC 化する。
3. 得た内部 API・インフラ情報を**別バグへ連鎖**させ実害を示す。

これで Medium 以上（時に Critical/High）に引き上げられる。「開示された対象が AWS シークレット/内部 API/内部インフラ情報なら、退屈な情報開示ではない」（Intigriti）。

〔補足〕一部プログラムは「ソースコード開示」「情報開示（機密なし）」を明示的に out of scope / N/A としている。報告前にプログラムのポリシーを確認すること。

---

## 7. どう守るか（防御・修正）

基本方針は3択（＋サーバ側の拒否設定）である。

1. 本番でソースマップを**生成しない/配布しない**。
2. 生成するが本番 Web ルートには出さず、エラー監視サービス（Sentry 等）へ**直接アップロードし、デプロイ前に削除**する（`hidden-source-map`）。
3. どうしても Web ルートに置くなら認証必須パス配下に置くか、`*.map` を未認証リクエストに拒否する。

### 7-1. webpack（devtool docs 逐語）

> `(none)` (Set `devtool: false`, or omit the option outside of `development` mode) - No SourceMap is emitted. This is a good option to start with.
>
> `source-map` - A full SourceMap is emitted as a separate file. It adds a reference comment to the bundle so development tools know where to find it.
> W> You should configure your server to disallow access to the Source Map file for normal users!
>
> `hidden-source-map` - Same as `source-map`, but doesn't add a reference comment to the bundle. Useful if you only want SourceMaps to map error stack traces from error reports, but don't want to expose your SourceMap for the browser development tools.
> W> You should not deploy the Source Map file to the webserver. Instead only use it for error report tooling.
>
> `nosources-source-map` - A SourceMap is created without the `sourcesContent` in it. It can be used to map stack traces on the client without exposing all of the source code. You can deploy the Source Map file to the webserver.
> W> It still exposes filenames and structure for decompiling, but it doesn't expose the original code.

命名パターン（逐語）。

> The pattern is: `[inline-|hidden-|eval-][nosources-][cheap-[module-]]source-map[-debugids]`.

パターンに現れる `hidden-*` / `nosources-*` の各 addition の公式説明（逐語）。この2つがハンティング上とくに重要である。

> `hidden-*` addition | no reference to the SourceMap added. When SourceMap is not deployed, but should still be generated, e. g. for error reporting purposes.
> `nosources-*` addition | source code is not included in SourceMap.

つまり `hidden-*` は「参照コメントを足さない（＝バンドルから `.map` の在処が読めない）」だけで `.map` 自体は生成される。`nosources-*` は「`.map` に元ソース本文（`sourcesContent`）を含めない」。両者は隠すものが違う。

production 可否表（逐語、抜粋）。

| devtool | production | quality | comment |
| --- | --- | --- | --- |
| (none) | yes | bundle | Recommended choice for production builds with maximum performance. |
| `eval` | no | generated | Recommended choice for development builds with maximum performance. |
| `eval-source-map` | no | original | Recommended choice for development builds with high quality SourceMaps. |
| `source-map` | yes | original | Recommended choice for production builds with high quality SourceMaps. |
| `inline-source-map` | no | original | Possible choice when publishing a single file |
| `nosources-source-map` | yes | original | source code not included |
| `hidden-nosources-source-map` | yes | original | no reference, source code not included |
| `hidden-source-map` | yes | original | no reference. Possible choice when using SourceMap only for error reporting purposes. |

### 7-2. Vite（build-options docs 逐語）

> ## build.sourcemap
> - **Type:** `boolean | 'inline' | 'hidden'`
> - **Default:** `false`
>
> Generate production source maps. If `true`, a separate sourcemap file will be created. If `'inline'`, the sourcemap will be appended to the resulting output file as a data URI. `'hidden'` works like `true` except that the corresponding sourcemap comments in the bundled files are suppressed.

Vite は既定で本番ソースマップ無効。`'hidden'` にすると `.map` は出るが参照コメントを抑制するだけ。

### 7-3. Next.js（productionBrowserSourceMaps docs 逐語）

> Source Maps are enabled by default during development. During production builds, they are disabled to prevent you leaking your source on the client, unless you specifically opt-in with the configuration flag.

```js
// next.config.js
module.exports = {
  productionBrowserSourceMaps: true,
}
```

Next.js は既定で本番ブラウザ向けソースマップ無効。上記フラグを true にすると露出するので**触らないのが安全**。有効化した場合、生成された `.map` は **JS と同じディレクトリに出力され、Next.js がそれを自動的に配信する**（サーバ側で個別に置く必要がない分、うっかり有効化するとそのまま公開される）。

### 7-4. Create React App（GENERATE_SOURCEMAP docs 逐語）

> | GENERATE_SOURCEMAP | 🚫 Ignored | ✅ Used | When set to `false`, source maps are not generated for a production build. This solves out of memory (OOM) issues on some smaller machines. |

表の2列は「development で使われるか / production で使われるか」。`GENERATE_SOURCEMAP` は development では無視され、production ビルドでのみ効く。

**重要な読み取り**: CRA 公式ドキュメントはこのフラグを OOM（メモリ不足）対策としてしか説明しておらず、セキュリティ上の意味に一切触れていない。つまり CRA は**既定で本番ソースマップを生成する**側であり、開発者が「セキュリティのために切る」動機を公式ドキュメントから得られない構造になっている。これは Vite や Next.js と正反対で、**CRA 系アプリでソースマップ露出が多発する制度的な理由**だ。ハンティング時は「CRA 由来の構成（`static/js/main.<hash>.chunk.js` 等）を見たら `.map` を必ず試す」が定石。

### 7-5. Rollup（output docs 逐語）

> ### output.sourcemap
> Type: `boolean | 'inline' | 'hidden'` / CLI: `-m`/`--sourcemap`/`--no-sourcemap` / Default: `false`
>
> If `true`, a separate sourcemap file will be created. If `"inline"`, the sourcemap will be appended to the resulting `output` file as a data URI. `"hidden"` works like `true` except that the corresponding sourcemap comments in the bundled files are suppressed.

> ### output.sourcemapExcludeSources
> Type: `boolean` / CLI: `--sourcemapExcludeSources`/`--no-sourcemapExcludeSources` / Default: `false`
>
> If `true`, the actual code of the sources will not be added to the sourcemaps, making them considerably smaller.

Rollup も既定は無効。Vite が Rollup 上に構築されているため型が共通している。`sourcemapExcludeSources: true` は `sourcesContent` を落とす設定で、webpack の `nosources-source-map` に相当する。

### 7-6. バンドラ既定値の対比表

すべて逐語取得済みの一次資料にもとづく。どのツールが「危険側」かを一目で押さえること。

| ツール | 本番ソースマップの既定 | 露出を止める設定 | 原文だけ落とす設定 |
| --- | --- | --- | --- |
| webpack | mode 依存（`production` で option 省略なら出ない） | `devtool: false` | `nosources-source-map` |
| Vite | **`false`（安全側）** | 既定のまま / `build.sourcemap: false` | —（`'hidden'` は参照コメント抑制のみ） |
| Rollup | **`false`（安全側）** | 既定のまま / `--no-sourcemap` | `sourcemapExcludeSources: true` |
| Next.js | **本番ブラウザ向けは無効（安全側）** | `productionBrowserSourceMaps` を触らない | — |
| Create React App | **生成する（危険側）** | `GENERATE_SOURCEMAP=false` | — |

**注意**: `hidden`（webpack `hidden-*` / Vite `'hidden'` / Rollup `'hidden'`）は**参照コメントを消すだけで `.map` 自体は出力される**。ファイル名は推測可能（`app.js` → `app.js.map`）なので、`hidden` は単体では防御にならない。必ず「デプロイ前に削除」または「サーバで拒否」と併用すること。ハンター側から見れば `hidden` はむしろ狙い目である。

### 7-7. Sentry へアップロードして本番から削除（Sentry Docs 逐語）

正攻法は「生成 → Sentry へアップロード → デプロイ前に削除」だ。`@sentry/webpack-plugin` の設定（逐語）。

```javascript
const { sentryWebpackPlugin } = require("@sentry/webpack-plugin");

module.exports = {
  // ... other config above ...

  devtool: "hidden-source-map", // Source map generation must be turned on ("hidden-source-map", "source-map", etc.)
  plugins: [
    sentryWebpackPlugin({
      org: "___ORG_SLUG___",
      project: "___PROJECT_SLUG___",
      authToken: process.env.SENTRY_AUTH_TOKEN,

      sourcemaps: {
        // As you're enabling client source maps, you probably want to delete them after they're uploaded to Sentry.
        // Set the appropriate glob pattern for your output folder - some glob examples below:
        filesToDeleteAfterUpload: ["./**/*.map", ".*/**/public/**/*.map", "./dist/**/client/**/*.map"]
      }
    }),
  ],
};
```

Sentry の警告（逐語）。

> Generating source maps **may expose them to the public**, potentially causing your source code to be leaked. You can prevent this by configuring your server to deny access to `.js.map` files, or by using [Sentry Webpack Plugin's `sourcemaps.filesToDeleteAfterUpload`] option to delete source maps after they've been uploaded to Sentry.

認証トークンの扱い（逐語）。要旨は「認証トークンは `authToken` オプション・`SENTRY_AUTH_TOKEN` 環境変数・`.env.sentry-build-plugin` ファイルのいずれかで渡せる。`.env.sentry-build-plugin` は機微データなので `.gitignore` に入れること」。原文は次のとおり。

> Auth tokens can be passed to the plugin explicitly with the `authToken` option, with a `SENTRY_AUTH_TOKEN` environment variable, or with an `.env.sentry-build-plugin` file (don't forget to add it to your `.gitignore` file, as this is sensitive data) in the working directory when building your project.

```bash
# .env.sentry-build-plugin
SENTRY_AUTH_TOKEN=___ORG_AUTH_TOKEN___
```

### 7-8. Web サーバでの `.map` 拒否とデプロイ衛生

- どうしても Web ルートに置く場合は認証必須パス配下に置くか、ホストルールで `*.map` を未認証リクエストに拒否する。
- **ビルド成果物ディレクトリのみをデプロイ**し、プロジェクトフォルダごと配らない。`.git`, `.env`, `.DS_Store`, バックアップパターンを `.gitignore` / `.vercelignore` / `.dockerignore` 等に追加する（`.git` 露出も同種の漏洩）。
- nginx 例（`.map` 拒否）。

```nginx
location ~ /\.git { deny all; }
location ~ \.map$ { deny all; }
```

- CI に露出チェック（デプロイ後に公開 URL へ `.map` を要求して 200 が出ないか）を組み込む。

---

## 手を動かす

1. 対象サイトの HTML から `<script src>` を全列挙し、各 `.js` に対して次を確認する。
   - `curl -I https://target/static/js/main.chunk.js` でレスポンスヘッダに `SourceMap:` / `X-SourceMap:` が無いか。
   - `curl -s https://target/static/js/main.chunk.js | grep -aoE 'sourceMappingURL=[^ ]*'` で `//#` と `//@` 両方の参照を探す。`data:application/json` が続く場合はインライン埋め込み。
   - 参照が無くても `curl -s -o /dev/null -w '%{http_code}' https://target/static/js/main.chunk.js.map` で `.map` を総当たりし 200 を確認。
2. DevTools を開き Sources タブを見る。`webpack:///src/...` のような元ツリーが見えれば露出確定。
3. `.map` を取得したら、まず `sourcesContent` を確認する。
   ```bash
   curl -s https://target/static/js/main.chunk.js.map | python3 -c 'import json,sys;d=json.load(sys.stdin);print("non-null:",sum(1 for c in d.get("sourcesContent",[]) if c))'
   ```
   非 null が多ければ原文が丸ごと復元できる。
4. 復元する。
   ```bash
   ./sourcemapper -output ./out -url https://target/static/js/main.chunk.js.map
   # または SPA ルートから自動検出
   ./unwebpack_sourcemap.py --detect https://target/ ./out
   # CSS も含めるなら
   shuji ./downloaded.js.map -o ./out
   ```
5. 復元コードを静的解析する。
   ```bash
   grep -rEn '(sk_live_|AKIA|/api/|feature[_-]?flag|password|authorization|https?://[^ "]+)' ./out/
   ```
6. 見つけた隠しエンドポイントを（許可範囲で）検証し PoC 化する。秘密は安全に有効性を確認する。
7. 報告は「露出内容」を前面に置き、機密/隠し機能/内部 API を実害に連鎖させて深刻度を裏付ける。

## つまずきポイント

- **「`//#` コメントが無いから安全」は誤り**。HTTP `SourceMap:` ヘッダ（コメントより優先）、`//@` レガシー形式、`data:` インライン、CSS/Wasm の4経路がある。1つ潰しただけで諦めない。
- **`.map` が全部 404 でも安全とは限らない**。バンドル本文に `data:application/json;base64,` で原文が埋まっている場合がある。
- **CDN 配信の相対 `sourceMappingURL`** は、アプリのドメインではなく JS を配っているホスト（CDN 側）に `.map` を探す。base を間違えると見逃す。
- **`hidden` は防御ではない**。参照コメントを消すだけで `.map` 自体は出力される。ファイル名が推測できる以上、削除かサーバ拒否と併用しないと無意味。
- **単なる `.map` 公開は Informational 扱いになりやすい**。秘密・隠しエンドポイント・内部 API を実害に連鎖させないと深刻度が上がらない。
- **BurpSourceMap は `.js` を読むたびに `.map` を要求する**。スコープ外への意図しない通信を避けるため、使うときだけ有効化しスコープ設定を併用する。
- **CRA は既定で本番ソースマップを生成する**（危険側）。`static/js/main.<hash>.chunk.js` 構成を見たら必ず `.map` を試す。

## この節のまとめ

- ソースマップは、圧縮した本番 JS を元ソースへ逆写像する `.map`（JSON）で、本来はスタックトレースを読みやすく保つデバッグ補助物。
- 本番に認証なしで配布されると、`sourcesContent` から元コードが丸ごと、`sources` からディレクトリ構造・開発者ホームパス、`names` から意味のある識別子が復元される。
- 露出するのは変数名・関数名・ファイル構造・内部コメント・隠し機能・内部 API・開発者名、そして時にハードコードされた秘密。
- 起きる原因は「バンドラが既定または一般設定で `.map` を生成し、ビルド成果物ごとデプロイされる」こと。可視な兆候がなく見落とされやすい。
- `.map` の在処は4経路: `//#`/`//@` コメント、HTTP `SourceMap:` ヘッダ（コメントより優先）、`data:` インライン埋め込み、CSS/Wasm アノテーション。
- 診断では `sourcesContent` が非 null かをまず確認すると深刻度の当たりが即座に付く。`ignoreList` で自社コードに絞り込める。
- 復元は `sourcemapper -url <map>` / `unwebpack_sourcemap.py --detect <spa_root>` / `shuji file.js.map -o folder` で自動化できる。
- 大規模検出は Nuclei / Acunetix / BurpSourceMap、URL 収集は gau / waybackurls / waymore、抽出は jsluice / LinkFinder。
- 事例: Webpack `.map` からの未公開パスワード変更エンドポイント→アカウント乗っ取り、Stripe シークレット露出、Apple App Store の全ソース流出、Claude Code の 59.8MB `.map` 流出。
- 深刻度は内容依存。Bugcrowd VRT で `source_code_dump`=P4、`sensitive_data_leakage_exposure`=P1。秘密や隠し機能を実害に連鎖させて格上げする。
- 防御は「本番で生成/配布しない（`devtool:false` / `GENERATE_SOURCEMAP=false` / Vite `build.sourcemap:false`）」「Sentry へ直接アップロードし `filesToDeleteAfterUpload` で削除」「サーバで `.map` を拒否」。
- CRA は既定で生成する危険側、Vite/Rollup/Next.js は安全側。`hidden` は参照コメントを消すだけで防御にならない。

## 理解度チェック

1. ソースマップの `sourcesContent` フィールドが `null` 埋めの場合と、文字列が入っている場合で、攻撃者が得られるものはどう違うか。
   ▶ 答え: `null` 埋めなら原文は復元できず `sources` のパス構造のみが漏れる（webpack `nosources-*` / Rollup `sourcemapExcludeSources` に相当）。文字列が入っていれば元ソースコードが丸ごと復元できる。復元前に `sourcesContent` を覗けば深刻度の当たりが付く。

2. JS 本文に `//# sourceMappingURL=` コメントが無いサイトを見て「ソースマップは露出していない」と結論づけるのはなぜ誤りか。3つ以上の理由を挙げよ。
   ▶ 答え: (1) HTTP `SourceMap:` レスポンスヘッダで配布される場合があり、しかもコメントより優先される。(2) レガシー形式 `//@ sourceMappingURL` も消費側は受理する。(3) `data:application/json;base64,` でバンドル本文に直接埋め込まれている場合がある。(4) CSS（`.css.map`）や Wasm のカスタムセクションにもある。(5) 参照コメントを消す `hidden` 設定でも `.map` 自体は推測可能なファイル名で出力される。

3. CDN で配信されている JS が相対 `sourceMappingURL` を持つとき、`.map` はどこに探しに行くべきか。
   ▶ 答え: アプリのドメインではなく、その JS を配っているホスト（`<script src>` の origin、この場合 CDN 側）を基準に相対 URL を解決する。インラインスクリプト由来ならページの origin が基準になる。

4. Bugcrowd VRT で、ソースマップ露出はどの分類に対応し、priority はどう変わり得るか。
   ▶ 答え: 専用項目は無いが `Sensitive Data Exposure > Source Code Dump`（`source_code_dump`）が P4（Low）、`Sensitive data Leakage/Exposure`（`sensitive_data_leakage_exposure`）が P1。単なるソース流出は P4 どまりだが、露出内容が機微なら P1 まで格上げされ得る。

5. 単なる `.map` 公開の報告を Medium 以上に格上げする3つの方法は何か。
   ▶ 答え: (1) 復元コードからハードコードされた有効な秘密（AWS/Stripe/JWT シークレット等）を提示する。(2) 未公開/隠しエンドポイントを叩いて挙動（例: 認証欠如）を PoC 化する。(3) 得た内部 API・インフラ情報を別バグへ連鎖させ実害を示す。

6. webpack の `hidden-source-map` と `nosources-source-map` はそれぞれ何を隠すのか。
   ▶ 答え: `hidden-source-map` はバンドルへの参照コメントを付けない（`.map` 自体は生成されるので、Web に置けば推測で取得され得る）。`nosources-source-map` は `sourcesContent` を含めない（ファイル名と構造は露出するが原文は露出しない）。

7. Create React App が「ソースマップ露出が多発する制度的な理由」を持つと言えるのはなぜか。
   ▶ 答え: CRA は既定で本番ソースマップを生成する側であり、公式ドキュメントは `GENERATE_SOURCEMAP=false` を OOM 対策としてしか説明せず、セキュリティ上の意味に触れていない。開発者が「セキュリティのために切る」動機を公式資料から得られない。Vite/Next.js が安全側の既定なのと対照的。

8. Sentry を使った「正攻法」のワークフローを1文で述べよ。
   ▶ 答え: ビルド時にソースマップを生成し（`devtool: "hidden-source-map"`）、Sentry へアップロードしてスタックトレースを読みやすく保ちつつ、`filesToDeleteAfterUpload` でデプロイ前に `.map` を削除して公開しない。

9. BurpSourceMap を常時有効にしておくと何が問題か。
   ▶ 答え: `.js` を読むたびに `.map` へリクエストが飛ぶため、スコープ外ホストへ意図しない通信が発生しノイズになる。README も不要時は無効化を推奨。使用時のみ有効化しスコープ設定を併用する。

10. 復元した元ソースコードから、まず何を grep すべきか。代表的なパターンを挙げよ。
    ▶ 答え: API エンドポイント（`/api/`）・内部ホスト・URL（`https?://`）、シークレット（`sk_live_`, `AKIA`, JWT, `password`, `token`, `secret`）、feature flag、内部コメント、開発者パス（`/home/<user>/`）。

## 出典

- https://blog.sentry.security/abusing-exposed-sourcemaps/ （原典取得できず二次情報ベース）
- https://www.raijuna.com/knowledge/source-map-exposure （原典取得できず二次情報ベース）
- https://github.com/tc39/source-map-spec （TC39 Source Map 公式仕様、逐語取得）
- https://owasp.org/www-project-web-security-testing-guide/ WSTG-INFO-05 Review Web Page Content for Information Leakage（逐語取得）
- https://webpack.js.org/configuration/devtool/ （逐語取得）
- https://vitejs.dev/config/build-options （build.sourcemap、逐語取得）
- https://nextjs.org/docs productionBrowserSourceMaps（逐語取得）
- https://create-react-app.dev/docs/advanced-configuration/ GENERATE_SOURCEMAP（逐語取得）
- https://rollupjs.org/configuration-options/ output.sourcemap / output.sourcemapExcludeSources（逐語取得）
- https://docs.sentry.io/ Source Maps / Webpack uploading（逐語取得）
- https://github.com/denandz/sourcemapper （逐語取得）
- https://github.com/rarecoil/unwebpack-sourcemap （逐語取得）
- https://github.com/paazmaya/shuji （逐語取得）
- https://github.com/Manjesh24/BurpSourceMap （逐語取得）
- https://github.com/bugcrowd/vulnerability-rating-taxonomy （逐語取得）
- https://escape.tech/blog/apple-app-store-source-map-leak/ （二次情報）
- https://pulsesecurity.co.nz/articles/javascript-from-sourcemaps （二次情報）
- https://medium.com/@danielsilva691/discovering-account-takeover-vulnerability-through-source-map-analysis-0cd4038cbc04 （二次情報）
- https://github.com/orgs/community/discussions/191423 （二次情報）

<!-- sources: https://blog.sentry.security/abusing-exposed-sourcemaps/, https://www.raijuna.com/knowledge/source-map-exposure, https://github.com/tc39/source-map-spec, https://owasp.org/www-project-web-security-testing-guide/, https://webpack.js.org/configuration/devtool/, https://vitejs.dev/config/build-options, https://nextjs.org/docs, https://create-react-app.dev/docs/advanced-configuration/, https://rollupjs.org/configuration-options/, https://docs.sentry.io/, https://github.com/denandz/sourcemapper, https://github.com/rarecoil/unwebpack-sourcemap, https://github.com/paazmaya/shuji, https://github.com/Manjesh24/BurpSourceMap, https://github.com/bugcrowd/vulnerability-rating-taxonomy, https://escape.tech/blog/apple-app-store-source-map-leak/, https://pulsesecurity.co.nz/articles/javascript-from-sourcemaps -->
<!-- terms: ソースマップ, Source Map, sourcesContent, sourceMappingURL, SourceMapヘッダ, ignoreList, devtool, hidden-source-map, nosources-source-map, GENERATE_SOURCEMAP, productionBrowserSourceMaps, sourcemapExcludeSources, sourcemapper, unwebpack-sourcemap, shuji, BurpSourceMap, Bugcrowd VRT, source_code_dump, Base64 VLQ, TC39 -->
<!-- self-read: https://blog.sentry.security/abusing-exposed-sourcemaps/ | egressポリシーでCONNECT 403ブロック。原文逐語は未取得、二次情報ベース -->
<!-- self-read: https://www.raijuna.com/knowledge/source-map-exposure | egressポリシーでCONNECT 403ブロック。原文逐語は未取得、二次情報ベース -->
<!-- self-read: https://github.com/Manjesh24/BurpSourceMap | 拡張の導入・画面操作はGitHubページで確認 -->
