# Site Isolation と Spectre/Meltdown — プロセス分離でサイドチャネルを封じる

> **この節で分かること**
> - Spectre / Meltdown が「投機実行（speculative execution）」と「キャッシュのタイミング差」を使って、本来読めないメモリを盗む仕組みを説明できる。
> - なぜブラウザが「同一プロセスに載っているデータは全部読まれる」という前提へ脅威モデルを書き換えたのかを説明できる。
> - Chrome の Site Isolation が「レンダラを単一 site にロックする」とはどういうことか、`site`（scheme + eTLD+1（=登録可能ドメイン。§5.2 で定義））という単位の意味とともに説明できる。
> - CORB / ORB / COOP / COEP / `Origin-Agent-Cluster` といった防御ヘッダが、それぞれ何を守るために生まれたのかを対応づけて説明できる。
> - バグハンターとして、機密 JSON の `Content-Type` や `nosniff`、cross-origin isolation の状態を自分で確認し、報告に値する設定不備を見つけられる。

**元資料**:
- https://developer.chrome.com/blog/meltdown-spectre （原典は取得できず二次情報ベース）
- https://developer.chrome.com/blog/site-isolation （原典は取得できず二次情報ベース）
- https://www.chromium.org/Home/chromium-security/site-isolation/ （原典は取得できず二次情報ベース）

**関連する節**: 同一オリジンポリシー（SOP）、CORS、Fetch Metadata、XS-Leaks の各節

> **信頼性の前提**: この節の担当3 URL はいずれも本教科書の執筆環境から直接取得できなかった（組織のエグレスポリシーによるドメインブロック）。以下の記述は WebSearch 経由で得られた原典からの引用・要約（二次情報）と、明示的に区別した〔補足〕から構成する。逐語で示す英文は「検索結果に引用として現れた文」であり、原典での完全な前後文脈は未確認である。原典に存在しない機能名・URL・数値は書いていない。読者は各原典を必ず自分の環境で開いて確認してほしい（後述の 📌 ブロック参照）。

---

## 1. なぜこの話から始めるのか — ソフトウェアの壁をハードウェアが貫通した

ブラウザのセキュリティは長らく「ソフトウェアの境界」で組み立てられてきた。同一オリジンポリシー（Same-Origin Policy, SOP）で「別オリジンの中身は読ませない」と決め、サンドボックスで「レンダラは OS に直接触れない」と決める。ところが 2018 年、この前提を根っこから揺るがす脆弱性が公表された。それが **Spectre** と **Meltdown** である。

この節は、Spectre/Meltdown という「CPU の脆弱性」が、なぜ **Site Isolation**（サイト分離）という「ブラウザのプロセス構造の作り直し」に行き着いたのか、その因果を追う。バグハンターにとって重要なのは攻撃コードそのものより、**この事件のあとに Web プラットフォームへ次々と足された防御ヘッダ群（CORB / ORB / COOP / COEP / CORP / Fetch Metadata / `Origin-Agent-Cluster`）が、すべてこの一つの結論から派生している**という設計の地図を持つことである。

## 2. Spectre / Meltdown の正体 — 投機実行とキャッシュの副チャネル

### 2.1 何が起きたのか

Google の **Project Zero**（グーグルの脆弱性研究チーム）が 2018 年 1 月 3 日に公表した。原典 `developer.chrome.com/blog/meltdown-spectre` の導入部として検索結果に現れた記述はこうだ。

> Project Zero revealed vulnerabilities in modern CPUs that a process can use to read arbitrary memory, including memory that doesn't belong to that process, named Spectre and Meltdown.

本質は一行で言える。「あるプロセスが、**そのプロセスに属さないメモリを含む任意のメモリを読める**」。OS のプロセス分離やブラウザのサンドボックスというソフトウェアの境界を、ハードウェアの投機実行が貫通してしまう。

〔補足〕この原典記事の公開日は、検索結果に現れたメタデータ上は **2018 年 2 月 6 日**（記事メタデータ由来の二次情報で、原典本文では未確認）。記事の締めくくりは検索結果上「If you have any questions, feel free to reach out to me on Twitter」となっており、**著者名は特定できなかった**。これらは事実確度の低い二次情報なので、正確な情報は後述の 📌 ブロックから原典を開いて確認してほしい。

投機実行（speculative execution, スペキュレイティブ・エグゼキューション）とは、分岐（if 文など）の結果が確定する前に、CPU が「たぶんこっちだろう」と先回りして命令を実行しておく高速化の仕組みのこと。予測が外れたら結果は破棄されるので、プログラムの見かけの動作は変わらない。たとえば、渋滞を予想して先に別ルートへ車を走らせておき、間違っていたら戻す、というイメージである。

### 2.2 攻撃の必須条件は「高精度タイマー」

破棄されるはずの投機実行が、なぜ情報漏洩になるのか。鍵は「**アーキテクチャ上の状態（レジスタやメモリの最終値）には残らないが、キャッシュには痕跡が残る**」という点にある。原典の該当文はこうだ。

> To exploit these vulnerabilities, an attacker needs to measure how long it takes to read a certain value from memory, requiring a reliable and accurate timer.

攻撃者は、ある配列要素を読む時間を測る。「速い＝キャッシュに載っている＝投機実行がさっき触った」と判定できる。この判定を繰り返すことで、本来読めない秘密を 1 ビットずつ復元する。これが「キャッシュのタイミング差という副チャネル（side channel, サイドチャネル）」である。副チャネルとは、本来の通信経路ではなく、処理時間・消費電力などの**副次的に漏れる情報**から中身を推測する経路のこと。

この「タイマーが要る」という一点が、Chrome の初期緩和策すべての設計理由を説明する。攻撃を止める道は3つに整理できる。

```
1. 高精度タイマーを奪う   → performance.now() の粗粒度化、SharedArrayBuffer 無効化
2. 投機実行のガジェットを潰す → V8 のコンパイラ緩和
3. 読める場所に秘密を置かない → Site Isolation / CORB / COOP+COEP  ← 最終解
```

### 2.3 3つのバリアントと CVE

〔補足〕CVE 番号と名称は公開アドバイザリの一般的な記載に一致する。

| CVE | 通称 | バリアント名 | 概要 |
|---|---|---|---|
| CVE-2017-5753 | Spectre | Variant 1 / Bounds Check Bypass | 配列境界チェックを投機的に乗り越えて範囲外を読む。ブラウザの JS から最も現実的に成立するのがこれ。 |
| CVE-2017-5715 | Spectre | Variant 2 / Branch Target Injection | 間接分岐予測器を汚染し、攻撃者が選んだアドレスのコードを投機実行させる。 |
| CVE-2017-5754 | Meltdown | Variant 3 / Rogue Data Cache Load | 特権（カーネル）メモリをユーザ空間から投機的に読む。 |

検索結果に現れた原典の記述。

> The first two variants abuse speculative execution to perform bounds-check bypass (CVE-2017-5753), or by utilizing branch target injection (CVE-2017-5715) to cause kernel code at an address under attacker control to execute speculatively.

> The issue is not specific to any one vendor and takes advantage of techniques that are commonly used in most of the modern processor architectures.

つまり**特定ベンダ固有ではなく、現代 CPU の共通設計に内在する**問題である。「CPU を替えれば安全」という前提は成立しない。

### 2.4 Web での現実的な威力：leaky.page

「理論上は読める」ではなく「JavaScript から実際に読める」ことを示したのが、Google が 2021 年 3 月に公開した Spectre V1 の実証コード（PoC）**leaky.page** である（出典: `security.googleblog.com` 2021-03 ／二次情報）。

| 条件 | 漏洩速度 |
|---|---|
| Chrome 88 / Intel Skylake CPU（公開 PoC の標準構成） | 1 kB/s |
| 低安定性のプロトタイプ | 8 kB/s |
| JavaScript タイマーのみを使う版（`SharedArrayBuffer` 不使用） | 60 B/s |

> Google's Leaky.Page PoC is a Spectre V1 gadget that is a JavaScript array that is speculatively accessed out of bounds.

