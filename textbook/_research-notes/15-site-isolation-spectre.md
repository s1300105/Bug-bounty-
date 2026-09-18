# [15] Site Isolation と Spectre/Meltdown — Chromium のプロセス分離によるサイドチャネル防御（ch02 用詳細ノート）

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://developer.chrome.com/blog/site-isolation | **failed** | WebFetch → 失敗、curl → 失敗 | WebFetch が `EGRESS_BLOCKED`（`Access to developer.chrome.com is blocked by the network egress proxy.`）。curl も `curl: (56) CONNECT tunnel failed, response 403`。組織のエグレスポリシーによる拒否のため再試行不可（proxy README の指示「403/407 は迂回・再試行せず報告する」に従った）。 |
| https://developer.chrome.com/blog/meltdown-spectre | **failed** | WebFetch → 失敗 | 同上（`developer.chrome.com` がドメイン単位でブロック）。 |
| https://www.chromium.org/Home/chromium-security/site-isolation/ | **failed** | WebFetch → 失敗 | `EGRESS_BLOCKED`（`Access to www.chromium.org is blocked by the network egress proxy.`）。 |

### フォールバックの実施状況（手順3に沿って全て試行）

| フォールバック | 結果 |
|---|---|
| a. `curl -sSL -A "Mozilla/5.0" <URL>` でHTML取得 | 失敗（CONNECT 403）。TLS検証の無効化・`HTTPS_PROXY` の解除は行っていない。 |
| b. raw.githubusercontent.com（`GoogleChrome/developer.chrome.com` リポジトリの記事 Markdown 原文） | ホスト自体は 301 応答で到達可能だったが、WebFetch は GitHub 系も含めブロックされ、curl でのリポジトリ内パス取得も CONNECT 段階で通らず本文取得不可。 |
| c. web.archive.org スナップショット | 失敗（CONNECT 403、到達不可）。 |
| d. WebSearch による二次情報補完 | **成功（本ノートの本体はこれ）**。14 本の検索クエリを実行し、原典の引用・要約を収集した。 |

追加で到達性を検査したが全てブロックされていたホスト（参考）:
`web.archive.org`, `r.jina.ai`, `chromium.googlesource.com`, `developer.mozilla.org`, `en.wikipedia.org`, `html.duckduckgo.com`, `meltdownattack.com`, `spectreattack.com`, `security.googleblog.com`。

> **重要（信頼性の前提）**: 担当3URLはいずれも**原典を直接読めていない**。以下の「詳細ノート」は **WebSearch 経由で得られた原典からの引用・要約（二次情報）** と、明示的に区別した **〔補足（一般知識）〕** から構成する。逐語引用として提示している英文は「検索結果に引用として現れた文」であり、原典での完全な前後文脈は未確認である。原典に存在しない機能名・URL・数値は書いていない。

---

## 要約（3〜10行）

- Spectre / Meltdown は CPU の**投機実行（speculative execution）**を悪用し、本来アクセス権のないメモリを**キャッシュのタイミング差という副チャネル**経由で読み出す脆弱性群である。ブラウザでは JavaScript から成立するため、「同一レンダラプロセスに載っているデータは全て読まれうる」という脅威モデルの書き換えが起きた。
- Chrome の初期緩和は **SharedArrayBuffer の無効化（Chrome 63 / 2018-01-05）**と **`performance.now()` の解像度低下（5μs → 100μs + ランダムジッタ）**、および **V8（Chrome 64 以降）のコンパイラレベル緩和**だった。しかし V8 チームは「ソフトウェア緩和では包括的・効率的な防御にならず、唯一有効なのは機密データをプロセスのアドレス空間から追い出すこと」と結論した。
- その答えが **Site Isolation**：レンダラプロセスを**単一の site**（= **scheme + eTLD+1**）の文書だけにロックし、クロスサイトの iframe を**別プロセス（out-of-process iframe / OOPIF）**に追い出す。Chrome 67（デスクトップ、2018年5月〜7月）で既定有効、Chrome 77 で Android のログインサイト、Chrome 92 で OAuth 認証サイトと拡張機能まで拡大。デスクトップのメモリオーバーヘッドは約 **10〜13%**。
- プロセス境界に加えてネットワーク応答のフィルタとして **CORB（Cross-Origin Read Blocking）**、その後継として **ORB（Opaque Response Blocking / CORB++）**が導入された。
- 高精度タイマーや SharedArrayBuffer を取り戻すには **COOP + COEP による cross-origin isolation**（`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` / `credentialless`）が必要で、`self.crossOriginIsolated === true` で確認する。
- 開発者への影響は主に「**フルページレイアウトが同期でなくなる**」こと（クロスサイト iframe のリレイアウトが非同期化）と、**`document.domain` による同一サイト間の同期アクセスの廃止**（Chrome 115 で既定無効、`Origin-Agent-Cluster: ?0` でのみ延命）。
- 限界も明確：Site Isolation は **site 粒度**（origin 粒度ではない）であり、同一サイト内の攻撃、プロセスロックされていないレンダラ、リソース枯渇攻撃には弱い。Spectre 自体を止めるのではなく「読まれても価値のあるデータがそこに無い」状態を作る防御である。

---

## 詳細ノート

### 0. 本ノートの情報源の対応関係

| 本ノートの節 | 本来の出典（担当URL） | 実際に参照できた二次情報 |
|---|---|---|
| 1〜2（Spectre/Meltdown と初期緩和） | https://developer.chrome.com/blog/meltdown-spectre | 検索結果に現れた同記事の引用、`chromium.org/Home/chromium-security/ssca/`、`v8.dev/blog/spectre`、`security.googleblog.com` の引用 |
| 3（Site Isolation の定義と仕組み） | https://www.chromium.org/Home/chromium-security/site-isolation/ | 同ページの引用、`chromium.org/developers/design-documents/site-isolation/`、`process_model_and_site_isolation.md` の引用 |
| 4〜5（CORB / ORB） | 上記2URLから参照されるサブ資料 | `cross_origin_read_blocking_explainer.md`、`chromium.org/Home/chromium-security/corb-for-developers/`、`annevk/orb`、blink-dev Intent to Ship の引用 |
| 6（COOP/COEP） | Spectre 緩和の現行形 | `web.dev/articles/coop-coep`、`web.dev/articles/cross-origin-isolation-guide`、`developer.chrome.com/blog/cross-origin-isolated-hr-timers` の引用 |
| 7（開発者への影響） | https://developer.chrome.com/blog/site-isolation | 同記事の引用（`document.documentElement.clientWidth` の例、unload ハンドラ、DevTools、性能）、`developer.chrome.com/blog/document-domain-setter-deprecation` の引用 |
| 8（既知の制限） | https://www.chromium.org/Home/chromium-security/site-isolation/ | 同ページ・`docs/security/compromised-renderers.md` の引用 |

---

### 1. Spectre / Meltdown の概要と、投機実行によるメモリ読み出し（出典: https://developer.chrome.com/blog/meltdown-spectre ／二次情報経由）

#### 1.1 何が起きたか

原典 `developer.chrome.com/blog/meltdown-spectre` の導入部として検索結果に現れた記述:

> Project Zero revealed vulnerabilities in modern CPUs that a process can use to read arbitrary memory, including memory that doesn't belong to that process, named Spectre and Meltdown.

- Google の **Project Zero** が 2018年1月3日に公表。記事自体の公開日付は検索結果上では **2018年2月6日**（※記事メタデータ由来の二次情報。原典未確認）。
- 「あるプロセスが、**そのプロセスに属さないメモリを含む任意のメモリを読める**」という性質が本質。OS のプロセス分離やブラウザのサンドボックスといった**ソフトウェアの境界を、ハードウェアの投機実行が貫通する**。
- 記事の締めくくりは検索結果上「If you have any questions, feel free to reach out to me on Twitter」となっており、著者名は特定できなかった。

#### 1.2 攻撃の必須条件：高精度タイマー

> To exploit these vulnerabilities, an attacker needs to measure how long it takes to read a certain value from memory, requiring a reliable and accurate timer.

これが Chrome の緩和策の設計理由を全て説明する。投機実行で読み出された値は**アーキテクチャ上の状態には残らない**が、**キャッシュに痕跡（cache footprint）として残る**。攻撃者はある配列要素の読み出し時間を測り、「速い＝キャッシュに載っている＝投機実行が触った」と判定することで 1 ビットずつ秘密を復元する。したがって、

1. **高精度タイマーを奪う** → `performance.now()` の粗粒度化、`SharedArrayBuffer` 無効化
2. **投機実行のガジェットを潰す** → V8 のコンパイラ緩和
3. **読める場所に秘密を置かない** → Site Isolation / CORB / COOP+COEP

という3層の緩和が導かれた。3 が最終解である。

#### 1.3 CVE と3つのバリアント（〔補足（一般知識）〕として整理。CVE 番号と名称は公開アドバイザリの一般的な記載に一致）

| CVE | 通称 | バリアント名 | 概要 |
|---|---|---|---|
| CVE-2017-5753 | Spectre | Variant 1 / **Bounds Check Bypass** | 配列境界チェックを投機的に乗り越えて範囲外を読む。**ブラウザの JS から最も現実的**に成立するのがこれ。 |
| CVE-2017-5715 | Spectre | Variant 2 / **Branch Target Injection** | 間接分岐予測器を汚染し、攻撃者が選んだアドレスのコードを投機実行させる。 |
| CVE-2017-5754 | Meltdown | Variant 3 / **Rogue Data Cache Load** | 特権（カーネル）メモリをユーザ空間から投機的に読む。 |

検索結果に現れた記述:

> The first two variants abuse speculative execution to perform bounds-check bypass (CVE-2017-5753), or by utilizing branch target injection (CVE-2017-5715) to cause kernel code at an address under attacker control to execute speculatively.

> The issue is not specific to any one vendor and takes advantage of techniques that are commonly used in most of the modern processor architectures.

→ **ベンダ固有ではなく、現代 CPU の共通設計に内在する**。よって「CPU を替えれば安全」ではない前提で Web を設計する必要がある。

#### 1.4 Web における現実的な威力：leaky.page PoC（出典: security.googleblog.com 2021-03 ／二次情報）

Site Isolation の必要性を裏づける実測値として、教科書に必ず載せたい数値。

| 条件 | 漏洩速度 |
|---|---|
| Chrome 88 / Intel Skylake CPU（公開 PoC の標準構成） | **1 kB/s** |
| 低安定性のプロトタイプ | **8 kB/s** |
| JavaScript タイマーのみを使う版（`SharedArrayBuffer` 不使用） | **60 B/s** |

> Google's Leaky.Page PoC is a Spectre V1 gadget that is a JavaScript array that is speculatively accessed out of bounds.

> The project demonstrates that these issues are not specific to Chrome, and other modern browsers are similarly vulnerable to this exploitation vector.

重要な含意: **`SharedArrayBuffer` を無効化しても Spectre は成立する**（60 B/s でも認証トークンやセッション Cookie を抜くには十分)。つまりタイマー緩和は「速度を落とす嫌がらせ」にすぎず、プロセス分離が本命だという結論に直結する。

---

### 2. Chrome / V8 の初期緩和（2018年1月〜）（出典: https://developer.chrome.com/blog/meltdown-spectre, https://www.chromium.org/Home/chromium-security/ssca/, https://v8.dev/blog/spectre ／二次情報経由）

#### 2.1 SharedArrayBuffer の無効化

> **SharedArrayBuffer Disabled:** Chrome disabled SharedArrayBuffer in Chrome 63 starting on January 5th, 2018.

> SharedArrayBuffer can be used by a dedicated worker to increment a counter, with the main thread reading this counter as a timer.

- **なぜ SAB がタイマーになるのか**: 専用 Worker が共有メモリ上のカウンタをひたすらインクリメントし、メインスレッドがその値を読む。これは実質的に **CPU クロックに近い分解能のタイマー**として機能し、`performance.now()` を粗くしても迂回できてしまう。だから API そのものを落とすしかなかった。
- chromium.org ssca ページの記述:

> Chrome disabled SharedArrayBuffer in Chrome 63 starting on Jan 5th 2018, and modified the behavior of other APIs such as performance.now to help reduce the efficacy of side-channel attacks. **SharedArrayBuffer is now re-enabled in Chrome versions where Site Isolation is on by default.**

→ **SAB の復活条件は「Site Isolation が既定で有効であること」**。後に COOP/COEP による cross-origin isolation の明示要求へと厳格化される（§6）。

#### 2.2 `performance.now()` の解像度低下

> **performance.now() Resolution Reduced:** In Chrome, the resolution of performance.now() was reduced from 5 microseconds to 100, and random uniform jitter was introduced to prevent resolution recovery.

| 項目 | 値 |
|---|---|
| 変更前の解像度 | **5 マイクロ秒** |
| 変更後の解像度 | **100 マイクロ秒** |
| 追加対策 | **ランダムな一様ジッタ（random uniform jitter）** |
| ジッタの目的 | 多数回測定の平均化による**解像度の復元（resolution recovery）を防ぐ** |

〔補足（一般知識）〕ジッタなしで粗い解像度だけを課すと、攻撃者は同じ測定を N 回繰り返して平均を取ることで実効解像度を 1/√N 程度まで取り戻せる。一様ジッタを乗せるのはこの統計的復元を潰すため。

#### 2.3 V8（Chrome 64 以降）のコンパイラレベル緩和

chromium.org ssca ページ:

> These attacks are mitigated by Site Isolation. **Starting in Chrome 64, Chrome's JavaScript engine V8 has included further mitigations which provide protection on platforms where Site Isolation is not enabled.**

`v8.dev/blog/spectre`（"A year with Spectre: a V8 perspective"）の要点:

> The V8 team implemented mitigations for known attack proofs of concept, and worked on changes in **TurboFan**, their optimizing compiler, that make its generated code safe even when these attacks are triggered.

> Untrusted code can read a process's entire address space using Spectre and side channels, but **software mitigations reduce the effectiveness of many potential gadgets without being efficient or comprehensive**, with the only effective mitigation being to **move sensitive data out of the process's address space**.

> Such attacks can't be reliably mitigated at the software level, and robust solutions require **security boundaries to be aligned with low-level primitives like process-based isolation**.

> Browsers decided to disable SharedArrayBuffer until other mitigations are in place. Additionally, **timer query extensions** could be used to mount Spectre and Meltdown attacks, so they remained disabled in Chrome until Site Isolation was on by default, at which point they would be **re-enabled with sufficiently reduced precision**.

> Chrome already had an effort underway for many years to separate sites into different processes to reduce the attack surface due to conventional vulnerabilities, and this investment paid off with **site isolation being productionized and deployed for as many platforms as possible by May 2018**.

この「ソフトウェア緩和の敗北宣言」は ch02 の骨格として必須。**同一プロセスに載っているものは読まれる前提で設計せよ**という原則が、以降の Web プラットフォーム（COOP/COEP/CORP/Fetch Metadata/SameSite）すべての根拠になる。

#### 2.4 Post-Spectre 脅威モデルの書き換え（出典: Chromium `docs/security/side-channel-threat-model.md` ／二次情報）

> The new mental model assumes that user code can reliably gain access to all data within a renderer process through speculation. Chromium's threat model now asserts that **"active web content … will be able to read any and all data in the address space of the process that hosts it"**.

> Browsers need to **align the origin boundary with the process boundary** through fundamental refactoring projects like Chromium's Site Isolation and Firefox's **Project Fission**.

> Site Isolation is considered the systematic mitigation to speculative side-channel attacks.

〔補足（一般知識）〕Firefox の対応プロジェクトが **Project Fission**、Safari/WebKit も同種のプロセス分離を持つ。ブラウザ横断で「origin/site 境界をプロセス境界に揃える」方向に収束した。

#### 2.5 Post-Spectre Web Development：開発者向け推奨（出典: Chromium `docs/security/post-spectre-webdev.md` / W3C `post-spectre-webdev` ／二次情報）

原典 meltdown-spectre 記事にも同趣旨の助言があったことが検索結果から確認できる:

> The Chrome team advises web developers to **prevent cookies from entering the renderer process' memory by using SameSite and HTTPOnly cookie attributes, avoid reading from document.cookie, ensure correct MIME types, and specify an `X-Content-Type-Options: nosniff` header for URLs with user-specific or sensitive content.**

> these recommendations help users who have Site Isolation enabled get the most out of **Cross-Origin Read Blocking**.

Chromium ドキュメント側の推奨リスト（要約）:

| # | 推奨 | 目的 |
|---|---|---|
| 1 | 受信ヘッダを検査する。特に `Origin` ヘッダと `Sec-Fetch-` プレフィックス付きヘッダ群（Fetch Metadata） | 攻撃者サイトから誘発されたクロスサイト要求をサーバ側で拒否する |
| 2 | Cookie に `SameSite` と `HttpOnly` を付ける。ページ側で `document.cookie` を読まない | Cookie 値をレンダラのアドレス空間に入れない |
| 3 | 正しい MIME タイプを返す。ユーザ固有／機密コンテンツの URL には `X-Content-Type-Options: nosniff` を付ける | CORB/ORB に確実に保護させる |

> A reasonable set of mitigation primitives exists today, ready and waiting for use.

> Chromium, Gecko, and WebKit all implement some or all of the mitigations recommended in this document.

〔補足（一般知識）〕Fetch Metadata の主要ヘッダは `Sec-Fetch-Site`（`same-origin` / `same-site` / `cross-site` / `none`）、`Sec-Fetch-Mode`、`Sec-Fetch-Dest`、`Sec-Fetch-User`。「`Sec-Fetch-Site: cross-site` かつ `Sec-Fetch-Mode: navigate` 以外なら拒否」といったリソース分離ポリシーをサーバ側に置くのが定石。

#### 2.6 タイマー粒度の最終形（出典: https://developer.chrome.com/blog/cross-origin-isolated-hr-timers ／二次情報）

> Starting in **Chrome 91**, the resolution of explicit timers will be restricted to **100 microseconds** across platforms without cross-origin isolation.

> By enabling cross-origin isolation, websites can relax the restriction to **5 microseconds** regardless of platform.

> Browser vendors decided to limit the timers to more coarse resolutions when Spectre was discovered. This is because Spectre, and similar speculative execution attacks, rely on timers to measure the time certain operations take, then guess the contents of the process' memory.

> With cross-origin isolation, we can now allow pages to access **high-resolution timers, SharedArrayBuffer, and other APIs that are unsafe to expose in processes that can read arbitrary cross-origin data**.

| 状態 | `performance.now()` 等の解像度 |
|---|---|
| cross-origin isolated でない（既定） | **100 μs**（Chrome 91 以降、全プラットフォーム統一） |
| cross-origin isolated（COOP+COEP） | **5 μs** |

また **Chrome 92** 以降、`SharedArrayBuffer` は cross-origin isolation なしでは使えない（検索結果に「Chrome 92 is when SharedArrayBuffer will no longer work without cross-origin isolation」とある）。

---

### 3. Site Isolation の定義と仕組み（出典: https://www.chromium.org/Home/chromium-security/site-isolation/ ／二次情報経由）