> The project demonstrates that these issues are not specific to Chrome, and other modern browsers are similarly vulnerable to this exploitation vector.

含意は重い。**`SharedArrayBuffer` を無効化しても、JavaScript タイマーだけで 60 B/s は漏れる**。認証トークンやセッション Cookie を抜くにはそれで十分だ。だから「タイマーを粗くする」緩和は速度を落とす嫌がらせに過ぎず、本命はプロセス分離だ、という結論に直結する。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Meltdown/Spectre（Chrome for Developers ブログ, 2018年頃） — https://developer.chrome.com/blog/meltdown-spectre
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `developer.chrome.com` がドメイン単位でエグレスブロックされ、`curl`・web.archive.org・raw.githubusercontent.com 経由もすべて到達不可）。以下の記述は検索結果に現れた引用断片にもとづく要約である。
> **読みどころ**:
> 1. Project Zero の公表（2018年1月3日）と「プロセスに属さないメモリを読める」という脆弱性の性質。
> 2. 「攻撃には信頼できる正確なタイマーが必要」という一文 — Chrome の全緩和策の設計理由がここに集約されている。
> 3. `SharedArrayBuffer` を無効化した理由（専用 Worker がカウンタを増やし、メインスレッドがそれをタイマーとして読む手口）。
> 4. `performance.now()` の数値（5μs → 100μs）と「ランダムな一様ジッタで解像度の復元を防ぐ」という記述の原文。
> 5. 開発者向け推奨（`SameSite` / `HttpOnly` / `document.cookie` を読まない / 正しい MIME タイプ / `nosniff`）の原文リスト。
> **代替手段**: V8 チームの解説 `https://v8.dev/blog/spectre`（"A year with Spectre: a V8 perspective"）と、Spectre PoC 解説 `https://security.googleblog.com/2021/03/a-spectre-proof-of-concept-for-spectre.html` は無料で読め、同趣旨をより詳しく説明している。

## 3. Chrome の初期緩和と「ソフトウェア緩和の敗北宣言」

### 3.1 SharedArrayBuffer の無効化

`SharedArrayBuffer`（SAB, シェアードアレイバッファ）とは、複数のスレッド（メインスレッドと Worker）が同じメモリ領域を共有できる仕組みのこと。これがなぜ危険かというと、高精度タイマーの代わりになるからだ。

> SharedArrayBuffer Disabled: Chrome disabled SharedArrayBuffer in Chrome 63 starting on January 5th, 2018.

> SharedArrayBuffer can be used by a dedicated worker to increment a counter, with the main thread reading this counter as a timer.

専用 Worker が共有メモリ上のカウンタをひたすら `+1` し続け、メインスレッドがその値を読む。これは実質 CPU クロックに近い分解能のタイマーになり、`performance.now()` をいくら粗くしても迂回できてしまう。だから API そのものを落とすしかなかった。復活条件は後述するとおり「Site Isolation が既定で有効であること」である。

### 3.2 performance.now() の解像度低下

> performance.now() Resolution Reduced: In Chrome, the resolution of performance.now() was reduced from 5 microseconds to 100, and random uniform jitter was introduced to prevent resolution recovery.

| 項目 | 値 |
|---|---|
| 変更前の解像度 | 5 マイクロ秒 |
| 変更後の解像度 | 100 マイクロ秒 |
| 追加対策 | ランダムな一様ジッタ（random uniform jitter） |
| ジッタの目的 | 多数回測定の平均化による解像度の復元（resolution recovery）を防ぐ |

〔補足〕ジッタ（jitter, 揺らぎ）を乗せない場合、攻撃者は同じ測定を N 回繰り返して平均を取ると、実効解像度を 1/√N 程度まで取り戻せてしまう。一様ジッタはこの統計的復元を潰すために乗せる。

### 3.3 V8 のコンパイラレベル緩和

V8 とは Chrome の JavaScript エンジンのこと。Chrome 64 以降、その最適化コンパイラ **TurboFan** に緩和が入った。

> Starting in Chrome 64, Chrome's JavaScript engine V8 has included further mitigations which provide protection on platforms where Site Isolation is not enabled.

しかし V8 チーム自身が、ソフトウェア緩和の限界をはっきり認めている（`v8.dev/blog/spectre`）。

> Untrusted code can read a process's entire address space using Spectre and side channels, but software mitigations reduce the effectiveness of many potential gadgets without being efficient or comprehensive, with the only effective mitigation being to move sensitive data out of the process's address space.

> Such attacks can't be reliably mitigated at the software level, and robust solutions require security boundaries to be aligned with low-level primitives like process-based isolation.

これは「ソフトウェア緩和の敗北宣言」とも呼べる重要な結論である。**唯一有効な防御は、機密データをそのプロセスのアドレス空間から追い出すこと**。以降のすべての Web プラットフォーム機能（COOP/COEP/CORP/Fetch Metadata/SameSite）の根拠がここにある。「同一プロセスに載っているものは読まれる前提で設計せよ」という原則を、頭に刻んでおくとよい。

### 3.4 脅威モデルの書き換え（Post-Spectre Threat Model）

Chromium は脅威モデルそのものを書き換えた（`docs/security/side-channel-threat-model.md` ／二次情報）。

> Chromium's threat model now asserts that "active web content … will be able to read any and all data in the address space of the process that hosts it".

> Browsers need to align the origin boundary with the process boundary through fundamental refactoring projects like Chromium's Site Isolation and Firefox's Project Fission.

つまり各ブラウザは横並びで「origin／site の境界をプロセス境界に揃える」方向へ収束した。Firefox のそれが **Project Fission**、Chromium のそれが **Site Isolation** である。

### 3.5 開発者向けの推奨（原典より）

原典 meltdown-spectre 記事にも同趣旨の助言があったことが確認できる。

> The Chrome team advises web developers to prevent cookies from entering the renderer process' memory by using SameSite and HTTPOnly cookie attributes, avoid reading from document.cookie, ensure correct MIME types, and specify an `X-Content-Type-Options: nosniff` header for URLs with user-specific or sensitive content.

Chromium ドキュメント側の推奨を要約すると次の3点になる。

| # | 推奨 | 目的 |
|---|---|---|
| 1 | 受信ヘッダを検査する。特に `Origin` ヘッダと `Sec-Fetch-` 系ヘッダ群（Fetch Metadata） | 攻撃者サイトから誘発されたクロスサイト要求をサーバ側で拒否する |
| 2 | Cookie に `SameSite` と `HttpOnly` を付ける。ページ側で `document.cookie` を読まない | Cookie 値をレンダラのアドレス空間に入れない |
| 3 | 正しい MIME タイプを返す。機密 URL には `X-Content-Type-Options: nosniff` を付ける | CORB/ORB に確実に保護させる |

〔補足〕Fetch Metadata の主要ヘッダは `Sec-Fetch-Site`（`same-origin` / `same-site` / `cross-site` / `none`）、`Sec-Fetch-Mode`、`Sec-Fetch-Dest`、`Sec-Fetch-User`。「`Sec-Fetch-Site: cross-site` かつナビゲーション以外なら拒否」というポリシーをサーバ側に置くのが定石である。

### 3.6 タイマー粒度の最終形

その後、解像度は全プラットフォームで統一された（`developer.chrome.com/blog/cross-origin-isolated-hr-timers` ／二次情報）。

| 状態 | `performance.now()` 等の解像度 |
|---|---|
| cross-origin isolated でない（既定） | 100 μs（Chrome 91 以降、全プラットフォーム統一） |
| cross-origin isolated（COOP+COEP） | 5 μs |

> With cross-origin isolation, we can now allow pages to access high-resolution timers, SharedArrayBuffer, and other APIs that are unsafe to expose in processes that can read arbitrary cross-origin data.

また **Chrome 92** 以降、`SharedArrayBuffer` は cross-origin isolation なしでは使えなくなった。つまり「危険な API を返す代わりに、サイト側が『私のプロセスには意図しないクロスオリジンデータは無い』と証明しろ」という取引になった。その証明手段が後述の COOP + COEP である。

## 4. Site Isolation の定義 — レンダラを単一 site にロックする