#### 3.1 定義

> Site Isolation is an effort to improve Chrome to use **sandboxed renderer processes as a security boundary between web sites**, even in the presence of vulnerabilities in the renderer process.

> Site Isolation **locks each renderer process to documents from a single site** and **filters certain cross-site data from each process**.

> Site Isolation makes it harder for untrusted websites to access or steal information from your accounts on other websites by isolating each site into its own process.

developer.chrome.com/blog/site-isolation の該当部分（検索結果引用）:

> Site Isolation is a security feature in Chrome that offers an additional line of defense to make attacks less likely to succeed.

> With Site Isolation, **all cross-site navigations become cross-process**, so that documents from different sites don't share a process with each other.

要点は2本柱:
1. **プロセスロック（site locking）**: 1つのレンダラプロセスに載るのは**単一 site の文書だけ**。
2. **データフィルタ**: ネットワーク層でクロスサイトの機密応答をレンダラに渡さない（= CORB/ORB）。

#### 3.2 「site」の単位 = **scheme + eTLD+1**

最重要定義。原典（Site Isolation 設計文書／chromium.org）の引用:

> A page's site includes the **scheme and registered domain name, including the public suffix, but ignoring subdomains, port, or path**. This is more specific than an origin.

> Sites are defined as **scheme plus eTLD+1**, since **different origins within a given site may have synchronous access to each other if they each modify their `document.domain`**.

つまり「なぜ origin ではなく site なのか」の答えは **`document.domain` の存在**。同一サイト内の異なる origin は `document.domain` を書き換えることで同期的に互いをスクリプトできてしまうため、プロセス境界を origin に引くと Web 互換性が壊れる。だから **site（緩い）粒度**が選ばれた。（この制約が後に `document.domain` 廃止 → origin 粒度化（Origin-Agent-Cluster）へ進む。§7.4 参照）

**site の同一性の例**（原典に挙がっている例を含む）:

| URL A | URL B | 同一 site か | 理由 |
|---|---|---|---|
| `https://www.example.com` | `https://foo.example.com` | **同一 site** | scheme（`https`）と登録ドメイン（`example.com`）が一致。サブドメインは無視。 |
| `https://www.example.com` | `http://www.example.com` | **別 site** | **scheme が違う** |
| `https://www.example.com:443` | `https://www.example.com:8443` | **同一 site** | **ポートは無視** |
| `https://example.com/a` | `https://example.com/b` | **同一 site** | **パスは無視** |
| `https://foo.github.io` | `https://bar.github.io` | **別 site**〔補足（一般知識）〕 | `github.io` は public suffix なので eTLD+1 は `foo.github.io` / `bar.github.io` になる |

用語整理:
- **eTLD**（effective TLD / public suffix）: `com`, `co.jp`, `github.io` など、Public Suffix List に載る「実質的なトップレベル」。
- **eTLD+1**（registrable domain）: eTLD にラベル1つ足したもの。`example.co.jp`、`foo.github.io`。
- **origin**: scheme + host + port（サブドメインもポートも区別する）。**site より厳しい**。
- 〔補足（一般知識）〕Cookie の `SameSite` 属性が使う「same-site」判定も eTLD+1 ベースだが、そちらは scheme を含めるかどうかの差（schemeful same-site）が段階導入された。Site Isolation の site は**最初から scheme を含む**。

#### 3.3 SiteInstance と BrowsingInstance

プロセス割り当ての実装概念（原典 Site Isolation 設計文書の引用）:

> **SiteInstance** refers to a group of documents within a unit of related similar-origin browsing contexts, and **all documents within a SiteInstance may be able to script each other, so they must be rendered in the same process**.

> A **BrowsingInstance** corresponds to the notion of a **"unit of related browsing contexts"** in the HTML5 spec and includes all browser objects that might be able to script each other because of how they were created (e.g., `window.open` or targeted links).

> A BrowsingInstance may have **multiple SiteInstances** associated with it.

対応関係:

| 概念 | 粒度 | 意味 |
|---|---|---|
| BrowsingInstance | 「関連するブラウジングコンテキストの集合」 | `window.open()` や `target` 付きリンクで繋がった window 群。互いに参照を持ち得る。 |
| SiteInstance | BrowsingInstance 内の site 単位 | 同一 BrowsingInstance 内で同じ site の文書群。**同一プロセスに載る**。 |
| RenderProcess | OS プロセス | 原則 1 SiteInstance = 1 プロセス（プロセス数上限に達すると再利用されうる） |

〔補足（一般知識）〕`rel="noopener"` や COOP によって window 間の参照が切れると **BrowsingInstance が分かれる**（"BrowsingInstance swap"）。これが COOP がプロセス分離の前提条件になる理由。

#### 3.4 Out-of-Process iframes（OOPIF）

> **All cross-site iframes are put into a different process than their parent frame, using "out-of-process iframes."**（Charlie Reis, site isolator at Google）

> As of **Chrome 56**, Chrome started using out-of-process iframes to keep web content out of privileged extension processes.

- OOPIF は Site Isolation の実装上の核心。**親フレームと子 iframe が別プロセス**になるため、フレームツリーがプロセス境界をまたいで存在する（プロキシオブジェクトで繋がる）。
- Chrome 56 での先行利用（拡張機能プロセスから Web コンテンツを追い出す）→ Chrome 67 で全クロスサイト iframe へ一般化、という段階導入。

> Widespread use for cross-site iframes launched in **Chrome 67 on desktop**, and in **Chrome 77 for Android**.

#### 3.5 Site Isolation が防ぐもの（原典の箇条書き／逐語引用）

これは ch02 に表として丸ごと載せるべき中核リスト。

| 防げる攻撃 | 原文（引用） |
|---|---|
| クロスサイト Cookie / HTML5 ストレージの窃取 | **Stealing cross-site cookies and HTML5 stored data** – Site Isolation prevents a renderer process from receiving cookies or stored data from sites other than its own. |
| 保存済みパスワードの窃取 | **Stealing saved passwords** – Site Isolation prevents a renderer process from receiving saved passwords from sites other than its own. |
| 他サイトに付与された権限の悪用 | **Abusing permissions granted to another site** – Site Isolation prevents a renderer process from using permissions such as geolocation that the user has granted to other sites. |
| クロスサイト HTML/XML/JSON データの窃取 | **Stealing cross-site HTML, XML, and JSON data** – Using MIME type and content sniffing, Site Isolation prevents a renderer process from loading most sensitive cross-site data. |
| `X-Frame-Options` の突破 | **Compromising X-Frame-Options** – Site Isolation prevents a renderer process from loading cross-site pages in iframes, allowing the browser process to decide if a given site can be loaded in an iframe based on `X-Frame-Options` or CSP `frame-ancestors` headers. |

> Site Isolation has been enabled by default on desktop platforms (for all sites) in **Chrome 67**, and on Android (for sites users log into) in **Chrome 77**, helping defend against **speculative side channel attacks (e.g., Spectre)**, and (on desktop) against **UXSS and fully compromised renderer processes**.

> As of **Chrome 63**, Site Isolation could be enabled as an additional mitigation against **universal cross-site scripting (UXSS)** vulnerabilities and Spectre.

> **By tricking CPU branch predictors into speculatively reading memory outside JavaScript array bounds, malicious code running in a renderer process could exfiltrate any data loaded anywhere within that same process memory space.**

（最後の一文が「Site Isolation が Spectre 対策である理由」を一行で説明している。教科書に引くべき。）

#### 3.6 侵害されたレンダラに対する防御（出典: Chromium `docs/security/compromised-renderers.md` ／二次情報）

> Site Isolation allows the privileged browser process to **restrict what origins a renderer process is authorized to read or control**.

> The combination of **Chrome's sandbox, IPC security checks, and Site Isolation** limit what an untrustworthy renderer process can do, protecting Chrome users against attackers **even when such attackers are able to bypass security logic in the renderer process**.

多層防御の構造:

| 層 | 役割 |
|---|---|
| OS サンドボックス | レンダラから OS リソースへの直接アクセスを遮断 |
| IPC セキュリティチェック（browser 側の検証） | レンダラの要求（Cookie 取得、ストレージ読み、権限利用など）を**ブラウザプロセス側で検証**。実装上の中核関数が `CanAccessDataForOrigin` |
| Site Isolation（プロセスロック） | そのプロセスがどの site を名乗れるかを固定し、上記検証の判定材料にする |

〔補足（一般知識）〕検証に失敗した IPC はレンダラの**強制終了（renderer kill）**につながる。「レンダラ側のチェックは UX のため、真の検証はブラウザプロセス側」という原則は、バグバウンティで「レンダラ側チェックだけを迂回できたが browser 側で止まった」ケースの評価軸になる。

#### 3.7 有効化の歴史とプラットフォーム別の状況

| バージョン | 内容 |
|---|---|
| Chrome 56 | OOPIF を拡張機能プロセスから Web コンテンツを追い出す目的で先行利用 |
| Chrome 63 | Site Isolation を**オプトイン**で有効化可能（UXSS と Spectre への追加緩和として）。同時に `SharedArrayBuffer` を無効化（2018-01-05） |
| Chrome 64 | V8 に追加のソフトウェア緩和（Site Isolation が無い環境での保護） |
| Chrome 67（2018年5月〜） | **デスクトップで全サイトに既定有効** |
| Chrome 77（2019年10月） | **Android でログインするサイトを分離**（RAM 2GB 以上のほぼ全端末） |
| Chrome 91 | タイマー解像度を全プラットフォーム 100μs に統一、cross-origin isolated なら 5μs |
| Chrome 92 | **OAuth ベースのログインを認識して分離**、拡張機能へも拡大。`SharedArrayBuffer` は cross-origin isolation 必須に |
| Chrome 115（2023年7月頃） | `document.domain` セッタを既定で無効化（origin-keyed agent cluster を既定に） |