ここからが本命である。Site Isolation の狙いは「読める場所に秘密を置かない」を、ブラウザのプロセス構造で実現することだ。

> Site Isolation is an effort to improve Chrome to use sandboxed renderer processes as a security boundary between web sites, even in the presence of vulnerabilities in the renderer process.

> Site Isolation locks each renderer process to documents from a single site and filters certain cross-site data from each process.

developer.chrome.com 側の位置づけはこうだ。

> Site Isolation is a security feature in Chrome that offers an additional line of defense to make attacks less likely to succeed.

> With Site Isolation, all cross-site navigations become cross-process, so that documents from different sites don't share a process with each other.

要は2本柱である。

```
Site Isolation の2本柱
├─ (1) プロセスロック（site locking）
│    1つのレンダラプロセスに載るのは「単一 site の文書だけ」
└─ (2) データフィルタ
     ネットワーク層でクロスサイトの機密応答をレンダラに渡さない（= CORB/ORB）
```

「追加の防御線（an additional line of defense）」という言い回しが重要だ。Site Isolation は Spectre を**直さない**。CPU の穴はそのままで、「読まれても価値のあるデータがそこに無い」状態を作るだけである。この限界は §12 で改めて扱う。

## 5. 「site」という単位 — scheme + eTLD+1（=登録可能ドメイン。§5.2 で定義）

### 5.1 なぜ origin ではなく site なのか

Site Isolation で最重要の定義がこれである。

> A page's site includes the scheme and registered domain name, including the public suffix, but ignoring subdomains, port, or path. This is more specific than an origin.

> Sites are defined as scheme plus eTLD+1, since different origins within a given site may have synchronous access to each other if they each modify their `document.domain`.

「なぜ origin（scheme + host + port）ではなく site（scheme + eTLD+1）という粗い単位なのか」の答えは、**`document.domain` の存在**にある。同一サイト内の異なる origin は、`document.domain` を書き換えると同期的に互いをスクリプトできてしまう。プロセス境界を origin に引くと、この同期アクセスができなくなり Web 互換性が壊れる。だからやむを得ず粗い site 粒度を選んだ。この妥協が後に「`document.domain` を殺して origin 粒度へ進める」という展開（§11）につながる。

### 5.2 用語の整理

- **eTLD（effective TLD / public suffix, 実効トップレベルドメイン）**: `com`、`co.jp`、`github.io` など、Public Suffix List に載る「実質的なトップレベル」。
- **eTLD+1（registrable domain, 登録可能ドメイン）**: eTLD にラベルを1つ足したもの。`example.co.jp`、`foo.github.io`。
- **origin（オリジン）**: scheme + host + port。サブドメインもポートも区別する。site より厳しい。
- **site（サイト）**: scheme + eTLD+1。サブドメイン・ポート・パスを無視する。origin より緩い。

### 5.3 同一 site 判定の例

| URL A | URL B | 同一 site か | 理由 |
|---|---|---|---|
| `https://www.example.com` | `https://foo.example.com` | 同一 site | scheme と登録ドメイン（`example.com`）が一致。サブドメインは無視。 |
| `https://www.example.com` | `http://www.example.com` | 別 site | scheme が違う |
| `https://www.example.com:443` | `https://www.example.com:8443` | 同一 site | ポートは無視 |
| `https://example.com/a` | `https://example.com/b` | 同一 site | パスは無視 |
| `https://foo.github.io` | `https://bar.github.io` | 別 site〔補足〕 | `github.io` は public suffix なので eTLD+1 は `foo.github.io` / `bar.github.io` になる |

〔補足〕Cookie の `SameSite` 属性が使う「same-site」判定も eTLD+1 ベースだが、そちらは scheme を含めるか（schemeful same-site）が段階導入された歴史がある。Site Isolation の site は最初から scheme を含む点が異なる。

## 6. SiteInstance / BrowsingInstance / OOPIF — 実装の骨格

### 6.1 プロセス割り当ての概念

Site Isolation がどのフレームをどのプロセスに載せるかは、2つの概念で決まる。まず関係を一言で言うと、**BrowsingInstance（大きな入れ物）⊃ SiteInstance（その中の site ごとの束）** という包含関係にある。BrowsingInstance は「互いに参照を持ち得る window の集合」という広い単位で、その内部を site 単位に切り分けたものが SiteInstance であり、SiteInstance 1つが原則1プロセスに載る。この関係を頭に置いてから、次の原文を読むとよい。

> SiteInstance refers to a group of documents within a unit of related similar-origin browsing contexts, and all documents within a SiteInstance may be able to script each other, so they must be rendered in the same process.

> A BrowsingInstance corresponds to the notion of a "unit of related browsing contexts" in the HTML5 spec and includes all browser objects that might be able to script each other because of how they were created (e.g., `window.open` or targeted links).

| 概念 | 粒度 | 意味 |
|---|---|---|
| BrowsingInstance | 関連するブラウジングコンテキストの集合 | `window.open()` や `target` 付きリンクで繋がった window 群。互いに参照を持ち得る。 |
| SiteInstance | BrowsingInstance 内の site 単位 | 同一 BrowsingInstance 内で同じ site の文書群。同一プロセスに載る。 |
| RenderProcess | OS プロセス | 原則 1 SiteInstance = 1 プロセス（プロセス数上限に達すると再利用されうる） |

〔補足〕`rel="noopener"` や COOP によって window 間の参照が切れると BrowsingInstance が分かれる（"BrowsingInstance swap"）。これが COOP がプロセス分離の前提条件になる理由である。

### 6.2 Out-of-Process iframe（OOPIF）

Site Isolation の実装上の核心が **OOPIF（out-of-process iframe, プロセス外 iframe）** である。親フレームと別 site の子 iframe を、別々のプロセスに置く。

> All cross-site iframes are put into a different process than their parent frame, using "out-of-process iframes."

> As of Chrome 56, Chrome started using out-of-process iframes to keep web content out of privileged extension processes.

```
1つのタブに見えるページ（プロセス境界をまたぐフレームツリー）

  親ページ  https://example.com          … プロセス A
    └─ iframe  https://ads.other.com      … プロセス B（別 site → 別プロセス）
         └─ iframe  https://example.com    … プロセス A に戻る（同一 site）
```

フレームツリーはプロセス境界をまたいで存在し、境界の向こう側はプロキシオブジェクトで繋がる。Chrome 56 で拡張機能プロセスから Web コンテンツを追い出す目的で先行利用され、Chrome 67 で全クロスサイト iframe に一般化された。

## 7. Site Isolation が防ぐもの、そして多層防御

### 7.1 防げる攻撃の一覧（原典の逐語）

これは中核リストなので原文とともに丸ごと載せる。

| 防げる攻撃 | 原文（引用） |
|---|---|
| クロスサイト Cookie / ストレージの窃取 | Stealing cross-site cookies and HTML5 stored data – Site Isolation prevents a renderer process from receiving cookies or stored data from sites other than its own. |
| 保存済みパスワードの窃取 | Stealing saved passwords – Site Isolation prevents a renderer process from receiving saved passwords from sites other than its own. |
| 他サイトに付与された権限の悪用 | Abusing permissions granted to another site – ... permissions such as geolocation that the user has granted to other sites. |
| クロスサイト HTML/XML/JSON の窃取 | Stealing cross-site HTML, XML, and JSON data – Using MIME type and content sniffing, Site Isolation prevents a renderer process from loading most sensitive cross-site data. |
| `X-Frame-Options` の突破 | Compromising X-Frame-Options – ... allowing the browser process to decide if a given site can be loaded in an iframe based on `X-Frame-Options` or CSP `frame-ancestors` headers. |

Spectre 対策としての理由を一行で述べた原文がこれである。

> By tricking CPU branch predictors into speculatively reading memory outside JavaScript array bounds, malicious code running in a renderer process could exfiltrate any data loaded anywhere within that same process memory space.

また Site Isolation はデスクトップで **UXSS（universal cross-site scripting）** — ブラウザ自体の欠陥で SOP を越えてスクリプト実行できる脆弱性 — や、完全に乗っ取られたレンダラに対しても被害範囲を縮小する。

### 7.2 侵害されたレンダラに対する多層防御

Site Isolation は単体ではなく、サンドボックス・IPC 検証と組み合わさって効く（`docs/security/compromised-renderers.md` ／二次情報）。

> The combination of Chrome's sandbox, IPC security checks, and Site Isolation limit what an untrustworthy renderer process can do, protecting Chrome users against attackers even when such attackers are able to bypass security logic in the renderer process.

| 層 | 役割 |
|---|---|
| OS サンドボックス | レンダラから OS リソースへの直接アクセスを遮断 |
| IPC セキュリティチェック | レンダラの要求（Cookie 取得、ストレージ読み、権限利用）をブラウザプロセス側で検証。中核関数が `CanAccessDataForOrigin` |
| Site Isolation（プロセスロック） | そのプロセスがどの site を名乗れるかを固定し、上記検証の判定材料にする |

〔補足〕検証に失敗した IPC はレンダラの強制終了（renderer kill）につながる。「レンダラ側のチェックは UX のため、真の検証はブラウザプロセス側」という原則は、バグバウンティで「レンダラ側チェックだけを迂回できたが browser 側で止まった」ケースの評価軸になる。

## 8. 有効化の歴史と設定手段

### 8.1 バージョンごとの歩み

| バージョン | 内容 |
|---|---|
| Chrome 56 | OOPIF を拡張機能プロセスから Web コンテンツを追い出す目的で先行利用 |
| Chrome 63 | Site Isolation をオプトインで有効化可能。同時に `SharedArrayBuffer` を無効化（2018-01-05） |
| Chrome 64 | V8 に追加のソフトウェア緩和 |
| Chrome 67（2018年5月〜） | デスクトップで全サイトに既定有効。メモリオーバーヘッドは約 10〜13% |
| Chrome 77（2019年10月） | Android でログインするサイトを分離（RAM 2GB 以上のほぼ全端末） |
| Chrome 91 | タイマー解像度を全プラットフォーム 100μs に統一、cross-origin isolated なら 5μs |
| Chrome 92 | OAuth ベースのログインを認識して分離、拡張機能へも拡大。`SharedArrayBuffer` は cross-origin isolation 必須に |
| Chrome 115（2023年7月頃） | `document.domain` セッタを既定で無効化（origin-keyed agent cluster を既定に） |

Android の運用は「全サイト分離はコストが高すぎる」ため、リスクの高いサイトを優先するヒューリスティック方式である。

> Site Isolation for all sites continues to be too costly for most Android devices, so the strategy is to improve heuristics for prioritizing sites that benefit most from added protection.

> Starting in Chrome 92, Site Isolation will recognize common OAuth interactions and protect sites relying on OAuth-based login.

**バグハンター視点**: Android Chrome では分離されていない site が普通に存在する。「パスワード入力実績がある」「OAuth を経由した」というヒューリスティックに載っていない site 同士は同一プロセスを共有しうる。ターゲットが Android で機密データを扱うなら、自サイト側で COOP/COEP を張るか、そもそも同一プロセスに機密を置かない設計が要る。

### 8.2 有効化・設定の手段（逐語）

**ユーザ操作のフラグ**

```text
chrome://flags#enable-site-per-process
```

> Visit chrome://flags#enable-site-per-process, click Enable, and restart.

**コマンドラインフラグ**

```text
--site-per-process
--isolate-origins=<comma-separated list of origins>
```

**エンタープライズポリシー**

| ポリシー名 | プラットフォーム | 効果 |
|---|---|---|
| `SitePerProcess` | Desktop（Chrome OS 含む） | 全サイトを分離。Enabled にするとユーザがオプトアウトできなくなる |
| `SitePerProcessAndroid` | Android | Android 版の同等ポリシー |
| `IsolateOrigins` | Desktop | 指定した origin ごとに専用プロセス。そのプロセスには指定 origin とそのサブドメインの文書しか入らない |
| `IsolateOriginsAndroid` | Android | Android 版 |

> Since Google Chrome 77, you can specify a range of origins to isolate using a wildcard, such as `https://[*.]corp.example.com` to give every origin underneath `https://corp.example.com` its own dedicated process.

ワイルドカード構文（逐語）。

```text
https://[*.]corp.example.com
```

**診断用の内部ページ**

```text
chrome://process-internals
```

〔補足〕`chrome://process-internals` は、どのフレームがどのプロセス／SiteInstance に載っているかを一覧できる内部ページ。挙動検証やバグ報告時の証跡取得に使う。`IsolateOrigins` は site より細かい origin 粒度の分離を後付けで得る手段であり、社内ポータルだけを隔離したい場合に使う。Web 側から `Origin-Agent-Cluster: ?1` を送る方法（§11）はその「サイト側からの宣言版」に相当する。

## 9. CORB — クロスサイトの機密応答をレンダラに渡さない

### 9.1 なぜ必要か

プロセスをロックしても、`<script src>` や `<img src>` のような **no-cors（CORS 不要）で取得できるサブリソース**は、同一プロセスのメモリに「読めない前提の応答」を運び込んでしまう。Spectre はその「読めない前提」を無効化する。だから**そもそもレンダラに渡さない**必要がある。これが **CORB（Cross-Origin Read Blocking, クロスオリジン読み取りブロック）** の役割である。

> Cross-Origin Read Blocking (CORB) is a web platform security feature that helps mitigate side-channel attacks and prevents the browser from delivering certain cross-origin network responses to a web page when they might contain sensitive information.

> Blocking such resources prevents a malicious web page from using Spectre to read a cross-origin resource pulled into an OOPIF process via a no-cors request.

### 9.2 何をどうブロックするか

> CORB blocks cross-origin `text/html` responses requested from `<script>` or `<img>` tags, replacing them with an empty response instead.

> When CORB protects a response, the response body is replaced with an empty body and the response headers are removed.

対象は HTML / XML / JSON（さらに PDF や ZIP も対象例に挙がる）。判定は MIME タイプと、`nosniff` の有無で変わる。

| 条件 | CORB の挙動 |
|---|---|
| `Content-Type` が HTML/XML/JSON 系 かつ `X-Content-Type-Options: nosniff` あり | スニッフィングせず即ブロック（最も確実に保護される） |
| `nosniff` なし | 応答先頭をスニッフィングし、HTML/XML/JSON と確認できた場合のみブロック（誤検知回避） |
| 画像・スクリプト・CSS・音声動画として正しくラベル付けされている | ブロックしない（正当な no-cors 利用を壊さない） |

スニッフィング（sniffing）とは、`Content-Type` を鵜呑みにせず、応答の先頭バイトを見て中身の種類を推測すること。

### 9.3 DevTools のメッセージと互換性

CORB がブロックすると、DevTools のコンソールに警告が出る（逐語）。

```text
Cross-Origin Read Blocking (CORB) blocked cross-origin response http://localhost:8080/rest/users/login with MIME type application/json. See https://www.chromestatus.com/feature/5629709824032768 for more details
```

互換性への影響はごくわずかだと報告されている。

> Only 0.115% of CORB-eligible responses might have been observably blocked due to a `nosniff` header or range request (206 partial responses).

**開発者がやるべきこと**（逐語）。ユーザ固有 JSON や CSRF トークンを含むページには次を付ける。

```text
Content-Type: application/json
X-Content-Type-Options: nosniff
```

〔補足〕さらに強い保護として `Cross-Origin-Resource-Policy: same-origin` を付けると、ヒューリスティックに頼らず明示的にクロスオリジンの no-cors 取得を拒否できる。JSON API には「`nosniff` + 正しい `Content-Type` + `CORP: same-origin` + Fetch Metadata による拒否」を組み合わせるのが現在の定石である。

## 10. ORB — CORB の後継（CORB++）

### 10.1 設計思想の反転

**ORB（Opaque Response Blocking, 不透明応答ブロック）** は CORB の置き換えで、しばしば **CORB++** と呼ばれる。

> Opaque Response Blocking (ORB) is a replacement for Cross-Origin Read Blocking (CORB). ORB is often referred to as "CORB++" and expands on CORB's protection mechanisms.