Android の運用（出典: security.googleblog.com "Protecting more with Site Isolation" ／二次情報）:

> Site Isolation became active for nearly all Android devices with at least **2GB of RAM** running Chrome 77. Chrome had been isolating **sites where users log in by entering a password**.

> Many sites allow users to authenticate on a third-party site (for example, sites that offer "Sign in with Google"), possibly without the user ever typing in a password, most commonly accomplished with the **OAuth** protocol. Starting in **Chrome 92**, Site Isolation will recognize common OAuth interactions and protect sites relying on OAuth-based login.

> **Site Isolation for all sites continues to be too costly for most Android devices**, so the strategy is to improve heuristics for prioritizing sites that benefit most from added protection.

> On Android, Chromium isolates high-risk sites while allowing less sensitive cross-origin pages to share processes when device RAM falls below specific thresholds.

**バグハンター視点の含意**: Android Chrome では**分離されていない site が普通に存在する**。「パスワード入力実績がある」「OAuth を経由した」という**ヒューリスティックに載っていない site 同士は同一プロセスを共有しうる**。ターゲットが Android で機密データを扱うなら、自サイト側で COOP/COEP を張るか、そもそも同一プロセスに機密を置かない設計が必要。

#### 3.8 メモリオーバーヘッド

> a 2018 Chromium blog post by Charlie Reis (the engineer leading the implementation) put the figure at **"about a 10-13% total memory overhead"** on desktop and noted that the mobile rollout was staged differently due to tighter RAM constraints on Android.

> Chrome requires a minimum RAM threshold (currently **2GB**) for Site Isolation modes.

#### 3.9 有効化・設定の手段（フラグとエンタープライズポリシー）

**chrome://flags（ユーザ操作）**

```
chrome://flags#enable-site-per-process
```
> Visit chrome://flags#enable-site-per-process, click Enable, and restart.

（Android で全サイト分離を強制する場合も同じフラグ。原典の表現: "Google offers a manual flag to enable for all sites at the expense of memory: `chrome://flags/#enable-site-per-process`"）

**コマンドラインフラグ（逐語）**

```
--site-per-process
--isolate-origins=<comma-separated list of origins>
```
> Use command line flags to start Chrome with `--isolate-origins` followed by a comma-separated list of origins to isolate.

**エンタープライズポリシー**

| ポリシー名 | プラットフォーム | 効果 |
|---|---|---|
| `SitePerProcess` | Desktop（Chrome OS 含む） | 全サイトを分離。**Enabled にするとユーザが `chrome://flags` の "Disable site isolation" でオプトアウトできなくなる** |
| `SitePerProcessAndroid` | Android | Android 版の同等ポリシー |
| `IsolateOrigins` | Desktop | カンマ区切りで指定した origin ごとに専用プロセス。**そのプロセスには指定 origin とそのサブドメインの文書しか入らない** |
| `IsolateOriginsAndroid` | Android | Android 版 |

原典引用:

> The `SitePerProcess` policy enforces site isolation for all sites, while `IsolateOrigins` allows for more selective application.

> Setting this policy to Enabled prevents users from opting out (for example, using Disable site isolation in `chrome://flags`).

> Setting the policy means each of the named origins in a comma-separated list runs in a dedicated process, and each named origin's process will only be allowed to contain documents from **that origin and its subdomains**.

> Since **Google Chrome 77**, you can specify a range of origins to isolate using a wildcard, such as `https://[*.]corp.example.com` to give every origin underneath `https://corp.example.com` its own dedicated process.

ワイルドカード構文（逐語）:

```
https://[*.]corp.example.com
```

〔補足（一般知識）〕`IsolateOrigins` は **site より細かい origin 粒度**の分離を後付けで得る手段であり、社内ポータル（`intranet.corp.example.com`）だけを他の同一サイト文書から隔離したい場合に使う。Web 側から `Origin-Agent-Cluster: ?1` を送る方法（§7.4）はこれの「サイト側からの宣言版」に相当する。

**調査用の内部ページ**

```
chrome://process-internals
```
〔補足（一般知識）〕どのフレームがどのプロセス／SiteInstance に載っているかを一覧できる内部ページ。Site Isolation の挙動検証やバグ報告時の証跡取得に使う。原典ページでの詳細記述は取得できなかった。

---

### 4. CORB（Cross-Origin Read Blocking）（出典: Chromium `cross_origin_read_blocking_explainer.md`, https://www.chromium.org/Home/chromium-security/corb-for-developers/ ／二次情報経由）

#### 4.1 位置づけと定義

> Cross-Origin Read Blocking (CORB) is a web platform security feature that helps **mitigate side-channel attacks** and **prevents the browser from delivering certain cross-origin network responses to a web page when they might contain sensitive information**.

> CORB tries to transparently block cross-site HTML, XML, and JSON responses from the renderer process, **with almost no impact to compatibility**.

> Cross-Origin Read Blocking (CORB) mitigates the risk of exposing sensitive cross-origin data by checking MIME type of responses in cross-origin subresources.

**なぜ必要か**: プロセスをロックしても、`<script src>` や `<img src>` のような **CORS 不要（no-cors）で取得できるサブリソース**は、同一プロセスのメモリに「読めない前提の応答」を運び込んでしまう。Spectre はその「読めない前提」を無効化するので、**そもそもレンダラに渡さない**必要がある。

> Blocking such resources prevents a malicious web page from using Spectre to read a cross-origin resource pulled into an OOPIF process via a no-cors request.

#### 4.2 何をブロックするか

> CORB blocks cross-origin `text/html` responses requested from `<script>` or `<img>` tags, replacing them with an empty response instead.

> When CORB protects a response, **the response body is replaced with an empty body and the response headers are removed**.

> HTML, PDF, JSON, and ZIP are examples of resources that CORB and ORB attempt to block.

#### 4.3 MIME スニッフィングと `nosniff`

> When the **"nosniff" header is not present**, Chrome **looks at the start of the file** to confirm whether it is **HTML, XML, or JSON** before deciding whether to protect it.

> For best security results, web developers should **mark responses with the correct `Content-Type` header** and **opt out of sniffing by using the `X-Content-Type-Options: nosniff` header**.

判定ロジックの整理:

| 条件 | CORB の挙動 |
|---|---|
| `Content-Type` が HTML/XML/JSON 系 かつ `X-Content-Type-Options: nosniff` あり | **スニッフィングせず即ブロック**（最も確実に保護される） |
| `nosniff` なし | 応答先頭を**スニッフィング**し、HTML/XML/JSON と確認できた場合のみブロック（誤検知を避けるため） |
| 画像・スクリプト・CSS・音声動画として正しくラベル付けされている | ブロックしない（正当な no-cors 利用を壊さないため） |

#### 4.4 DevTools のコンソールメッセージ（逐語）

```
Cross-Origin Read Blocking (CORB) blocked cross-origin response https://www.example.com/ ...
```

> When CORB blocks an HTTP response, it emits the following warning message to the DevTools console in Chrome: "Cross-Origin Read Blocking (CORB) blocked cross-origin response https://www.example.com/ ..."

実際に報告例として現れる完全形（サポートフォーラムのタイトル、逐語）:

```
Cross-Origin Read Blocking (CORB) blocked cross-origin response http://localhost:8080/rest/users/login with MIME type application/json. See https://www.chromestatus.com/feature/5629709824032768 for more details
```

chromestatus の機能エントリ（CORB）: `https://chromestatus.com/feature/5629709824032768`

#### 4.5 Web 可視な影響と誤爆パターン

> CORB may have web-visible impact for features that are **not subject to the same-origin policy, such as `img` and `script` tags**, including cross-origin `img` elements where the response contains an image but is **mislabeled as `text/html`** content type and served with a `X-Content-Type-Options: nosniff` header.

> In rare cases, a response served with `X-Content-Type-Options: nosniff` and an **incorrect `Content-Type`** response header may be blocked, such as blocking an actual image mislabeled as `Content-Type: text/html` and `nosniff`, and if this occurs and interferes with a page's behavior, you should **request that the website correct the `Content-Type` header**.

> Only **0.115%** of CORB-eligible responses might have been observably blocked due to a `nosniff` header or **range request (206 partial responses)**.

（この 0.115% という数値が「互換性への影響はほぼ無い」という主張の裏付け。教科書に数値として載せる価値がある。）

#### 4.6 開発者がやるべきこと（CORB for Developers）

> To protect sensitive resources, serve them with a **correct `Content-Type` response header** and a **`X-Content-Type-Options: nosniff` response header**, which ensure Chrome can identify the resources as needing protection. This applies to sensitive resources like **pages or JSON files with user-specific information** or **pages with CSRF tokens**.

推奨ヘッダ（逐語）:

```
Content-Type: application/json
X-Content-Type-Options: nosniff
```

〔補足（一般知識）〕さらに強い保護として `Cross-Origin-Resource-Policy: same-origin` を付けると、CORB のヒューリスティックに頼らず**明示的に**クロスオリジンからの no-cors 取得を拒否できる（§6.3）。JSON API に対しては「`nosniff` + 正しい `Content-Type` + `CORP: same-origin` + Fetch Metadata による拒否」を組み合わせるのが現在の定石。

---

### 5. ORB（Opaque Response Blocking / CORB++）（出典: `annevk/orb`, blink-dev Intent to Ship, chromestatus ／二次情報経由）