ORB の中核用語が **opaque-blocklisted MIME type（不透明ブロックリスト MIME タイプ）** である。これは **HTML MIME タイプ・JSON MIME タイプ・XML MIME タイプ**を指す語で、「クロスオリジンで読めてしまうと危険なので、レンダラに透過させず（＝opaque なまま）ブロックすべき型」という意味である。

> An opaque-blocklisted MIME type is an HTML MIME type, JSON MIME type, or XML MIME type.

〔補足〕さらに W3C/WHATWG の TAG レビューには **opaque-blocklisted-never-sniffed MIME types** というカテゴリもある。これはスニッフィングを一切せず**常にブロックすべき型**（例: `application/zip`、`application/pdf` など）を指す。HTML/JSON/XML が「スニッフして疑わしければブロック」なのに対し、こちらは問答無用でブロックされる、と押さえておけばよい。

> CSS, JavaScript, images, and media (audio and video) can be requested across origins without CORS. Except for CSS there is no MIME type enforcement. ORB still blocks as many responses as possible that are not one of these types...

重要なのは発想の反転である。

- **CORB**: 「HTML/XML/JSON **らしいもの**をブロックする」＝ブロックリスト型
- **ORB**: 「no-cors で正当に取得できる型（CSS/JS/画像/メディア）**以外はできるだけブロックする**」＝許可リスト寄り

### 10.2 CORB との差分

| 観点 | CORB | ORB |
|---|---|---|
| ブロック対象の決め方 | HTML/XML/JSON を検出してブロック（ブロックリスト型） | 許される型以外をブロック（許可リスト寄り） |
| ブロック時の見せ方 | 空のレスポンスを注入（body 空・ヘッダ除去） | ネットワークエラーを発生させる |
| スニッフィング対象 | HTML / JSON / XML | 完全版 ORB は JavaScript もスニッフィング（v0.1 は HTML/JSON/XML） |
| 段階導入 | — | **v0.1 → v0.2** の2段階で blink-dev の Intent to Ship を経て投入された |

> ORB specifies error handling for blocked resources differently from CORB: ORB raises network errors, while CORB injects an empty response.

ORB はいきなり全面適用されたのではなく、**v0.1 → v0.2** という2段階で、Chromium の blink-dev メーリングリストでの Intent to Ship を経て段階導入された。各段階の chromestatus フィーチャエントリの ID は以下のとおり（逐語）。

```text
ORB v0.1  chromestatus feature ID: 4933785622675456
ORB v0.2  chromestatus feature ID: 5166834424217600
```

仕様提案は `https://github.com/annevk/orb` にある。

**バグハンター／診断上の含意**: ブロック時の挙動が「空応答」から「ネットワークエラー」へ変わることは、エラーイベントの有無を観測する **XS-Leaks** の成立条件を変える。`<img onerror>` / `<script onerror>` の発火有無や `fetch` の reject タイミングで「その応答がブロック対象だったか（＝その URL が HTML/JSON を返したか）」を推測できる余地が生じる。応答形状の差異がオラクル（真偽を返す観測装置）にならないかを、許可された検証の範囲で確認する価値がある。

## 11. COOP / COEP と cross-origin isolation

### 11.1 なぜ必要か

Site Isolation はブラウザが勝手にやってくれる防御だが、危険な API（高精度タイマー、`SharedArrayBuffer`）を解禁するには、**サイト側が「私のプロセスには意図しないクロスオリジンデータが入っていない」ことを保証**しなければならない。その宣言手段が COOP + COEP である。

> Cross-origin isolation provides the standard baseline for browsers to run pages in an isolated environment such that they are unable to load unwilling cross-origin resources, and therefore, are not at risk for Spectre.

### 11.2 必要なヘッダ（逐語・完全形）

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

または COEP を代替値にする。

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

### 11.3 各ヘッダの役割

| ヘッダ | 値 | 役割 |
|---|---|---|
| `Cross-Origin-Opener-Policy`（COOP） | `same-origin` | トップレベルのブラウジングコンテキストをクロスオリジンのポップアップから隔離する。`window.opener` / `window.open()` 経由の参照を切り、BrowsingInstance を分離する |
| `Cross-Origin-Embedder-Policy`（COEP） | `require-corp` | すべてのクロスオリジンサブリソースに `Cross-Origin-Resource-Policy` での明示的オプトインを要求する |
| `Cross-Origin-Embedder-Policy`（COEP） | `credentialless` | クロスオリジン no-cors リクエストを Cookie・認証情報なしで送ることで、`CORP` なしでも埋め込みを許す |
| `Cross-Origin-Resource-Policy`（CORP） | `same-origin` / `same-site` / `cross-origin` | リソース側が「どこからの no-cors 取得を許すか」を宣言する |

〔補足〕COOP の他の値は `unsafe-none`（既定）、`same-origin-allow-popups`、および報告専用の `Cross-Origin-Opener-Policy-Report-Only` / `Cross-Origin-Embedder-Policy-Report-Only`。段階導入では Report-Only で壊れる埋め込みを洗い出すのが標準手順である。

### 11.4 確認方法（逐語）と解禁されるもの

ブラウザのコンソールで次を評価し、`true` なら cross-origin isolated が成立している。

```js
self.crossOriginIsolated
```

| 機能 | 非 isolated | isolated |
|---|---|---|
| `SharedArrayBuffer` | Chrome 92 以降使用不可 | 使用可 |
| `performance.now()` 等の明示的タイマー解像度 | 100 μs（Chrome 91 以降） | 5 μs |
| `performance.measureUserAgentSpecificMemory()` 等 | 制限 | 利用可〔補足〕 |
| `Permissions-Policy: cross-origin-isolated` による子フレームへの委譲 | — | 制御可〔補足〕（MDN に該当ディレクティブがある。cross-origin isolated な能力を子フレームへ渡すかを制御する） |

### 11.5 後続の提案（補足・言及のみ）

〔補足〕cross-origin isolation の使い勝手を改善する後続の動きが2つある。いずれも本教科書の執筆環境からは内容本文を取得できておらず、機能名の存在のみ検索結果で確認したものである。

- **Document Isolation Policy**: COEP のように「すべてのサブリソースに `CORP` を要求する」形ではなく、**文書単位で（プロセス分離により）cross-origin isolation 相当の能力を得る**提案。COEP を全面採用しづらいサイトでも高精度タイマー等を解禁しやすくする狙いがある。解説 `https://developer.chrome.com/blog/document-isolation-policy` と提案リポジトリ `https://github.com/WICG/document-isolation-policy` の存在を確認した。
- **COEP `credentialless` の Origin Trial**: `credentialless` 値の実地試験を告知した記事 `https://developer.chrome.com/blog/coep-credentialless-origin-trial` の存在を確認した。

## 12. 開発者への影響 — 同期前提が壊れる

原典 site-isolation 記事の該当節は "What to watch out for"。「Site Isolation には微妙な副作用がある」と前置きされている。

### 12.1 フルページレイアウトが同期でなくなる（最重要）

> With Site Isolation, full-page layout is no longer guaranteed to be synchronous, since the frames of a page may now be spread across multiple processes.

> This may affect pages that change the size of a frame and then send a `postMessage` to it, since the receiving frame may not yet know its new size when receiving the message.

原典の具体例では、社交ウィジェットが `postMessage` を受けて `document.documentElement.clientWidth` を読む。Site Isolation 前は答えが **456**（更新後の幅）だったが、Site Isolation 後は別プロセスでのリレイアウトが非同期になるため、答えが **123**（更新前の幅）にもなりうる。

〔補足〕原典のコードブロックは取得できなかったため、確認済みの要素（`postMessage`、`document.documentElement.clientWidth`、幅 `123` → `456`）から再構成した擬似コードを示す。原典のコードそのものではない。

```js
// 親ページ（https://example.com）
const iframe = document.querySelector('iframe'); // https://social.example/widget
iframe.style.width = '456px';   // 変更前は 123px
iframe.contentWindow.postMessage('resized', '*');
```