#### 5.1 定義と目的

> Opaque Response Blocking (ORB) is a **replacement for Cross-Origin Read Blocking (CORB)**. ORB is often referred to as **"CORB++"** and expands on CORB's protection mechanisms.

> CORB and ORB are both **heuristics** that attempt to prevent cross-origin disclosure of **"no-cors" subresources**.

> **CSS, JavaScript, images, and media (audio and video) can be requested across origins without CORS. Except for CSS there is no MIME type enforcement.** ORB still blocks as many responses as possible that are not one of these types to avoid leaking their contents through side channels.

→ 設計思想の反転が重要。
- **CORB**: 「HTML/XML/JSON **らしいもの**をブロックする」（**ブロックリスト型**）
- **ORB**: 「no-cors で正当に取得できる型（CSS / JS / 画像 / 音声動画）**以外はできるだけブロックする**」（**許可リスト寄り**）

#### 5.2 用語と分類

> An **opaque-blocklisted MIME type** is an **HTML MIME type, JSON MIME type, or XML MIME type**.

> HTML, PDF, JSON, and ZIP are examples of resources that CORB and ORB attempt to block.

〔補足（一般知識）〕W3C/WHATWG 側の TAG レビュー議題に「opaque-blocklisted-**never-sniffed** MIME types」というカテゴリがあり、スニッフィングを一切せず常にブロックすべき型（例: `application/zip`、`application/pdf` 等）の扱いが議論されている。

#### 5.3 CORB との差分表

| 観点 | CORB | ORB |
|---|---|---|
| ブロック対象の決め方 | HTML/XML/JSON を**検出してブロック**（ブロックリスト型） | no-cors で許される型（CSS/JS/画像/メディア）**以外をブロック**（許可リスト寄り） |
| ブロック時の見せ方 | **空のレスポンスを注入**（body 空・ヘッダ除去） | **ネットワークエラーを発生させる** |
| スニッフィング対象 | HTML / JSON / XML のスニッフィング | 完全版 ORB は **JavaScript のスニッフィング**を行う（v0.1 は HTML/JSON/XML スニッフィング） |
| 段階導入 | — | **v0.1** → **v0.2**（blink-dev で Intent to Ship が2段） |

> ORB specifies error handling for blocked resources differently from CORB: **ORB raises network errors, while CORB injects an empty response.**

> A main difference between full ORB and ORB v0.1 is **JS sniffing versus HTML/JSON/XML sniffing**.

**バグハンター／診断上の含意**: ブロック時の挙動が「空応答」から「ネットワークエラー」へ変わることは、**エラーイベントの有無を観測する XS-Leaks の成立条件**を変える。`<img onerror>` / `<script onerror>` の発火有無や `fetch` の reject タイミングで「その応答がブロック対象だったか」＝「その URL が HTML/JSON を返したか」を推測できる余地が生じるため、応答形状の差異がオラクルにならないかを検証する価値がある（許可された検証・バグバウンティ前提）。

参照 ID（逐語）:
- chromestatus: ORB v0.1 `https://chromestatus.com/feature/4933785622675456`
- chromestatus: ORB v0.2 `https://chromestatus.com/feature/5166834424217600`
- 仕様提案リポジトリ: `https://github.com/annevk/orb`

---

### 6. COOP / COEP と `crossOriginIsolated`（出典: web.dev coop-coep / cross-origin-isolation-guide, MDN, developer.chrome.com ／二次情報経由）

#### 6.1 なぜ必要か

Site Isolation は「ブラウザが勝手にやってくれる防御」だが、**危険な API（高精度タイマー、`SharedArrayBuffer`）を解禁するには、サイト側が「私のプロセスには意図しないクロスオリジンデータが入っていない」ことを保証しなければならない**。その保証の宣言手段が COOP + COEP。

> Certain features, such as access to `SharedArrayBuffer` objects or using `Performance.now()` with unthrottled timers, are only available if your document is **cross-origin isolated**.

> **Cross-origin isolation provides the standard baseline for browsers to run pages in an isolated environment such that they are unable to load unwilling cross-origin resources, and therefore, are not at risk for Spectre.**

#### 6.2 必要なヘッダ（逐語・完全形）

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

または COEP の代替値:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

> A document will be cross-origin isolated if it includes the `Cross-Origin-Opener-Policy` header with the directive **`same-origin`** and the `Cross-Origin-Embedder-Policy` header with the directive **`require-corp`** or **`credentialless`**.

#### 6.3 各ヘッダの役割

| ヘッダ | 値 | 役割 |
|---|---|---|
| `Cross-Origin-Opener-Policy` | `same-origin` | **トップレベルのブラウジングコンテキストをクロスオリジンのポップアップから隔離する**。`window.opener` / `window.open()` 経由の参照を切り、BrowsingInstance を分離する |
| `Cross-Origin-Embedder-Policy` | `require-corp` | **すべてのクロスオリジンサブリソースに `Cross-Origin-Resource-Policy` ヘッダでの明示的オプトインを要求する** |
| `Cross-Origin-Embedder-Policy` | `credentialless` | クロスオリジン no-cors リクエストを **Cookie・認証情報なしで送る**ことで、`CORP` ヘッダなしでも埋め込みを許す |
| `Cross-Origin-Resource-Policy` | `same-origin` / `same-site` / `cross-origin` | **リソース側**が「どこからの no-cors 取得を許すか」を宣言する |

> The COOP header **isolates the top-level browsing context from cross-origin pop-ups**, while the COEP header **forces every cross-origin sub-resource to opt in with a `Cross-Origin-Resource-Policy` header**, or with `credentialless` mode, to load without cookies and credentials.

> The `Cross-Origin-Embedder-Policy: credentialless` value was added as a **workaround**, allowing your site to be considered cross-origin isolated so you can use features like `SharedArrayBuffer`, while **no-cors requests don't need to have a `Cross-Origin-Resource-Policy` to be embedded**.

〔補足（一般知識）〕COOP の他の値は `unsafe-none`（既定）、`same-origin-allow-popups`（自分が開いたポップアップとの関係は保つが、自分を開いた側からは切る）、および報告専用の `Cross-Origin-Opener-Policy-Report-Only` / `Cross-Origin-Embedder-Policy-Report-Only`。段階導入では Report-Only で壊れる埋め込みを洗い出すのが標準手順。

#### 6.4 確認方法（逐語）

```js
self.crossOriginIsolated
```

> You can check that `self.crossOriginIsolated` returns `true` in console to verify that your page is cross-origin isolated.

`window.crossOriginIsolated`（`Window` の読み取り専用プロパティ）も同義。Worker 内では `self.crossOriginIsolated`。

#### 6.5 cross-origin isolated で解禁されるもの

| 機能 | 非 isolated | isolated |
|---|---|---|
| `SharedArrayBuffer` | Chrome 92 以降**使用不可** | 使用可 |
| `performance.now()` 等の明示的タイマー解像度 | **100 μs**（Chrome 91 以降） | **5 μs** |
| `performance.measureUserAgentSpecificMemory()` 等の一部計測 API | 制限 | 利用可（〔補足（一般知識）〕） |
| `Permissions-Policy: cross-origin-isolated` による子フレームへの委譲 | — | 制御可（〔補足（一般知識）〕MDN に該当ディレクティブがある） |

#### 6.6 関連する後続機能（〔補足（一般知識）〕として言及のみ）

- **Document Isolation Policy**: COEP のようにサブリソースへ制約を課さずに、文書単位で（プロセス分離により）cross-origin isolation 相当の能力を得る提案。`developer.chrome.com/blog/document-isolation-policy` と WICG リポジトリ `WICG/document-isolation-policy` が存在することを検索結果で確認した（内容は未取得）。
- **COEP: credentialless の Origin Trial** 記事（`developer.chrome.com/blog/coep-credentialless-origin-trial`）の存在も確認した（内容未取得）。

---

### 7. 開発者への影響 — 同期的クロスドキュメントアクセスの破綻（出典: https://developer.chrome.com/blog/site-isolation ／二次情報経由）

原典の該当節は **"What to watch out for"**。原典引用:

> Enabling Site Isolation comes with a few **subtle side-effects** that might affect your website.

#### 7.1 フルページレイアウトが同期でなくなる（最重要）

> With Site Isolation, **full-page layout is no longer guaranteed to be synchronous**, since the frames of a page may now be spread across multiple processes. This might affect pages if they assume that **a layout change immediately propagates to all frames on the page**.

> This may affect pages that **change the size of a frame and then send a `postMessage` to it**, since the receiving frame **may not yet know its new size** when receiving the message.

原典の具体例（検索結果で確認できた要素）:

> A social widget receives a message through the `postMessage` API and logs the width of its root HTML element using `document.documentElement.clientWidth`.

> Accessing `document.documentElement.clientWidth` **forces layout**, which used to be synchronous before Chrome enabled Site Isolation.

> Before Chrome enabled Site Isolation, the answer was **456** (the updated width value). However, with Site Isolation enabled, the cross-origin social widget re-layout now happens **asynchronously in a separate process**. This means the answer can now also be **123** (the original width value), depending on whether the layout has been processed in the separate process.

〔補足（一般知識）〕原典のコードブロックは取得できなかったため、上記の確認済み要素（`postMessage`、`document.documentElement.clientWidth`、幅 `123` → `456`）だけから再構成した**擬似コード**を示す。原典のコードそのものではない点に注意。

親ページ側（再構成・擬似コード）:

```js
// 親ページ（https://example.com）
const iframe = document.querySelector('iframe'); // https://social.example/widget
iframe.style.width = '456px';   // 変更前は 123px
iframe.contentWindow.postMessage('resized', '*');
```