```js
// https://social.example/widget（親とは別 site → 別プロセス）
window.addEventListener('message', () => {
  // Site Isolation 前: 456（レイアウトが同期的に伝播していた）
  // Site Isolation 後: 123 または 456（別プロセスでのリレイアウトは非同期）
  console.log(document.documentElement.clientWidth);
});
```

**原則**: 「サイズ変更 → `postMessage` → 受信側で即座にサイズを読む」という同期前提の実装は壊れる。正しくは `ResizeObserver` を使う、`requestAnimationFrame` を挟む、または親が新しいサイズをペイロードに含めて送る。

**バグハンター視点**: この非同期化は新たに競合状態（race condition）を生む。「iframe がまだ古い状態のまま親のメッセージを信用して処理する」実装は状態不整合を突く攻撃面になりうる。逆にプロセス間のレイアウト伝播タイミング差そのものが、フレームのレンダリング完了時間の差でクロスサイト状態を推測する XS-Leaks の材料になる可能性も検討対象になる。

### 12.2 unload ハンドラと DevTools

クロスプロセス遷移では、新ページ表示後にバックグラウンドで古いページの `unload` が走り、タイムアウトで強制終了される。さらに DevTools では `unload` の中身が観測しにくい。

| 制約 | 内容 |
|---|---|
| ブレークポイント | `unload` ハンドラ内で効かない |
| Network パネル | `unload` 中のリクエストが表示されない |
| Console | `unload` 中の `console.log` が出ないことがある |

〔補足〕`unload` に「必ず届く」前提の同期処理を置く実装は破綻する。代替は `navigator.sendBeacon()`、`fetch(..., {keepalive: true})`、`visibilitychange` / `pagehide` イベント。**診断上の含意**として、`unload` 経路の通信は DevTools では見えないので、Burp / mitmproxy などのプロキシで直接観測する必要がある。

### 12.3 document.domain の廃止と Origin-Agent-Cluster

§5.1 で見たとおり、「site 粒度を選ばざるを得なかった理由が `document.domain`」だった。Chrome はその `document.domain` を殺すことで、site 粒度から origin 粒度の分離へ進める道を開いた。

> Relaxing the same-origin policy by setting `document.domain` is deprecated, and is disabled by default in Chrome 115, released around July 2023.

> To continue using the `document.domain` feature, please opt out of origin-keyed agent clusters by sending an `Origin-Agent-Cluster: ?0` header along with the HTTP response for the document and frames.

`Origin-Agent-Cluster`（オリジンキー・エージェントクラスタ）ヘッダは、その文書を origin 単位でまとめるか site 単位でまとめるかをブラウザに指示する。値の `?1` / `?0` は、**`?1`＝真・`?0`＝偽 を表す HTTP ヘッダの標準的な真偽値記法**（Structured Field Values の boolean 表記）である。つまり `?1` が「origin-keyed を有効にする＝真」、`?0` が「無効＝偽」を意味する。

```text
Origin-Agent-Cluster: ?1
Origin-Agent-Cluster: ?0
```

| 値 | 意味 | `document.domain` | プロセス分離 |
|---|---|---|---|
| `?1` | origin-keyed agent cluster を要求 | 無効 | origin 単位の分離が可能（より強い） |
| `?0` | site-keyed にオプトアウト | 使用可（Chrome 115 以降で延命する唯一の方法） | site 単位 |
| 送らない | Chrome 115 以降は origin-keyed が既定 | 無効 | origin 単位 |

〔補足〕`?1` / `?0` は、文書本体と、同期アクセス相手になる全フレームの両方に同じ値を送る必要がある（片方だけでは agent cluster が揃わない）。つまり `document.domain` の廃止は互換性整理ではなく、Spectre 対策の粒度を一段上げるための前提工事である。

**バグハンター視点**: レガシーアプリで `document.domain = 'example.com'` に依存した同期的クロスサブドメイン連携が残っている場合、(1) `Origin-Agent-Cluster: ?0` を全フレームに送れているか、(2) その延命によってサブドメイン間の広いアクセス面が維持され、1つのサブドメインの XSS が同一サイト全体に波及していないか、を見る。`document.domain` 依存の解消はそれ自体が防御改善提案になる。

> ### 📌 ここは自分で開いて読んでください
> **資料**: Site Isolation for web developers（Chrome for Developers ブログ, 2018年7月11日） — https://developer.chrome.com/blog/site-isolation
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `developer.chrome.com` のドメイン単位のエグレスブロック。web.archive.org 経由も到達不可）。§12 の記述は検索結果の引用断片からの再構成である。
> **読みどころ**:
> 1. "What to watch out for" 節 — `document.documentElement.clientWidth` を使った社交ウィジェットのコード例と `123` / `456` の説明。本文の擬似コードではなく、原文のコードを必ず自分の目で確認すること。
> 2. unload ハンドラと DevTools の制約の節 — 原文の正確な文言と、タイムアウト値に具体的な数値が書かれているか。
> 3. "Cross-Origin Read Blocking" の節 — 記事が案内している詳細資料（CORB for web developers / in-depth CORB explainer）へのリンク。
> 4. 性能・メモリの節 — 10〜13% という数値が記事本文に書かれているか。
> **代替手段**: 入門として最も読みやすい対話形式の解説 "What's Up With Site Isolation"（`https://chromium.googlesource.com/chromium/src/+/main/docs/transcripts/wuwt-e09-site-isolation.md`）が無料で読める。

### 12.4 セッションストレージと Cookie（文脈が不確実な項目）

原典 site-isolation 記事には、次の一文が検索結果として現れている。

> When you perform a top-level navigation to an isolated site, any state used for browsing (cookie store, cache, localstorage, etc.) will not be shared with your normal browsing session.

これは「isolated site へのトップレベルナビゲーションでは、Cookie ストア・キャッシュ・localStorage などの状態が通常のブラウジングセッションと共有されない」という意味に読める。

〔注意〕この引用は検索結果経由であり、原典で「isolated site」がどのモードを指すのか（通常の Site Isolation なのか、より強い分離モードなのか）を確認できていない。通常の Site Isolation の動作では**ストレージは分割されない**（ストレージを origin/site 単位で仕切るのは **Storage Partitioning** という別機能）ため、この記述は特定の強い分離モードについての説明である可能性が高い。**Site Isolation ＝ ストレージ分割ではない**という点を取り違えないこと。正確な文脈は後述の 📌 ブロックから原典を開いて確認してほしい。

## 13. 既知の制限 — Site Isolation は Spectre を「直す」わけではない

### 13.1 制限の一覧

- **リソース消費**: 追加プロセスのメモリコスト（デスクトップで約 10〜13%）。低 RAM 端末では有効化できない。悪意あるページが大量のクロスサイト iframe を生成してプロセスを枯渇させる **リソース枯渇攻撃（DoS）** に悪用されうる。

  > The main tradeoff of site isolation involves the added resource consumption ... can be abused in some cases to enable resource exhaustion attacks.

- **site 粒度であること**: 同一サイト内（サブドメイン間）は同一プロセスになりうる。`a.example.com` の XSS から `b.example.com` のデータへ、Spectre を使わずとも同一プロセス経由で近づける余地が残る。対策は `IsolateOrigins` ポリシー（管理者側）または `Origin-Agent-Cluster: ?1`（サイト側）。
- **プロセスロックされていないレンダラ**: Android の部分分離モードやプロセス上限到達時、特定スキーム（`about:`、`data:`）の扱いで「ロックされていないプロセス」が生じる。ロックが無いと IPC 検証の判定材料が減る。
- **IO スレッドでの検証の限界**: `CanAccessDataForOrigin` が IO スレッド上で走ると、UI スレッドが持つ完全な情報を参照できず、ロックされていないレンダラからのアクセスを防げない。一部のストレージ保護がこれに依存している。

### 13.2 最重要の限界

Site Isolation は CPU の投機実行の穴を塞がない。「読まれても困らない状態にする」だけである。

| 残るリスク | 内容 |
|---|---|
| 同一プロセス内のデータは依然読まれる | 自サイトの機密（トークン、他ユーザのデータ）を同一プロセスに載せれば、自サイト上の XSS や悪意ある広告スクリプトから Spectre で読める |
| no-cors で引き込んだ応答 | CORB/ORB のヒューリスティックを通り抜けた応答（正しい `Content-Type` の無い機密 JSON など）は読まれうる |
| タイミング副チャネル一般 | Site Isolation はプロセス分離であり、クロスサイトのタイミング観測（XS-Leaks）そのものは防げない〔補足〕 |
| Android の非分離サイト | ヒューリスティックに載らないサイトは分離されない |

> ### 📌 ここは自分で開いて読んでください
> **資料**: Chromium Security: Site Isolation — https://www.chromium.org/Home/chromium-security/site-isolation/
> **なぜ**: 本教科書の執筆環境からは自動取得できなかった（理由: `www.chromium.org` のドメイン単位のエグレスブロック）。§7・§8・§13 の一部は検索結果の引用断片からの要約である。
> **読みどころ**:
> 1. Site Isolation が防ぐものの箇条書き（5項目）の原文と、site の定義（scheme + eTLD+1）・なぜ origin ではないかの原文。
> 2. "Limitations" / "Known issues" 節 — リソース枯渇攻撃、プロセスロックされていないレンダラ、IO スレッドでの `CanAccessDataForOrigin` の限界。
> 3. エンタープライズポリシーとコマンドラインフラグの正確な一覧（`SitePerProcess` / `IsolateOrigins`、ワイルドカード構文 `https://[*.]corp.example.com`）。
> 4. ページ末尾のリンク集 — 設計文書、`process_model_and_site_isolation.md`、USENIX Security 2019 論文への導線。
> **代替手段**: 一次資料の決定版は USENIX Security 2019 論文 "Site Isolation: Process Separation for Web Sites within the Browser"（`https://www.usenix.org/system/files/sec19-reis.pdf`）で、無料 PDF として公開されている。site 粒度を選んだ理由・互換性の実測・性能評価が最も詳しい。

## 14. バグハンティングの視点でまとめる

〔補足〕以下は本節で確認した原典の技術内容から導いた実務チェックリストであり、原典に箇条書きとして存在するものではない。すべて許可された診断・バグバウンティ・自分で立てた検証環境を前提とする。

### 14.1 サイト側の設定確認

| # | 確認項目 | 期待値 / 確認方法 |
|---|---|---|
| 1 | 機密 JSON API の `Content-Type` | `application/json` 等が正しく付いているか（`text/html` / `text/plain` で返していないか） |
| 2 | `X-Content-Type-Options` | 機密／ユーザ固有 URL に `nosniff` が付いているか |
| 3 | `Cross-Origin-Resource-Policy` | 機密リソースに `same-origin`（または `same-site`）が付いているか |
| 4 | Cookie 属性 | `HttpOnly` + `SameSite`。`document.cookie` を読むコードがないか |
| 5 | Fetch Metadata | `Sec-Fetch-Site: cross-site` の状態変更リクエストをサーバ側で拒否しているか |
| 6 | COOP / COEP | 機密トップレベル文書に `COOP: same-origin`。`self.crossOriginIsolated` の値 |
| 7 | `document.domain` | 使用していないか。使っているなら `Origin-Agent-Cluster: ?0` に依存していないか |
| 8 | `X-Frame-Options` / CSP `frame-ancestors` | 設定漏れがないか |

### 14.2 挙動の観測

| # | 観測 | 手段 |
|---|---|---|
| 1 | どのフレームがどのプロセスに載っているか | `chrome://process-internals`、Chrome のタスクマネージャ |
| 2 | CORB/ORB のブロック | DevTools Console の `Cross-Origin Read Blocking (CORB) blocked ...` 警告 |
| 3 | cross-origin isolation の成立 | Console で `self.crossOriginIsolated` |
| 4 | `unload` 経路の通信 | DevTools では見えない。外部プロキシで観測 |
| 5 | レイアウト非同期化による競合 | 「サイズ変更 → `postMessage` → 即測定」パターンを探す |

### 14.3 報告時の観点

- 「レンダラ側のチェックだけを迂回した」は、ブラウザプロセス側の IPC 検証で止まるなら Chrome のバグではない。**Site Isolation の境界を越えたか**が評価軸である。
- サイト側の報告としては「機密 JSON が `nosniff` 無し／誤った `Content-Type` で提供されており、CORB/ORB の保護対象にならない」は実務的に価値のある指摘（Spectre / XS-Leaks 双方の前提を作るため）。
- Chrome 本体のバグは `crbug.com` に報告する。

## 手を動かす

1. **site と origin の違いを体感する**。Chrome で新しいタブを開き、アドレスバーに `chrome://process-internals` と入力して開く。フレームとプロセスの対応が一覧される内部ページである。次に、クロスサイト iframe を含む適当なページ（自分で用意した検証ページが望ましい）を別タブで開き、`chrome://process-internals` を再読み込みして、親フレームと iframe が別プロセスになっていることを確認する。
2. **cross-origin isolation の有無を確認する**。任意のページで DevTools（F12）を開き、Console に次を打つ。

   ```js
   self.crossOriginIsolated
   ```

   多くのサイトで `false` が返る。`true` を返すサイト（`SharedArrayBuffer` を使うツール系など）を探し、そのレスポンスヘッダに `Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy: require-corp`（または `credentialless`）が付いていることを、DevTools の Network タブで確かめる。
3. **CORB/ORB のブロックを観測する**。自分で立てた検証サーバで、JSON を `Content-Type: text/html` と `X-Content-Type-Options: nosniff` を付けて返すエンドポイントを用意する。それを別 site のページから `<img src="...">` や `<script src="...">` で読み込み、DevTools Console に `Cross-Origin Read Blocking (CORB) blocked cross-origin response ...` が出るかを確認する。
4. **機密 API のヘッダを点検する**。診断対象（許可された範囲）のログイン後にしか返らない JSON エンドポイントを DevTools の Network で開き、Response Headers の `Content-Type`・`X-Content-Type-Options`・`Cross-Origin-Resource-Policy` を読む。§14.1 の期待値と照合し、欠けているものを記録する。
5. **document.domain 依存を探す**。対象サイトの JavaScript を検索し、`document.domain =` の代入があるかを確認する。あれば、その文書と関連フレームのレスポンスに `Origin-Agent-Cluster: ?0` が付いているか（Chrome 115 以降で動かすために必要）を Network タブで確認する。

## つまずきポイント

- **「Site Isolation を入れれば Spectre は治る」は誤り**。Site Isolation は CPU の穴を塞がない。「読まれても価値のあるデータがそこに無い」状態を作るだけである。自サイトの機密を同一プロセスに載せれば、自サイト上の XSS からは Spectre で読める。
- **site と origin を混同しやすい**。`site` は scheme + eTLD+1（サブドメイン・ポート・パス無視）で origin より緩い。`https://a.example.com` と `https://b.example.com` は別 origin だが同一 site なので、既定では同一プロセスに載りうる。
- **CORB が「全部のクロスオリジン応答を止める」わけではない**。止めるのは主に HTML/XML/JSON。画像・スクリプト・CSS・音声動画として正しくラベル付けされた no-cors リソースは通す。だから機密は正しい `Content-Type` + `nosniff` を付けて初めて守られる。
- **`self.crossOriginIsolated` が `false` なのは異常ではない**。cross-origin isolation は COOP+COEP を明示的に張ったサイトだけで `true` になる。既定は `false` で、その状態でも Site Isolation 自体は効いている。両者は別物である。
- **`Origin-Agent-Cluster: ?0` と `?1` の向きを取り違えやすい**。`?1` が「より強い（origin 粒度・`document.domain` 無効）」、`?0` が「弱い側へオプトアウト（`document.domain` 延命）」。Chrome 115 以降は送らなければ `?1` 相当が既定。
- **Android では分離されていない site が普通にある**。デスクトップの感覚で「クロスサイトは必ず別プロセス」と決めつけない。ヒューリスティックに載らないサイトは同一プロセスを共有しうる。

## この節のまとめ