クロスサイト iframe 側（再構成・擬似コード）:

```js
// https://social.example/widget（親とは別 site → 別プロセス）
window.addEventListener('message', () => {
  // Site Isolation 前: 456（レイアウトが同期的に伝播していた）
  // Site Isolation 後: 123 または 456（別プロセスでのリレイアウトは非同期）
  console.log(document.documentElement.clientWidth);
});
```

**教科書に載せる原則**: 「サイズ変更 → `postMessage` → 受信側で即座にサイズを読む」という**同期前提の実装は壊れる**。正しくは `ResizeObserver` を使う、または受信側が `requestAnimationFrame` を挟んで測る、あるいは**親が新しいサイズを `postMessage` のペイロードに含めて送る**（〔補足（一般知識）〕）。

**バグハンター視点**: この非同期化は**競合状態（race condition）を新たに生む**。「iframe がまだ古いサイズ／古い状態のまま、親から来たメッセージを信用して処理する」実装は、状態不整合を突く攻撃面になりうる。逆に、プロセス間のレイアウト伝播タイミング差そのものが**タイミング副チャネル**（フレームのレンダリング完了時間の差でクロスサイト状態を推測する XS-Leaks）の材料になる可能性も検討対象になる。

#### 7.2 unload ハンドラの挙動

> Even without Site Isolation some main frame navigations are cross-process, which impacts unload handler behavior — **unload handlers for the old page and its subframes run in the background after the new page is shown**, and **the old unload handlers are terminated if they don't finish within a certain timeout**.

要点:
- クロスプロセス遷移では、**新しいページが表示された後に**古いページとそのサブフレームの `unload` ハンドラがバックグラウンドで走る。
- 一定のタイムアウト内に終わらなければ**強制終了**される。
- → `unload` 内で同期 XHR や重い処理をして「必ず届く」前提を置く実装は破綻する。〔補足（一般知識）〕代替は `navigator.sendBeacon()` や `fetch(..., {keepalive: true})`、`visibilitychange` / `pagehide` イベント。

#### 7.3 DevTools の制約

> **DevTools support for unload handlers is largely missing** — breakpoints inside unload handlers don't work, requests made during unload handlers don't show up in the Network pane, and `console.log` calls made during unload handlers may not show up.

| 制約 | 内容 |
|---|---|
| ブレークポイント | `unload` ハンドラ内のブレークポイントが効かない |
| Network パネル | `unload` 中に発行したリクエストが表示されない |
| Console | `unload` 中の `console.log` が出ないことがある |

**診断上の含意**: `unload` 経路の挙動（ビーコン送信、トークンのクリーンアップ漏れなど）は DevTools では見えない。プロキシ（Burp / mitmproxy 等）でネットワークを直接観測する必要がある。〔補足（一般知識）〕

#### 7.4 `document.domain` の廃止と Origin-Agent-Cluster

原典 site-isolation 記事の記述:

> An experimental mode will **break any pages that depend on modifying `document.domain` to access a cross-origin but same-site page**.

その後の展開（出典: `developer.chrome.com/blog/document-domain-setter-deprecation`, `developer.chrome.com/blog/immutable-document-domain`, Chromium `docs/security/document-domain.md` ／二次情報）:

> Relaxing the same-origin policy by setting `document.domain` is **deprecated, and is disabled by default in Chrome 115**, released around **July 2023**.

> The `Origin-Agent-Cluster` header instructs the browser whether the document should be handled by the **origin-keyed agent cluster** or not. To continue using the `document.domain` feature, please **opt out of origin-keyed agent clusters by sending an `Origin-Agent-Cluster: ?0` header** along with the HTTP response for the document **and frames**.

> A web browser can cluster sites (in order to assign them to operating system processes) and sites can be clustered **by origin, or by site**. **Origin-keyed agent clustering is preferable for security reasons.**

> However when sites are clustered by origin, **synchronous access to frames outside of that origin (but within the same site) is no longer possible**. Thus sites in origin-keyed agent clusters **disable the `document.domain` setter**.

> The Origin specification states that the feature should be removed. Mozilla considers disabling `document.domain` by default worth prototyping, and WebKit indicated that they are moderately positive about deprecating the `document.domain` setter.

ヘッダ値（逐語）:

```
Origin-Agent-Cluster: ?1
Origin-Agent-Cluster: ?0
```

| 値 | 意味 | `document.domain` | プロセス分離 |
|---|---|---|---|
| `?1` | origin-keyed agent cluster を要求 | 無効 | **origin 単位**の分離が可能になる（より強い） |
| `?0` | site-keyed agent cluster にオプトアウト | 使用可（Chrome 115 以降で延命する唯一の方法） | site 単位 |
| 送らない | Chrome 115 以降は **origin-keyed が既定** | 無効 | origin 単位 |

〔補足（一般知識）〕`?1` / `?0` は Structured Field Values の boolean 表記。**文書本体と、同期アクセス相手になる全フレームの両方**に同じ値を送る必要がある（片方だけでは agent cluster が揃わない）。

**なぜこれが ch02 の核心か**: §3.2 で見たとおり「site 粒度を選ばざるを得なかった理由が `document.domain`」だった。その `document.domain` を殺すことで、Chrome は **site 粒度から origin 粒度の分離**へ進める道を開いた。つまり `document.domain` の廃止は互換性整理ではなく、**Spectre 対策の粒度を一段上げるための前提工事**である。

**バグハンター視点**: レガシーアプリで `document.domain = 'example.com'` に依存した同期的クロスサブドメイン連携が残っている場合、(1) `Origin-Agent-Cluster: ?0` を全フレームに送れているか、(2) その延命によって**サブドメイン間の同期アクセスという広いアクセス面が維持されている**ことが XSS の被害範囲拡大（1つのサブドメインの XSS が同一サイト全体に波及）に繋がっていないかを見る。`document.domain` 依存の解消は、それ自体が防御の改善提案になる。

#### 7.5 セッションストレージと Cookie

> When you perform a top-level navigation to an isolated site, **any state used for browsing (cookie store, cache, localstorage, etc.) will not be shared with your normal browsing session.**

〔注意〕この引用は検索結果経由であり、文脈（原典で「isolated site」がどのモードを指すか）を確認できていない。**Site Isolation の通常動作ではストレージは分割されない**（ストレージ分割は Storage Partitioning という別機能）ため、この記述は特定のモード（強い分離モード）についての説明である可能性が高い。教科書に転記する際は原典を確認すること。〔補足（一般知識）〕

#### 7.6 性能への影響（正負両方）

> Site Isolation can affect performance in several ways, both positive and negative: **some frames may render faster by running in parallel with the rest of the page**, but **creating additional renderer processes also increases memory requirements and may introduce latency on cross-process navigations**.

| 方向 | 内容 |
|---|---|
| 正 | クロスサイトフレームがページ本体と**並列にレンダリング**されるため速くなることがある |
| 負 | **プロセス増加によるメモリ消費増**（デスクトップで約 10〜13%） |
| 負 | **クロスプロセス遷移のレイテンシ増**（新プロセス起動コスト） |

#### 7.7 バグの報告

> For reporting bugs related to Site Isolation, the resources point to Chrome's bug tracking system at **crbug.com**.

---

### 8. 既知の制限（出典: https://www.chromium.org/Home/chromium-security/site-isolation/, Chromium `docs/security/compromised-renderers.md` ／二次情報経由）

#### 8.1 リソース消費というトレードオフ

> The main tradeoff of site isolation involves the **added resource consumption necessitated by the additional processes** it requires, which **limits its effectiveness on some classes of devices** and can be **abused in some cases to enable resource exhaustion attacks**.

- 低 RAM 端末（特に Android の 2GB 未満）では有効化できない／部分的にしか有効化されない。
- 悪意あるページが**大量のクロスサイト iframe を生成してプロセスを枯渇させる**リソース枯渇攻撃（DoS）に悪用されうる。〔補足（一般知識）〕Chrome はプロセス数上限を設けてプロセスを再利用するが、上限に達した状態では**別 site が同一プロセスを共有する**ため、分離保証が弱まる方向の副作用がある。

#### 8.2 site 粒度であること（origin 粒度ではない）

- **同一サイト内（サブドメイン間）は同一プロセス**になりうる。`a.example.com` の XSS から `b.example.com` のデータへ、Spectre を使わずとも同一プロセス経由で近づける余地が残る。
- 対策は `IsolateOrigins` ポリシー（管理者側）または `Origin-Agent-Cluster: ?1`（サイト側）。

#### 8.3 プロセスロックされていないレンダラ

> Some sites are hosted in a renderer process that is **not locked to any particular site**, and if an attacker compromises an **unlocked renderer process**, they may try to abuse protection gaps.

〔補足（一般知識）〕Android の部分分離モードや、プロセス上限到達時、あるいは特定のスキーム（`about:`、`data:` など）の扱いによって「ロックされていないプロセス」が生じる。ロックが無いプロセスでは「そのプロセスはどの site を名乗れるか」という判定材料が無いため、IPC 検証が甘くなる。

#### 8.4 IO スレッドでの検証の限界

> When `CanAccessDataForOrigin` runs on the **IO thread**, it **cannot protect isolated sites against being accessed from an unlocked renderer process**, and **some web storage protections depend on `CanAccessDataForOrigin` calls on the IO thread**.

実装上の既知ギャップ。IO スレッド上の検証は UI スレッドが持つ完全な情報（どのプロセスがどの site にロックされているか）を参照できない設計上の制約があり、ストレージ保護の一部がこれに依存している。

#### 8.5 Site Isolation は Spectre を「直す」わけではない