- Spectre / Meltdown は投機実行を悪用し、キャッシュのタイミング差という副チャネルで、本来アクセス権のないメモリを読み出す CPU 由来の脆弱性群である。
- 攻撃には高精度タイマーが要る。そこから「タイマーを奪う」「投機ガジェットを潰す」「読める場所に秘密を置かない」という3層の緩和が導かれ、3番目が最終解になった。
- Chrome の初期緩和は `SharedArrayBuffer` 無効化（Chrome 63 / 2018-01-05）、`performance.now()` の 5μs→100μs 粗粒度化＋ジッタ、V8（Chrome 64〜）のコンパイラ緩和だった。
- V8 チームは「ソフトウェア緩和は包括的・効率的でなく、唯一有効なのは機密データをプロセスのアドレス空間から追い出すこと」と結論し、脅威モデルを「同一プロセスのデータは全部読まれる」前提へ書き換えた。
- その答えが Site Isolation：レンダラを単一 site（scheme + eTLD+1）にロックし、クロスサイト iframe を別プロセス（OOPIF）へ追い出す。デスクトップは Chrome 67 で既定有効、メモリオーバーヘッドは約 10〜13%。
- site が origin より緩いのは `document.domain` による同期アクセスのため。後に `document.domain` を Chrome 115 で既定無効化し、`Origin-Agent-Cluster` で origin 粒度へ進む道を開いた。
- プロセス分離を補うデータフィルタが CORB（HTML/XML/JSON をブロック、空応答注入）とその後継 ORB（許可型以外をブロック、ネットワークエラー）である。
- 危険な API（高精度タイマー、`SharedArrayBuffer`）を取り戻すには COOP + COEP による cross-origin isolation が必要で、`self.crossOriginIsolated === true` で確認する。
- Site Isolation は Spectre を直さない。site 粒度・非分離レンダラ・リソース枯渇・Android の非分離サイトという限界があり、「読まれても価値のあるデータをそこに置かない」設計が本質である。
- バグハンターの実務は、機密 JSON の `Content-Type`・`nosniff`・`CORP`、COOP/COEP、`document.domain` 依存、Fetch Metadata の拒否などを点検し、CORB/ORB の保護対象から漏れた機密応答を見つけることに集約される。

## 理解度チェック

1. Spectre 攻撃が成立するために攻撃者が必ず必要とするものは何か。
   ▶ 答え: 読み出し時間を測るための信頼できる高精度タイマー。だから Chrome はまず `performance.now()` の粗粒度化と `SharedArrayBuffer` 無効化でタイマーを奪いにいった。

2. Chrome が「site = scheme + eTLD+1」という粗い単位を選び、origin 単位にしなかった主な理由は何か。
   ▶ 答え: `document.domain` を書き換えると同一サイト内の異なる origin が同期的に互いをスクリプトできてしまい、プロセス境界を origin に引くと Web 互換性が壊れるため。

3. `https://a.example.com` と `https://b.example.com` は同一 site か、別 site か。既定で同一プロセスに載りうるか。
   ▶ 答え: 同一 site（登録ドメインが `example.com`、サブドメインは無視）。よって既定では同一プロセスに載りうる。origin 単位で分けたいなら `IsolateOrigins` か `Origin-Agent-Cluster: ?1` を使う。

4. CORB は主に何をブロックし、ブロック時にどう見せるか。ORB との違いは何か。
   ▶ 答え: CORB はクロスサイトの HTML/XML/JSON を主にブロックし、body を空にしてヘッダを除去する。ORB は「no-cors で正当な型（CSS/JS/画像/メディア）以外をできるだけブロック」する許可リスト寄りの設計で、ブロック時はネットワークエラーを発生させる。

5. cross-origin isolation を成立させるために送るヘッダの組み合わせを1つ挙げ、成立を確認するコードを書け。
   ▶ 答え: `Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy: require-corp`（または `credentialless`）。Console で `self.crossOriginIsolated` が `true` を返せば成立。

6. 「Site Isolation を有効にすれば Spectre は完全に防げる」という主張は正しいか。
   ▶ 答え: 正しくない。Site Isolation は CPU の投機実行の穴を塞がず、「読まれても価値のあるデータをそこに置かない」状態を作るだけ。同一プロセスに載った機密は依然読まれうる。

7. 機密 JSON API を Spectre / XS-Leaks から守るために付けるべきレスポンスヘッダを2つ以上挙げよ。
   ▶ 答え: `Content-Type: application/json`（正しい MIME）、`X-Content-Type-Options: nosniff`、`Cross-Origin-Resource-Policy: same-origin`、および Fetch Metadata（`Sec-Fetch-Site: cross-site` の拒否）。

8. Site Isolation 有効化後に「サイズ変更 → `postMessage` → 受信側で即 `clientWidth` を読む」実装が壊れるのはなぜか。
   ▶ 答え: クロスサイト iframe が別プロセスにあり、レイアウトの伝播が非同期になるため。受信時点で新しい幅がまだ反映されておらず、古い値（例: 123）が返りうる。`ResizeObserver` などを使うべき。

## 出典

- https://developer.chrome.com/blog/meltdown-spectre
- https://developer.chrome.com/blog/site-isolation
- https://www.chromium.org/Home/chromium-security/site-isolation/
- https://www.chromium.org/Home/chromium-security/ssca/
- https://v8.dev/blog/spectre
- https://security.googleblog.com/2021/03/a-spectre-proof-of-concept-for-spectre.html
- https://www.chromium.org/Home/chromium-security/corb-for-developers/
- https://github.com/annevk/orb
- https://web.dev/articles/coop-coep
- https://web.dev/articles/cross-origin-isolation-guide
- https://developer.chrome.com/blog/cross-origin-isolated-hr-timers
- https://developer.chrome.com/blog/document-domain-setter-deprecation
- https://www.usenix.org/system/files/sec19-reis.pdf
- https://developer.chrome.com/blog/document-isolation-policy
- https://github.com/WICG/document-isolation-policy
- https://developer.chrome.com/blog/coep-credentialless-origin-trial
- https://chromium.googlesource.com/chromium/src/+/main/docs/transcripts/wuwt-e09-site-isolation.md

<!-- sources: https://developer.chrome.com/blog/meltdown-spectre, https://developer.chrome.com/blog/site-isolation, https://www.chromium.org/Home/chromium-security/site-isolation/, https://www.chromium.org/Home/chromium-security/ssca/, https://v8.dev/blog/spectre, https://security.googleblog.com/2021/03/a-spectre-proof-of-concept-for-spectre.html, https://www.chromium.org/Home/chromium-security/corb-for-developers/, https://github.com/annevk/orb, https://web.dev/articles/coop-coep, https://web.dev/articles/cross-origin-isolation-guide, https://developer.chrome.com/blog/cross-origin-isolated-hr-timers, https://developer.chrome.com/blog/document-domain-setter-deprecation, https://www.usenix.org/system/files/sec19-reis.pdf, https://developer.chrome.com/blog/document-isolation-policy, https://github.com/WICG/document-isolation-policy, https://developer.chrome.com/blog/coep-credentialless-origin-trial, https://chromium.googlesource.com/chromium/src/+/main/docs/transcripts/wuwt-e09-site-isolation.md -->
<!-- terms: Site Isolation, Spectre, Meltdown, 投機実行, 副チャネル, site, origin, eTLD+1, public suffix, OOPIF, SiteInstance, BrowsingInstance, CanAccessDataForOrigin, CORB, ORB, opaque-blocklisted MIME type, SharedArrayBuffer, performance.now(), cross-origin isolation, COOP, COEP, CORP, Origin-Agent-Cluster, document.domain, Project Fission, UXSS, leaky.page, Fetch Metadata, Storage Partitioning, Document Isolation Policy -->
<!-- self-read: https://developer.chrome.com/blog/meltdown-spectre | developer.chrome.com がドメイン単位でエグレスブロックされ原典を直接取得できなかった -->
<!-- self-read: https://developer.chrome.com/blog/site-isolation | developer.chrome.com がドメイン単位でエグレスブロックされ原典を直接取得できなかった -->
<!-- self-read: https://www.chromium.org/Home/chromium-security/site-isolation/ | www.chromium.org がドメイン単位でエグレスブロックされ原典を直接取得できなかった -->