最も重要な限界。Site Isolation は **CPU の投機実行の穴を塞がない**。「読まれても困らない状態にする」だけである。したがって:

| 残るリスク | 内容 |
|---|---|
| 同一プロセス内のデータは依然読まれる | 自サイトの機密データ（トークン、他ユーザのデータ）を同一プロセスに載せれば、自サイト上の XSS や悪意ある広告スクリプトからは Spectre で読める |
| no-cors で引き込んだ応答 | CORB/ORB のヒューリスティックを通り抜けた応答（正しい `Content-Type` が付いていない機密 JSON など）は読まれうる |
| タイミング副チャネル一般 | Site Isolation はプロセス分離であり、**クロスサイトのタイミング観測（XS-Leaks）そのものは防げない**〔補足（一般知識）〕 |
| Android の非分離サイト | ヒューリスティックに載らないサイトは分離されない |
| 他ブラウザ / 古いブラウザ | leaky.page PoC の記述どおり「other modern browsers are similarly vulnerable」 |

---

### 9. 脆弱性ハンティング／セキュリティ診断のためのチェックリスト（防御・診断目的、許可された検証を前提）

〔補足（一般知識）〕以下は本ノートで確認した原典の技術内容から導いた実務チェックリストであり、原典に箇条書きとして存在するものではない。

#### 9.1 サイト側の設定確認

| # | 確認項目 | 期待値 / 確認方法 |
|---|---|---|
| 1 | 機密 JSON API の `Content-Type` | `application/json` 等が正しく付いているか（`text/html` や `text/plain` で返していないか） |
| 2 | `X-Content-Type-Options` | 機密／ユーザ固有コンテンツの URL に `nosniff` が付いているか |
| 3 | `Cross-Origin-Resource-Policy` | 機密リソースに `same-origin`（または `same-site`）が付いているか |
| 4 | Cookie 属性 | `HttpOnly` + `SameSite`（`Lax` または `Strict`）。`document.cookie` を読むコードがないか |
| 5 | Fetch Metadata | `Sec-Fetch-Site: cross-site` の状態変更リクエストをサーバ側で拒否しているか |
| 6 | COOP / COEP | 機密を扱うトップレベル文書に `Cross-Origin-Opener-Policy: same-origin` が付いているか。`self.crossOriginIsolated` の値 |
| 7 | `document.domain` | 使用していないか。使っている場合 `Origin-Agent-Cluster: ?0` に依存していないか |
| 8 | `Origin-Agent-Cluster: ?1` | サブドメイン間の同期アクセスが不要なら宣言しているか（origin 粒度分離の獲得） |
| 9 | `X-Frame-Options` / CSP `frame-ancestors` | Site Isolation がブラウザプロセス側で判定材料にする。設定漏れがないか |

#### 9.2 挙動の観測

| # | 観測 | 手段 |
|---|---|---|
| 1 | どのフレームがどのプロセスに載っているか | `chrome://process-internals`、Chrome のタスクマネージャ |
| 2 | CORB/ORB によるブロック | DevTools Console の `Cross-Origin Read Blocking (CORB) blocked cross-origin response ...` 警告 |
| 3 | cross-origin isolation の成立 | Console で `self.crossOriginIsolated` |
| 4 | `unload` 経路の通信 | **DevTools では見えない**。外部プロキシで観測する |
| 5 | レイアウト非同期化による競合 | サイズ変更 → `postMessage` → 即測定 のパターンを grep で探す |

#### 9.3 報告時の観点

- 「レンダラ側のチェックだけを迂回した」は、ブラウザプロセス側の IPC 検証で止まるなら Chrome のバグではない。**Site Isolation の境界を越えたか**が評価軸。
- サイト側の報告としては「機密 JSON が `nosniff` 無し / 誤った `Content-Type` で提供されており、CORB/ORB の保護対象にならない」は**実務的に価値のある指摘**（Spectre / XS-Leaks 双方の前提を作るため）。
- Chrome 本体のバグは `crbug.com` に報告する。

---

### 10. 用語集（本ノート内の定義まとめ）

| 用語 | 定義 |
|---|---|
| **Site Isolation** | サンドボックス化されたレンダラプロセスを Web サイト間のセキュリティ境界として使う Chromium の取り組み。各レンダラプロセスを単一 site の文書にロックし、クロスサイトデータをフィルタする |
| **site** | **scheme + eTLD+1**。サブドメイン・ポート・パスは無視。origin より粗い |
| **origin** | scheme + host + port |
| **eTLD / public suffix** | `com`, `co.jp`, `github.io` など実質的なトップレベルドメイン |
| **eTLD+1 / registrable domain** | eTLD にラベル1つ足したもの |
| **OOPIF（out-of-process iframe）** | 親フレームと別プロセスに置かれた iframe。Chrome 56 で拡張機能向けに先行、Chrome 67 で全クロスサイト iframe に適用 |
| **SiteInstance** | 同一 BrowsingInstance 内の同一 site の文書群。互いにスクリプト可能なので同一プロセスに載る |
| **BrowsingInstance** | HTML 仕様の "unit of related browsing contexts"。`window.open` や target 付きリンクで繋がった window 群 |
| **process lock / site locking** | レンダラプロセスに「この site の文書だけ」という制約を掛けること |
| **`CanAccessDataForOrigin`** | ブラウザプロセス側で「このレンダラはこの origin のデータにアクセスしてよいか」を判定する関数。IO スレッド上では保護に限界がある |
| **CORB（Cross-Origin Read Blocking）** | クロスサイトの HTML/XML/JSON 応答をレンダラに渡さない仕組み。ブロック時は空の body + ヘッダ除去 |
| **ORB（Opaque Response Blocking / CORB++）** | CORB の後継。no-cors で正当な型（CSS/JS/画像/メディア）以外を可能な限りブロック。ブロック時は**ネットワークエラー** |
| **opaque-blocklisted MIME type** | HTML MIME type、JSON MIME type、XML MIME type |
| **Spectre** | 投機実行を悪用して本来読めないメモリを副チャネル経由で読む攻撃。Variant 1 = Bounds Check Bypass（CVE-2017-5753）、Variant 2 = Branch Target Injection（CVE-2017-5715） |
| **Meltdown** | Rogue Data Cache Load（CVE-2017-5754）。特権メモリをユーザ空間から投機的に読む |
| **投機実行（speculative execution）** | 分岐結果が確定する前に先行実行する CPU の高速化機構。結果は破棄されるが**キャッシュ状態は残る** |
| **`SharedArrayBuffer`** | 共有メモリ。Worker と組んで高精度タイマーになるため Chrome 63（2018-01-05）で無効化。Chrome 92 以降は cross-origin isolation が必須 |
| **`performance.now()`** | 高精度タイマー。解像度を 5μs → 100μs に低下＋一様ジッタ。Chrome 91 で全プラットフォーム 100μs、cross-origin isolated なら 5μs |
| **cross-origin isolation** | `COOP: same-origin` + `COEP: require-corp`(or `credentialless`) により、意図しないクロスオリジンリソースが載らないことを保証した状態。`self.crossOriginIsolated === true` |
| **COOP** | `Cross-Origin-Opener-Policy`。トップレベルのブラウジングコンテキストをクロスオリジンのポップアップから隔離 |
| **COEP** | `Cross-Origin-Embedder-Policy`。全クロスオリジンサブリソースに CORP でのオプトインを要求（`require-corp`）または認証情報なしで読み込む（`credentialless`） |
| **CORP** | `Cross-Origin-Resource-Policy`。リソース側が no-cors 取得の許可範囲を宣言（`same-origin` / `same-site` / `cross-origin`） |
| **`Origin-Agent-Cluster`** | `?1` で origin-keyed agent cluster（`document.domain` 無効・origin 粒度分離可）、`?0` で site-keyed にオプトアウト（`document.domain` 延命） |
| **`document.domain` セッタ** | 同一サイト内の異なる origin 間で同期アクセスを可能にする旧機能。Chrome 115（2023年7月頃）で既定無効 |
| **Project Fission** | Firefox の Site Isolation 相当プロジェクト |
| **UXSS（universal XSS）** | ブラウザ自体の欠陥により同一オリジンポリシーを越えてスクリプトを実行できる脆弱性。Site Isolation はこれの被害範囲も縮小する |
| **leaky.page** | Google が 2021年3月に公開した Spectre V1 の PoC。Chrome 88 / Intel Skylake で 1 kB/s |
| **Fetch Metadata** | `Sec-Fetch-Site` / `Sec-Fetch-Mode` / `Sec-Fetch-Dest` / `Sec-Fetch-User` によるリクエスト文脈のサーバ側判定 |

---

## 読者が自分で開くべき資料

本ノートの担当3URLは**全て取得できなかった**（エグレスポリシーによるドメインブロック）。読者は自分の環境で必ず原典を開き、以下を確認すること。

### 1. https://developer.chrome.com/blog/site-isolation （"Site Isolation for web developers", 2018年7月11日）

**取得できなかった理由**: WebFetch が `EGRESS_BLOCKED`（`developer.chrome.com` がドメイン単位で許可されていない）。curl も CONNECT 段階で 403。web.archive.org / raw.githubusercontent.com 経由も到達不可。

**読みどころ（優先順）**
1. **"Site Isolation in a nutshell"** — Site Isolation が「追加の防御線」であるという位置づけの原文。
2. **"How Site Isolation works"** — レンダラを単一 site にロックする仕組みと、クロスサイトナビゲーションが全てクロスプロセスになる説明。
3. **"What to watch out for"** — **本ノート §7 の全内容の原典**。特に `document.documentElement.clientWidth` を使った社交ウィジェットのコード例（本ノートでは擬似コードで再構成しただけなので、**原文のコードを必ず自分の目で確認すること**）と `123` / `456` の説明。
4. **unload ハンドラと DevTools の制約**の節 — 原文の正確な文言と、タイムアウト値に具体的な数値が書かれているかどうか。
5. **"Cross-Origin Read Blocking"** の節 — 記事が案内している詳細資料へのリンク（CORB for web developers / in-depth CORB explainer）。
6. **セッションストレージ・Cookie に関する記述** — 本ノート §7.5 は文脈が確認できていないので、原文で「isolated site」がどのモードを指すのか確認すること。
7. **性能・メモリの節** — 10〜13% という数値が記事本文に書かれているかどうか。

### 2. https://developer.chrome.com/blog/meltdown-spectre （"Meltdown/Spectre", 2018年2月頃）

**取得できなかった理由**: 同上（`developer.chrome.com` のドメインブロック）。

**読みどころ（優先順）**
1. **Project Zero の公表（2018年1月3日）と脆弱性の性質**の説明 — 「プロセスに属さないメモリを読める」という一文。
2. **「攻撃には信頼できる正確なタイマーが必要」**という記述 — Chrome の全緩和策の設計理由がここに集約されている。
3. **`SharedArrayBuffer` を無効化した理由** — 「専用 Worker がカウンタをインクリメントし、メインスレッドがタイマーとして読む」という具体的な悪用手口の説明。
4. **`performance.now()` の数値** — 5μs → 100μs、および「ランダムな一様ジッタで解像度の復元を防ぐ」という記述の原文。
5. **開発者向けの推奨**（`SameSite` / `HttpOnly` / `document.cookie` を読まない / 正しい MIME タイプ / `nosniff`）の原文リスト。
6. **Site Isolation への案内**と、記事執筆時点での有効化手順（`chrome://flags` の記述）。
7. **著者名と Twitter への言及** — 本ノートでは著者を特定できなかった。

### 3. https://www.chromium.org/Home/chromium-security/site-isolation/ （Chromium Security: Site Isolation）

**取得できなかった理由**: WebFetch が `EGRESS_BLOCKED`（`www.chromium.org` がドメイン単位で許可されていない）。

**読みどころ（優先順）**
1. **Site Isolation が防ぐものの箇条書き（5項目）** — 本ノート §3.5 の表の原文。Cookie/ストレージ窃取、保存パスワード窃取、権限の悪用、HTML/XML/JSON 窃取、`X-Frame-Options` 突破。
2. **site の定義**（scheme + eTLD+1）と、**なぜ origin ではないのか**（`document.domain` による同期アクセス）の原文。
3. **プラットフォーム別の有効化状況** — デスクトップ Chrome 67 / Android Chrome 77 の記述と、Android のヒューリスティック（パスワード入力サイト、OAuth、RAM 閾値）の最新の記述。
4. **"Limitations" / "Known issues" 節** — 本ノート §8 で二次情報からしか拾えなかった部分。**リソース枯渇攻撃への悪用可能性**、**プロセスロックされていないレンダラ**、**IO スレッドでの `CanAccessDataForOrigin` の限界**についての原文。
5. **エンタープライズポリシーとコマンドラインフラグの正確な一覧** — `SitePerProcess` / `SitePerProcessAndroid` / `IsolateOrigins` / `IsolateOriginsAndroid`、`--site-per-process`、`--isolate-origins=...`、ワイルドカード構文 `https://[*.]corp.example.com`。
6. **`chrome://process-internals` など診断用ページの説明**（本ノートでは一般知識として補足しただけ）。
7. **ページ末尾のリンク集** — 設計文書（`chromium.org/developers/design-documents/site-isolation/`）、`process_model_and_site_isolation.md`、CORB 資料、USENIX Security 2019 論文への導線。

### 4. 併せて読むべき関連原典（本ノートでも二次情報として引用したが、原典は未取得）

| URL | 読みどころ |
|---|---|
| `https://www.usenix.org/system/files/sec19-reis.pdf` | Charlie Reis らの USENIX Security 2019 論文 "Site Isolation: Process Separation for Web Sites within the Browser"。**設計・実装・実測値の一次資料**。site 粒度を選んだ理由、互換性の実測、性能評価が最も詳しい |
| `https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md` | SiteInstance / BrowsingInstance / プロセス割り当ての実装レベルの定義 |
| `https://chromium.googlesource.com/chromium/src/+/main/docs/security/compromised-renderers.md` | 侵害されたレンダラに対する脅威モデルと防御の一覧。**既知の保護ギャップ**が明記されている |
| `https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/security/side-channel-threat-model.md` | "Post-Spectre Threat Model Re-Think"。脅威モデルの書き換えの原文 |
| `https://chromium.googlesource.com/chromium/src.git/+/refs/heads/main/docs/security/post-spectre-webdev.md` / `https://www.w3.org/TR/post-spectre-webdev/` | 開発者向け推奨の完全版（W3C ノートにもなっている） |
| `https://www.chromium.org/Home/chromium-security/ssca/` | "Mitigating Side-Channel Attacks"。Chrome の緩和策一覧の一次資料 |
| `https://www.chromium.org/Home/chromium-security/corb-for-developers/` | CORB の開発者向けガイド |
| `https://chromium.googlesource.com/chromium/src/+/master/services/network/cross_origin_read_blocking_explainer.md` | CORB explainer（アルゴリズムの詳細、統計） |
| `https://github.com/annevk/orb` | ORB の仕様提案。CORB との差分がここに書かれている |
| `https://v8.dev/blog/spectre` | "A year with Spectre: a V8 perspective"。**ソフトウェア緩和が不十分である理由**の最良の説明 |
| `https://security.googleblog.com/2021/03/a-spectre-proof-of-concept-for-spectre.html` / `https://leaky.page/` | Spectre PoC の解説と実測値（1 kB/s 等） |
| `https://web.dev/articles/coop-coep` / `https://web.dev/articles/cross-origin-isolation-guide` | COOP/COEP の導入手順（Report-Only での段階移行を含む） |
| `https://developer.chrome.com/blog/cross-origin-isolated-hr-timers` | タイマー解像度と cross-origin isolation の関係（100μs / 5μs） |
| `https://developer.chrome.com/blog/document-domain-setter-deprecation` / `https://developer.chrome.com/blog/immutable-document-domain` | `document.domain` 廃止と `Origin-Agent-Cluster` の移行手順 |
| `https://chromium.googlesource.com/chromium/src/+/main/docs/transcripts/wuwt-e09-site-isolation.md` | "What's Up With Site Isolation"（2023年、Sharon と Charlie の対話形式）。**入門として最も読みやすい** |
| `https://developer.chrome.com/blog/document-isolation-policy` / `https://github.com/WICG/document-isolation-policy` | COEP の制約なしに cross-origin isolation 相当を得る後続提案 |
| `https://chromeenterprise.google/policies/site-per-process/` / `https://chromeenterprise.google/policies/isolate-origins/` | エンタープライズポリシーの正式リファレンス |

---

## 本ノート作成時に実際に参照できた二次情報（WebSearch 経由）

原典が読めなかったため、以下の検索結果に現れた引用・要約を材料にした。各引用の完全な前後文脈は未確認である。

- `security.googleblog.com/2018/07/mitigating-spectre-with-site-isolation.html`（Site Isolation による Spectre 緩和）
- `security.googleblog.com/2021/07/protecting-more-with-site-isolation.html`（Android / OAuth への拡大）
- `security.googleblog.com/2021/03/a-spectre-proof-of-concept-for-spectre.html`（leaky.page）
- `www.chromium.org/developers/design-documents/site-isolation/`（設計文書：site 定義、SiteInstance、BrowsingInstance、防ぐものの一覧）
- `chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md`
- `chromium.googlesource.com/chromium/src/+/main/docs/security/compromised-renderers.md`
- `chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/security/side-channel-threat-model.md`
- `chromium.googlesource.com/chromium/src.git/+/refs/heads/main/docs/security/post-spectre-webdev.md`
- `www.chromium.org/Home/chromium-security/ssca/`
- `www.chromium.org/Home/chromium-security/corb-for-developers/`
- `chromium.googlesource.com/chromium/src/+/master/services/network/cross_origin_read_blocking_explainer.md`
- `github.com/annevk/orb`, `chromestatus.com/feature/4933785622675456`, `chromestatus.com/feature/5166834424217600`
- `v8.dev/blog/spectre`
- `web.dev/articles/coop-coep`, `web.dev/articles/cross-origin-isolation-guide`
- `developer.mozilla.org`（COOP / COEP / `crossOriginIsolated` / `Permissions-Policy: cross-origin-isolated` の各リファレンス）
- `developer.chrome.com/blog/cross-origin-isolated-hr-timers`
- `developer.chrome.com/blog/document-domain-setter-deprecation`, `developer.chrome.com/blog/immutable-document-domain`
- `chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/security/document-domain.md`
- `chromium.googlesource.com/chromium/src/+/main/docs/transcripts/wuwt-e09-site-isolation.md`
- `chromeenterprise.google/policies/site-per-process/`, `chromeenterprise.google/policies/isolate-origins/`
- `www.usenix.org/system/files/sec19-reis.pdf`（USENIX Security 2019 論文）
- `en.wikipedia.org/wiki/Spectre_(security_vulnerability)`, `en.wikipedia.org/wiki/Meltdown_(security_vulnerability)`, `en.wikipedia.org/wiki/Site_isolation`
- Red Hat / Dell / CISA の Meltdown-Spectre アドバイザリ（CVE 番号とバリアント名の確認用）
