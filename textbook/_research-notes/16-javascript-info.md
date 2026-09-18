# [16] javascript.info（The Modern JavaScript Tutorial）— 全章構成とクライアントサイド脆弱性ハンティングに直結する言語/ブラウザ挙動

## 取得状況

| URL | 状態 | 取得方法 | 備考 |
|---|---|---|---|
| https://javascript.info/ | failed | WebFetch → 403 EGRESS_BLOCKED / curl → `CONNECT tunnel failed, response 403` | 組織のegressポリシーで `javascript.info:443` へのCONNECTが拒否。プロキシ状態の `recentRelayFailures` に `connect_rejected` として記録。TLS検証の無効化は行わず、再試行もしていない。 |
| https://raw.githubusercontent.com/javascript-tutorial/en.javascript.info/master/README.md | full | curl | 公式ソースリポジトリのREADME。ディレクトリ命名規則（`N-url` / `index.md`=章 / `article.md`=記事 / `task.md`=課題）を確認。 |
| https://github.com/javascript-tutorial/en.javascript.info (git clone --depth 1 --filter=blob:none --sparse, 全*.md をsparse-checkout) | full | git clone + `git sparse-checkout set --no-cone '/*.md' '/**/*.md'` | **javascript.info の本文そのもの**（サイトはこのリポジトリのMarkdownをレンダリングしている）。712個の.mdを取得。うち章/記事本体は204ファイル（`index.md` 33 + `article.md` 171）。本ノートの詳細部分はすべてこの一次ソースの逐語読解に基づく。 |

**重要**: サイト本体（javascript.info）はブロックされたが、**サイトの全本文は公式GitHubリポジトリ `javascript-tutorial/en.javascript.info` に同一内容のMarkdownとして存在する**ため、原典の内容は逐語で取得できている。ただし「サイト上のトップページのパート分けラベル」「レンダリング後のURL」だけはHTMLを見ていないため、後述のとおり構成規則から導出している（導出箇所は明記した）。

---

## 要約（3〜10行）

javascript.info（Ilya Kantor / The Modern JavaScript Tutorial）は、JS言語コアからブラウザAPIまでを仕様（ECMA-262 / WHATWG DOM・HTML・Fetch・URL）に沿って段階的に解説する事実上の標準教材。構成は Part 1「The JavaScript language」（1-js、14章）、Part 2「Browser: Document, Events, Interfaces」（2-ui、6章）、および追加記事群（Frames and windows / Binary data, files / Network requests / Storing data in the browser / Animation / Web components / Regular expressions）の3層。

クライアントサイド脆弱性ハンティングの観点では、本サイトは「攻撃手法カタログ」ではなく**挙動の一次的な理解を与える教材**として価値が高い。具体的に直結するのは、(1) レキシカル環境と `[[Environment]]` によるクロージャ（＝スコープ汚染とminifier/evalの相互作用）、(2) `__proto__` が `Object.prototype` のアクセサであることとプロトタイプ汚染（`Object.create(null)` / `Map` による回避が明示されている）、(3) `this` が呼び出し時決定であること（`bind`/矢印関数/クラスフィールド）、(4) microtask/macrotask の実行順（`Promise` → レンダリング → 次のmacrotask）、(5) `eval` / `new Function` のスコープ差、(6) `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `document.write` vs `textContent` / `append` のエスケープ有無、(7) イベントのバブリング・キャプチャ・`stopPropagation` とデリゲーション（`data-*` behaviorパターン）、(8) Same Origin Policy・`iframe` sandbox・`document.domain`・`postMessage` の `targetOrigin`/`event.origin` 検証、(9) CORS の safe/unsafe 判定とpreflight・`Access-Control-*` ヘッダ群・`credentials`、(10) Cookie の `domain`/`path`/`secure`/`samesite`/`httpOnly` と XSRF、(11) clickjacking と `X-Frame-Options`、(12) Storage のorigin境界と `storage` イベントによるウィンドウ間通信、(13) 正規表現の catastrophic backtracking（ReDoS）とlookaheadによる擬似atomic group。

---

## サイト全体の章構成（完全目次）

### URL構成規則

〔補足（一般知識）〕javascript.info はフラットURL方式で、記事URLは `https://javascript.info/<slug>` の形をとる。`<slug>` はリポジトリの当該フォルダ名から先頭の数値プレフィックス（`NN-`）を除去した文字列である。章（`index.md`）も同様に `https://javascript.info/<章slug>` となる。以下の表のURLはこの規則により機械的に導出した（サイトHTMLは取得できていないため、個々のURLの実在をHTTPレベルでは確認していない）。タイトルは各 `.md` の先頭 `# ` 見出しから逐語で取得した。

### Part 1: The JavaScript language （`1-js/`, https://javascript.info/js ）

> 原文（`1-js/index.md`）: "Here we learn JavaScript, starting from scratch and go on to advanced concepts like OOP. We concentrate on the language itself here, with the minimum of environment-specific notes."

| # | 章 / 記事 | 原題 | URL |
|---|---|---|---|
| 1 | 章 | An introduction | /getting-started |
| 1.1 | 記事 | An Introduction to JavaScript | /intro |
| 1.2 | 記事 | Manuals and specifications | /manuals-specifications |
| 1.3 | 記事 | Code editors | /code-editors |
| 1.4 | 記事 | Developer console | /devtools |
| 2 | 章 | JavaScript Fundamentals | /first-steps |
| 2.1 | 記事 | Hello, world! | /hello-world |
| 2.2 | 記事 | Code structure | /structure |
| 2.3 | 記事 | The modern mode, "use strict" | /strict-mode |
| 2.4 | 記事 | Variables | /variables |
| 2.5 | 記事 | Data types | /types |
| 2.6 | 記事 | Interaction: alert, prompt, confirm | /alert-prompt-confirm |
| 2.7 | 記事 | Type Conversions | /type-conversions |
| 2.8 | 記事 | Basic operators, maths | /operators |
| 2.9 | 記事 | Comparisons | /comparison |
| 2.10 | 記事 | Conditional branching: if, '?' | /ifelse |
| 2.11 | 記事 | Logical operators | /logical-operators |
| 2.12 | 記事 | Nullish coalescing operator '??' | /nullish-coalescing-operator |
| 2.13 | 記事 | Loops: while and for | /while-for |
| 2.14 | 記事 | The "switch" statement | /switch |
| 2.15 | 記事 | Functions | /function-basics |
| 2.16 | 記事 | Function expressions | /function-expressions |
| 2.17 | 記事 | Arrow functions, the basics | /arrow-functions-basics |
| 2.18 | 記事 | JavaScript specials | /javascript-specials |
| 3 | 章 | Code quality | /code-quality |
| 3.1 | 記事 | Debugging in the browser | /debugging-chrome |
| 3.2 | 記事 | Coding Style | /coding-style |
| 3.3 | 記事 | Comments | /comments |
| 3.4 | 記事 | Ninja code | /ninja-code |
| 3.5 | 記事 | Automated testing with Mocha | /testing-mocha |
| 3.6 | 記事 | Polyfills and transpilers | /polyfills |
| 4 | 章 | Objects: the basics | /object-basics |
| 4.1 | 記事 | Objects | /object |
| 4.2 | 記事 | Object references and copying | /object-copy |
| 4.3 | 記事 | Garbage collection | /garbage-collection |
| 4.4 | 記事 | Object methods, "this" | /object-methods |
| 4.5 | 記事 | Constructor, operator "new" | /constructor-new |
| 4.6 | 記事 | Optional chaining '?.' | /optional-chaining |
| 4.7 | 記事 | Symbol type | /symbol |
| 4.8 | 記事 | Object to primitive conversion | /object-toprimitive |
| 5 | 章 | Data types | /data-types |
| 5.1 | 記事 | Methods of primitives | /primitives-methods |
| 5.2 | 記事 | Numbers | /number |
| 5.3 | 記事 | Strings | /string |
| 5.4 | 記事 | Arrays | /array |
| 5.5 | 記事 | Array methods | /array-methods |
| 5.6 | 記事 | Iterables | /iterable |
| 5.7 | 記事 | Map and Set | /map-set |
| 5.8 | 記事 | WeakMap and WeakSet | /weakmap-weakset |
| 5.9 | 記事 | Object.keys, values, entries | /keys-values-entries |
| 5.10 | 記事 | Destructuring assignment | /destructuring-assignment |
| 5.11 | 記事 | Date and time | /date |
| 5.12 | 記事 | JSON methods, toJSON | /json |
| 6 | 章 | **Advanced working with functions** | /advanced-functions |
| 6.1 | 記事 | Recursion and stack | /recursion |
| 6.2 | 記事 | Rest parameters and spread syntax | /rest-parameters-spread |
| 6.3 | 記事 | **Variable scope, closure** | /closure |
| 6.4 | 記事 | **The old "var"** | /var |
| 6.5 | 記事 | **Global object** | /global-object |
| 6.6 | 記事 | Function object, NFE | /function-object |
| 6.7 | 記事 | **The "new Function" syntax** | /new-function |
| 6.8 | 記事 | Scheduling: setTimeout and setInterval | /settimeout-setinterval |
| 6.9 | 記事 | **Decorators and forwarding, call/apply** | /call-apply-decorators |
| 6.10 | 記事 | **Function binding** | /bind |
| 6.11 | 記事 | Arrow functions revisited | /arrow-functions |
| 7 | 章 | Object properties configuration | /object-properties |
| 7.1 | 記事 | **Property flags and descriptors** | /property-descriptors |
| 7.2 | 記事 | Property getters and setters | /property-accessors |
| 8 | 章 | **Prototypes, inheritance** | /prototypes |
| 8.1 | 記事 | **Prototypal inheritance** | /prototype-inheritance |
| 8.2 | 記事 | F.prototype | /function-prototype |
| 8.3 | 記事 | **Native prototypes** | /native-prototypes |
| 8.4 | 記事 | **Prototype methods, objects without __proto__** | /prototype-methods |
| 9 | 章 | **Classes** | /classes |
| 9.1 | 記事 | **Class basic syntax** | /class |
| 9.2 | 記事 | Class inheritance | /class-inheritance |
| 9.3 | 記事 | Static properties and methods | /static-properties-methods |
| 9.4 | 記事 | **Private and protected properties and methods** | /private-protected-properties-methods |
| 9.5 | 記事 | Extending built-in classes | /extend-natives |
| 9.6 | 記事 | Class checking: "instanceof" | /instanceof |
| 9.7 | 記事 | Mixins | /mixins |
| 10 | 章 | Error handling | /error-handling |
| 10.1 | 記事 | Error handling, "try...catch" | /try-catch |
| 10.2 | 記事 | Custom errors, extending Error | /custom-errors |
| 11 | 章 | **Promises, async/await** | /async |
| 11.1 | 記事 | Introduction: callbacks | /callbacks |
| 11.2 | 記事 | Promise | /promise-basics |
| 11.3 | 記事 | Promises chaining | /promise-chaining |
| 11.4 | 記事 | Error handling with promises | /promise-error-handling |
| 11.5 | 記事 | Promise API | /promise-api |
| 11.6 | 記事 | Promisification | /promisify |
| 11.7 | 記事 | **Microtasks** | /microtask-queue |
| 11.8 | 記事 | **Async/await** | /async-await |
| 12 | 章 | Generators, advanced iteration | /generators-iterators |
| 12.1 | 記事 | Generators | /generators |
| 12.2 | 記事 | Async iteration and generators | /async-iterators-generators |
| 13 | 章 | **Modules** | /modules |
| 13.1 | 記事 | **Modules, introduction** | /modules-intro |
| 13.2 | 記事 | Export and Import | /import-export |
| 13.3 | 記事 | Dynamic imports | /modules-dynamic-imports |
| 14 | 章 | Miscellaneous | /js-misc |
| 14.1 | 記事 | **Proxy and Reflect** | /proxy |
| 14.2 | 記事 | **Eval: run a code string** | /eval |
| 14.3 | 記事 | Currying | /currying-partials |
| 14.4 | 記事 | Reference Type | /reference-type |
| 14.5 | 記事 | BigInt | /bigint |
| 14.6 | 記事 | Unicode, String internals | /unicode |
| 14.7 | 記事 | WeakRef and FinalizationRegistry | /weakref-finalizationregistry |

### Part 2: Browser: Document, Events, Interfaces （`2-ui/`, https://javascript.info/ui ）

> 原文（`2-ui/index.md`）: "Learning how to manage the browser page: add elements, manipulate their size and position, dynamically create interfaces and interact with the visitor."

| # | 章 / 記事 | 原題 | URL |
|---|---|---|---|
| 1 | 章 | Document | /document |
| 1.1 | 記事 | **Browser environment, specs** | /browser-environment |
| 1.2 | 記事 | DOM tree | /dom-nodes |
| 1.3 | 記事 | Walking the DOM | /dom-navigation |
| 1.4 | 記事 | Searching: getElement*, querySelector* | /searching-elements-dom |
| 1.5 | 記事 | **Node properties: type, tag and contents** | /basic-dom-node-properties |
| 1.6 | 記事 | **Attributes and properties** | /dom-attributes-and-properties |
| 1.7 | 記事 | **Modifying the document** | /modifying-document |
| 1.8 | 記事 | Styles and classes | /styles-and-classes |
| 1.9 | 記事 | Element size and scrolling | /size-and-scroll |
| 1.10 | 記事 | Window sizes and scrolling | /size-and-scroll-window |
| 1.11 | 記事 | Coordinates | /coordinates |
| 2 | 章 | **Introduction to Events** | /events |
| 2.1 | 記事 | **Introduction to browser events** | /introduction-browser-events |
| 2.2 | 記事 | **Bubbling and capturing** | /bubbling-and-capturing |
| 2.3 | 記事 | **Event delegation** | /event-delegation |
| 2.4 | 記事 | **Browser default actions** | /default-browser-action |
| 2.5 | 記事 | **Dispatching custom events** | /dispatch-events |
| 3 | 章 | UI Events | /event-details |
| 3.1 | 記事 | Mouse events | /mouse-events-basics |
| 3.2 | 記事 | Moving the mouse: mouseover/out, mouseenter/leave | /mousemove-mouseover-mouseout-mouseenter-mouseleave |
| 3.3 | 記事 | Drag'n'Drop with mouse events | /mouse-drag-and-drop |
| 3.4 | 記事 | Pointer events | /pointer-events |
| 3.5 | 記事 | Keyboard: keydown and keyup | /keyboard-events |
| 3.6 | 記事 | Scrolling | /onscroll |
| 4 | 章 | Forms, controls | /forms-controls |
| 4.1 | 記事 | Form properties and methods | /form-elements |
| 4.2 | 記事 | Focusing: focus/blur | /focus-blur |
| 4.3 | 記事 | Events: change, input, cut, copy, paste | /events-change-input |
| 4.4 | 記事 | Forms: event and method submit | /forms-submit |
| 5 | 章 | Document and resource loading | /loading |
| 5.1 | 記事 | Page: DOMContentLoaded, load, beforeunload, unload | /onload-ondomcontentloaded |
| 5.2 | 記事 | Scripts: async, defer | /script-async-defer |
| 5.3 | 記事 | **Resource loading: onload and onerror** | /onload-onerror |
| 6 | 章 | Miscellaneous | /ui-misc |
| 6.1 | 記事 | Mutation observer | /mutation-observer |
| 6.2 | 記事 | Selection and Range | /selection-range |
| 6.3 | 記事 | **Event loop: microtasks and macrotasks** | /event-loop |

### Part 3: 追加記事群 （`3-` 〜 `9-` のトップレベル章）

〔補足（一般知識）〕javascript.info のトップページでは、これらは "Part 3" 相当の「追加記事（Additional articles）」としてまとめて掲示される。リポジトリ側にはこの "Part 3" というラベルを持つファイルは存在せず（`1-js/index.md`・`2-ui/index.md` に相当するパート見出しファイルがない）、`3-frames-and-windows` 〜 `9-regular-expressions` が並列のトップレベル章として置かれている。したがって「Part 3」という括りはサイト表示上のグルーピングであり、以下では章単位で列挙する。

| # | 章 / 記事 | 原題 | URL |
|---|---|---|---|
| 3 | 章 | **Frames and windows** | /frames-and-windows |
| 3.1 | 記事 | **Popups and window methods** | /popup-windows |
| 3.2 | 記事 | **Cross-window communication** | /cross-window-communication |
| 3.3 | 記事 | **The clickjacking attack** | /clickjacking |
| 4 | 章 | Binary data, files | /binary |
| 4.1 | 記事 | ArrayBuffer, binary arrays | /arraybuffer-binary-arrays |
| 4.2 | 記事 | TextDecoder and TextEncoder | /text-decoder |
| 4.3 | 記事 | Blob | /blob |
| 4.4 | 記事 | File and FileReader | /file |
| 5 | 章 | **Network requests** | /network |
| 5.1 | 記事 | **Fetch** | /fetch |
| 5.2 | 記事 | FormData | /formdata |
| 5.3 | 記事 | Fetch: Download progress | /fetch-progress |
| 5.4 | 記事 | Fetch: Abort | /fetch-abort |
| 5.5 | 記事 | **Fetch: Cross-Origin Requests** | /fetch-crossorigin |
| 5.6 | 記事 | **Fetch API**（全オプション一覧） | /fetch-api |
| 5.7 | 記事 | **URL objects** | /url |
| 5.8 | 記事 | **XMLHttpRequest** | /xmlhttprequest |
| 5.9 | 記事 | Resumable file upload | /resume-upload |
| 5.10 | 記事 | Long polling | /long-polling |
| 5.11 | 記事 | WebSocket | /websocket |
| 5.12 | 記事 | Server Sent Events | /server-sent-events |
| 6 | 章 | **Storing data in the browser** | /data-storage |
| 6.1 | 記事 | **Cookies, document.cookie** | /cookie |
| 6.2 | 記事 | **LocalStorage, sessionStorage** | /localstorage |
| 6.3 | 記事 | IndexedDB | /indexeddb |
| 7 | 章 | Animation | /animation |
| 7.1 | 記事 | Bezier curve | /bezier-curve |
| 7.2 | 記事 | CSS-animations | /css-animations |
| 7.3 | 記事 | JavaScript animations | /js-animation |
| 8 | 章 | Web components | /web-components |
| 8.1 | 記事 | From the orbital height | /webcomponents-intro |
| 8.2 | 記事 | Custom elements | /custom-elements |
| 8.3 | 記事 | Shadow DOM | /shadow-dom |
| 8.4 | 記事 | Template element | /template-element |
| 8.5 | 記事 | Shadow DOM slots, composition | /slots-composition |
| 8.6 | 記事 | Shadow DOM styling | /shadow-dom-style |
| 8.7 | 記事 | **Shadow DOM and events** | /shadow-dom-events |
| 9 | 章 | Regular expressions | /regular-expressions |
| 9.1 | 記事 | Patterns and flags | /regexp-introduction |
| 9.2 | 記事 | Character classes | /regexp-character-classes |
| 9.3 | 記事 | Unicode: flag "u" and class \p{...} | /regexp-unicode |
| 9.4 | 記事 | Anchors: string start ^ and end $ | /regexp-anchors |
| 9.5 | 記事 | Multiline mode of anchors ^ $, flag "m" | /regexp-multiline-mode |
| 9.6 | 記事 | Word boundary: \b | /regexp-boundary |
| 9.7 | 記事 | Escaping, special characters | /regexp-escaping |
| 9.8 | 記事 | Sets and ranges [...] | /regexp-character-sets-and-ranges |
| 9.9 | 記事 | Quantifiers +, *, ? and {n} | /regexp-quantifiers |
| 9.10 | 記事 | Greedy and lazy quantifiers | /regexp-greedy-and-lazy |
| 9.11 | 記事 | Capturing groups | /regexp-groups |
| 9.12 | 記事 | Backreferences in pattern: \N and \k<name> | /regexp-backreferences |
| 9.13 | 記事 | Alternation (OR) \| | /regexp-alternation |
| 9.14 | 記事 | Lookahead and lookbehind | /regexp-lookahead-lookbehind |
| 9.15 | 記事 | **Catastrophic backtracking** | /regexp-catastrophic-backtracking |
| 9.16 | 記事 | Sticky flag "y", searching at position | /regexp-sticky |
| 9.17 | 記事 | Methods of RegExp and String | /regexp-methods |

（**太字**＝本ノートで詳細に内容を抽出した、セキュリティに直結する記事）

---

## 詳細ノート

### 1. 変数スコープとクロージャ（出典: https://javascript.info/closure ）

#### 1.1 ブロックスコープ

- `{...}` 内で `let` / `const` 宣言した変数はそのブロック内でのみ可視。`if`、`for`、`while` の `{...}` も同様。
- `for (let i = 0; ...)` の `i` は「視覚的には `{...}` の外」だが、**`for` 構文は特別で、その中で宣言された変数はブロックの一部と見なされる**。
- ブロックで分離すれば同名 `let` を別々に宣言できる。分離しないと `SyntaxError: variable already declared`。

#### 1.2 レキシカル環境（Lexical Environment）— 4ステップの仕組み

原文の定義（逐語訳）:

> JavaScript では、**実行中のすべての関数、コードブロック `{...}`、およびスクリプト全体**が、*Lexical Environment* と呼ばれる内部（隠れた）オブジェクトを関連付けて持つ。

Lexical Environment オブジェクトは2つの部分からなる:

1. **Environment Record** — すべてのローカル変数をプロパティとして格納するオブジェクト（`this` の値など他の情報も含む）。
2. **外側のレキシカル環境への参照**（outer lexical environment）。

> **「変数」とは、特別な内部オブジェクト `Environment Record` のプロパティにすぎない。「変数を取得/変更する」とは「そのオブジェクトのプロパティを取得/変更する」ことである。**

- **Step 1（変数）**: スクリプト開始時、レキシカル環境は宣言済みの全変数で事前に埋められる。初期状態は "Uninitialized"（未初期化）— エンジンは変数を知っているが、`let` で宣言されるまで参照できない特殊な内部状態。`let phrase` の定義に到達すると値は `undefined`。以後、代入で値が変わる。
- Lexical Environment は**仕様上のオブジェクト**であり、[仕様](https://tc39.es/ecma262/#sec-lexical-environments) で挙動を説明するためだけに「理論上」存在する。コードから直接取得・操作できない。エンジンは最適化してよく、未使用変数を破棄してメモリ節約してよい（可視的な振る舞いが記述どおりであれば）。
- **Step 2（関数宣言）**: **Function Declaration は即座に完全初期化される**。レキシカル環境が作られた時点で、すぐ使える関数になる（`let` と異なり宣言前に使える）。これは Function Declaration のみ。`let say = function(name)...` のような Function Expression には適用されない。
- **Step 3（内側と外側）**: 関数実行時、呼び出しの先頭で新しいレキシカル環境が自動生成され、ローカル変数と引数を保持する。**変数アクセス時は内側のレキシカル環境から探索し、次に外側、さらに外側…最後にグローバルまで辿る。**
  - **どこにも見つからない場合、strict モードではエラー。`use strict` なしでは、存在しない変数への代入は互換性のため新しいグローバル変数を作る。**（＝グローバル汚染の原典的根拠）
- **Step 4（関数を返す）**: すべての関数は、生成されたレキシカル環境を隠れプロパティ **`[[Environment]]`** に記憶する。`counter.[[Environment]]` は `{count: 0}` のレキシカル環境を参照する。**`[[Environment]]` 参照は関数生成時に一度だけ設定され、以後不変。**
  - 呼び出し時、新しいレキシカル環境が作られ、その outer 参照は `counter.[[Environment]]` から取られる。
  - **変数は、それが存在するレキシカル環境で更新される。**

#### 1.3 クロージャの定義（原文の枠囲み "Closure" より）

> [クロージャ](https://en.wikipedia.org/wiki/Closure_(computer_programming)) とは、外側の変数を記憶しアクセスできる関数である。…JavaScript では**すべての関数が自然にクロージャである**（例外は1つだけで、`new Function` の章で扱う）。
>
> フロントエンド開発者が面接で「クロージャとは？」と聞かれたら、クロージャの定義と、JavaScript の全関数はクロージャであるという説明、加えて技術的詳細（`[[Environment]]` プロパティとレキシカル環境の仕組み）を答えるのが妥当。

#### 1.4 ガベージコレクションと「デバッグ時に変数が見えない」V8の挙動

- 通常、関数呼び出し終了時にレキシカル環境は全変数と共にメモリから除去される（参照がないため）。
- ただし、関数終了後も到達可能なネスト関数があれば、その `[[Environment]]` がレキシカル環境を参照するため、**関数完了後もレキシカル環境は生き続ける**。
- `f()` を何度も呼んで結果の関数を保存すると、**対応するレキシカル環境オブジェクトすべてがメモリに保持される**（例: `let arr = [f(), f(), f()]` で3つ）。
- `g = null` とすればメモリはクリーンアップされる。
- **実際の最適化（重要なデバッグ上の落とし穴）**: エンジンは変数使用を解析し、外側変数が使われないことがコードから明白なら除去する。
  > **V8（Chrome, Edge, Opera）における重要な副作用は、そのような変数がデバッグ時に利用不可能になることである。**
  - `debugger;` で止めて `alert(value)` を打っても「そんな変数はない」となる。さらに、**同名の外側変数が期待したものの代わりに見えることがある**（例: 内側の `"the closest value"` ではなく外側の `"Surprise!"` が表示される）。
  - これは「デバッガのバグではなく V8 の特別な機能」。

#### コード/コマンド（原文のまま逐語）

```js run
function makeCounter() {
  let count = 0;

  return function() {
    return count++;
  };
}

let counter = makeCounter();

alert( counter() ); // 0
alert( counter() ); // 1
alert( counter() ); // 2
```

```js
function f() {
  let value = 123;

  return function() {
    alert(value);
  }
}

let g = f(); // g.[[Environment]] stores a reference to the Lexical Environment
// of the corresponding f() call
```

```js
function f() {
  let value = Math.random();

  return function() { alert(value); };
}

// 3 functions in array, every one of them links to Lexical Environment
// from the corresponding f() run
let arr = [f(), f(), f()];
```

```js run
function f() {
  let value = Math.random();

  function g() {
    debugger; // in console: type alert(value); No such variable!
  }

  return g;
}

let g = f();
g();
```

```js run global
let value = "Surprise!";

function f() {
  let value = "the closest value";

  function g() {
    debugger; // in console: type alert(value); Surprise!
  }

  return g;
}

let g = f();
g();
```

---

### 2. 旧 `var` の挙動（出典: https://javascript.info/var ）

原文冒頭の注記: 「この記事は古いスクリプトを理解するためのものであり、新しいコードの書き方ではない」。

- **`var` にはブロックスコープがない**。`var` で宣言した変数は**関数スコープかグローバルスコープ**のいずれかで、ブロックを貫通して可視。
  - `if (true) { var test = true; }` の後で `alert(test)` は `true`（グローバル変数になる）。`let` なら `ReferenceError: test is not defined`。
  - `for (var i = 0; i < 10; i++) { var one = 1; }` の後、`alert(i)` は `10`、`alert(one)` は `1`（どちらもグローバル）。
  - コードブロックが関数内にあれば、`var` は関数レベル変数になる。
  - 理由: 「昔の JavaScript ではブロックにレキシカル環境がなく、`var` はその名残」。
- **`var` は再宣言を許容する**。`let user; let user;` は `SyntaxError: 'user' has already been declared` だが、`var user = "Pete"; var user = "John";` はエラーにならず、2つ目の `var` は何もしない（既に宣言済み）。
- **`var` は使用箇所より後に宣言できる（ホイスティング）**。`var` 宣言は関数開始時（グローバルならスクリプト開始時）に処理される。`if (false) { var phrase; }` のように実行されない分岐内の `var` でも、関数先頭で処理されるため変数は存在する。
  - **宣言はホイストされるが、代入はホイストされない**。`alert(phrase); var phrase = "Hello";` は `undefined` を表示する。
- **IIFE**（immediately-invoked function expressions）: `var` にブロックスコープがない時代の擬似ブロックスコープ手法。現代では使うべきでないが古いスクリプトに出現する。
  - 括弧が必要な理由: エンジンがメインコードで `"function"` を見ると Function Declaration の開始と解釈するが、Function Declaration には名前が必須で、また即時呼び出しが許されないため。

#### コード/コマンド（原文のまま逐語）

```js run
// Ways to create IIFE

*!*(*/!*function() {
  alert("Parentheses around the function");
}*!*)*/!*();

*!*(*/!*function() {
  alert("Parentheses around the whole thing");
}()*!*)*/!*;

*!*!*/!*function() {
  alert("Bitwise NOT operator starts the expression");
}();

*!*+*/!*function() {
  alert("Unary plus starts the expression");
}();
```

（`*!*` … `*/!*` は javascript.info 独自の Markdown 拡張で「強調表示」を意味するマーカー。サイト上では該当行がハイライトされる。）

---

### 3. グローバルオブジェクト（出典: https://javascript.info/global-object ）

- ブラウザでは `window`、Node.js では `global`。標準名として **`globalThis`** が言語に追加され、主要ブラウザすべてでサポート。
- グローバルオブジェクトの全プロパティは直接アクセスできる（`alert("Hello")` ≡ `window.alert("Hello")`）。
- **ブラウザでは、`var`（`let`/`const` ではない！）で宣言されたグローバル関数・変数はグローバルオブジェクトのプロパティになる。**
  - `var gVar = 5;` → `window.gVar` は `5`。
  - `let gLet = 5;` → `window.gLet` は `undefined`。
  - Function Declaration（メインコードフローの `function` キーワード文。Function Expression は除く）も同じ効果。
  - 原文の警告: 「これに依存しないこと！ この挙動は互換性のために存在する。現代のスクリプトは JavaScript モジュールを使い、そこではこういうことは起きない。」
- グローバルに置きたい値は明示的にプロパティとして書く（`window.currentUser = {...}`）。ローカル変数と同名の場合は `window.currentUser.name` と明示的に取るのが「安全」。
- ポリフィル判定に使う: `if (!window.Promise) { window.Promise = ... }`。
- まとめの指針: 「将来性と可読性のため、グローバルオブジェクトのプロパティは `window.x` として直接アクセスすべき」。

---

### 4. `new Function` 構文（出典: https://javascript.info/new-function ）

構文:

```js
let func = new Function ([arg1, arg2, ...argN], functionBody);
```

- **他の関数生成方法との決定的な違いは、実行時に渡された文字列から文字どおり関数が作られること。**
- **`new Function` は任意の文字列を関数に変える。例えばサーバから新しい関数を受け取って実行できる**（原文の逐語例）:

```js
let str = ... receive the code from a server dynamically ...

let func = new Function(str);
func();
```

- **クロージャの例外**: 通常、関数は生成された場所を `[[Environment]]` に記憶するが、**`new Function` で作られた関数の `[[Environment]]` は現在のレキシカル環境ではなくグローバル環境を参照する**。したがって外側変数にアクセスできず、グローバル変数のみアクセス可能。
  - `getFunc()()` で `error: value is not defined` になる（通常の関数式なら `"test"`）。
- なぜこの設計か（原文の論拠）: 本番公開前に **minifier** がローカル変数を短い名前（`let userName` → `let a`）にリネームする。`new Function` が外側変数にアクセスできたら、リネームされた `userName` を見つけられない。
  > **もし `new Function` が外側変数にアクセスできたら、minifier と問題を起こす。**
- 歴史的理由から、引数はカンマ区切りリストでも与えられる。以下3つは同じ意味:

```js
new Function('a', 'b', 'return a + b'); // basic syntax
new Function('a,b', 'return a + b'); // comma-separated
new Function('a , b', 'return a + b'); // comma-separated with spaces
```

---

### 5. `eval` — コード文字列の実行（出典: https://javascript.info/eval ）

- 構文: `let result = eval(code);`。**`eval` の結果は最後の文（statement）の結果。**
  - `eval('1+1')` → `2`。`eval('let i = 0; ++i')` → `1`。
- **eval されたコードは現在のレキシカル環境で実行されるため、外側変数が見える。**
  - `let a = 1; function f() { let a = 2; eval('alert(a)'); } f();` → `2`。
- **外側変数を変更することもできる**: `let x = 5; eval("x = 10"); alert(x); // 10, value modified`
- **strict モードでは `eval` は自身のレキシカル環境を持つ**。eval 内で宣言された関数・変数は外から見えない。
  - `eval("let x = 5; function f() {}"); alert(typeof x); // undefined`
  - **`use strict` がなければ `eval` は自身のレキシカル環境を持たず、`x` と `f` が外から見える。**
- 「eval is evil」の理由と安全な代替（原文の2つの方策、逐語）:
  - **eval されるコードが外側変数を使わないなら、`window.eval(...)` として呼ぶ** — こうするとコードはグローバルスコープで実行される。
    ```js
    let x = 1;
    {
      let x = 5;
      window.eval('alert(x)'); // 1 (global variable)
    }
    ```
  - **eval されるコードがローカル変数を必要とするなら、`eval` を `new Function` に変え、引数として渡す。**
    ```js
    let f = new Function('a', 'alert(a)');
    f(5); // 5
    ```
- minifier への影響: **`eval` が使われるとローカル変数が eval されたコード文字列からアクセスされうるため、minifier は `eval` から見える可能性のある全変数のリネームを行わない。これは圧縮率に悪影響を与える。**

〔補足（一般知識）〕診断上の要点: `eval` が「現在のレキシカル環境」で動くという性質は、DOM-based XSS において「注入点がクロージャ内部にある」ケースでスコープ内の機密（トークン等）へ到達できることを意味する。逆に `new Function`（および `window.eval`）はグローバルスコープ固定であるため、到達できる識別子集合が異なる。原典はこの差を明示しており、シンク分類のときにこの2つを区別する根拠になる。

---

### 6. `this` の束縛（出典: https://javascript.info/object-methods ）

- オブジェクトのプロパティに格納された関数を **メソッド** と呼ぶ。
- **`this` の値はドットの前のオブジェクト**（メソッド呼び出しに使われたオブジェクト）。
- **`this` は束縛されていない（"this" is not bound）**。`this` はどの関数でも使え、オブジェクトのメソッドでなくても構文エラーにならない。**`this` の値は実行時に、コンテキストに応じて評価される。**
  - 同じ関数を2つのオブジェクトに代入すると、呼び出しごとに異なる `this` になる。`admin['f']()` のようにブラケット記法でも同じ（ドットかブラケットかは関係ない）。
- **オブジェクトなしで呼ぶと `this == undefined`（strict モード）**。
  - **非strict モードでは `this` は*グローバルオブジェクト*（ブラウザでは `window`）になる。これは歴史的挙動で `"use strict"` が修正する。**
- **矢印関数は「自分の」`this` を持たない**。矢印関数内で `this` を参照すると、外側の「通常の」関数から取られる。

〔補足（一般知識）〕診断上の要点: 非strict の `this === window` は、ライブラリ内のメソッドを剥がして呼ぶ（`const f = obj.method; f()`）ことで `window` にプロパティが書かれるガジェットになり得る。原典はこの挙動と、`"use strict"` による修正を明記している。

---

### 7. `func.bind` と部分適用（出典: https://javascript.info/bind ）

- 「`this` を失う」典型例: `setTimeout(user.sayHi, 1000);` → `Hello, undefined!`
  - **ブラウザの `setTimeout` は少し特殊で、関数呼び出しに対し `this=window` を設定する**（Node.js では `this` はタイマーオブジェクトになる）。そのため `this.firstName` は `window.firstName` を取ろうとして存在しない。他の類似ケースでは通常 `this` は `undefined` になる。
- 解決1（ラッパー）: `setTimeout(() => user.sayHi(), 1000);`
  - **脆弱性（原文の表現: "a slight vulnerability appears in our code structure"）**: `setTimeout` が発火する前（1秒の遅延中）に `user` の値が変わると、突然別のオブジェクトを呼んでしまう。
- 解決2（`bind`）: `let boundFunc = func.bind(context);`
  - `func.bind(context)` の結果は**関数として呼び出し可能な特殊な "exotic object"** で、`this=context` を設定して呼び出しを透過的に `func` へ渡す。
  - 引数は「そのまま」渡される。`bind` 後は `user` が変わっても、bind 済みの（古い `user` オブジェクトへの参照である）値を使う。
  - `bindAll` パターン: `for (let key in user) { if (typeof user[key] == 'function') { user[key] = user[key].bind(user); } }`。lodash の `_.bindAll(object, methodNames)` も同様。
- **部分適用（partial application）**: `let bound = func.bind(context, [arg1], [arg2], ...);`
  - `let double = mul.bind(null, 2);` → `double(3)` は `mul(2, 3)` = 6。
  - **コンテキストを固定せず引数だけ固定する**には自作 `partial` が必要（ネイティブ `bind` ではできない）:

```js
function partial(func, ...argsBound) {
  return function(...args) { // (*)
    return func.call(this, ...argsBound, ...args);
  }
}
```

---

### 8. プロトタイプ継承（出典: https://javascript.info/prototype-inheritance ）

- JavaScript のオブジェクトは特殊な隠れプロパティ **`[[Prototype]]`**（仕様上の名称）を持ち、`null` か他のオブジェクトを参照する。その参照先を「プロトタイプ」と呼ぶ。
- **プロパティを読むときに存在しなければ、JavaScript は自動的にプロトタイプから取得する。**
- `__proto__` で設定できる: `rabbit.__proto__ = animal;` は `rabbit.[[Prototype]] = animal` を設定する。
- プロトタイプチェーンは長くできる（`longEar` → `rabbit` → `animal`）。
- **制限は2つだけ**:
  1. 参照は循環できない（`__proto__` を循環的に代入しようとするとエラー）。
  2. **`__proto__` の値はオブジェクトか `null` のいずれか。他の型は無視される。**
  3. （加えて）`[[Prototype]]` は1つだけ。2つのオブジェクトから継承はできない。
- **`__proto__` は `[[Prototype]]` の歴史的な getter/setter である**（`[[Prototype]]` そのものではない）。
  - **仕様上、`__proto__` はブラウザのみがサポートすべきものだが、実際にはサーバサイドを含む全環境がサポートしている。**
  - 現代的には `Object.getPrototypeOf` / `Object.setPrototypeOf` が推奨。
- **書き込み・削除はプロトタイプを使わない**。プロトタイプは**読み取りにのみ**使われる。書き込み/削除はオブジェクトに直接作用する。
  - **例外はアクセサプロパティ**。代入は setter 関数で処理されるため、そのようなプロパティへの書き込みは実質「関数呼び出し」になる。
  - したがって、プロトタイプ上に getter/setter がある場合、`admin.fullName = "Alice Cooper"` は**プロトタイプ上の setter を起動する**が、`this` は `admin`（ドットの前のオブジェクト）なので `admin` の状態のみ変わり、`user` の状態は保護される。
- **`this` はプロトタイプの影響を一切受けない。メソッドがオブジェクト自身にあろうがプロトタイプにあろうが、メソッド呼び出しでは `this` は常にドットの前のオブジェクトである。**
  - 結果: 「メソッドは共有されるが、オブジェクトの状態は共有されない」。
- **`for..in` は継承プロパティも列挙する**。`Object.keys` は自身のキーのみ返す。
  - `obj.hasOwnProperty(key)` で自身のプロパティかどうか判定。
  - チェーンは `rabbit` → `animal` → `Object.prototype` → `null`。
  - `hasOwnProperty` が `for..in` に出ないのは、`Object.prototype` の全プロパティと同様 **`enumerable:false`** フラグを持ち、`for..in` が enumerable なプロパティのみ列挙するため。
  - **`Object.keys`、`Object.values` など他のほぼすべての key/value 取得メソッドは継承プロパティを無視する。**

---

### 9. ネイティブプロトタイプ（出典: https://javascript.info/native-prototypes ）

- `obj = {}` は `obj = new Object()` と同じで、`[[Prototype]]` は `Object.prototype` に設定される。`Object.prototype.__proto__` は `null`。
- `Array`、`Date`、`Function` などもメソッドをプロトタイプに持つ。**仕様上、すべての組み込みプロトタイプの頂点には `Object.prototype` がある。**
  - `arr.__proto__ === Array.prototype`、`arr.__proto__.__proto__ === Object.prototype`、その上は `null`。
  - メソッドは重なることがある（`Array.prototype.toString` が `Object.prototype.toString` より近いので配列版が使われる）。
  - 関数も組み込み `Function` コンストラクタのオブジェクトで、`call`/`apply` などは `Function.prototype` から来る。
- **プリミティブ**: 文字列・数値・真偽値はオブジェクトではないが、プロパティアクセス時に組み込みコンストラクタ `String` / `Number` / `Boolean` で一時ラッパーオブジェクトが作られ、メソッドを提供して消える。メソッドは `String.prototype` / `Number.prototype` / `Boolean.prototype` にある。
  - **`null` と `undefined` にはオブジェクトラッパーがなく、対応するプロトタイプも存在しない。**
- **ネイティブプロトタイプは変更可能**: `String.prototype.show = function() { alert(this); };` → `"BOOM!".show();`
  - 原文の警告: **「プロトタイプはグローバルなので衝突しやすい。2つのライブラリが `String.prototype.show` を追加したら一方が他方を上書きする。一般にネイティブプロトタイプの変更は悪い考えとされる。」**
  - **現代のプログラミングでネイティブプロトタイプ変更が容認される唯一のケースはポリフィルである。**
- **プロトタイプからのメソッド借用（method borrowing）**: `obj.join = Array.prototype.join;` は動作する。組み込み `join` の内部アルゴリズムは正しいインデックスと `length` プロパティだけを見ており、**本当に配列かどうかを検査しない。多くの組み込みメソッドがそうである。**

〔補足（一般知識）〕診断上の要点: 「組み込みメソッドが配列かどうかを検査しない」という性質は、array-like な攻撃者制御オブジェクト（`{0:..., length:...}`）を組み込みメソッドに食わせる型混同系のテストにつながる。原典はこの緩さを明記している。

---

### 10. プロトタイプメソッドと「`__proto__` を持たないオブジェクト」— プロトタイプ汚染の原典的説明（出典: https://javascript.info/prototype-methods ）

これは本サイトで最もセキュリティに直結する節である。

- `obj.__proto__` によるプロトタイプの設定/読み取りは**旧式でやや非推奨**（標準のいわゆる "Annex B"、ブラウザ専用の部に移された）。
- 現代的メソッド:
  - `Object.getPrototypeOf(obj)` — `obj` の `[[Prototype]]` を返す。
  - `Object.setPrototypeOf(obj, proto)` — `obj` の `[[Prototype]]` を `proto` に設定。
  - `Object.create(proto[, descriptors])` — `proto` を `[[Prototype]]` とする空オブジェクトを作る（第2引数は省略可能なプロパティ記述子）。
- **`__proto__` の唯一「眉をひそめられない」用法は、新しいオブジェクトを作るときのプロパティとしての `{ __proto__: ... }` である。**
- 完全なクローン（enumerable/non-enumerable、データプロパティ、setter/getter すべて、正しい `[[Prototype]]` 付き）:

```js
let clone = Object.create(
  Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj)
);
```

#### 10.1 歴史（原文の年代を逐語で保持）

- コンストラクタ関数の `prototype` プロパティは**ごく古い時代**から機能していた。オブジェクトを所与のプロトタイプで作る最古の方法。
- **2012年**、`Object.create` が標準に登場。所与のプロトタイプでオブジェクトを作れるが、取得/設定はできなかった。一部のブラウザが非標準の `__proto__` アクセサを実装し、任意時点での取得/設定を可能にした。
- **2015年**、`Object.setPrototypeOf` と `Object.getPrototypeOf` が標準に追加され、`__proto__` と同じ機能を提供。`__proto__` は事実上どこでも実装済みだったため、いわば非推奨となり標準の Annex B（非ブラウザ環境ではオプショナル）に移された。
- **2022年**、オブジェクトリテラル `{...}` 内での `__proto__` の使用が公式に許可された（Annex B から出た）。ただし getter/setter としての `obj.__proto__` は依然 Annex B。

#### 10.2 速度の警告（原文の枠囲み）

> **速度が問題なら既存オブジェクトの `[[Prototype]]` を変更するな。** 技術的にはいつでも取得/設定できるが、通常はオブジェクト生成時に一度だけ設定し、以後変更しない。JavaScript エンジンはこれに高度に最適化されている。`Object.setPrototypeOf` や `obj.__proto__=` でプロトタイプを「オンザフライ」に変更するのは、**オブジェクトのプロパティアクセス操作に対する内部最適化を壊すため非常に遅い操作**である。

#### 10.3 "Very plain" objects — プロトタイプ汚染の直接的記述

原文（逐語訳、強調は原文の趣旨に従う）:

> オブジェクトはキー/値ペアを保存する連想配列として使える。…しかし**ユーザ提供のキー**（例えばユーザが入力した辞書）を保存しようとすると、興味深い不具合が見える: `"__proto__"` 以外のすべてのキーは正しく動く。

```js run
let obj = {};

let key = prompt("What's the key?", "__proto__");
obj[key] = "some value";

alert(obj[key]); // [object Object], not "some value"!
```

> ユーザが `__proto__` と入力すると、4行目の代入が無視される。…`__proto__` プロパティは特別で、オブジェクトか `null` でなければならない。文字列はプロトタイプになれない。だから文字列を `__proto__` に代入すると無視される。
>
> しかし我々はそんな挙動を*意図して*いなかった。キー/値ペアを保存したいのに、`"__proto__"` という名前のキーが正しく保存されなかった。つまりこれはバグである！
>
> ここでは結果は深刻ではない。しかし他のケースでは `obj` に文字列ではなくオブジェクトを保存しているかもしれず、そうすると**プロトタイプが実際に変更されてしまう**。結果として、実行はまったく予期しない形で誤った方向に進む。
>
> **さらに悪いのは — 通常、開発者はそのような可能性をまったく考えないことである。そのためこの種のバグは気づきにくく、脆弱性に変わることさえある。とくに JavaScript がサーバサイドで使われる場合。**
>
> `obj.toString` への代入でも予期しないことが起こりうる（組み込みオブジェクトメソッドであるため）。

#### 10.4 回避方法（2つ、原文のまま）

1. **`Map` を使う**:

```js run
let map = new Map();

let key = prompt("What's the key?", "__proto__");
map.set(key, "some value");

alert(map.get(key)); // "some value" (as intended)
```

2. **プロトタイプなしオブジェクト**:

```js run
let obj = Object.create(null);
// or: obj = { __proto__: null }

let key = prompt("What's the key?", "__proto__");
obj[key] = "some value";

alert(obj[key]); // "some value"
```

- 仕組み: **`__proto__` はオブジェクトのプロパティではなく `Object.prototype` のアクセサプロパティである**。したがって `obj.__proto__` が読み書きされると、プロトタイプから対応する getter/setter が呼ばれ、`[[Prototype]]` を取得/設定する。`Object.create(null)` はプロトタイプのない空オブジェクト（`[[Prototype]]` が `null`）を作るので、**`__proto__` の継承 getter/setter が存在せず、通常のデータプロパティとして処理される**。
- そのようなオブジェクトを「very plain」または「pure dictionary」オブジェクトと呼ぶ。
- 欠点: `toString` などの組み込みオブジェクトメソッドを欠く（`alert(obj)` は `Error (no toString)`）。ただし連想配列としては通常問題ない。
- **`Object.something(...)` 形式のメソッド（`Object.keys(obj)` など）はプロトタイプにないので、そのようなオブジェクトでも動作し続ける。**

```js run
let chineseDictionary = Object.create(null);
chineseDictionary.hello = "你好";
chineseDictionary.bye = "再见";

alert(Object.keys(chineseDictionary)); // hello,bye
```

- まとめの記述（逐語訳）: 「通常、オブジェクトは組み込みメソッドと `__proto__` getter/setter を `Object.prototype` から継承するため、対応するキーが『占有済み』になり、副作用を引き起こす可能性がある。`null` プロトタイプなら、オブジェクトは真に空である。」

---

### 11. プロパティフラグと記述子（出典: https://javascript.info/property-descriptors ）

オブジェクトプロパティは `value` に加えて3つの特別な属性（フラグ）を持つ:

| フラグ | 意味 |
|---|---|
| `writable` | `true` なら値を変更できる。そうでなければ読み取り専用。 |
| `enumerable` | `true` ならループで列挙される。そうでなければ列挙されない。 |
| `configurable` | `true` ならプロパティを削除でき、これらの属性を変更できる。そうでなければ不可。 |

- 「通常の方法」でプロパティを作ると全フラグが `true`。
- `Object.getOwnPropertyDescriptor(obj, propertyName)` でプロパティの*完全な*情報（記述子オブジェクト）を得る。
- `Object.defineProperty(obj, propertyName, descriptor)` でフラグを変更する。
  - **プロパティが存在すれば `defineProperty` はフラグを更新する。存在しなければ、所与の値とフラグでプロパティを作る。その場合、フラグが供給されなければ `false` と見なされる。**
- **非strict モードでは、non-writable プロパティへの書き込みなどでエラーは発生しない。ただし操作も成功しない。フラグ違反アクションは非strict では黙って無視される。**
- `Math.PI` は non-writable, non-enumerable, non-configurable（記述子の実値 `3.141592653589793`）。`Math.PI = 3;` はエラー、`delete Math.PI` も不可、`Object.defineProperty(Math, "PI", { writable: true })` も `configurable: false` のためエラー。
- **`configurable: false` はプロパティフラグの変更と削除を防ぐが、値の変更は許す**（`writable` が `true` なら）。
- 唯一可能な属性変更: **non-configurable なプロパティに対する `writable: true` → `false`**（逆は不可）。
- `Object.defineProperties(obj, descriptors)` で複数同時定義。
- `Object.getOwnPropertyDescriptors(obj)` で全記述子取得。**`for..in` はシンボリックおよび non-enumerable なプロパティを無視するが、`Object.getOwnPropertyDescriptors` はシンボリックと non-enumerable を含む*すべて*の記述子を返す。**
  - フラグを意識したクローン: `let clone = Object.defineProperties({}, Object.getOwnPropertyDescriptors(obj));`
- オブジェクト全体を封じるメソッド（表）:

| メソッド | 効果 |
|---|---|
| `Object.preventExtensions(obj)` | 新しいプロパティの追加を禁止。 |
| `Object.seal(obj)` | プロパティの追加/削除を禁止。既存の全プロパティに `configurable: false` を設定。 |
| `Object.freeze(obj)` | 追加/削除/変更を禁止。既存の全プロパティに `configurable: false, writable: false` を設定。 |
| `Object.isExtensible(obj)` | プロパティ追加が禁止なら `false`、そうでなければ `true`。 |
| `Object.isSealed(obj)` | 追加/削除が禁止で、既存の全プロパティが `configurable: false` なら `true`。 |
| `Object.isFrozen(obj)` | 追加/削除/変更が禁止で、現在の全プロパティが `configurable: false, writable: false` なら `true`。 |

- 原文の締め: 「これらのメソッドは実際にはあまり使われない。」

〔補足（一般知識）〕診断上の要点: `Object.freeze(Object.prototype)` はプロトタイプ汚染の緩和策としてよく提案されるが、原典が述べるとおり非strict では違反が黙って無視される（例外が出ない）ため、「効いているか」の確認はフラグの状態（`Object.isFrozen`）で行う必要がある。

---

### 12. クラス（出典: https://javascript.info/class ）

- **JavaScript において class は関数の一種である。** `typeof User` は `"function"`。
- `class User {...}` が実際に行うこと:
  1. `User` という名前の関数を作る（クラス宣言の結果となる）。関数コードは `constructor` メソッドから取られる（書かなければ空と見なされる）。
  2. `sayHi` などのクラスメソッドを **`User.prototype`** に格納する。
  - 検証: `User === User.prototype.constructor` は `true`。`Object.getOwnPropertyNames(User.prototype)` は `constructor, sayHi`。
- **単なる糖衣構文ではない**（3つの重要な差異）:
  1. `class` で作られた関数は特殊な内部プロパティ **`[[IsClassConstructor]]: true`** でラベル付けされる。通常の関数と異なり `new` 付きで呼ばなければならない（`User()` → `Error: Class constructor User cannot be invoked without 'new'`）。文字列表現も多くのエンジンで `"class..."` で始まる。
  2. **クラスメソッドは non-enumerable**。クラス定義は `"prototype"` 内の全メソッドに `enumerable` フラグ `false` を設定する。
  3. **クラスは常に `use strict`**。クラス構文内の全コードが自動的に strict モード。
- クラス式（Class Expression）: `let User = class { ... };`。名前付きクラス式の名前はクラス内部でのみ可視。
- getter/setter、計算名 `['say' + 'Hi']()` が使える。技術的には getter/setter は `User.prototype` に作られる。
- **クラスフィールド**: `name = "John";` は `User.prototype` ではなく**個々のオブジェクトに設定される**（`User.prototype.name` は `undefined`）。値は複雑な式や関数呼び出しでもよい（例: `name = prompt("Name, please?", "John");`）。
- **クラスフィールドで束縛済みメソッドを作る**:

```js run
class Button {
  constructor(value) {
    this.value = value;
  }
  click = () => {
    alert(this.value);
  }
}

let button = new Button("hello");

setTimeout(button.click, 1000); // hello
```

  - `click = () => {...}` は**オブジェクトごとに作られ**、`Button` オブジェクトごとに別個の関数が存在し、その内部の `this` はそのオブジェクトを参照する。**ブラウザ環境のイベントリスナで特に有用。**

#### 12.1 プライベートフィールド（出典: https://javascript.info/private-protected-properties-methods ）

- プライベートフィールド（`#` プレフィックス）はパブリックフィールドと衝突しない。プライベート `#waterAmount` とパブリック `waterAmount` を同時に持てる。
- **protected と異なり、プライベートフィールドは言語自体によって強制される。**
- ただし **継承しても直接アクセスできない**。`class MegaCoffeeMachine extends CoffeeMachine { method() { alert( this.#waterAmount ); // Error: can only access from CoffeeMachine } }`
- **プライベートフィールドは `this[name]` として利用できない。`this['#name']` は動作しない。これはプライバシーを保証するための構文上の制約。**

---

### 13. Microtask キュー（出典: https://javascript.info/microtask-queue ）

- Promise ハンドラ `.then`/`.catch`/`.finally` は**常に非同期**。Promise が即座に解決されていても、`.then` 以下の行のコードが先に実行される。
- ECMA 標準は内部キュー **`PromiseJobs`**（より一般には「microtask キュー」、V8 用語）を規定する。[仕様](https://tc39.github.io/ecma262/#sec-jobs-and-job-queues) より:
  - **キューは先入れ先出し（FIFO）: 先にエンキューされたタスクが先に実行される。**
  - **タスクの実行は、他に何も実行されていないときにのみ開始される。**
- 順序を制御したいなら `.then` でチェーンする。
- **未処理 rejection（unhandled rejection）は、microtask キューの終端で Promise のエラーが処理されていないときに発生する。**
  - `setTimeout(() => promise.catch(...), 1000)` で後から `catch` を足しても、`unhandledrejection` が先に発火してしまう。**エンジンは microtask キューが完了した時点で Promise を検査し、rejected 状態のものがあればイベントを発火する。**

---

### 14. イベントループ: microtask と macrotask（出典: https://javascript.info/event-loop ）

#### 14.1 イベントループの基本アルゴリズム

1. タスクがある間: 最も古いタスクから実行する。
2. タスクが現れるまでスリープし、1に戻る。

タスクの例: 外部スクリプト `<script src="...">` のロード完了時の実行 / ユーザのマウス移動による `mousemove` イベントのディスパッチとハンドラ実行 / `setTimeout` の期限到来時のコールバック実行。

タスクはキュー（**"macrotask queue"**、[v8](https://v8.dev/) 用語）を形成し、"first come – first served" で処理される。

**2つの追加事項（逐語訳）**:

1. **エンジンがタスクを実行している間、レンダリングは決して起こらない。** タスクがどれだけ長くかかるかは関係ない。**DOM への変更はタスクが完了した後にのみ描画される。**
2. タスクが長すぎると、ブラウザは他のタスク（ユーザイベント処理など）をできない。そのため一定時間後に「Page Unresponsive」のようなアラートを出し、ページ全体と共にタスクを kill することを提案する。

#### 14.2 Use-case 1: CPU 負荷の高いタスクの分割

- `setTimeout` のネストで分割する。**スケジューリングを `count()` の先頭に移すと有意に速くなる。** 理由: **ネストした `setTimeout` 呼び出しには in-browser の最小遅延 4ms がある。`0` を設定しても `4ms`（かそれ以上）になる。だから早くスケジュールするほど速く走る。**

#### 14.3 Use case 2/3

- 進捗表示: 重いタスクを `setTimeout` で分割すれば、その間に変更が描画される。
- イベント後に何かをする: ハンドラ内でイベントがバブルアップし全レベルで処理されるまで処理を遅らせるには、ゼロ遅延 `setTimeout` でラップする。

#### 14.4 Macrotask と Microtask

- **microtask は我々のコードからのみ発生する。** 通常は Promise によって作られる: `.then/catch/finally` ハンドラの実行が microtask になる。**`await` の「裏側」でも microtask が使われる**（Promise 処理の別形態であるため）。
- 特別な関数 **`queueMicrotask(func)`** が `func` を microtask キューにエンキューする。
- > **すべての *macrotask* の直後に、エンジンは *microtask* キューのすべてのタスクを実行する。他の macrotask やレンダリングやその他何かを実行する前に。**
- 実行順の例: `setTimeout(() => alert("timeout")); Promise.resolve().then(() => alert("promise")); alert("code");` → **`code` → `promise` → `timeout`**。
- **すべての microtask は、他のイベント処理やレンダリング、他の macrotask が行われる前に完了する。**
  - これが重要な理由: **microtask 間でアプリケーション環境が基本的に同じであること（マウス座標の変化なし、新しいネットワークデータなしなど）を保証する。**
- 現在のコードの後、かつ変更が描画されたり新しいイベントが処理されたりする前に関数を非同期実行したいなら `queueMicrotask` を使う。

#### 14.5 詳細なイベントループアルゴリズム（原文のまとめ、逐語訳）

（[仕様](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model) と比べればなお簡略化されているが）

1. *macrotask* キューから最も古いタスクをデキューして実行する（例: "script"）。
2. すべての *microtask* を実行する:
   - microtask キューが空でない間:
     - 最も古い microtask をデキューして実行する。
3. 変更があればレンダリングする。
4. macrotask キューが空なら、macrotask が現れるまで待つ。
5. 1 に戻る。

- 新しい *macrotask* をスケジュールする: ゼロ遅延 `setTimeout(f)`。
- 新しい *microtask* をスケジュールする: `queueMicrotask(f)`。Promise ハンドラも microtask キューを通る。
- **microtask 間に UI やネットワークのイベント処理は入らない。microtask は直後に次々と実行される。**
- Web Workers: イベントループをブロックすべきでない長い重い計算には [Web Workers](https://html.spec.whatwg.org/multipage/workers.html) を使う。別の並列スレッドでコードを走らせる方法。メインプロセスとメッセージを交換できるが、独自の変数と独自のイベントループを持つ。**Web Workers は DOM にアクセスできない**ので、主に計算、複数 CPU コアの同時利用に有用。

---

### 15. async/await（出典: https://javascript.info/async-await ）

- `async` キーワードの2つの効果: (1) 関数が常に Promise を返す（非 Promise は解決済み Promise にラップされる）、(2) その中で `await` が使えるようになる。
- `await promise` は Promise が settle するまで関数の実行を「一時停止」し、結果を返す。
  - **`await` は文字どおり関数の実行を Promise が settle するまで中断し、Promise の結果で再開する。これは CPU リソースを消費しない。JavaScript エンジンはその間、他のジョブ（他のスクリプトの実行、イベント処理など）を行える。**
- 非 async 関数内での `await` は SyntaxError。
- **モジュール内ではトップレベル `await` が動作する**（モダンブラウザ）。モジュールを使わない/古いブラウザを支える場合の万能レシピは無名 async 関数でラップすること: `(async () => { ... })();`
- **`await` は "thenable" を受け付ける**。`.then` メソッドを持つ任意のオブジェクトで足りる。`await` が非 Promise で `.then` を持つオブジェクトを得ると、組み込み関数 `resolve` と `reject` を引数として渡してそのメソッドを呼ぶ（通常の `Promise` executor と同様）。
- エラー処理: `await Promise.reject(new Error("Whoops!"))` は `throw new Error("Whoops!")` と同じ。`try..catch` で捕捉できる。`try..catch` がなければ async 関数呼び出しで生成された Promise が rejected になり、`.catch` を付けて処理できる。付け忘れると未処理 Promise エラーになり、グローバル `unhandledrejection` ハンドラで捕捉できる。
- `Promise.all` と組み合わせて複数の Promise を待てる。

---

### 16. Proxy と Reflect（出典: https://javascript.info/proxy ）

#### 16.1 構文と基本

```js
let proxy = new Proxy(target, handler)
```

- `target` — ラップするオブジェクト。**関数を含め何でもよい。**
- `handler` — プロキシ設定。操作をインターセプトするメソッド（"trap"）を持つオブジェクト。
- trap がなければ操作は `target` に転送される。**空の `handler` の `Proxy` は `target` の透過的なラッパー。** `Proxy` は特殊な "exotic object" で、自身のプロパティを持たない。

#### 16.2 内部メソッドと trap の完全対応表（原文の表を完全再現）

| Internal Method | Handler Method | Triggers when... |
|-----------------|----------------|-------------|
| `[[Get]]` | `get` | reading a property |
| `[[Set]]` | `set` | writing to a property |
| `[[HasProperty]]` | `has` | `in` operator |
| `[[Delete]]` | `deleteProperty` | `delete` operator |
| `[[Call]]` | `apply` | function call |
| `[[Construct]]` | `construct` | `new` operator |
| `[[GetPrototypeOf]]` | `getPrototypeOf` | Object.getPrototypeOf |
| `[[SetPrototypeOf]]` | `setPrototypeOf` | Object.setPrototypeOf |
| `[[IsExtensible]]` | `isExtensible` | Object.isExtensible |
| `[[PreventExtensions]]` | `preventExtensions` | Object.preventExtensions |
| `[[DefineOwnProperty]]` | `defineProperty` | Object.defineProperty, Object.defineProperties |
| `[[GetOwnProperty]]` | `getOwnPropertyDescriptor` | Object.getOwnPropertyDescriptor, `for..in`, `Object.keys/values/entries` |
| `[[OwnPropertyKeys]]` | `ownKeys` | Object.getOwnPropertyNames, Object.getOwnPropertySymbols, `for..in`, `Object.keys/values/entries` |

#### 16.3 不変条件（Invariants）

JavaScript は内部メソッドと trap が満たさなければならない不変条件を強制する:

- `[[Set]]` は値の書き込みに成功したら `true`、そうでなければ `false` を返さなければならない。
- `[[Delete]]` は値の削除に成功したら `true`、そうでなければ `false` を返さなければならない。
- `[[GetPrototypeOf]]` をプロキシオブジェクトに適用した結果は、プロキシの target オブジェクトに適用した `[[GetPrototypeOf]]` と同じ値を返さなければならない。**言い換えれば、プロキシのプロトタイプを読むと常に target オブジェクトのプロトタイプが返らなければならない。**
- 完全な不変条件リストは[仕様](https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots)にある。

#### 16.4 各 trap の引数と要点

- `get(target, property, receiver)` — `receiver` は target プロパティが getter の場合、その呼び出しで `this` として使われるオブジェクト。通常は `proxy` 自身（またはプロキシを継承したオブジェクト）。
- `set(target, property, value, receiver)` — **成功時は `true`、失敗時は `false` を返さなければならない（`false` は `TypeError` を引き起こす）。** 忘れたり falsy を返すと `TypeError`。
  - 配列の `push` / `unshift` などをオーバーライドする必要はない。内部で `[[Set]]` 操作を使うためプロキシがインターセプトする。
- `ownKeys(target)` — `Object.keys` / `for..in` 等が使う。**オブジェクトに存在しないキーを返しても `Object.keys` は列挙しない。** 理由: `Object.keys` は `enumerable` フラグを持つプロパティのみ返し、そのチェックのため各プロパティで内部メソッド `[[GetOwnProperty]]` を呼んで記述子を取得する。プロパティが無ければ記述子は空で `enumerable` フラグがないためスキップされる。
  - 対策: `getOwnPropertyDescriptor` trap で `{ enumerable: true, configurable: true }` を返す。
- `has(target, property)` — `in` 演算子をインターセプト。`range` オブジェクトで `5 in range` を実現する例。
- `apply(target, thisArg, args)` — プロキシを関数として呼ぶのを処理。**プロキシは通常のラッパー関数と違い、`length` や `name` などのプロパティ読み書きもすべて target に転送する**（ラッパー関数だと `sayHi.length` が `0` になるがプロキシなら `1`）。

#### 16.5 `_` プレフィックスの保護と `value.bind(target)` の必然性

- `get` / `set` / `deleteProperty` / `ownKeys` の4つの trap で `_` 始まりのプロパティを保護する例。
- `get` trap の重要な詳細（逐語）:

```js
get(target, prop) {
  // ...
  let value = target[prop];
  return (typeof value === 'function') ? value.bind(target) : value; // (*)
}
```

- 理由: `user.checkPassword()` のようなオブジェクトメソッドは `_password` にアクセスできなければならない。`user.checkPassword()` の呼び出しはプロキシ化された `user` を `this` として受け取る（ドットの前のオブジェクトが `this` になる）ため、`this._password` にアクセスしようとすると `get` trap が発動してエラーを投げる。だから `(*)` でオブジェクトメソッドのコンテキストを元のオブジェクト `target` に束縛する。
- **原文の但し書き（セキュリティ上重要）**: 「その解決策は通常は機能するが理想的ではない。メソッドが非プロキシのオブジェクトを他のどこかに渡してしまうかもしれず、そうなると混乱する: どちらが元のオブジェクトでどちらがプロキシ化されたものか？ さらに、オブジェクトは複数回プロキシ化されうる（複数のプロキシがオブジェクトに異なる『調整』を加える）。**ラップされていないオブジェクトをメソッドに渡すと、予期しない結果が生じうる。** だからそのようなプロキシはどこでも使うべきではない。」
- モダンエンジンは `#` プレフィックスのプライベートプロパティをネイティブにサポートしており、プロキシは不要。**ただしそれ自体の問題もあり、特に継承されない。**

#### 16.6 Reflect

`Reflect` は `Proxy` の作成を簡単にする組み込みオブジェクト。内部メソッドの最小ラッパー。

| Operation |  `Reflect` call | Internal method |
|-----------------|----------------|-------------|
| `obj[prop]` | `Reflect.get(obj, prop)` | `[[Get]]` |
| `obj[prop] = value` | `Reflect.set(obj, prop, value)` | `[[Set]]` |
| `delete obj[prop]` | `Reflect.deleteProperty(obj, prop)` | `[[Delete]]` |
| `new F(value)` | `Reflect.construct(F, value)` | `[[Construct]]` |

> **`Proxy` で trap 可能なすべての内部メソッドについて、`Reflect` に同じ名前・同じ引数のメソッドが存在する。**

- `Reflect` は演算子（`new`、`delete`…）を関数として呼べるようにする。
- **getter のプロキシ問題**: `get` trap が `target[prop]` を返す実装だと、プロキシをプロトタイプにしたオブジェクト（`admin`）から getter を読むと `this=target` で走ってしまい、`admin.name` が `"Admin"` ではなく `"Guest"` になる。
  - 修正: `return Reflect.get(target, prop, receiver);` — `receiver` が正しい `this`（この場合 `admin`）を getter に渡す。
  - より短く: `get(target, prop, receiver) { return Reflect.get(...arguments); }`
  - **`Reflect` 呼び出しは trap とまったく同じ名前・同じ引数を受け取るよう意図的に設計されている。** だから `return Reflect...` は操作を転送する安全な no-brainer。

#### 16.7 Proxy の制限（4つ）

1. **組み込みオブジェクト: 内部スロット（internal slots）**
   - `Map`、`Set`、`Date`、`Promise` などは「内部スロット」を使う。プロパティのようなものだが内部・仕様専用。例えば `Map` はアイテムを内部スロット `[[MapData]]` に保存する。**組み込みメソッドはこれらに直接アクセスし、`[[Get]]/[[Set]]` 内部メソッドを経由しないので `Proxy` はインターセプトできない。**
   - `let proxy = new Proxy(new Map(), {}); proxy.set('test', 1);` → **Error**。[組み込みメソッド `Map.prototype.set`](https://tc39.es/ecma262/#sec-map.prototype.set) が `this.[[MapData]]` にアクセスしようとするが `this=proxy` のため見つからず失敗する。
   - 回避策: `get` trap で `typeof value == 'function' ? value.bind(target) : value` を返す。
   - **注目すべき例外: 組み込み `Array` は内部スロットを使わない**（登場が古い歴史的理由）。だから配列のプロキシ化ではこの問題は起きない。
2. **プライベートフィールド** — 同様に内部スロットで実装されているため、プロキシ化するとメソッド内の `this.#name` が失敗する。メソッドを bind する解決策で動くが、前述の欠点がある。
3. **Proxy ≠ target** — プロキシと元オブジェクトは別のオブジェクト。`Set` のキーとして元オブジェクトを使った後プロキシ化すると `allUsers.has(user)` が `false` になる。
   - > **プロキシは厳密等価テスト `===` をインターセプトできない。** プロキシは `new`（`construct`）、`in`（`has`）、`delete`（`deleteProperty`）など多くの演算子をインターセプトできるが、オブジェクトの厳密等価テストをインターセプトする方法はない。オブジェクトは自分自身とのみ厳密に等しい。**オブジェクトを等価比較するすべての操作と組み込みクラスは、オブジェクトとプロキシを区別する。透過的な置き換えはここには存在しない。**
4. **パフォーマンス** — ベンチマークはエンジン依存だが、一般に最も単純なプロキシでのプロパティアクセスは数倍時間がかかる。実際には一部の「ボトルネック」オブジェクトでのみ問題になる。

#### 16.8 Revocable proxy

```js
let {proxy, revoke} = Proxy.revocable(target, handler)
```

- `revoke()` の呼び出しはプロキシから target オブジェクトへの内部参照をすべて除去し、両者は接続されなくなる。以後 `proxy.data` は Error。
- 当初 `revoke` は `proxy` と分離しているので、`proxy` を渡しつつ `revoke` を現在のスコープに残せる。
- `WeakMap` にプロキシをキー、対応する `revoke` を値として保存するパターンが示されている（`Map` ではなく `WeakMap` を使う理由は GC をブロックしないため）。

---

### 17. ブラウザ環境、DOM / BOM / CSSOM（出典: https://javascript.info/browser-environment ）

- JavaScript 仕様は実行プラットフォームを **host environment** と呼ぶ。host environment は言語コアに加えて独自のオブジェクトと関数を提供する。
- ルートオブジェクト `window` には**2つの役割**がある:
  1. JavaScript コードのグローバルオブジェクト。
  2. 「ブラウザウィンドウ」を表し、それを制御するメソッドを提供する。
- **DOM (Document Object Model)** — ページコンテンツ全体を変更可能なオブジェクトとして表す。`document` オブジェクトがページへの主要な「エントリポイント」。仕様は [DOM Living Standard](https://dom.spec.whatwg.org)。
  - DOM はブラウザ専用ではない。HTML をダウンロードして処理するサーバサイドスクリプトも DOM を使える（仕様の一部のみサポートする場合がある）。
- **CSSOM** — CSS ルールとスタイルシートのための別仕様 [CSS Object Model (CSSOM)](https://www.w3.org/TR/cssom-1/)。DOM とともに使われる。実際にはほとんど必要ない（通常は CSS クラスの追加/削除で済む）。
- **BOM (Browser Object Model)** — ドキュメント以外のすべてを扱うためにブラウザ（host environment）が提供する追加オブジェクト。
  - [navigator](mdn:api/Window/navigator) — ブラウザと OS の背景情報。最も広く知られる2つは **`navigator.userAgent`**（現在のブラウザについて）と **`navigator.platform`**（プラットフォームについて。Windows/Linux/Mac などの識別に役立つ）。
  - [location](mdn:api/Window/location) — 現在の URL を読み、ブラウザを新しい URL へリダイレクトできる。
    ```js run
    alert(location.href); // shows current URL
    if (confirm("Go to Wikipedia?")) {
      location.href = "https://wikipedia.org"; // redirect the browser to another URL
    }
    ```
  - **`alert`/`confirm`/`prompt` も BOM の一部**（ドキュメントと直接関係しない純粋なブラウザメソッド）。
- **仕様の位置づけ（原文のまとめ）**:
  - DOM 仕様: ドキュメント構造、操作、イベントを記述 — https://dom.spec.whatwg.org
  - CSSOM 仕様: スタイルシートとスタイルルール、その操作、ドキュメントへの束縛 — https://www.w3.org/TR/cssom-1/
  - HTML 仕様: HTML 言語（タグ等）に加えて **BOM** も記述 — `setTimeout`、`alert`、`location` など — https://html.spec.whatwg.org 。DOM 仕様を取り込み、多くの追加プロパティ・メソッドで拡張する。
  - 一部のクラスは https://spec.whatwg.org/ に別途記述。
  - 「WHATWG [term]」または「MDN [term]」で検索するのが便利（例: `https://google.com?q=whatwg+localstorage`, `https://google.com?q=mdn+localstorage`）。

---

### 18. DOM ノードのプロパティ — XSS シンクの一次的定義（出典: https://javascript.info/basic-dom-node-properties ）

#### 18.1 DOM ノードクラス階層

ルートは [EventTarget](https://dom.spec.whatwg.org/#eventtarget) で、[Node](https://dom.spec.whatwg.org/#interface-node) が継承し、他の DOM ノードがそれを継承する。

| クラス | 役割 |
|---|---|
| `EventTarget` | すべてのもののルート「抽象」クラス。このクラスのオブジェクトは決して作られない。全 DOM ノードが「イベント」をサポートするための基底。 |
| `Node` | DOM ノードの基底となる「抽象」クラス。コアのツリー機能 `parentNode`、`nextSibling`、`childNodes` などを提供（これらは getter）。`Node` クラスのオブジェクトは決して作られない。 |
| `Document` | 歴史的理由から `HTMLDocument` に継承されることが多い（最新仕様は義務づけない）。ドキュメント全体。グローバル `document` オブジェクトはまさにこのクラスに属する。 |
| `CharacterData` | 「抽象」クラス。`Text` と `Comment` が継承。 |
| `Text` | 要素内のテキストに対応するクラス（`<p>Hello</p>` の `Hello`）。 |
| `Comment` | コメントのクラス。表示されないが、各コメントは DOM のメンバーになる。 |
| `Element` | DOM 要素の基底クラス。`nextElementSibling`、`children` のような要素レベルのナビゲーションと `getElementsByTagName`、`querySelector` のような検索メソッドを提供。`SVGElement`、`XMLElement`、`HTMLElement` の基底。 |
| `HTMLElement` | すべての HTML 要素の基本クラス。`HTMLInputElement`（`<input>`）、`HTMLBodyElement`（`<body>`）、`HTMLAnchorElement`（`<a>`）などに継承される。 |

- `<input>` 要素の DOM オブジェクトは継承順に `HTMLInputElement` → `HTMLElement` → `Element` → `Node` → `EventTarget` → `Object` からプロパティとメソッドを得る（だから `hasOwnProperty` も使える）。
- クラス名を見る方法: `document.body.constructor.name` → `HTMLBodyElement`、`alert(document.body)` → `[object HTMLBodyElement]`、`instanceof` によるチェーン確認。
- `console.log(elem)` は要素の DOM ツリーを表示、`console.dir(elem)` は要素を DOM オブジェクトとして表示（プロパティ探索に適する）。
- 仕様では DOM クラスは JavaScript ではなく **IDL (Interface description language)** で記述される。

#### 18.2 `nodeType`

- `elem.nodeType == 1` — 要素ノード
- `elem.nodeType == 3` — テキストノード
- `elem.nodeType == 9` — document オブジェクト
- 他の値は[仕様](https://dom.spec.whatwg.org/#node)にある。`nodeType` は読み取り専用。

#### 18.3 `nodeName` と `tagName`

- `tagName` は `Element` ノードにのみ存在する。
- `nodeName` は任意の `Node` に定義される。要素では `tagName` と同じ意味。他のノード型（テキスト、コメント等）ではノード型を表す文字列（`#comment`、`#document`）。
- **タグ名は XML モード以外では常に大文字。** ブラウザには HTML モードと XML モードがあり、XML モードは `Content-Type: application/xml+xhtml` ヘッダで XML ドキュメントを受け取ったときに有効になる。HTML モードでは `<body>` も `<BoDy>` も `BODY`。XML モードでは大小がそのまま保たれる。

#### 18.4 コンテンツ系プロパティ（XSS シンク／セーフシンクの一覧表）

| プロパティ | 読み | 書き | HTML として解釈されるか | 備考 |
|---|---|---|---|---|
| `innerHTML` | 要素内の HTML を文字列で取得 | 可 | **HTML として解釈される** | 要素ノードのみ有効。不正な HTML はブラウザが修正する（`'<b>test'` → `<b>test</b>`）。**`innerHTML` が `<script>` タグを挿入しても HTML の一部になるが実行されない。** |
| `outerHTML` | 要素自身を含む完全な HTML | 可 | **HTML として解釈される** | **書き込みは要素を変更しない。DOM から除去して新しい HTML をその位置に挿入する。書き込んだ変数（`div`）は古い値を保持し続ける。** |
| `nodeValue` / `data` | 非要素ノード（テキスト、コメント）の内容 | 可 | 解釈されない | 2つはほぼ同じ。通常 `data` を使う。コメントに埋め込まれたテンプレート命令（`<!-- if isAdmin -->`）を読むのに使われることがある。 |
| `textContent` | 要素内のテキスト（全 `<tags>` を除いたもの） | 可 | **解釈されない（テキストとして挿入）** | 「**`textContent` への書き込みははるかに有用。テキストを『安全な方法』で書き込めるから。**」ユーザ入力の表示に使うべき。 |
| `hidden` | 可視性 | 可 | — | 技術的には `style="display:none"` と同じ。 |
| `value` | `<input>`、`<select>`、`<textarea>` の値 | 可 | — | `HTMLInputElement`、`HTMLSelectElement` 等 |
| `href` | `<a href="...">` の href | 可 | — | `HTMLAnchorElement` |
| `id` | `id` 属性の値、全要素 | 可 | — | `HTMLElement` |

#### 18.5 `innerHTML +=` の完全上書き（重要な副作用）

- `elem.innerHTML += "..."` は `elem.innerHTML = elem.innerHTML + "..."` の短縮形。
- 実際に起こること: (1) 古いコンテンツが除去され、(2) 新しい `innerHTML`（古いものと新しいものの連結）が代わりに書かれる。
- **コンテンツが「ゼロ化」されゼロから書き直されるため、すべての画像と他のリソースが再ロードされる。**
- 他の副作用: 既存テキストがマウスで選択されていた場合、ほとんどのブラウザは `innerHTML` の書き直し時に選択を解除する。ユーザがテキストを入力した `<input>` があればそのテキストは除去される。
- 原文の例（逐語）:
  ```js
  chatDiv.innerHTML += "<div>Hello<img src='smile.gif'/> !</div>";
  chatDiv.innerHTML += "How goes?";
  ```

#### 18.6 `innerHTML` vs `textContent` の対比（原文のデモ、逐語）

```html run
<div id="elem1"></div>
<div id="elem2"></div>

<script>
  let name = prompt("What's your name?", "<b>Winnie-the-Pooh!</b>");

  elem1.innerHTML = name;
  elem2.textContent = name;
</script>
```

1. 最初の `<div>` は名前を「HTML として」受け取る。すべてのタグがタグになるので太字の名前が見える。
2. 2番目の `<div>` は名前を「テキストとして」受け取るので、文字どおり `<b>Winnie-the-Pooh!</b>` が見える。

> ほとんどの場合、我々はユーザからのテキストを期待し、それをテキストとして扱いたい。サイトに予期しない HTML が入るのは望まない。**`textContent` への代入はまさにそれを行う。**

---

### 19. 属性とプロパティ（出典: https://javascript.info/dom-attributes-and-properties ）

- ブラウザがページを読み込むとき HTML をパースして DOM オブジェクトを生成する。要素ノードでは、**ほとんどの標準 HTML 属性が自動的に DOM オブジェクトのプロパティになる**。
- **属性-プロパティのマッピングは1対1ではない。**
- DOM ノードは通常の JavaScript オブジェクトなので改変できる。`document.body.myData = {...}` のように独自プロパティ、`document.body.sayTagName = function() {...}` のように独自メソッドを追加できる。
- **組み込みプロトタイプ `Element.prototype` を変更して全要素に新しいメソッドを追加することもできる**:
  ```js run
  Element.prototype.sayHi = function() {
    alert(`Hello, I'm ${this.tagName}`);
  };

  document.documentElement.sayHi(); // Hello, I'm HTML
  document.body.sayHi(); // Hello, I'm BODY
  ```
- **非標準属性は DOM プロパティを生成しない。** `<body id="test" something="non-standard">` で `document.body.something` は `undefined`。
- ある要素で標準の属性が別の要素では未知であることがある。`"type"` は `<input>`（[HTMLInputElement](https://html.spec.whatwg.org/#htmlinputelement)）では標準だが `<body>`（[HTMLBodyElement](https://html.spec.whatwg.org/#htmlbodyelement)）では標準でない。
- 属性アクセス用メソッド（すべて HTML に書かれているものを正確に操作する）:

| メソッド | 動作 |
|---|---|
| `elem.hasAttribute(name)` | 存在をチェック |
| `elem.getAttribute(name)` | 値を取得 |
| `elem.setAttribute(name, value)` | 値を設定 |
| `elem.removeAttribute(name)` | 属性を削除 |
| `elem.attributes` | 組み込み [Attr](https://dom.spec.whatwg.org/#attr) クラスに属するオブジェクト（`name` と `value` プロパティを持つ）のコレクション。iterable。標準・非標準の全属性を含む。 |

- **HTML 属性の特徴**: 名前は**大文字小文字を区別しない**（`id` は `ID` と同じ）。**値は常に文字列**。
- **プロパティ-属性の同期**: 標準属性が変わると対応するプロパティが自動更新され、（いくつかの例外を除いて）逆も成り立つ。
  - **例外の代表: `input.value` は 属性→プロパティ の方向にのみ同期する。** `input.setAttribute('value', 'text')` → `input.value` は `text`。しかし `input.value = 'newValue'` の後 `input.getAttribute('value')` は `text`（更新されない！）。
  - この「機能」は有用: ユーザ操作で `value` が変わった後、HTML の「元の」値を属性から復元できる。
- **DOM プロパティは型付き**:
  - `input.checked` は boolean（属性値は空文字列だがプロパティ値は `true`）。
  - `style` 属性は文字列だが `style` プロパティはオブジェクト（`[object CSSStyleDeclaration]`）。
  - **`href` DOM プロパティは常に*完全な* URL である。属性が相対 URL や単なる `#hash` を含んでいても。** `<a id="a" href="#hello">` で `a.getAttribute('href')` は `#hello`、`a.href` は `http://site.com/page#hello`。
- **`data-*` 属性**: 「data-」で始まる全属性はプログラマ用に予約されており、`dataset` プロパティで利用できる。`data-about` → `elem.dataset.about`。複数語の `data-order-state` は camelCase の `dataset.orderState` になる。読み取りだけでなく変更も可能で、CSS がそれに応じてビューを更新する。

| | Properties | Attributes |
|------------|------------|------------|
| Type | Any value, standard properties have types described in the spec | A string |
| Name | Name is case-sensitive | Name is not case-sensitive |

- 属性を参照すべきケース（原文のまとめ）: (1) 非標準属性が必要なとき（ただし `data-` 始まりなら `dataset` を使うべき）、(2) HTML に「書かれたとおりの」値が必要なとき（例: `href` プロパティは常に完全 URL なので「元の」値を取りたい場合）。

〔補足（一般知識）〕診断上の要点: `a.href` が常に絶対 URL に正規化される一方 `getAttribute('href')` は生の文字列を返すという差は、`javascript:` スキームや相対パス由来のオープンリダイレクト/DOM XSS を検査する際の観測点の選択に直結する。原典はこの差を明示している。

---

### 20. ドキュメントの変更 — 挿入 API のエスケープ有無（出典: https://javascript.info/modifying-document ）

#### 20.1 ノード生成

- `document.createElement(tag)` — 所与のタグで新しい*要素ノード*を作る。
- `document.createTextNode(text)` — 所与のテキストで新しい*テキストノード*を作る。
- `elem.cloneNode(true)` — 要素の「深い」クローンを作る（全属性と子要素を含む）。`elem.cloneNode(false)` なら子要素なし。

#### 20.2 挿入メソッド（表）

| メソッド | 挿入位置 | 文字列引数の扱い |
|---|---|---|
| `node.append(...nodes or strings)` | `node` の**末尾**に | **テキストとして**（`<`, `>` は適切にエスケープされる） |
| `node.prepend(...nodes or strings)` | `node` の**先頭**に | 同上 |
| `node.before(...nodes or strings)` | `node` の**直前**に | 同上 |
| `node.after(...nodes or strings)` | `node` の**直後**に | 同上 |
| `node.replaceWith(...nodes or strings)` | `node` を置き換える | 同上 |
| `node.remove()` | `node` を削除 | — |

- **原文の明記（逐語）**: 「テキストは『HTML として』ではなく『テキストとして』挿入され、`<`、`>` のような文字は適切にエスケープされる。…**言い換えると、文字列は `elem.textContent` がそうするように安全な方法で挿入される。**」
  - 例: `div.before('<p>Hello</p>', document.createElement('hr'));` の結果 HTML は `&lt;p&gt;Hello&lt;/p&gt;` と `<hr>`。
- **すべての挿入メソッドは、ノードを古い場所から自動的に削除する**（移動には `remove` 不要）。

#### 20.3 `insertAdjacentHTML/Text/Element`

`elem.insertAdjacentHTML(where, html)` — 第1引数は挿入位置を指定するコードワードで、以下のいずれかでなければならない:

| `where` の値 | 挿入位置 |
|---|---|
| `"beforebegin"` | `html` を `elem` の直前に挿入 |
| `"afterbegin"` | `html` を `elem` の内部・先頭に挿入 |
| `"beforeend"` | `html` を `elem` の内部・末尾に挿入 |
| `"afterend"` | `html` を `elem` の直後に挿入 |

- **第2引数は HTML 文字列で、「HTML として」挿入される。**「これが任意の HTML をページに追加できる方法」。
- 兄弟メソッド: `elem.insertAdjacentText(where, text)`（同じ構文だが `text` を「テキストとして」挿入）、`elem.insertAdjacentElement(where, elem)`（要素を挿入）。「実際にはほとんどの場合 `insertAdjacentHTML` のみが使われる」。

#### 20.4 `DocumentFragment`

- ノードのリストを受け渡すためのラッパーとして機能する特別な DOM ノード。他のノードを append できるが、どこかに挿入するとその中身が代わりに挿入される（"blends in"）。
- 明示的に使われることは稀（配列を返して `...` スプレッドで `append` すればよい）。ただし `template` 要素などの上位概念がこれに基づく。

#### 20.5 旧式メソッド

| メソッド | 動作 |
|---|---|
| `parentElem.appendChild(node)` | `node` を `parentElem` の最後の子として追加 |
| `parentElem.insertBefore(node, nextSibling)` | `node` を `parentElem` 内の `nextSibling` の前に挿入 |
| `parentElem.replaceChild(node, oldChild)` | `parentElem` の子のうち `oldChild` を `node` で置換 |
| `parentElem.removeChild(node)` | `parentElem` から `node` を削除（`node` がその子である前提） |

- これらはすべて挿入/削除されたノードを返す。

#### 20.6 `document.write`

- `document.write(html)` の呼び出しは `html` を「まさに今ここに」ページに書き込む。DOM も標準もなかった時代からのメソッド。
- **重要な制限: `document.write` の呼び出しはページがロード中の間のみ機能する。** その後に呼ぶと**既存のドキュメントの内容が消去される**。
- 利点: ブラウザが入ってくる HTML を読んでいる（パースしている）間に呼ばれて何かを書くと、ブラウザはそれを最初から HTML テキストにあったかのように消費する。**DOM 変更が involve されないため非常に速い。** DOM がまだ構築されていない状態でページテキストに直接書き込む。

---

### 21. ブラウザイベント入門（出典: https://javascript.info/introduction-browser-events ）

#### 21.1 主要な DOM イベント一覧（原文の分類を保持）

- **マウスイベント**: `click`（タッチスクリーンデバイスではタップで生成される）、`contextmenu`（右クリック）、`mouseover` / `mouseout`、`mousedown` / `mouseup`、`mousemove`
- **キーボードイベント**: `keydown`、`keyup`
- **フォーム要素イベント**: `submit`、`focus`
- **ドキュメントイベント**: `DOMContentLoaded`（HTML がロード・処理され DOM が完全に構築されたとき）
- **CSS イベント**: `transitionend`

#### 21.2 ハンドラの割り当て方法（3つ）

1. **HTML 属性**: `on<event>`。`<input value="Click me" onclick="alert('Click!')" type="button">`
   - **ハンドラが HTML 属性で割り当てられると、ブラウザはそれを読み、属性の内容から新しい関数を作って DOM プロパティに書き込む。** つまり方法1と方法2は実質同じ。
   - HTML 属性名は大文字小文字を区別しないので `ONCLICK` も `onClick` も動く。
2. **DOM プロパティ**: `elem.onclick = function() {...}`
   - **`onclick` プロパティは1つしかないので、複数のイベントハンドラを割り当てられない。** JavaScript でハンドラを追加すると既存のハンドラを上書きする。
   - 削除は `elem.onclick = null`。
   - **DOM プロパティの大文字小文字は重要**（`elem.onclick`、`elem.ONCLICK` ではない）。
3. **`addEventListener` / `removeEventListener`**

#### 21.3 よくある間違い（原文の "Possible mistakes"）

- `button.onclick = sayThanks;`（正） vs `button.onclick = sayThanks();`（誤 — 関数呼び出しの*結果*（`undefined`）が代入される）。
- マークアップでは括弧が必要（`onclick="sayThanks()"`）。ブラウザが属性を読むと、属性の内容を本体とするハンドラ関数を作るため。
- **ハンドラに `setAttribute` を使ってはいけない**:
  ```js run no-beautify
  // a click on <body> will generate errors,
  // because attributes are always strings, function becomes a string
  document.body.setAttribute('onclick', function() { alert(1) });
  ```

#### 21.4 `addEventListener`

```js
element.addEventListener(event, handler, [options]);
```

`options` オブジェクトのプロパティ:

| オプション | 意味 |
|---|---|
| `once` | `true` なら、リスナは発火後に自動的に削除される。 |
| `capture` | イベントを処理するフェーズ。歴史的理由から `options` は `false`/`true` でもよく、それは `{capture: false/true}` と同じ。 |
| `passive` | `true` なら、ハンドラは `preventDefault()` を呼ばない。 |

- **ハンドラの削除には割り当てたのとまったく同じ関数を渡す必要がある。** 同じコードの別の関数オブジェクトでは削除できない。
  > **関数を変数に保存しないなら削除できない。`addEventListener` で割り当てられたハンドラを「読み戻す」方法はない。**
- **一部のイベントは `addEventListener` でのみ動作する。** 例: `DOMContentLoaded`。`document.onDOMContentLoaded = ...` は決して走らない。

#### 21.5 イベントオブジェクト

| プロパティ | 意味 |
|---|---|
| `event.type` | イベント型（例: `"click"`） |
| `event.currentTarget` | イベントを処理した要素。**`this` とまったく同じ。ただしハンドラが矢印関数の場合や `this` が他のものに束縛されている場合は、`event.currentTarget` から要素を得る。** |
| `event.clientX` / `event.clientY` | ポインタイベントでのカーソルのウィンドウ相対座標 |

- HTML ハンドラでも `event` オブジェクトが使える（ブラウザが `function(event) { ... }` の形でハンドラを作るため。第1引数の名前が `"event"` で、本体が属性から取られる）。

#### 21.6 オブジェクトハンドラ: `handleEvent`

- `addEventListener` には関数ではなくオブジェクトも割り当てられる。イベント発生時に **`obj.handleEvent(event)`** が呼ばれる。
- カスタムクラスのオブジェクトも使える。`handleEvent` は自分で全部やる必要はなく、イベント固有のメソッドを呼び分けられる（`'on' + event.type[0].toUpperCase() + event.type.slice(1)` のような動的メソッド名解決の例が示されている）。

〔補足（一般知識）〕診断上の要点: `handleEvent` による動的メソッド名解決（`this[method](event)`）は、イベント型名が攻撃者に制御できる状況でのプロトタイプ経由のメソッド呼び出し（ガジェット）につながりうる。`data-action` を使ったデリゲーション（次節）も同型のパターン。

---

### 22. バブリングとキャプチャリング（出典: https://javascript.info/bubbling-and-capturing ）

#### 22.1 バブリング

> **要素でイベントが発生すると、まずその要素のハンドラが走り、次に親、さらに他のすべての祖先へと上っていく。**

- `FORM > DIV > P` で内側の `<p>` をクリックすると `p` → `div` → `form` → …→ `document` オブジェクトまで。
- **ほとんど*すべて*のイベントはバブルする。** キーワードは「ほとんど」。例: **`focus` イベントはバブルしない。** 他にも例があるが、これは規則ではなく例外。

#### 22.2 `event.target` vs `this` (= `event.currentTarget`)

- **イベントを引き起こした最も深くネストした要素を *target* 要素と呼び、`event.target` としてアクセスできる。**
- `event.target` — イベントを開始した「ターゲット」要素。**バブリング過程を通じて変化しない。**
- `this` (= `event.currentTarget`) — 「現在の」要素、現在走っているハンドラを持つ要素。
- クリックが `<form>` 要素そのもので行われた場合、`event.target` が `this` と等しくなることもある。

#### 22.3 バブリングの停止

- `event.stopPropagation()` — 上方向への移動を停止する。
- **`event.stopImmediatePropagation()`** — 「1つの要素に同一イベントの複数のハンドラがある場合、そのうち1つがバブリングを停止しても他は実行される。言い換えると `event.stopPropagation()` は上方向への移動を停止するが、現在の要素上の他の全ハンドラは走る。バブリングを停止し**かつ**現在の要素上のハンドラが走るのを防ぐには `event.stopImmediatePropagation()` がある。それ以降、他のハンドラは実行されない。」
- **原文の警告（逐語訳、セキュリティ/観測性に直結）**:
  > **必要もなくバブリングを停止するな！** バブリングは便利である。明白かつアーキテクチャ的によく考えられた本当の必要性なしに停止するな。時に `event.stopPropagation()` は隠れた落とし穴を作り、後に問題になる。
  > 例:
  > 1. ネストしたメニューを作る。各サブメニューが自身の要素上のクリックを処理し、外側のメニューがトリガされないよう `stopPropagation` を呼ぶ。
  > 2. 後に、ユーザの振る舞い（どこをクリックするか）を追跡するためウィンドウ全体のクリックを捕捉しようと決める。分析システムはこれをやる。通常コードは `document.addEventListener('click'…)` で全クリックを捕捉する。
  > 3. **我々の分析は `stopPropagation` でクリックが止められている領域では機能しない。悲しいことに「デッドゾーン」を得てしまった。**
  >
  > 通常バブリングを防ぐ本当の必要はない。それを要求するように見えるタスクは他の手段で解決できる。その1つはカスタムイベントを使うこと。また、あるハンドラで `event` オブジェクトにデータを書き込み、別のハンドラでそれを読むこともできるので、下位での処理情報を親のハンドラへ渡せる。

#### 22.4 キャプチャリング

標準 [DOM Events](https://www.w3.org/TR/DOM-Level-3-Events/) はイベント伝播の3フェーズを記述する:

1. **Capturing phase** — イベントが要素へ下っていく。
2. **Target phase** — イベントがターゲット要素に到達した。
3. **Bubbling phase** — イベントが要素から上っていく。

- **`on<event>` プロパティ、HTML 属性、2引数の `addEventListener(event, handler)` で追加されたハンドラはキャプチャについて何も知らず、第2・第3フェーズでのみ走る。**
- キャプチャフェーズで捕捉するには `capture` オプションを `true` にする:
  ```js
  elem.addEventListener(..., {capture: true})

  // or, just "true" is an alias to {capture: true}
  elem.addEventListener(..., true)
  ```
- 形式上3フェーズあるが、**第2フェーズ（target phase）は別扱いされない。キャプチャとバブリング両フェーズのハンドラがそのフェーズでトリガされる。**
- `<p>` をクリックしたときの順序: `HTML` → `BODY` → `FORM` → `DIV` → `P`（キャプチャ）、続いて `P` → `DIV` → `FORM` → `BODY` → `HTML`（バブリング）。`P` は2回現れる。
- `event.eventPhase` はイベントが捕捉されたフェーズ番号を返す（capturing=1, target=2, bubbling=3）。
- **ハンドラ削除には同じフェーズを指定する必要がある**（`addEventListener(..., true)` なら `removeEventListener(..., true)`）。
- **同一要素・同一フェーズのリスナは設定順に走る**（保証される）。
- **キャプチャフェーズ中の `event.stopPropagation()` はバブリングも防ぐ。** 「通常イベントはまず下り（キャプチャ）、次に上る（バブリング）。しかしキャプチャフェーズ中に `event.stopPropagation()` が呼ばれると、イベントの移動が止まり、バブリングは起こらない。」

---

### 23. イベントデリゲーション（出典: https://javascript.info/event-delegation ）

#### 23.1 アルゴリズム

1. コンテナに単一のハンドラを置く。
2. ハンドラ内でソース要素 `event.target` をチェックする。
3. 興味のある要素の内部でイベントが起きたなら、そのイベントを処理する。

#### 23.2 堅牢な実装（原文の改良コード、逐語）

```js
table.onclick = function(event) {
  let td = event.target.closest('td'); // (1)

  if (!td) return; // (2)

  if (!table.contains(td)) return; // (3)

  highlight(td); // (4)
};
```

説明:
1. `elem.closest(selector)` はセレクタにマッチする最も近い祖先を返す。
2. `event.target` がどの `<td>` 内にもなければ即座に return。
3. **ネストしたテーブルの場合、`event.target` が `<td>` であっても現在のテーブルの外にあることがある。** だから*我々のテーブルの*`<td>` かをチェックする。
4. そうならハイライトする。

#### 23.3 マークアップ内のアクション（`data-action` パターン）

```html
<button data-action="save">Click to Save</button>
```

```html autorun height=60 run untrusted
<div id="menu">
  <button data-action="save">Save</button>
  <button data-action="load">Load</button>
  <button data-action="search">Search</button>
</div>

<script>
  class Menu {
    constructor(elem) {
      this._elem = elem;
      elem.onclick = this.onClick.bind(this); // (*)
    }

    save() {
      alert('saving');
    }

    load() {
      alert('loading');
    }

    search() {
      alert('searching');
    }

    onClick(event) {
      let action = event.target.dataset.action;
      if (action) {
        this[action]();
      }
    };
  }

  new Menu(menu);
</script>
```

- **`this.onClick` を `(*)` で `this` に bind しているのが重要。** そうでないと内部の `this` が `Menu` オブジェクトではなく DOM 要素（`elem`）を参照し、`this[action]` が意図したものにならない。
- `data-action` のほうがクラス `.action-save` などより意味論的に良く、CSS ルールでも使える。

〔補足（一般知識）〕診断上の要点: `this[action]()` は `action` が DOM 属性（＝しばしば HTML インジェクション経由で攻撃者が制御可能）から来るため、プロトタイプチェーン上の任意メソッド（`constructor`、`toString` 等）を呼ぶガジェットになりうる。原典はこのパターンを推奨パターンとして提示しているので、教科書では「実装パターンとしての普及度」と「注入時のガジェット性」を併記すべき。

#### 23.4 「behavior」パターン

パターンは2つの部分からなる:
1. 要素にその振る舞いを記述するカスタム属性を追加する。
2. **ドキュメント全体のハンドラ**がイベントを追跡し、属性付き要素でイベントが起きたらアクションを実行する。

- Behavior: Counter — `data-counter` 属性、`document.addEventListener('click', ...)` で `event.target.dataset.counter != undefined` をチェック。
- Behavior: Toggler — `data-toggle-id` 属性で `document.getElementById(id)` の `hidden` をトグル。
- **原文の警告（逐語）**: 「**document レベルのハンドラには常に `addEventListener` を使え。** `document` オブジェクトにイベントハンドラを割り当てるときは、`document.on<event>` ではなく常に `addEventListener` を使うべき。後者は衝突を引き起こす（新しいハンドラが古いものを上書きする）。実際のプロジェクトでは、コードの異なる部分によって `document` に多数のハンドラが設定されるのが普通。」

#### 23.5 デリゲーションの制限（原文の compare ブロック）

- **第一に、イベントはバブリングしなければならない。** 一部のイベントはバブルしない。また下位のハンドラは `event.stopPropagation()` を使うべきでない。
- 第二に、デリゲーションは CPU 負荷を増やしうる。コンテナレベルのハンドラが、興味があるかないかに関わらずコンテナ内のあらゆる場所のイベントに反応するため。ただし通常は無視できる。

---

### 24. ブラウザのデフォルトアクション（出典: https://javascript.info/default-browser-action ）

#### 24.1 デフォルトアクションの一覧（原文のまとめ）

| イベント | デフォルトアクション |
|---|---|
| `mousedown` | 選択を開始する（マウスを動かして選択） |
| `click` on `<input type="checkbox">` | `input` をチェック/アンチェックする |
| `submit` | `<input type="submit">` のクリック、またはフォームフィールド内での `Enter` 押下でこのイベントが発生し、その後ブラウザがフォームを送信する |
| `keydown` | キー押下がフィールドへの文字追加や他のアクションにつながる |
| `contextmenu` | 右クリックでイベントが起き、アクションはブラウザのコンテキストメニュー表示 |
| （リンクのクリック） | その URL へのナビゲーションを開始 |

#### 24.2 防止方法

- **主な方法は `event.preventDefault()`。**
- **`on<event>` で割り当てられたハンドラ（`addEventListener` ではない）なら `return false` も同じ効果。**
  - **ハンドラが返す値は通常無視される。唯一の例外が `on<event>` で割り当てられたハンドラからの `return false`。** それ以外の場合 `return` 値は無視される。特に `true` を返す意味はない。
- **後続イベント（Follow-up events）**: 「あるイベントが別のイベントに流れ込むことがある。最初のイベントを防ぐと2番目は起こらない。」
  - `<input>` 上の `mousedown` はフォーカスと `focus` イベントにつながる。`mousedown` を防ぐとフォーカスされない。
  - ただし他の方法（`Tab` キー）でならフォーカス可能。マウスクリックではもう不可。

#### 24.3 `passive` オプション

- `addEventListener` の任意オプション `passive: true` は、**ハンドラが `preventDefault()` を呼ばないことをブラウザに知らせる。**
- 必要な理由: モバイルデバイスの `touchmove` などはデフォルトでスクロールを引き起こすが、ハンドラ内の `preventDefault()` でそれを防げる。そのためブラウザはそのイベントを検出したとき、まず全ハンドラを処理し、どこでも `preventDefault` が呼ばれなければスクロールに進む。これが不要な遅延と UI の「ジッタ」を引き起こしうる。
- **一部のブラウザ（Firefox, Chrome）では `touchstart` と `touchmove` イベントに対して `passive` はデフォルトで `true`。**

#### 24.4 `event.defaultPrevented`

- デフォルトアクションが防がれたら `true`、そうでなければ `false`。
- **`event.stopPropagation()` の代わりに使える**: ネストしたコンテキストメニューの例で、`document.oncontextmenu` 内で `if (event.defaultPrevented) return;` をチェックすれば、下位が処理済みのイベントを無視できる。
  - `stopPropagation()` を使う代償は高い: 「**右クリックに関する情報へのアクセスを、統計を集めるカウンタを含むあらゆる外部コードに対して永久に拒否してしまう。それは非常に賢明でない。**」
- **`event.stopPropagation()` と `event.preventDefault()`（`return false` としても知られる）は2つの異なるものであり、互いに無関係。**

#### 24.5 セマンティクスの警告（原文の枠囲み）

> 技術的には、デフォルトアクションを防いで JavaScript を追加すれば任意の要素の振る舞いをカスタマイズできる。例えばリンク `<a>` をボタンのように、ボタン `<button>` をリンクのように（別 URL へリダイレクト等）振る舞わせられる。
> しかし一般に HTML 要素の意味論的な意味は保つべきである。…それは「単に良いこと」であるだけでなく、**アクセシビリティの観点で HTML を良くする。**
> `<a>` の例では: ブラウザはそのようなリンクを新しいウィンドウで開くことを（右クリック等で）許す。人々はそれを好む。しかしボタンを JavaScript でリンクのように振る舞わせ CSS でリンクのように見せても、`<a>` 固有のブラウザ機能は働かない。

---

### 25. カスタムイベントのディスパッチ（出典: https://javascript.info/dispatch-events ）

#### 25.1 コンストラクタ

```js
let event = new Event(type[, options]);
```

- `type` — イベント型。`"click"` のような文字列、または `"my-event"` のような独自のもの。
- `options` — 2つの任意プロパティを持つオブジェクト:
  - `bubbles: true/false` — `true` ならイベントはバブルする。
  - `cancelable: true/false` — `true` なら「デフォルトアクション」を防げる。
  - **デフォルトは両方 `false`: `{bubbles: false, cancelable: false}`。**

#### 25.2 `dispatchEvent` と `event.isTrusted`

- `elem.dispatchEvent(event)` でイベントを「走らせる」。ハンドラは通常のブラウザイベントと同様に反応する。
- **`event.isTrusted`**（原文の枠囲み、逐語訳）:
  > 「本物」のユーザイベントとスクリプト生成イベントを区別する方法がある。**プロパティ `event.isTrusted` は実際のユーザアクションから来たイベントでは `true`、スクリプト生成イベントでは `false` である。**
- カスタムイベントには `addEventListener` を使う必要がある（`on<event>` は組み込みイベントにしか存在せず、`document.onhello` は動かない）。
- バブルさせるには `bubbles: true` を設定しなければならない。

#### 25.3 UI イベントクラス

[UI Event 仕様](https://www.w3.org/TR/uievents) のクラス: `UIEvent`、`FocusEvent`、`MouseEvent`、`WheelEvent`、`KeyboardEvent`、…

- そのようなイベントを作るなら `new Event` ではなくこれらを使うべき（例: `new MouseEvent("click")`）。
- **正しいコンストラクタはそのイベント型の標準プロパティを指定できる**（`clientX`/`clientY` 等）。**汎用の `Event` コンストラクタはそれを許さない — 未知のプロパティは無視される**（`event.clientX` が `undefined` になる）。
- 技術的には生成後に `event.clientX=100` を直接代入すれば回避できる。**ブラウザ生成のイベントは常に正しい型を持つ。**

#### 25.4 `CustomEvent`

- 独自の新イベント型には `new CustomEvent` を使うべき。技術的には [CustomEvent](https://dom.spec.whatwg.org/#customevent) は `Event` と同じだが、1つ例外がある。
- 第2引数（オブジェクト）に追加プロパティ **`detail`** を加えられる（任意のカスタム情報）。ハンドラは `event.detail` でアクセスする。
- `CustomEvent` が `detail` という特別フィールドを提供するのは**他のイベントプロパティとの衝突を避けるため**。

#### 25.5 `event.preventDefault()` とカスタムイベント

- `event.preventDefault()` を呼ぶと、`elem.dispatchEvent(event)` の呼び出しは `false` を返す。ディスパッチしたコードは続行すべきでないと分かる。
- **イベントは `cancelable: true` フラグを持たなければならない。そうでないと `event.preventDefault()` の呼び出しは無視される。**

#### 25.6 イベント内イベントは同期的

- 通常イベントはキューで処理される（`onclick` 処理中に新しいイベントが発生したらキューに入る）。
- **注目すべき例外は、あるイベントが別のイベントの内部から開始された場合（例: `dispatchEvent` 使用）。そのようなイベントは即座に処理される: 新しいイベントハンドラが呼ばれ、それから現在のイベント処理が再開される。**
  - 出力順序は `1 -> nested -> 2`。ネストしたイベントの伝播と処理は、外側のコード（`onclick`）に処理が戻る前に完了する。
  - **`dispatchEvent` に限らない。イベントハンドラが他のイベントをトリガするメソッドを呼ぶと、それらも同期的にネストして処理される。**
- 分離したいなら `dispatchEvent` をゼロ遅延 `setTimeout` でラップする → 出力順序は `1 -> 2 -> nested`。

#### 25.7 原文の注意（ブラウザイベントの生成について）

> ブラウザイベント（`click` や `keydown` など）を生成する技術的可能性はあるが、細心の注意をもって使うべきである。
> **ハンドラを走らせるためにブラウザイベントを生成すべきではない。それはハッキーな方法であり、ほとんどの場合悪いアーキテクチャである。**
> ネイティブイベントが生成されるかもしれないケース:
> - サードパーティライブラリを必要な形で動かすための汚いハック（他の対話手段を提供していない場合）。
> - 自動テストのため。スクリプトで「ボタンをクリック」してインターフェースが正しく反応するか見る。

---

### 26. Shadow DOM とイベント（出典: https://javascript.info/shadow-dom-events ）

- shadow tree の狙いはコンポーネントの内部実装詳細をカプセル化すること。詳細をカプセル化したまま保つため、**ブラウザはイベントを *retarget*（再ターゲット）する。**
- > **shadow DOM 内で発生したイベントは、コンポーネント外で捕捉されたとき、host 要素を target とする。**
  - 例: shadow DOM 内の `<button>` をクリックすると、内部ハンドラは `Inner target: BUTTON`、`document` ハンドラは `Outer target: USER-CARD`。
- **retargeting は、light DOM に物理的に存在する slotted 要素でイベントが発生した場合には起こらない。** `<span slot="username">` のクリックでは、shadow 側・light 側両方のハンドラで target はその `span` 要素。
  - 一方、shadow DOM 由来の要素（例: `<b>Name</b>`）でクリックが起こると、shadow DOM の外にバブルアウトする際に `event.target` は `<user-card>` にリセットされる。

#### 26.1 `event.composedPath()`

- バブリングの目的には **flattened DOM** が使われる。
- 元のイベントターゲットへの完全なパス（全 shadow 要素を含む）は **`event.composedPath()`** で得られる。
- 例: `<span slot="username">` のクリックで `event.composedPath()` は配列 `[span, slot, div, shadow-root, user-card, body, html, document, window]` を返す。これは flattened DOM におけるターゲット要素からの親チェーンそのもの。
- **shadow tree の詳細は `{mode:'open'}` のツリーにのみ提供される。** `{mode: 'closed'}` で作られた shadow tree では、composed path は host（`user-card`）から始まって上へ。「closed ツリーの内部は完全に隠される。」

#### 26.2 `event.composed`

**`composed: true` を持つイベント**（shadow DOM 境界を越える）:

- `blur`, `focus`, `focusin`, `focusout`
- `click`, `dblclick`
- `mousedown`, `mouseup`, `mousemove`, `mouseout`, `mouseover`
- `wheel`
- `beforeinput`, `input`, `keydown`, `keyup`
- **すべての touch イベントと pointer イベントも `composed: true`。**

**`composed: false` を持つイベント**（同一 DOM 内の要素でのみ捕捉可能）:

- `mouseenter`, `mouseleave`（そもそもバブルしない）
- `load`, `unload`, `abort`, `error`
- `select`
- `slotchange`

- **カスタムイベントをディスパッチするときは、コンポーネントの外へバブルアップさせるため `bubbles` と `composed` の両方を `true` に設定する必要がある。**
- ネストしたコンポーネントでは、1つの shadow DOM が別の shadow DOM にネストしうる。**その場合 composed イベントはすべての shadow DOM 境界を越えてバブルする。** イベントを直近の囲むコンポーネントだけに向けたいなら、shadow host 上でディスパッチし `composed: false` を設定することもできる。

---

### 27. Same Origin Policy とクロスウィンドウ通信（出典: https://javascript.info/cross-window-communication ）

#### 27.1 Same Origin の定義

> **2つの URL は、プロトコル、ドメイン、ポートが同じであれば「same origin」であると言われる。**

同一オリジンの例:
- `http://site.com`
- `http://site.com/`
- `http://site.com/my/page.html`

同一オリジンでない例:
- `http://www.site.com`（別ドメイン: `www.` が問題になる）
- `http://site.org`（別ドメイン: `.org` が問題になる）
- `https://site.com`（別プロトコル: `https`）
- `http://site.com:8080`（別ポート: `8080`）

「Same Origin」ポリシーが述べること:
- 別ウィンドウ（`window.open` で作られたポップアップや `<iframe>` 内のウィンドウ）への参照があり、そのウィンドウが同一オリジンから来ているなら、**そのウィンドウへ完全なアクセスがある。**
- そうでなく別オリジンから来ているなら、**そのウィンドウのコンテンツ（変数、document、何でも）にアクセスできない。唯一の例外は `location` で、変更できる（＝ユーザをリダイレクトできる）。しかし location を*読む*ことはできない**（ユーザが今どこにいるかは見えず、情報漏えいはない）。

#### 27.2 iframe での実際

- `iframe.contentWindow` で `<iframe>` 内の window を取得。
- `iframe.contentDocument` で `<iframe>` 内の document を取得（`iframe.contentWindow.document` の短縮形）。
- 別オリジンの `<iframe>` で許されること/許されないこと:
  - `iframe.contentWindow` の取得 — **許される**
  - `iframe.contentDocument` — **Security Error (another origin)**
  - `iframe.contentWindow.location.href` の**読み取り** — **Security Error**
  - `iframe.contentWindow.location = '/'` の**書き込み** — **OK**（iframe に別のものをロードできる）
- 同一オリジンなら何でもできる（`iframe.contentDocument.body.prepend("Hello, world!")`）。
- `iframe.onload` は本質的に `iframe.contentWindow.onload` と同じ（埋め込みウィンドウが全リソースとともに完全にロードされたときにトリガ）。ただし別オリジンの iframe では `iframe.contentWindow.onload` にアクセスできないので `iframe.onload` を使う。

#### 27.3 サブドメインと `document.domain`

- 同じ2次レベルドメインを共有するウィンドウ（`john.site.com`、`peter.site.com`、`site.com` — 共通の2次レベルドメインが `site.com`）なら、各ウィンドウで `document.domain = 'site.com';` を実行すればブラウザにその差を無視させ、クロスウィンドウ通信の目的では「same origin」から来たものとして扱わせられる。
- **原文の警告（逐語訳）**: 「**非推奨だがまだ動く。** `document.domain` プロパティは[仕様](https://html.spec.whatwg.org/multipage/origin.html#relaxing-the-same-origin-restriction)から除去される過程にある。クロスウィンドウメッセージング（後述）が推奨される代替。とはいえ現時点では全ブラウザがサポートしており、`document.domain` に依存する古いコードを壊さないため将来もサポートは維持される。」

#### 27.4 iframe の「間違った document」の落とし穴

- **iframe は生成時に即座に document を持つ。しかしその document は、後にロードされるものとは異なる！**
- そのため即座に document に何かをすると、おそらく失われる。イベントハンドラを設定しても無視される。
- 正しい document が確実にある時点は `iframe.onload` がトリガされたとき。ただしそれは iframe 全体が全リソースとともにロードされたときにのみトリガされる。
- より早い時点を捉えるには `setInterval` でチェックする（100ms ごとに `iframe.contentDocument` が新しいものかを比較）。

#### 27.5 `window.frames` と階層

- `window.frames[0]` — ドキュメント内の最初のフレームの window オブジェクト（番号指定）。
- `window.frames.iframeName` — `name="iframeName"` のフレームの window オブジェクト（名前指定）。
- ナビゲーションリンク:
  - `window.frames` — 「子」ウィンドウのコレクション（ネストしたフレーム用）。
  - `window.parent` — 「親」（外側）ウィンドウへの参照。
  - `window.top` — 最上位の親ウィンドウへの参照。
- フレーム内かどうかのチェック: `if (window == top) { ... } else { ... }`

#### 27.6 `sandbox` iframe 属性（完全な一覧）

- `sandbox` 属性は、信頼できないコードの実行を防ぐため `<iframe>` 内の特定のアクションを除外できる。**iframe を別オリジンから来たものとして扱い、かつ/または他の制限を適用することで「サンドボックス化」する。**
- `<iframe sandbox src="...">` には「デフォルトの制限セット」が適用される。**空の `"sandbox"` 属性が可能な限り最も厳しい制限を課す**が、適用*しない*制限をスペース区切りリストで指定して緩和できる（例: `<iframe sandbox="allow-forms allow-popups">`）。

| 値 | 意味（原文の逐語訳） |
|---|---|
| `allow-same-origin` | デフォルトで `"sandbox"` は iframe に「別オリジン」ポリシーを強制する。言い換えると、`src` が同じサイトを指していても、ブラウザに `iframe` を別オリジンから来たものとして扱わせる。スクリプトに対する含意されるすべての制限とともに。このオプションはその機能を除去する。 |
| `allow-top-navigation` | `iframe` が `parent.location` を変更するのを許可する。 |
| `allow-forms` | `iframe` からフォームを送信するのを許可する。 |
| `allow-scripts` | `iframe` からスクリプトを実行するのを許可する。 |
| `allow-popups` | `iframe` から `window.open` でポップアップを開くのを許可する。 |

- 完全な一覧は [MDN の iframe マニュアル](mdn:/HTML/Element/iframe) にある。
- **原文の注記（逐語訳）**: 「`"sandbox"` 属性の目的は*制限を追加すること*のみである。制限を除去することはできない。特に、iframe が別オリジンから来ている場合に same-origin 制限を緩和することはできない。」

#### 27.7 `postMessage`

- **`postMessage` インターフェースは、どのオリジンから来ていようとウィンドウ同士が話すことを可能にする。**
- > これは「Same Origin」ポリシーを回避する方法である。`john-smith.com` のウィンドウが `gmail.com` と話して情報交換することを可能にする。**ただし両者が同意し、対応する JavaScript 関数を呼ぶ場合のみ。それがユーザにとって安全な理由である。**

**送信側**: `win.postMessage(data, targetOrigin)`

| 引数 | 意味 |
|---|---|
| `data` | 送るデータ。任意のオブジェクトでよく、**データは「structured serialization algorithm」を使ってクローンされる。** IE は文字列のみサポートするので、そのブラウザを支えるには複雑なオブジェクトを `JSON.stringify` すべき。 |
| `targetOrigin` | ターゲットウィンドウのオリジンを指定する。**所与のオリジンからのウィンドウのみがメッセージを受け取る。** |

- **`targetOrigin` は安全策である（原文の逐語訳）**: 「ターゲットウィンドウが別オリジンから来ている場合、送信側ウィンドウではその `location` を読めないことを思い出そう。だから意図したウィンドウに今どのサイトが開かれているか確信できない。ユーザが別の場所へナビゲートしてしまったかもしれず、送信側ウィンドウはそれを知らない。**`targetOrigin` を指定すれば、そのウィンドウがまだ正しいサイトにある場合にのみデータを受け取ることが保証される。データが機密である場合に重要。**」
- チェックが不要なら `targetOrigin` を `*` に設定できる。

**受信側**: `message` イベントのハンドラ。`postMessage` が呼ばれ（かつ `targetOrigin` チェックが成功し）たときにトリガされる。

| イベントプロパティ | 意味 |
|---|---|
| `data` | `postMessage` からのデータ |
| `origin` | 送信側のオリジン（例: `http://javascript.info`） |
| `source` | 送信側ウィンドウへの参照。すぐに `source.postMessage(...)` で返信できる。 |

- **ハンドラの割り当てには `addEventListener` を使う必要がある。短縮構文 `window.onmessage` は動作しない。**
- 原文のハンドラ例（逐語）:

```js
window.addEventListener("message", function(event) {
  if (event.origin != 'http://javascript.info') {
    // something from an unknown domain, let's ignore it
    return;
  }

  alert( "received: " + event.data );

  // can message back using event.source.postMessage(...)
});
```

#### 27.8 まとめ（原文の逐語訳）

- ポップアップの参照: opener 側から `window.open`（新ウィンドウを開き参照を返す）、ポップアップ側から `window.opener`（ポップアップから opener ウィンドウへの参照）。
- iframe: `window.frames`、`window.parent`、`window.top`、`iframe.contentWindow`。
- **ウィンドウが同一オリジン（host, port, protocol）を共有すれば、ウィンドウは互いに何でもできる。**
- そうでなければ可能なアクションは: **別ウィンドウの `location` の変更（書き込み専用アクセス）** と **メッセージの送信** のみ。
- 例外: 同じ2次レベルドメインを共有するウィンドウ（`a.site.com` と `b.site.com`）。両方で `document.domain='site.com'` を設定すると「same origin」状態になる。iframe が `sandbox` 属性を持つ場合、`allow-same-origin` が属性値に指定されていない限り強制的に「別オリジン」状態に置かれる。**これは同一サイトからの信頼できないコードを iframe で実行するのに使える。**
- `postMessage` の3ステップ:
  1. 送信側が `targetWin.postMessage(data, targetOrigin)` を呼ぶ。
  2. `targetOrigin` が `'*'` でなければ、ブラウザは `targetWin` が `targetOrigin` のオリジンを持つかチェックする。
  3. そうなら `targetWin` が `message` イベントをトリガする（`origin`、`source`、`data` の特別プロパティ付き）。

---

### 28. ポップアップと window メソッド（出典: https://javascript.info/popup-windows ）

- `window.open('https://javascript.info/')` で新ウィンドウを開く。**最新のブラウザはほとんど、別ウィンドウではなく新しいタブで URL を開くよう設定されている。**
- **ポップアップがまだ使われるタスク**（例: OAuth 認可 = Google/Facebook ログイン）の理由:
  1. **ポップアップは独立した JavaScript 環境を持つ別ウィンドウである。だからサードパーティの信頼できないサイトからポップアップを開くのは安全。**
  2. ポップアップを開くのは非常に簡単。
  3. ポップアップはナビゲート（URL 変更）でき、opener ウィンドウにメッセージを送れる。

#### 28.1 ポップアップブロッキング

- **ほとんどのブラウザは、`onclick` のようなユーザトリガのイベントハンドラ外から呼ばれた場合にポップアップをブロックする。**
  ```js
  // popup blocked
  window.open('https://javascript.info');

  // popup allowed
  button.onclick = () => {
    window.open('https://javascript.info');
  };
  ```

#### 28.2 `window.open(url, name, params)`

| 引数 | 意味 |
|---|---|
| `url` | 新ウィンドウにロードする URL |
| `name` | 新ウィンドウの名前。各ウィンドウは `window.name` を持ち、ここでポップアップに使うウィンドウを指定できる。**その名前のウィンドウが既にあれば、所与の URL がそこに開かれる。なければ新ウィンドウが開かれる。** |
| `params` | 新ウィンドウの設定文字列。カンマ区切りの設定。**params にスペースがあってはならない**（例: `width=200,height=100`） |

`params` の設定:

- 位置:
  - `left/top`（数値）— 画面上のウィンドウ左上隅の座標。**制限: 新ウィンドウを画面外に配置できない。**
  - `width/height`（数値）— 新ウィンドウの幅と高さ。**最小幅/高さに制限があるので、不可視のウィンドウを作ることは不可能。**
- ウィンドウ機能:
  - `menubar` (yes/no) — 新ウィンドウのブラウザメニューを表示/非表示
  - `toolbar` (yes/no) — ナビゲーションバー（戻る、進む、リロード等）を表示/非表示
  - `location` (yes/no) — 新ウィンドウの URL フィールドを表示/非表示。**FF と IE はデフォルトで非表示にすることを許さない。**
  - `status` (yes/no) — ステータスバーを表示/非表示。**ほとんどのブラウザは強制的に表示する。**
  - `resizable` (yes/no) — リサイズを無効化できる。**非推奨。**
  - `scrollbars` (yes/no) — スクロールバーを無効化できる。**非推奨。**

省略された設定の規則:
- `open` 呼び出しに第3引数がない、または空なら、デフォルトのウィンドウパラメータが使われる。
- **params 文字列があって一部の `yes/no` 機能が省略されている場合、省略された機能は `no` 値と見なされる。** だから params を指定するなら、必要な機能すべてを明示的に yes に設定すること。
- `left/top` が params にない場合、ブラウザは最後に開かれたウィンドウの近くに新ウィンドウを開こうとする。
- `width/height` がない場合、新ウィンドウは最後に開かれたものと同じサイズになる。

#### 28.3 ポップアップからのアクセス / 双方向性

- `window.opener` — **ポップアップ以外の全ウィンドウでは `null`。**
- 原文のデモ（逐語、opener の DOM を書き換える）:

```js run
let newWin = window.open("about:blank", "hello", "width=200,height=200");

newWin.document.write(
  "<script>window.opener.document.body.innerHTML = 'Test'<\/script>"
);
```

- 「**ウィンドウ間の接続は双方向である: メインウィンドウとポップアップは互いへの参照を持つ。**」
- `win.close()` / `win.closed`。技術的には `close()` は任意の `window` で利用可能だが、**`window.open()` で作られていない `window` では、ほとんどのブラウザが `window.close()` を無視する。** だからポップアップでのみ機能する。

#### 28.4 移動・リサイズ・フォーカスの制限（悪用防止の歴史）

- `win.moveBy(x,y)` / `win.moveTo(x,y)` / `win.resizeBy(width,height)` / `win.resizeTo(width,height)`。
- **「悪用を防ぐため、ブラウザは通常これらのメソッドをブロックする。我々が開いたポップアップで、追加のタブがないものに対してのみ確実に機能する。」**
- **JavaScript にはウィンドウを最小化/最大化する方法がない。これらの OS レベル機能はフロントエンド開発者から隠されている。**
- `window.focus()` / `window.blur()` は「実際には厳しく制限されている。過去に悪意あるページが悪用したため」。
  - 悪用例（原文のまま）: `window.onblur = () => window.focus();` — ユーザがウィンドウから切り替えようとすると（`window.onblur`）ウィンドウをフォーカスに戻す。意図は「ユーザを `window` 内に*ロック*すること」。
  - 「ブラウザはそのようなコードを禁じ、広告や悪意あるページからユーザを保護するため多くの制限を導入しなければならなかった。制限はブラウザに依存する。例えばモバイルブラウザは通常 `window.focus()` を完全に無視する。また、ポップアップが新ウィンドウではなく別タブで開かれる場合フォーカスは機能しない。」
  - `blur` イベントは訪問者がウィンドウから切り替えたことを意味するが、**まだそれを見ているかもしれない。ウィンドウはバックグラウンドだがまだ可視である可能性がある。**

---

### 29. クリックジャッキング攻撃（出典: https://javascript.info/clickjacking ）

#### 29.1 攻撃の考え方

> 「クリックジャッキング」攻撃は、悪意あるページが**訪問者の代わりに**「被害者サイト」をクリックすることを可能にする。
> **Twitter、Facebook、Paypal などを含む多くのサイトがこの方法でハックされた。もちろんすべて修正されている。**

Facebook でのクリックジャッキングの手順（原文の逐語訳）:
1. 訪問者が悪意あるページに誘い込まれる。どうやってかは問題でない。
2. ページには無害に見えるリンクがある（"get rich now" や "click here, very funny" のような）。
3. そのリンクの上に、悪意あるページは **facebook.com からの `src` を持つ透明な `<iframe>`** を配置する。「Like」ボタンがちょうどそのリンクの真上に来るように。**通常これは `z-index` で行われる。**
4. リンクをクリックしようとして、訪問者は実際にはボタンをクリックする。

#### 29.2 デモ（原文のコード逐語）

```html run height=120 no-beautify
<style>
iframe { /* iframe from the victim site */
  width: 400px;
  height: 100px;
  position: absolute;
  top:0; left:-20px;
  opacity: 0.5; /* in real opacity:0 */
  z-index: 1;
}
</style>

<div>Click to get rich now:</div>

<!-- The url from the victim site -->
<iframe src="/clickjacking/facebook.html"></iframe>

<button>Click here!</button>

<div>...And you're cool (I'm a cool hacker actually)!</div>
```

- **結果: 訪問者が Facebook に認可済み（"remember me" は通常オン）なら「Like」が追加される。Twitter なら「Follow」ボタン。**
- 必要なのは、悪意あるページ上で `<iframe>` をボタンがリンクの真上に来るよう配置することだけ。**通常 CSS で可能。**

#### 29.3 キーボードは対象外（原文の枠囲み）

> **クリックジャッキングはクリック用であり、キーボード用ではない。**
> 攻撃はマウスアクション（またはモバイルのタップのような類似操作）にのみ影響する。
> **キーボード入力のリダイレクトははるかに困難。** 技術的には、ハックしたいテキストフィールドがあれば、テキストフィールドが重なるように iframe を配置できる。訪問者がページ上で見える入力にフォーカスしようとすると、実際には iframe 内の入力にフォーカスする。
> しかし問題がある。iframe が不可視なので、訪問者が入力するものはすべて隠される。**人々は普通、新しい文字が画面に表示されないと入力をやめる。**

#### 29.4 旧来の防御（弱い）

**framebusting**:

```js
if (top != window) {
  top.location = window.location;
}
```

- **信頼できる防御ではない。回避方法が多数ある。**

**回避1: トップナビゲーションのブロック** — トップページ（攻撃者側の囲むページ）が `beforeunload` に阻止ハンドラを設定する:

```js
window.onbeforeunload = function() {
  return false;
};
```

- `iframe` が `top.location` を変えようとすると、訪問者は離脱するか尋ねるメッセージを見る。**ほとんどの場合、訪問者は iframe について知らないため否定的に答える — 見えるのはトップページだけで、離れる理由がない。だから `top.location` は変わらない！**

**回避2: sandbox 属性** — `sandbox` 属性が制限するものの1つがナビゲーションである。**サンドボックス化された iframe は `top.location` を変更できない。**
- `<iframe sandbox="allow-scripts allow-forms" src="facebook.html"></iframe>` — スクリプトとフォームを許可して制限を緩和するが、**`allow-top-navigation` を省くことで `top.location` の変更を禁じる。**
- 「この単純な保護を回避する他の方法もある。」

#### 29.5 `X-Frame-Options`

- **サーバ側ヘッダ `X-Frame-Options` はページをフレーム内で表示することを許可または禁止できる。**
- **HTTP ヘッダとして正確に送られなければならない。HTML の `<meta>` タグで見つかった場合、ブラウザはそれを無視する。つまり `<meta http-equiv="X-Frame-Options"...>` は何もしない。**

ヘッダは3つの値を取りうる:

| 値 | 意味 |
|---|---|
| `DENY` | 決してフレーム内でページを表示しない。 |
| `SAMEORIGIN` | 親ドキュメントが同一オリジンから来ているならフレーム内を許可する。 |
| `ALLOW-FROM domain` | 親ドキュメントが所与のドメインから来ているならフレーム内を許可する。 |

- **例: Twitter は `X-Frame-Options: SAMEORIGIN` を使う。**

#### 29.6 機能を無効化して表示する（covering div）

- `X-Frame-Options` には副作用がある。**正当な理由があっても他のサイトは我々のページをフレーム内で表示できなくなる。**
- 代替: `height: 100%; width: 100%;` のスタイルを持つ `<div>` でページを「覆い」、全クリックをインターセプトする。その `<div>` は `window == top` の場合、または保護が不要と判明した場合に除去する。

```html
<style>
  #protector {
    height: 100%;
    width: 100%;
    position: absolute;
    left: 0;
    top: 0;
    z-index: 99999999;
  }
</style>

<div id="protector">
  <a href="/" target="_blank">Go to the site</a>
</div>

<script>
  // there will be an error if top window is from the different origin
  // but that's ok here
  if (top.document.domain == document.domain) {
    protector.remove();
  }
</script>
```

#### 29.7 `samesite` Cookie 属性によるクリックジャッキング防止

- **`samesite` 属性を持つ Cookie は、サイトが直接開かれた場合にのみ送られる。フレーム経由などでは送られない。**
- Facebook が認証 Cookie に `samesite` を付けていれば（`Set-Cookie: authorization=secret; samesite`）、別サイトからの iframe で Facebook が開かれたときにその Cookie は送られず、攻撃は失敗する。
- **限界（原文の逐語訳）**: 「`samesite` Cookie 属性は Cookie が使われていない場合には効果がない。これは他のウェブサイトが我々の公開・未認証ページを簡単に iframe で表示することを許すかもしれない。しかしこれは、限られたケースではクリックジャッキング攻撃を成立させることも許す。**例えば、IP アドレスをチェックして重複投票を防ぐ匿名投票サイトは、Cookie でユーザを認証していないため、依然としてクリックジャッキングに脆弱である。**」

#### 29.8 まとめ（原文の推奨、逐語訳）

- 「一つの見方では攻撃は『深くない』: ハッカーがやっているのは単一のクリックをインターセプトすることだけ。しかし別の見方では、**クリック後に別のコントロールが現れることをハッカーが知っていれば、巧妙なメッセージでユーザにそれらもクリックさせるよう強要できる。**」
- 「攻撃は非常に危険である。なぜなら UI を設計するとき、我々は普通ハッカーが訪問者の代わりにクリックするかもしれないとは予期しないから。**だから脆弱性はまったく予期しない場所で見つかりうる。**」
- **フレーム内で閲覧されることを意図しないページ（またはサイト全体）には `X-Frame-Options: SAMEORIGIN` を使うことが推奨される。**
- **ページを iframe で表示させたいがなお安全でいたいなら、覆う `<div>` を使う。**

---

### 30. Fetch の基本（出典: https://javascript.info/fetch ）

- 構文: `let promise = fetch(url, [options])`。`options` なしなら単純な GET リクエスト。
- レスポンス取得は通常2段階:
  1. **`fetch` が返す `promise` は、サーバがヘッダで応答するとすぐに組み込み [Response](https://fetch.spec.whatwg.org/#response-class) クラスのオブジェクトで解決される。** この段階で HTTP ステータスとヘッダをチェックできるが、まだ body はない。
     - **`promise` が reject するのは `fetch` が HTTP リクエストを行えなかった場合**（ネットワーク問題、サイトが存在しないなど）。**404 や 500 のような異常な HTTP ステータスはエラーを引き起こさない。**
     - `response.status` — HTTP ステータスコード。`response.ok` — boolean、HTTP ステータスコードが 200-299 なら `true`。
  2. body 取得には追加のメソッド呼び出しが必要。

| メソッド | 動作 |
|---|---|
| `response.text()` | レスポンスを読みテキストとして返す |
| `response.json()` | レスポンスを JSON としてパースする |
| `response.formData()` | レスポンスを `FormData` オブジェクトとして返す |
| `response.blob()` | レスポンスを [Blob](https://javascript.info/blob)（型付きバイナリデータ）として返す |
| `response.arrayBuffer()` | レスポンスを [ArrayBuffer](https://javascript.info/arraybuffer-binary-arrays)（バイナリデータの低レベル表現）として返す |
| `response.body` | [ReadableStream](https://streams.spec.whatwg.org/#rs-class) オブジェクト。body をチャンクごとに読める |

- **body 読み取りメソッドは1つしか選べない。** 既に `response.text()` でレスポンスを取得したら `response.json()` は動作しない（body コンテンツが既に処理済み）。
- `response.headers` は Map ライクなヘッダオブジェクト（`get` と反復が可能）。

#### 30.1 禁止された HTTP ヘッダ一覧（完全再現）

`fetch` の `headers` オプションで設定**できない**[forbidden HTTP headers](https://fetch.spec.whatwg.org/#forbidden-header-name):

- `Accept-Charset`, `Accept-Encoding`
- `Access-Control-Request-Headers`
- `Access-Control-Request-Method`
- `Connection`
- `Content-Length`
- `Cookie`, `Cookie2`
- `Date`
- `DNT`
- `Expect`
- `Host`
- `Keep-Alive`
- `Origin`
- `Referer`
- `TE`
- `Trailer`
- `Transfer-Encoding`
- `Upgrade`
- `Via`
- `Proxy-*`
- `Sec-*`

> **これらのヘッダは適切で安全な HTTP を保証するため、ブラウザによって排他的に制御される。**

#### 30.2 POST リクエスト

- `method` — HTTP メソッド（例: `POST`）
- `body` — リクエスト body。以下のいずれか: 文字列（例: JSON エンコード）、`FormData` オブジェクト（`multipart/form-data` として送信）、`Blob`/`BufferSource`（バイナリ送信）、[URLSearchParams](https://javascript.info/url)（`x-www-form-urlencoded` エンコード、めったに使われない）
- **リクエスト `body` が文字列なら `Content-Type` ヘッダはデフォルトで `text/plain;charset=UTF-8` に設定される。**
- `Blob` オブジェクトを送る場合、`Blob` は組み込みの型を持つので `Content-Type` を手動設定しない。**`Blob` オブジェクトではその型が `Content-Type` の値になる。**

---

### 31. Fetch: クロスオリジンリクエスト（CORS）（出典: https://javascript.info/fetch-crossorigin ）

#### 31.1 CORS の歴史的背景（原文の逐語訳の要点）

> **CORS は邪悪なハッカーからインターネットを守るために存在する。**
> **長年にわたり、あるサイトのスクリプトは別のサイトのコンテンツにアクセスできなかった。** そのシンプルだが強力な規則がインターネットセキュリティの基礎だった。例えば `hacker.com` の邪悪なスクリプトは `gmail.com` のユーザのメールボックスにアクセスできなかった。
> しかし開発者はより多くの力を要求した。制限を回避して他のウェブサイトへリクエストする様々なトリックが発明された。

**トリック1: フォーム** — `<form>` を `<iframe>` に送信する。
```html
<!-- form target -->
<iframe name="iframe"></iframe>

<!-- a form could be dynamically generated and submitted by JavaScript -->
<form target="iframe" method="POST" action="http://another.com/…">
  ...
</form>
```
- **フォームはどこへでもデータを送れるので、ネットワークメソッドなしに他サイトへ GET/POST リクエストができた。しかし別サイトの `<iframe>` のコンテンツへのアクセスは禁じられているので、レスポンスを読むことはできなかった。**

**トリック2: スクリプト（JSONP）** — `<script src="http://another.com/…">` は任意のドメインの `src` を持てる。`another.com` がこの種のアクセスにデータを公開する意図があれば "JSONP (JSON with padding)" プロトコルが使われた。
1. あらかじめデータを受け取るグローバル関数（例: `gotWeather`）を宣言する。
2. `src="http://another.com/weather.json?callback=gotWeather"` の `<script>` タグを作る。関数名を `callback` URL パラメータとして使う。
3. リモートサーバ `another.com` が `gotWeather(...)` を受け取らせたいデータで呼ぶスクリプトを動的に生成する。
4. リモートスクリプトがロード・実行されると `gotWeather` が走り、我々の関数なのでデータを得る。
- **「それは機能し、セキュリティを侵害しない。なぜなら双方がこの方法でデータを渡すことに同意したから。双方が同意しているなら、それは確かにハックではない。」古いブラウザでも動くため、今もこの種のアクセスを提供するサービスが存在する。**

#### 31.2 Safe requests（安全なリクエスト）の定義

**リクエストが safe であるのは以下の2条件を満たす場合:**

1. **[Safe method](https://fetch.spec.whatwg.org/#cors-safelisted-method): GET, POST または HEAD**
2. **[Safe headers](https://fetch.spec.whatwg.org/#cors-safelisted-request-header) — 許可されるカスタムヘッダは以下のみ:**
   - `Accept`
   - `Accept-Language`
   - `Content-Language`
   - `Content-Type` で値が `application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain` のいずれか

- それ以外のリクエストはすべて「unsafe」と見なされる。例えば `PUT` メソッドや `API-Key` HTTP ヘッダを持つリクエストは制限に合わない。
- > **本質的な違いは、safe リクエストは特別なメソッドなしに `<form>` や `<script>` で作れるということである。** だから非常に古いサーバでも safe リクエストを受け入れる準備があるはずである。
- > 対照的に、非標準ヘッダや `DELETE` メソッドのようなリクエストはこの方法で作れない。長い間 JavaScript はそのようなリクエストができなかった。**だから古いサーバは、そのようなリクエストが特権的なソースから来たと想定するかもしれない。「なぜならウェブページはそれらを送れないから」。**

#### 31.3 Safe request における CORS

- **リクエストがクロスオリジンなら、ブラウザは常に `Origin` ヘッダを追加する。**
- `Origin` ヘッダはパスなしの正確なオリジン（ドメイン/プロトコル/ポート）を含む。

```http
GET /request
Host: anywhere.com
Origin: https://javascript.info
...
```

- サーバは `Origin` を検査し、そのようなリクエストを受け入れることに同意するなら特別なヘッダ `Access-Control-Allow-Origin` をレスポンスに追加する。そのヘッダは許可されたオリジン（この場合 `https://javascript.info`）またはアスタリスク `*` を含むべきである。
- **ブラウザは信頼された仲介者の役割を果たす**:
  1. 正しい `Origin` がクロスオリジンリクエストとともに送られることを保証する。
  2. レスポンス内の許可を示す `Access-Control-Allow-Origin` をチェックし、存在すれば JavaScript がレスポンスにアクセスすることを許す。そうでなければエラーで失敗する。

寛容なサーバレスポンスの例:
```http
200 OK
Content-Type:text/html; charset=UTF-8
Access-Control-Allow-Origin: https://javascript.info
```

#### 31.4 レスポンスヘッダ（safe response headers 一覧）

**クロスオリジンリクエストでは、デフォルトで JavaScript はいわゆる「safe」レスポンスヘッダにのみアクセスできる:**

- `Cache-Control`
- `Content-Language`
- `Content-Length`
- `Content-Type`
- `Expires`
- `Last-Modified`
- `Pragma`

**それ以外のレスポンスヘッダにアクセスするとエラーになる。**

- **他のレスポンスヘッダへの JavaScript アクセスを許可するには、サーバは `Access-Control-Expose-Headers` ヘッダを送らなければならない。** アクセス可能にすべき unsafe なヘッダ名のカンマ区切りリストを含む。

```http
200 OK
Content-Type:text/html; charset=UTF-8
Content-Length: 12345
Content-Encoding: gzip
API-Key: 2c9de507f2c54aa1
Access-Control-Allow-Origin: https://javascript.info
Access-Control-Expose-Headers: Content-Encoding,API-Key
```

#### 31.5 Unsafe request と preflight

- **preflight リクエストは `OPTIONS` メソッドを使い、body なしで3つのヘッダを持つ:**
  - `Access-Control-Request-Method` — unsafe リクエストのメソッド
  - `Access-Control-Request-Headers` — その unsafe な HTTP ヘッダのカンマ区切りリスト
  - `Origin` — リクエストがどこから来たか（例: `https://javascript.info`）
- サーバが同意するなら、**空の body、ステータス 200 と以下のヘッダで応答すべき:**
  - `Access-Control-Allow-Origin` は `*` またはリクエスト元オリジン（例: `https://javascript.info`）でなければならない
  - `Access-Control-Allow-Methods` は許可されたメソッドを持たなければならない
  - `Access-Control-Allow-Headers` は許可されたヘッダのリストを持たなければならない
  - 加えて `Access-Control-Max-Age` で許可をキャッシュする秒数を指定できる。**そうすればブラウザは、所与の許可を満たす後続リクエストに対して preflight を送る必要がなくなる。**

**具体例（原文のリクエスト）:**

```js
let response = await fetch('https://site.com/service.json', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'API-Key': 'secret'
  }
});
```

このリクエストが unsafe である3つの理由（1つで十分）:
- メソッド `PATCH`
- `Content-Type` が `application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain` のいずれでもない
- 「unsafe」な `API-Key` ヘッダ

**Step 1（preflight リクエスト）:**

```http
OPTIONS /service.json
Host: site.com
Origin: https://javascript.info
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: Content-Type,API-Key
```

- メソッド: `OPTIONS`
- パス: メイン リクエストとまったく同じ `/service.json`

**Step 2（preflight レスポンス）:**

```http
200 OK
Access-Control-Allow-Origin: https://javascript.info
Access-Control-Allow-Methods: PUT,PATCH,DELETE
Access-Control-Allow-Headers: API-Key,Content-Type,If-Modified-Since,Cache-Control
Access-Control-Max-Age: 86400
```

- **上のレスポンスは 86400 秒（1日）キャッシュされる。この時間枠内では、後続リクエストは preflight を引き起こさない。** キャッシュされた許可に合致すると仮定すれば、直接送られる。

**Step 3（実際のリクエスト）:**

```http
PATCH /service.json
Host: site.com
Content-Type: application/json
API-Key: secret
Origin: https://javascript.info
```

**Step 4（実際のレスポンス）:**

```http
Access-Control-Allow-Origin: https://javascript.info
```

- **サーバはメインレスポンスにも `Access-Control-Allow-Origin` を追加するのを忘れてはならない。preflight の成功はそれを免除しない。**
- **preflight リクエストは「舞台裏」で起こり、JavaScript には不可視。** JavaScript はメインリクエストのレスポンス、またはサーバ許可がない場合のエラーのみを得る。

#### 31.6 Credentials

- **JavaScript コードによって開始されたクロスオリジンリクエストは、デフォルトでいかなる credential（Cookie や HTTP 認証）も持っていかない。**
- **`fetch('http://another.com')` は Cookie を送らない。`another.com` ドメインに属するものでさえ（！）**
- 理由（原文の逐語訳）: 「**credential 付きのリクエストは、それなしのものよりはるかに強力である。許されれば、ユーザの credential を使ってユーザの代わりに行動し機密情報にアクセスする完全な力を JavaScript に与える。** サーバは本当にそこまでスクリプトを信頼するのか？ ならば追加のヘッダで credential 付きのリクエストを明示的に許可しなければならない。」
- `fetch('http://another.com', { credentials: "include" });`
- サーバが同意するなら、`Access-Control-Allow-Origin` に加えて `Access-Control-Allow-Credentials: true` をレスポンスに追加すべき。

```http
200 OK
Access-Control-Allow-Origin: https://javascript.info
Access-Control-Allow-Credentials: true
```

- > **注意: credential 付きリクエストでは `Access-Control-Allow-Origin` にアスタリスク `*` を使うことは禁じられている。** 上に示したように、正確なオリジンを提供しなければならない。**これは追加の安全策であり、サーバがそのようなリクエストを行うことを信頼する相手を本当に知っていることを保証するためである。**

#### 31.7 まとめ（原文のまとめの表形式化）

**safe リクエストの場合:**
- → ブラウザはオリジン付きの `Origin` ヘッダを送る。
- ← credential なしのリクエスト（デフォルトで送られない）では、サーバは以下を設定すべき:
  - `Access-Control-Allow-Origin` を `*` または `Origin` と同じ値に
- ← credential 付きリクエストでは、サーバは以下を設定すべき:
  - `Access-Control-Allow-Origin` を `Origin` と同じ値に
  - `Access-Control-Allow-Credentials` を `true` に
- 加えて、`Cache-Control`、`Content-Language`、`Content-Type`、`Expires`、`Last-Modified`、`Pragma` 以外のレスポンスヘッダへの JavaScript アクセスを許可するには、サーバは `Access-Control-Expose-Headers` ヘッダに許可するものを列挙すべき。

**unsafe リクエストの場合、要求されたリクエストの前に予備的な "preflight" リクエストが発行される:**
- → ブラウザは同じ URL に `OPTIONS` リクエストを送る。ヘッダは:
  - `Access-Control-Request-Method` — 要求メソッド
  - `Access-Control-Request-Headers` — unsafe な要求ヘッダのリスト
- ← サーバはステータス 200 と以下のヘッダで応答すべき:
  - `Access-Control-Allow-Methods` — 許可されたメソッドのリスト
  - `Access-Control-Allow-Headers` — 許可されたヘッダのリスト
  - `Access-Control-Max-Age` — 許可をキャッシュする秒数
- その後、実際のリクエストが送られ、前述の「safe」スキームが適用される。

---

### 32. Fetch API 全オプション（出典: https://javascript.info/fetch-api ）

すべての可能な `fetch` オプションとデフォルト値（原文の逐語、コメントは代替値）:

```js
let promise = fetch(url, {
  method: "GET", // POST, PUT, DELETE, etc.
  headers: {
    // the content type header value is usually auto-set
    // depending on the request body
    "Content-Type": "text/plain;charset=UTF-8"
  },
  body: undefined, // string, FormData, Blob, BufferSource, or URLSearchParams
  referrer: "about:client", // or "" to send no Referer header,
  // or an url from the current origin
  referrerPolicy: "strict-origin-when-cross-origin", // no-referrer-when-downgrade, no-referrer, origin, same-origin...
  mode: "cors", // same-origin, no-cors
  credentials: "same-origin", // omit, include
  cache: "default", // no-store, reload, no-cache, force-cache, or only-if-cached
  redirect: "follow", // manual, error
  integrity: "", // a hash, like "sha256-abcdef1234567890"
  keepalive: false, // true
  signal: undefined, // AbortController to abort request
  window: window // null
});
```

#### 32.1 `referrer`, `referrerPolicy`

- **`referrer` オプションは任意の `Referer` を（現在のオリジン内で）設定するか、除去できる。**
  - 空文字列で referrer を送らない: `fetch('/page', { referrer: "" });`
  - 現在のオリジン内の別 URL: `fetch('/page', { referrer: "https://javascript.info/anotherpage" });`
- リクエストは3種類に分けられる: (1) 同一オリジンへのリクエスト、(2) 別オリジンへのリクエスト、(3) HTTPS から HTTP へのリクエスト（安全から不安全なプロトコルへ）。

[Referrer Policy 仕様](https://w3c.github.io/webappsec-referrer-policy/) に記述された可能な値:

| 値 | To same origin | To another origin | HTTPS→HTTP |
|-------|----------------|-------------------|------------|
| `"no-referrer"` | - | - | - |
| `"no-referrer-when-downgrade"` | full | full | - |
| `"origin"` | origin | origin | origin |
| `"origin-when-cross-origin"` | full | origin | origin |
| `"same-origin"` | full | - | - |
| `"strict-origin"` | origin | origin | - |
| `"strict-origin-when-cross-origin"` or `""` (default) | full | origin | - |
| `"unsafe-url"` | full | full | full |

- 各値の説明（原文の逐語訳）:
  - **`"strict-origin-when-cross-origin"`** — デフォルト値。同一オリジンには完全な `Referer` を送り、クロスオリジンにはオリジンのみを送る。ただし HTTPS→HTTP リクエストの場合は何も送らない。
  - **`"no-referrer-when-downgrade"`** — 完全な `Referer` を常に送る。ただし HTTPS から HTTP（より安全でないプロトコル）へリクエストを送る場合を除く。
  - **`"no-referrer"`** — `Referer` を決して送らない。
  - **`"origin"`** — `Referer` にオリジンのみを送り、完全なページ URL は送らない。例えば `http://site.com/path` ではなく `http://site.com` のみ。
  - **`"origin-when-cross-origin"`** — 同一オリジンには完全な `Referer` を送るが、クロスオリジンリクエストにはオリジン部分のみ。
  - **`"same-origin"`** — 同一オリジンには完全な `Referer` を送るが、クロスオリジンリクエストには `Referer` を送らない。
  - **`"strict-origin"`** — オリジンのみを送り、HTTPS→HTTP リクエストには `Referer` を送らない。
  - **`"unsafe-url"`** — HTTPS→HTTP リクエストでさえ常に完全な URL を `Referer` に送る。
- 実務例（原文）: 「サイトの外から知られるべきでない URL 構造を持つ管理ゾーンがあるとする。…デフォルトでは常にページの完全な URL を持つ `Referer` ヘッダを送る。例えば `Referer: https://javascript.info/admin/secret/paths`。他のウェブサイトにオリジン部分だけを知らせたいなら `referrerPolicy: "origin-when-cross-origin"` を設定する。」
- **Referrer policy は `fetch` 用だけではない。** [仕様](https://w3c.github.io/webappsec-referrer-policy/)に記述された Referrer policy はよりグローバル。特に、**`Referrer-Policy` HTTP ヘッダでページ全体のデフォルトポリシーを設定でき、`<a rel="noreferrer">` でリンク単位に設定できる。**

#### 32.2 `mode`

**`mode` オプションは偶発的なクロスオリジンリクエストを防ぐ安全策:**

| 値 | 意味 |
|---|---|
| `"cors"` | デフォルト。クロスオリジンリクエストが許可される。 |
| `"same-origin"` | クロスオリジンリクエストが禁止される。 |
| `"no-cors"` | safe なクロスオリジンリクエストのみが許可される。 |

- **「このオプションは `fetch` の URL がサードパーティから来る場合に有用で、クロスオリジン機能を制限する『電源オフスイッチ』が欲しいときに使える。」**

#### 32.3 `credentials`

**`credentials` オプションは `fetch` がリクエストとともに Cookie と HTTP-Authorization ヘッダを送るべきかを指定する:**

| 値 | 意味 |
|---|---|
| `"same-origin"` | デフォルト。クロスオリジンリクエストには送らない。 |
| `"include"` | 常に送る。JavaScript がレスポンスにアクセスするにはクロスオリジンサーバからの `Access-Control-Allow-Credentials` が必要。 |
| `"omit"` | 決して送らない。同一オリジンリクエストでさえ。 |

#### 32.4 `cache`

| 値 | 意味 |
|---|---|
| `"default"` | `fetch` は標準の HTTP キャッシュ規則とヘッダを使う |
| `"no-store"` | HTTP キャッシュを完全に無視する。**`If-Modified-Since`, `If-None-Match`, `If-Unmodified-Since`, `If-Match`, `If-Range` のいずれかのヘッダを設定すると、このモードがデフォルトになる** |
| `"reload"` | HTTP キャッシュ（あれば）から結果を取らないが、レスポンスでキャッシュを埋める（レスポンスヘッダがこのアクションを許可する場合） |
| `"no-cache"` | キャッシュされたレスポンスがあれば条件付きリクエストを作り、なければ通常のリクエストを作る。HTTP キャッシュをレスポンスで埋める |
| `"force-cache"` | HTTP キャッシュからのレスポンスを使う。stale でも。HTTP キャッシュにレスポンスがなければ通常の HTTP リクエストを行い通常どおり振る舞う |
| `"only-if-cached"` | HTTP キャッシュからのレスポンスを使う。stale でも。HTTP キャッシュにレスポンスがなければエラー。**`mode` が `"same-origin"` のときのみ動作する** |

#### 32.5 `redirect`

| 値 | 意味 |
|---|---|
| `"follow"` | デフォルト。HTTP リダイレクトを追う |
| `"error"` | HTTP リダイレクトの場合エラー |
| `"manual"` | HTTP リダイレクトを手動で処理できる。**リダイレクトの場合、`response.type="opaqueredirect"` でステータスとその他ほとんどのプロパティがゼロ/空の特別な response オブジェクトを得る** |

#### 32.6 `integrity`（Subresource Integrity）

- **`integrity` オプションはレスポンスが既知のチェックサムに一致するかチェックできる。**
- [仕様](https://w3c.github.io/webappsec-subresource-integrity/) に記述されているとおり、**サポートされるハッシュ関数は SHA-256、SHA-384、SHA-512。ブラウザによっては他もあるかもしれない。**
- `fetch('http://site.com/file', { integrity: 'sha256-abcdef' });`
- `fetch` は自身で SHA-256 を計算し文字列と比較する。**不一致の場合エラーがトリガされる。**

#### 32.7 `keepalive`

- **`keepalive` オプションはリクエストが、それを開始したウェブページより「長生き」しうることを示す。**
- 通常、ドキュメントがアンロードされると関連するネットワークリクエストはすべて中断される。**`keepalive` オプションはブラウザに、ページを離れた後でもバックグラウンドでリクエストを実行するよう伝える。**
- 制限:
  - **メガバイト単位は送れない: `keepalive` リクエストの body 制限は 64KB。**
    - 大量の統計を集めるなら、定期的にパケットで送り出し、最後の `onunload` リクエストに大量が残らないようにすべき。
    - **この制限はすべての `keepalive` リクエストを合わせて適用される。** 言い換えると、複数の `keepalive` リクエストを並列に実行できるが、それらの body 長の合計は 64KB を超えてはならない。
  - **ドキュメントがアンロードされたらサーバレスポンスを処理できない。**
- 原文の使用例:
  ```js run
  window.onunload = function() {
    fetch('/analytics', {
      method: 'POST',
      body: "statistics",
      keepalive: true
    });
  };
  ```

---

### 33. URL オブジェクト（出典: https://javascript.info/url ）

- 構文: `new URL(url, [base])`。`url` は完全な URL またはパスのみ（base が設定されている場合）。`base` は任意のベース URL。
- **`URL` オブジェクトのコンポーネント（原文のチートシート）:**
  - `href` は完全な url。`url.toString()` と同じ
  - `protocol` はコロン文字 `:` で終わる
  - `search` — パラメータの文字列。疑問符 `?` で始まる
  - `hash` — ハッシュ文字 `#` で始まる
  - **HTTP 認証が存在する場合 `user` と `password` プロパティもありうる: `http://login:password@site.com`（図には描かれておらず、めったに使われない）**
  - 他に `host`、`pathname`
- **`URL` オブジェクトをネットワーク（および他のほとんどの）メソッドに文字列の代わりに渡せる。** `fetch` や `XMLHttpRequest` で、URL 文字列が期待されるほぼどこでも使える。一般に `URL` オブジェクトは任意のメソッドに文字列の代わりに渡せる（ほとんどのメソッドは文字列変換を行い、`URL` オブジェクトを完全 URL の文字列に変える）。

#### 33.1 `URLSearchParams` のメソッド一覧

| メソッド | 動作 |
|---|---|
| `append(name, value)` | `name` でパラメータを追加 |
| `delete(name)` | `name` でパラメータを削除 |
| `get(name)` | `name` でパラメータを取得 |
| `getAll(name)` | 同じ `name` の全パラメータを取得（`?user=John&user=Pete` のように可能） |
| `has(name)` | `name` でパラメータの存在をチェック |
| `set(name, value)` | パラメータを設定/置換 |
| `sort()` | 名前でパラメータをソート（めったに必要ない） |
| （反復） | `Map` と同様に iterable |

- パラメータは自動的にエンコードされる。例: `url.searchParams.set('q', 'test me!')` → `?q=test+me%21`、`url.searchParams.set('tbs', 'qdr:y')` → `&tbs=qdr%3Ay`

#### 33.2 エンコーディング — `encodeURI` vs `encodeURIComponent`

標準 [RFC3986](https://tools.ietf.org/html/rfc3986) が URL で許される文字を定義する。許されないものはエンコードされなければならない（非ラテン文字やスペースは UTF-8 コードに置換され `%` を前置。**スペースは歴史的理由から `+` でエンコードできるが、それは例外**）。

| 関数 | 動作 |
|---|---|
| `encodeURI` | URL 全体をエンコードする。**URL で完全に禁止された文字のみをエンコードする。** |
| `decodeURI` | それをデコードして戻す |
| `encodeURIComponent` | URL コンポーネント（検索パラメータ、hash、pathname など）をエンコードする。**同じ文字に加えて `#`, `$`, `&`, `+`, `,`, `/`, `:`, `;`, `=`, `?`, `@` をエンコードする。** |
| `decodeURIComponent` | それをデコードして戻す |

- URL では `:`, `?`, `=`, `&`, `#` が許される。しかし検索パラメータのような単一の URL コンポーネントを見れば、これらの文字はフォーマットを壊さないためエンコードされなければならない。
- **比較例（原文）**: `encodeURIComponent('Rock&Roll')` → `Rock%26Roll`。`encodeURI('Rock&Roll')` → `Rock&Roll`（`&` をエンコードしない。URL 全体としては正当な文字であるため）。
  - **「しかし検索パラメータの内部では `&` をエンコードすべきである。そうしないと `q=Rock&Roll` になり、これは実際には `q=Rock` に加えて何か曖昧なパラメータ `Roll` になる。意図したものではない。」**
  - **「だから URL 文字列に正しく挿入するには、各検索パラメータに `encodeURIComponent` のみを使うべきである。最も安全なのは、許可された文字のみを含むと絶対に確信できない限り、名前と値の両方をエンコードすること。」**
- **`URL` との差異**: クラス [URL](https://url.spec.whatwg.org/#url-class) と [URLSearchParams](https://url.spec.whatwg.org/#interface-urlsearchparams) は最新の URI 仕様 [RFC3986](https://tools.ietf.org/html/rfc3986) に基づくが、**`encode*` 関数は廃止された版 [RFC2396](https://www.ietf.org/rfc/rfc2396.txt) に基づく。**
  - 例: IPv6 アドレスのエンコードが異なる。
    ```js run
    // valid url with IPv6 address
    let url = 'http://[2607:f8b0:4005:802::1007]/';

    alert(encodeURI(url)); // http://%5B2607:f8b0:4005:802::1007%5D/
    alert(new URL(url)); // http://[2607:f8b0:4005:802::1007]/
    ```
  - **`encodeURI` が角括弧 `[...]` を置換してしまうのは正しくない。理由は IPv6 URL が RFC2396 の時点（1998年8月）には存在しなかったため。**

---

### 34. XMLHttpRequest（出典: https://javascript.info/xmlhttprequest ）

- 現代の web 開発で `XMLHttpRequest` が使われる3つの理由（原文の逐語訳）:
  1. 歴史的理由: `XMLHttpRequest` を使う既存スクリプトをサポートする必要がある。
  2. 古いブラウザをサポートする必要があり、polyfill を使いたくない（スクリプトを小さく保つため等）。
  3. **`fetch` がまだできないこと、例えばアップロード進捗の追跡が必要。**
- 3ステップ: `new XMLHttpRequest()` → `xhr.open(method, URL, [async, user, password])` → `xhr.send([body])`
  - `async` — 明示的に `false` に設定すると同期リクエストになる
  - `user`, `password` — Basic HTTP 認証のログインとパスワード（必要な場合）
  - **`open` 呼び出しは名前に反して接続を開かない。リクエストを設定するだけで、ネットワーク活動は `send` の呼び出しで始まる。**
- **イベント一覧（[modern specification](https://xhr.spec.whatwg.org/#events) のライフサイクル順、原文の逐語訳）:**

| イベント | 意味 |
|---|---|
| `loadstart` | リクエストが開始した |
| `progress` | レスポンスのデータパケットが到着した。現時点でのレスポンス body 全体が `response` にある |
| `abort` | `xhr.abort()` の呼び出しでリクエストがキャンセルされた |
| `error` | 接続エラーが発生した（例: 誤ったドメイン名）。**404 のような HTTP エラーでは起こらない** |
| `load` | リクエストが正常に完了した |
| `timeout` | タイムアウトでリクエストがキャンセルされた（設定されていた場合のみ発生） |
| `loadend` | `load`、`error`、`timeout`、`abort` の後にトリガされる |

- **`error`、`abort`、`timeout`、`load` イベントは互いに排他的。そのうち1つだけが起こりうる。**
- `readystatechange` は歴史的に仕様が固まる前からあるもの。今は使う必要がない。
- アップロードを追跡するなら `xhr.upload` オブジェクトで同じイベントを listen する。

#### 34.1 同期リクエスト

- `open` の第3引数 `async` を `false` にすると同期リクエストになる。**JavaScript の実行が `send()` で一時停止し、レスポンスを受け取ったとき再開する。`alert` や `prompt` コマンドと似ている。**
- 原文の警告（逐語訳）: 「良さそうに見えるが、同期呼び出しはめったに使われない。**ロードが完了するまでページ内 JavaScript をブロックするから。一部のブラウザではスクロールが不可能になる。** 同期呼び出しが時間をかけすぎると、ブラウザは「ハングした」ウェブページを閉じることを提案するかもしれない。
  **`XMLHttpRequest` の多くの高度な機能、例えば別ドメインへのリクエストやタイムアウトの指定は、同期リクエストでは利用できない。** また、見たとおり進捗表示もない。」

#### 34.2 クロスオリジンリクエスト

- `XMLHttpRequest` は [fetch](https://javascript.info/fetch-crossorigin) と同じ CORS ポリシーを使ってクロスオリジンリクエストを行える。
- **`fetch` と同様、デフォルトで別オリジンへ Cookie と HTTP 認証を送らない。有効にするには `xhr.withCredentials` を `true` に設定する:**

```js
let xhr = new XMLHttpRequest();
xhr.withCredentials = true;

xhr.open('POST', 'http://anywhere.com/request');
...
```

---

### 35. Cookie と `document.cookie`（出典: https://javascript.info/cookie ）

- Cookie はブラウザに直接保存される小さなデータ文字列。**HTTP プロトコルの一部で、[RFC 6265](https://tools.ietf.org/html/rfc6265) 仕様で定義される。**
- 通常はウェブサーバがレスポンスの **`Set-Cookie`** HTTP ヘッダで設定する。その後ブラウザが同じドメインへの（ほぼ）すべてのリクエストに **`Cookie`** HTTP ヘッダで自動的に追加する。
- 最も広く使われるユースケースは認証:
  1. サインイン時、サーバはレスポンスの `Set-Cookie` HTTP ヘッダを使い、一意な「セッション識別子」を持つ Cookie を設定する。
  2. 次に同じドメインへリクエストが送られるとき、ブラウザは `Cookie` HTTP ヘッダを使って Cookie をネット越しに送る。
  3. そうしてサーバは誰がリクエストしたかを知る。

#### 35.1 読み取り

- `document.cookie` の値は `; ` で区切られた `name=value` ペアで構成される。各1つが別個の Cookie。
- 特定の Cookie を見つけるには `document.cookie` を `; ` で split し、正しい名前を探す。

#### 35.2 書き込み

- **`document.cookie` はデータプロパティではなく [アクセサ (getter/setter)](https://javascript.info/property-accessors) である。それへの代入は特別に扱われる。**
- > **`document.cookie` への書き込み操作は、そこに記載された Cookie のみを更新し、他の Cookie には触れない。**
- 名前と値は任意の文字を持てる。有効なフォーマットを保つため、組み込み `encodeURIComponent` 関数でエスケープすべき。
  ```js run
  // special characters (spaces) need encoding
  let name = "my name";
  let value = "John Smith"

  // encodes the cookie as my%20name=John%20Smith
  document.cookie = encodeURIComponent(name) + '=' + encodeURIComponent(value);
  ```
- **制限（原文の枠囲み、逐語訳）**:
  - **`document.cookie` を使って一度に設定/更新できるのは単一の Cookie のみ。**
  - **`encodeURIComponent` 後の `name=value` ペアは 4KB を超えてはならない。** だから Cookie に巨大なものを保存できない。
  - **ドメインあたりの Cookie の総数は約 20+ に制限される。正確な制限はブラウザに依存する。**
- 属性は `key=value` の後に `;` 区切りで列挙する: `document.cookie = "user=John; path=/; expires=Tue, 19 Jan 2038 03:14:07 GMT"`

#### 35.3 Cookie 属性の完全表

| 属性 | 書式 | 意味（原文の逐語訳を要約） |
|---|---|---|
| `domain` | `domain=site.com` | **Cookie がアクセス可能な場所を定義する。任意のドメインを設定できるわけではない。** 「**別の2次レベルドメインから Cookie にアクセスさせる方法はない。だから `other.com` は `site.com` で設定された Cookie を決して受け取らない。**」これは機密データを1サイトのみで利用可能にするための安全制限。**デフォルトでは Cookie はそれを設定したドメインでのみアクセス可能。デフォルトでは `forum.site.com` のようなサブドメインとも共有されない。** サブドメインに共有させるには、`site.com` で設定するとき `domain` 属性をルートドメイン `domain=site.com` に明示設定する。そうすれば全サブドメインがその Cookie を見る。**レガシー構文: 歴史的に `domain=.site.com`（`site.com` の前にドット）が同じ動作をした。先頭のドットは現在は無視されるが、一部のブラウザはそのようなドットを含む Cookie の設定を拒否するかもしれない。** |
| `path` | `path=/mypath` | **URL パスプレフィックスは絶対でなければならない。** そのパス配下のページで Cookie がアクセス可能になる。デフォルトは現在のパス。**`path=/admin` で設定された Cookie は `/admin` と `/admin/something` で可視だが、`/home`、`/home/admin`、`/` では不可視。** 通常は `path=/` にしてサイト全ページからアクセス可能にすべき。設定されない場合のデフォルトは [この方法](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#path_default_value) で計算される。 |
| `expires` | `expires=Tue, 19 Jan 2038 03:14:07 GMT` | Cookie の有効期限。ブラウザが自動削除する時刻（ブラウザのタイムゾーンに従う）。**日付はこの形式で正確に、GMT タイムゾーンでなければならない。`date.toUTCString` で得られる。過去の日付を設定すると Cookie は削除される。** |
| `max-age` | `max-age=3600` | `expires` の代替で、現在時点からの秒数で有効期限を指定。**ゼロまたは負の値に設定すると Cookie は削除される。** |
| （両方なし） | — | **これらの属性のいずれも持たない Cookie は、ブラウザ/タブを閉じると消える。そのような Cookie を「セッション Cookie」と呼ぶ。** |
| （両方あり） | — | **`max-Age` が両方設定された場合に優先される。**（原文の表記は `max-Age`） |
| `secure` | `secure` | **Cookie は HTTPS 経由でのみ転送されるべき。** 「**デフォルトでは、`http://site.com` で Cookie を設定すると `https://site.com` にも現れ、逆も同様。** つまり Cookie はドメインベースであり、プロトコルを区別しない。」この属性を付ければ、`https://site.com` で設定された Cookie は同じサイトに HTTP（`http://site.com`）でアクセスしたときに現れない。 |
| `samesite` | `samesite=strict` / `samesite=lax`（値なしの `samesite` と同じ） | **XSRF（cross-site request forgery）攻撃から保護するために設計されたセキュリティ属性。** 下で詳述。 |
| `httpOnly` | （サーバの `Set-Cookie` のみ） | **この属性は JavaScript からの Cookie へのいかなるアクセスも禁じる。`document.cookie` でそのような Cookie を見たり操作したりできない。** 下で詳述。 |

#### 35.4 XSRF 攻撃の説明（原文の逐語訳）

> `bank.com` にログインしていると想像してほしい。つまりそのサイトからの認証 Cookie を持っている。ブラウザはそれを `bank.com` へのすべてのリクエストとともに送るので、サイトはあなたを認識しすべての機密な金融操作を実行する。
> さて、別のウィンドウでウェブを閲覧しているうちに、うっかり別のサイト `evil.com` に来てしまう。**そのサイトには、ハッカーの口座への送金を開始するフィールドを持つフォーム `<form action="https://bank.com/pay">` を `bank.com` に送信する JavaScript コードがある。**
> **ブラウザは `bank.com` を訪れるたびに Cookie を送る。フォームが `evil.com` から送信されたとしても。だから銀行はあなたを認識し、支払いを実行する。**
> これがいわゆる "Cross-Site Request Forgery"（略して XSRF）攻撃である。
> **もちろん実際の銀行はこれから保護されている。`bank.com` が生成するすべてのフォームは、いわゆる「XSRF 保護トークン」という特別なフィールドを持つ。邪悪なページはそれを生成できず、リモートページから抽出することもできない。フォームを送信できるが、データを取り戻すことはできない。** サイト `bank.com` は受け取るすべてのフォームでそのようなトークンをチェックする。
> ただしそのような保護は実装に時間がかかる。すべてのフォームが必要なトークンフィールドを持つことを保証し、すべてのリクエストをチェックしなければならない。

#### 35.5 `samesite` の2つの値

**`samesite=strict`**
- **ユーザがサイト外から来た場合、`samesite=strict` の Cookie は決して送られない。**
- 言い換えると、ユーザがメールからリンクを辿ろうと、`evil.com` からフォームを送信しようと、他ドメイン由来の操作を何かしようと、Cookie は送られない。
- **認証 Cookie が `samesite=strict` 属性を持てば、XSRF 攻撃が成功する見込みはない。`evil.com` からの送信は Cookie なしで来るため、`bank.com` はユーザを認識せず支払いに進まない。**
- 「保護はかなり信頼できる。`bank.com` から来る操作のみが `samesite=strict` Cookie を送る。例えば `bank.com` の別ページからのフォーム送信。」
- **小さな不便**: ユーザが（メモなどから）`bank.com` への正当なリンクを辿ったとき、`bank.com` が自分を認識しないことに驚く。
  - 回避策: 2つの Cookie を使う。1つは「一般的な認識」用（"Hello, John" と言うだけ）、もう1つはデータ変更操作用で `samesite=strict`。

**`samesite=lax`**（値なしの `samesite` と同じ）
- **より緩和されたアプローチで、XSRF からも保護しつつユーザ体験を壊さない。**
- `strict` と同様、サイト外から来た場合にブラウザが Cookie を送るのを禁じるが、例外を追加する。
- **`samesite=lax` Cookie は以下の両条件が真の場合に送られる:**
  1. **HTTP メソッドが「safe」である（例: GET。POST ではない）。** safe な HTTP メソッドの完全なリストは [RFC7231 仕様](https://tools.ietf.org/html/rfc7231#section-4.2.1) にある。これらはデータの読み取りに使われるべきで書き込みには使われないメソッド。データ変更操作を行ってはならない。リンクを辿るのは常に GET で safe なメソッド。
  2. **操作がトップレベルナビゲーションを行う（ブラウザのアドレスバーの URL を変える）。** これは通常真だが、**ナビゲーションが `<iframe>` 内で行われる場合はトップレベルでない。加えて、ネットワークリクエスト用の JavaScript メソッドはいかなるナビゲーションも行わない。**
- **「だから `samesite=lax` がするのは、最も一般的な『URL へ行く』操作に Cookie を持たせることである。…しかし別サイトからのネットワークリクエストやフォーム送信のような、より複雑なものは Cookie を失う。」**

**欠点**: **`samesite` は非常に古いブラウザ（2017年頃）では無視される（サポートされない）。だから `samesite` のみに保護を依存すると、古いブラウザは脆弱になる。** ただし xsrf トークンのような他の保護手段と組み合わせて防御層を追加でき、将来古いブラウザが死滅すればおそらく xsrf トークンを落とせる。

#### 35.6 `httpOnly`

> この属性は JavaScript とは何の関係もないが、完全性のために言及しなければならない。
> ウェブサーバは `Set-Cookie` ヘッダで Cookie を設定する。また `httpOnly` 属性を設定してもよい。
> **この属性は JavaScript からの Cookie へのいかなるアクセスも禁じる。`document.cookie` でそのような Cookie を見たり操作したりできない。**
> **これは予防措置として使われる。ハッカーが自分の JavaScript コードをページに注入し、ユーザがそのページを訪れるのを待つ、という特定の攻撃から保護するため。** そんなことはまったく可能であってはならず、ハッカーは我々のサイトにコードを注入できるべきではないが、それを許すバグがあるかもしれない。
> 通常、そのようなことが起こり、ユーザがハッカーの JavaScript コードのあるウェブページを訪れると、そのコードは実行され、認証情報を含むユーザ Cookie を持つ `document.cookie` へのアクセスを得る。それは悪い。
> **しかし Cookie が `httpOnly` なら、`document.cookie` はそれを見ないので保護される。**

#### 35.7 Cookie ユーティリティ関数（原文のまま逐語）

```js
// returns the cookie with the given name,
// or undefined if not found
function getCookie(name) {
  let matches = document.cookie.match(new RegExp(
    "(?:^|; )" + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, '\\$1') + "=([^;]*)"
  ));
  return matches ? decodeURIComponent(matches[1]) : undefined;
}
```

```js run
function setCookie(name, value, attributes = {}) {

  attributes = {
    path: '/',
    // add other defaults here if necessary
    ...attributes
  };

  if (attributes.expires instanceof Date) {
    attributes.expires = attributes.expires.toUTCString();
  }

  let updatedCookie = encodeURIComponent(name) + "=" + encodeURIComponent(value);

  for (let attributeKey in attributes) {
    updatedCookie += "; " + attributeKey;
    let attributeValue = attributes[attributeKey];
    if (attributeValue !== true) {
      updatedCookie += "=" + attributeValue;
    }
  }

  document.cookie = updatedCookie;
}

// Example of use:
setCookie('user', 'John', {secure: true, 'max-age': 3600});
```

```js
function deleteCookie(name) {
  setCookie(name, "", {
    'max-age': -1
  })
}
```

- **原文の警告（逐語訳）**: 「**更新または削除は同じ path と domain を使わなければならない。** Cookie を更新または削除するとき、設定したときとまったく同じ path と domain 属性を使うべきである。」

#### 35.8 サードパーティ Cookie

- **Cookie は、ユーザが訪れているページ以外のドメインによって配置された場合「サードパーティ」と呼ばれる。**
- 仕組み:
  1. `site.com` のページが別サイトからバナーをロードする: `<img src="https://ads.com/banner.png">`
  2. **バナーとともに、`ads.com` のリモートサーバが `id=1234` のような Cookie を持つ `Set-Cookie` ヘッダを設定するかもしれない。そのような Cookie は `ads.com` ドメイン由来で、`ads.com` でのみ可視になる。**
  3. 次に `ads.com` にアクセスされたとき、リモートサーバは `id` Cookie を取得してユーザを認識する。
  4. **さらに重要なのは、ユーザが `site.com` から別のサイト `other.com`（これもバナーを持つ）へ移動したとき、`ads.com` は Cookie を得る。それは `ads.com` に属するため。こうして訪問者を認識し、サイト間を移動する間追跡する。**
- **ブラウザの方針（原文の逐語訳）**:
  - **Safari はサードパーティ Cookie を一切許可しない。**
  - **Firefox はサードパーティ Cookie をブロックするサードパーティドメインの「ブラックリスト」とともに提供される。**
- **重要な区別（原文の枠囲み、逐語訳）**: 「サードパーティドメインからスクリプトをロードし（`<script src="https://google-analytics.com/analytics.js">` のように）、そのスクリプトが `document.cookie` を使って Cookie を設定する場合、**そのような Cookie はサードパーティではない。** スクリプトが Cookie を設定する場合、スクリプトがどこから来たかに関係なく、**その Cookie は現在のウェブページのドメインに属する。**」

#### 35.9 GDPR

- ヨーロッパの GDPR という法規制が、ユーザのプライバシーを尊重するための規則を課す。**その規則の1つが、追跡 Cookie についてユーザから明示的な許可を要求すること。**
- **これは追跡/識別/認可 Cookie についてのみである。** 情報を保存するだけでユーザを追跡も識別もしない Cookie なら自由に設定できる。
- 準拠の2パターン:
  1. 認証済みユーザにのみ追跡 Cookie を設定したい場合 — 登録フォームに「プライバシーポリシーに同意する」のチェックボックスを置き、ユーザがチェックしたら認証 Cookie を設定できる。
  2. 全員に追跡 Cookie を設定したい場合 — 新規訪問者にモーダルの「スプラッシュスクリーン」を表示し Cookie への同意を要求する。

---

### 36. LocalStorage / sessionStorage（出典: https://javascript.info/localstorage ）

- Cookie との違い（原文の逐語訳）:
  - **Cookie と違い、web storage オブジェクトはリクエストごとにサーバへ送られない。そのため、はるかに多く保存できる。ほとんどのモダンブラウザは少なくとも 5MB（またはそれ以上）を許可し、それを設定する設定を持つ。**
  - **Cookie と違い、サーバは HTTP ヘッダを介して storage オブジェクトを操作できない。すべて JavaScript で行われる。**
  - **ストレージは origin（ドメイン/プロトコル/ポートの三つ組）に束縛される。つまり、異なるプロトコルやサブドメインは異なる storage オブジェクトを意味し、互いのデータにアクセスできない。**

#### 36.1 API 一覧

| メソッド/プロパティ | 動作 |
|---|---|
| `setItem(key, value)` | キー/値ペアを保存 |
| `getItem(key)` | キーで値を取得 |
| `removeItem(key)` | キーとその値を削除 |
| `clear()` | すべて削除 |
| `key(index)` | 所与の位置のキーを取得 |
| `length` | 保存されたアイテム数 |

#### 36.2 `localStorage` vs `sessionStorage`（原文の表を完全再現）

| `localStorage` | `sessionStorage` |
|----------------|------------------|
| Shared between all tabs and windows with the same origin | Visible within a browser tab, including iframes from the same origin |
| Survives browser restart | Survives page refresh (but not tab close) |

- `sessionStorage` の詳細（原文の逐語訳）:
  - **`sessionStorage` は現在のブラウザタブ内にのみ存在する。**
    - 同じページの別タブは異なる storage を持つ。
    - **しかし同じタブ内の iframe 間では共有される（同一オリジンから来ていると仮定して）。**
  - データはページリフレッシュを生き延びるが、タブを閉じる/開くことは生き延びない。

#### 36.3 オブジェクト風アクセスの問題

- `localStorage.test = 2` のようなアクセスは歴史的理由で許され、ほぼ動作するが、一般に非推奨:
  1. **キーがユーザ生成の場合、`length` や `toString` など `localStorage` の別の組み込みメソッドのような任意のものになりうる。その場合 `getItem/setItem` は正しく動作するが、オブジェクト風アクセスは失敗する。**
     ```js run
     let key = 'length';
     localStorage[key] = 5; // Error, can't assign length
     ```
  2. **`storage` イベントはデータ変更時にトリガされるが、そのイベントはオブジェクト風アクセスでは起こらない。**

#### 36.4 キーのループ

- storage オブジェクトは iterable でない。
- `for(let i=0; i<localStorage.length; i++) { let key = localStorage.key(i); ... }`
- `for key in localStorage` はキーを反復するが、**不要な組み込みフィールド（`getItem`、`setItem` など）も出力する。** `hasOwnProperty` でフィルタするか、`Object.keys(localStorage)` で「own」キーのみ取得する（`Object.keys` はオブジェクトに属するキーのみ返し、プロトタイプを無視するため）。

#### 36.5 文字列のみ

- **キーも値も文字列でなければならない。** 他の型（数値、オブジェクト）なら自動的に文字列に変換される（`localStorage.user = {name: "John"}` → `[object Object]`）。
- オブジェクトの保存には `JSON.stringify` / `JSON.parse` を使う。
- デバッグ目的で storage オブジェクト全体を stringify することも可能: `alert( JSON.stringify(localStorage, null, 2) );`

#### 36.6 `storage` イベント — オリジン内ウィンドウ間通信

データが `localStorage` または `sessionStorage` で更新されると [storage](https://html.spec.whatwg.org/multipage/webstorage.html#the-storageevent-interface) イベントがトリガされる。プロパティ:

| プロパティ | 意味 |
|---|---|
| `key` | 変更されたキー（`.clear()` が呼ばれた場合は `null`） |
| `oldValue` | 古い値（キーが新規追加の場合は `null`） |
| `newValue` | 新しい値（キーが削除された場合は `null`） |
| `url` | 更新が起きたドキュメントの url |
| `storageArea` | 更新が起きた `localStorage` または `sessionStorage` オブジェクト |

- **重要な点: イベントは、その storage にアクセスできるすべての `window` オブジェクトでトリガされる。ただしそれを引き起こしたウィンドウを除く。**
- > **これにより、同一オリジンの異なるウィンドウがメッセージを交換できる。**
- トリガ条件: **`setItem`、`removeItem`、`clear` の呼び出し。**（オブジェクト風アクセスではトリガされない）
- モダンブラウザは [Broadcast channel API](mdn:/api/Broadcast_Channel_API)（同一オリジンのウィンドウ間通信専用 API）もサポートする。より機能豊富だがサポートは少ない。**`localStorage` に基づいてその API を polyfill するライブラリがあり、どこでも利用可能にする。**

---

### 37. モジュール（出典: https://javascript.info/modules-intro ）

#### 37.1 歴史的モジュールシステム

- [AMD](https://en.wikipedia.org/wiki/Asynchronous_module_definition) — 最も古いモジュールシステムの1つ。ライブラリ [require.js](https://requirejs.org/) が最初に実装。
- [CommonJS](https://wiki.commonjs.org/wiki/Modules/1.1) — Node.js サーバ用に作られたモジュールシステム。
- [UMD](https://github.com/umdjs/umd) — AMD と CommonJS と互換の汎用モジュールシステム。
- **言語レベルのモジュールシステムは2015年に標準に登場した。**

#### 37.2 コアのモジュール機能（セキュリティに直結）

1. **常に `"use strict"`** — モジュールは常に strict モードで動作する。未宣言変数への代入はエラーになる。
2. **モジュールレベルスコープ** — 各モジュールは独自のトップレベルスコープを持つ。**モジュールのトップレベル変数・関数は他のスクリプトから見えない。**
   - **ブラウザの HTML ページでは、各 `<script type="module">` に対して独立したトップレベルスコープが存在する。** 同じページの2つの `type="module"` スクリプトは互いのトップレベル変数を見ない。
   - **ブラウザでは `window.user = "John"` のように明示的に `window` プロパティに代入すればウィンドウレベルのグローバルにできる。そうすれば `type="module"` の有無に関係なく全スクリプトがそれを見る。**「そのようなグローバル変数を作るのは眉をひそめられる。避けるように。」
3. **モジュールコードは初めて import されたときに一度だけ評価される** — 同じモジュールが複数の他モジュールから import されても、コードは最初の import 時に一度だけ実行される。その後はエクスポートがすべての後続 importer に与えられる。
   - **オブジェクトをエクスポートする場合、すべての importer がまったく同じ唯一のオブジェクトを得る。1つのモジュールでの変更が他から見える。**（原文の例では `1.js` が `admin.name = "Pete"` にすると `2.js` で `Pete` になる）
   - **これはモジュールの「設定（configure）」を可能にする便利な挙動**（古典的パターン: モジュールが設定オブジェクトをエクスポートし、最初の import でそれを初期化する）。
4. **`import.meta`** — 現在のモジュールについての情報を含むオブジェクト。内容は環境に依存する。**ブラウザではスクリプトの URL、HTML 内のインラインスクリプトなら現在のウェブページ URL を含む。**
5. **モジュール内では `this` は `undefined`** — 非モジュールスクリプトでは `this` はグローバルオブジェクト（`window`）。

#### 37.3 ブラウザ固有の機能（セキュリティに直結）

- **モジュールスクリプトは常に deferred**（外部・インライン両方に対し `defer` 属性と同じ効果）:
  - 外部モジュールスクリプト `<script type="module" src="...">` のダウンロードは HTML 処理をブロックしない。他のリソースと並列にロードされる。
  - モジュールスクリプトは HTML ドキュメントが完全に準備できるまで待って実行される（たとえ小さく HTML より速くロードされても）。
  - スクリプトの相対順序は維持される。
  - **副作用として、モジュールスクリプトは常に完全にロードされた HTML ページを「見る」。それより下の HTML 要素も含む。**
- **`async` がインラインスクリプトでも動作する** — 非モジュールスクリプトでは `async` 属性は外部スクリプトにのみ効く。モジュールスクリプトではインラインスクリプトにも効く。「何にも依存しない機能、例えばカウンタ、広告、ドキュメントレベルのイベントリスナに適している。」
- **外部スクリプトの2つの差異**:
  1. **同じ `src` を持つ外部スクリプトは一度だけ実行される。**
  2. **別オリジン（別サイト等）から取得される外部スクリプトは [CORS](mdn:Web/HTTP/CORS) ヘッダを必要とする。** 言い換えると、モジュールスクリプトが別オリジンから取得される場合、**リモートサーバは fetch を許可する `Access-Control-Allow-Origin` ヘッダを供給しなければならない。**
     ```html
     <!-- another-site.com must supply Access-Control-Allow-Origin -->
     <!-- otherwise, the script won't execute -->
     <script type="module" src="http://another-site.com/their.js"></script>
     ```
     **「これはデフォルトでより良いセキュリティを保証する。」**
- **「bare」モジュールは許されない** — ブラウザでは `import` は相対または絶対 URL を取得しなければならない。パスのないモジュールを「bare」モジュールと呼び、`import` では許されない。Node.js やバンドルツールは独自のモジュール発見手段を持つため bare モジュールを許す。
- **互換性、`nomodule`** — 古いブラウザは `type="module"` を理解せず、未知の type のスクリプトは単に無視する。`nomodule` 属性でフォールバックを提供できる。
- **モジュールは HTTP(s) 経由でのみ動作し、ローカルでは動作しない。** `file://` プロトコルでページを開くと `import/export` ディレクティブは動作しない。

#### 37.4 ビルドツールの変換内容（原文の一覧）

1. HTML の `<script type="module">` に入れることを意図した「main」モジュールを取る。
2. その依存関係（import、そして import の import 等）を解析する。
3. すべてのモジュールを含む単一ファイル（または調整可能な複数ファイル）を構築し、ネイティブの `import` 呼び出しをバンドラ関数で置き換える。HTML/CSS モジュールのような「特別な」モジュール型もサポートされる。
4. その過程で他の変換と最適化が適用されうる:
   - 到達不能コードの除去
   - 未使用エクスポートの除去（"tree-shaking"）
   - **`console` や `debugger` のような開発専用ステートメントの除去**
   - モダンな最先端の JavaScript 構文を [Babel](https://babeljs.io/) で類似機能の古いものへ変換
   - 結果ファイルの minify（スペース除去、変数をより短い名前に置換など）

---

### 38. リソース読み込みの `onload` / `onerror` と crossorigin ポリシー（出典: https://javascript.info/onload-onerror ）

- `onload` — ロード成功。`onerror` — エラー発生。
- `script.onload` は**スクリプトがロードされ実行された後**にトリガされる。だから `onload` 内でスクリプトの変数を使い、関数を実行できる。
- **`script.onerror` では HTTP エラーの詳細を得られない。404 だったか 500 だったか他だったか分からない。ロードが失敗したということだけ。**
- **`onload`/`onerror` はロードそのものだけを追跡する。スクリプト処理・実行中に起こりうるエラーはこれらのイベントの範囲外。** つまり、スクリプトが正常にロードされたら、たとえプログラミングエラーがあっても `onload` がトリガされる。**スクリプトエラーを追跡するには `window.onerror` グローバルハンドラを使える。**
- 他のリソースについての注意:
  - **ほとんどのリソースはドキュメントに追加されたときロードを開始する。しかし `<img>` は例外で、`src` を得たときロードを開始する。**
  - **`<iframe>` では、`iframe.onload` イベントはロード完了時にトリガされる。成功したロードでもエラーの場合でも両方。**（歴史的理由）

#### 38.1 Crossorigin ポリシーとエラー情報の隠蔽

- 規則: **あるサイトのスクリプトは他のサイトのコンテンツにアクセスできない。** より正確には、あるオリジン（ドメイン/ポート/プロトコルの三つ組）は別のオリジンのコンテンツにアクセスできない。**サブドメインであっても、単に別ポートであっても、それらは互いにアクセスのない異なるオリジンである。**
- **別ドメインのスクリプトを使っていてそこでエラーが起きた場合、エラーの詳細を得られない。**
  - 同一サイトからロードした場合の `window.onerror` の報告:
    ```
    Uncaught ReferenceError: noSuchFunction is not defined
    https://javascript.info/article/onload-onerror/crossorigin/error.js, 1:1
    ```
  - 別ドメインからロードした場合:
    ```
    Script error.
    , 0:0
    ```
  - 「詳細はブラウザによって異なるかもしれないが、考え方は同じ: **スタックトレースを含むスクリプト内部についてのいかなる情報も隠される。まさに別ドメインから来ているため。**」
- エラー詳細が必要な理由: **`window.onerror` でグローバルエラーを listen し、エラーを保存して分析用インターフェースを提供するサービスが多数ある（自作も可）。ユーザによってトリガされた実際のエラーを見られるので素晴らしい。しかしスクリプトが別オリジンから来るとエラーについての情報はあまり得られない。**
- > **クロスオリジンアクセスを許可するには、`<script>` タグが `crossorigin` 属性を持つ必要があり、加えてリモートサーバが特別なヘッダを提供しなければならない。**

**クロスオリジンアクセスの3レベル（原文の逐語訳）:**

| レベル | 条件 |
|---|---|
| 1. **`crossorigin` 属性なし** | アクセス禁止。 |
| 2. **`crossorigin="anonymous"`** | サーバが `Access-Control-Allow-Origin` ヘッダを `*` または我々のオリジンで応答すればアクセス許可。**ブラウザは認証情報と Cookie をリモートサーバへ送らない。** |
| 3. **`crossorigin="use-credentials"`** | サーバが `Access-Control-Allow-Origin` を我々のオリジンで、かつ `Access-Control-Allow-Credentials: true` を返せばアクセス許可。**ブラウザは認証情報と Cookie をリモートサーバへ送る。** |

- **「Cookie を気にしないなら `"anonymous"` が行くべき道。」**
- `readystatechange` イベントもリソースで動作するが、`load/error` のほうが単純なためめったに使われない。

---

### 39. Catastrophic backtracking（ReDoS）（出典: https://javascript.info/regexp-catastrophic-backtracking ）

- 「一部の正規表現は単純に見えるが、非常に長時間実行され、JavaScript エンジンを「ハング」させることさえある。」
- **典型的症状: 正規表現が時々は正常に動くが、特定の文字列では「ハング」し CPU を 100% 消費する。**
- **そのような場合、ウェブブラウザはスクリプトを kill してページをリロードすることを提案する。サーバサイド JavaScript ではそのような regexp がサーバプロセスをハングさせうる。それはさらに悪い。**

#### 39.1 例

```js run
let regexp = /^(\w+\s?)*$/;

alert( regexp.test("A good string") ); // true
alert( regexp.test("Bad characters: $@#") ); // false
```

```js run
let regexp = /^(\w+\s?)*$/;
let str = "An input string that takes a long time or even makes this regexp hang!";

// will take a very long time
alert( regexp.test(str) );
```

- **エンジン差**: 「公平を期すため述べておくと、一部の正規表現エンジンはそのような検索を効率的に処理できる。例えば **V8 エンジンのバージョン 8.8 以降はそれができる（だから Google Chrome 88 はここでハングしない）。一方 Firefox ブラウザはハングする。**」

#### 39.2 簡略化した例と組み合わせ爆発

```js run
let regexp = /^(\d+)*$/;

let str = "012345678901234567890123456789z";

// will take a very long time (careful!)
alert( regexp.test(str) );
```

- バックトラッキングの仕組み（原文の段階説明）: 貪欲な `\d+` が全桁を消費 → `$` が `z` に合わず不一致 → 貪欲量指定子 `+` が繰り返し回数を減らし1文字戻る → `(\d+)*` がもう1回の `\d+` を与える → …と、すべての可能な組み合わせを試す。
- **「桁の並び `123456789` を数値に分割する方法は多数ある。正確には <code>2<sup>n</sup>-1</code> 通りで、`n` は並びの長さである。」**
  - `123456789` では `n=9` で **511 通り**。
  - より長い `n=20` では約 **100万通り（1048575）**。
  - `n=30` では **その1000倍（1073741823 通り）**。
- 単語の場合も同様: `(input)`, `(inpu)(t)`, `(inp)(u)(t)`, `(in)(p)(ut)`, … と分割の全組み合わせを試す。
- **lazy モードは助けにならない**: 「`\w+` を `\w+?` に置き換えても regexp はハングする。組み合わせの*順序*は変わるが、その総数は変わらない。」
- 「一部の正規表現エンジンは全組み合わせを通るのを避ける、あるいはずっと速くする巧妙なテストや有限オートマトンを持つが、ほとんどのエンジンは持たず、常に助けになるわけでもない。」

#### 39.3 修正方法（2つのアプローチ）

**アプローチ1: 可能な組み合わせの数を下げる**

```js run
let regexp = /^(\w+\s)*\w*$/;
let str = "An input string that takes a long time or even makes this regex hang!";

alert( regexp.test(str) ); // false
```

- 「スペースを必須にすることで問題が消える。以前の regexp はスペースを省略すると `(\w+)*` になり、単一の単語内で `\w+` の多数の組み合わせを生む。新しいパターン `(\w+\s)*` は『スペースが続く単語』の繰り返しを指定する。`input` という文字列は `\w+\s` の2回の繰り返しとしてマッチできない。スペースが必須だから。」

**アプローチ2: バックトラッキングを防ぐ**

- 「モダンな正規表現エンジンはそのために **possessive quantifier（所有量指定子）** をサポートする。通常の量指定子の後に `+` を付けると possessive になる。つまり `\d+` の代わりに `\d++` を使って `+` のバックトラッキングを止める。」
- 「**possessive quantifier は実際には『通常の』ものより単純である。バックトラッキングなしで可能な限り多くマッチするだけ。**」
- 「**atomic capturing group（原子的キャプチャグループ）** — 括弧内のバックトラッキングを無効にする方法 — もある。…**しかし残念なことに、JavaScript ではそれらはサポートされていない。**」
- **"lookahead transform" でエミュレートできる**: `(?=(\w+))\1`
  - lookahead `?=` が現在位置から始まる最長の単語 `\w+` を前方に探す。
  - `?=...` の括弧の中身はエンジンに記憶されないので、`\w+` を括弧で包む。そうすればエンジンがその中身を記憶し、パターン内で `\1` として参照できる。
  - 「lookahead が単語 `\w+` を全体として見つけ、それを `\1` でパターンに取り込む。だから本質的に possessive plus `+` 量指定子を実装したことになる。**単語 `\w+` の一部ではなく全体だけをキャプチャする。**」
  - 比較（原文のまま）:
    ```js run
    alert( "JavaScript".match(/\w+Script/)); // JavaScript
    alert( "JavaScript".match(/(?=(\w+))\1Script/)); // null
    ```
    1. 最初の変種では `\w+` がまず単語全体 `JavaScript` をキャプチャし、その後 `+` が1文字ずつバックトラックしてパターンの残りにマッチしようとし、最終的に成功する（`\w+` が `Java` にマッチしたとき）。
    2. 2番目の変種では `(?=(\w+))` が前方を見て単語 `JavaScript` を見つけ、それが `\1` によって全体としてパターンに含められるので、その後に `Script` を見つける方法は残らない。
  - 最初の例の書き換え:
    ```js run
    let regexp = /^((?=(\w+))\2\s?)*$/;

    alert( regexp.test("A good string") ); // true

    let str = "An input string that takes a long time or even makes this regex hang!";

    alert( regexp.test(str) ); // false, works and fast!
    ```
    ここでは外側の括弧が追加されているため `\1` ではなく `\2` を使う。番号の混乱を避けるには名前を付けられる:
    ```js run
    // parentheses are named ?<word>, referenced as \k<word>
    let regexp = /^((?=(?<word>\w+))\k<word>\s?)*$/;

    let str = "An input string that takes a long time or even makes this regex hang!";

    alert( regexp.test(str) ); // false

    alert( regexp.test("A correct string") ); // true
    ```
- 関連文献（原文が挙げるもの）: [Regex: Emulate Atomic Grouping (and Possessive Quantifiers) with LookAhead](https://instanceof.me/post/52245507631/regex-emulate-atomic-grouping-with-lookahead)、[Mimicking Atomic Groups](https://blog.stevenlevithan.com/archives/mimic-atomic-groups)

---

## 40. 本ノートから導かれる source / sink 早見表（原典の記述のみに基づく整理）

### 40.1 HTML として解釈される（危険な）書き込み先

| API | 原典の記述箇所 | 原典の補足 |
|---|---|---|
| `elem.innerHTML = ...` | /basic-dom-node-properties, /modifying-document | 要素ノードのみ。**挿入された `<script>` タグは HTML の一部になるが実行されない。** 不正な HTML はブラウザが修正する。 |
| `elem.outerHTML = ...` | /basic-dom-node-properties | **書き込みは要素自体を変更せず、DOM から除去して新 HTML をその位置に挿入する。書き込んだ変数は古い値を保持する。** |
| `elem.insertAdjacentHTML(where, html)` | /modifying-document | `where` は `"beforebegin"` / `"afterbegin"` / `"beforeend"` / `"afterend"`。「任意の HTML をページに追加できる方法」。 |
| `document.write(html)` | /modifying-document | **ページロード中のみ機能する。その後に呼ぶと既存のドキュメント内容が消去される。** DOM 変更を伴わずページテキストへ直接書き込むため非常に速い。 |
| `new Function(functionBody)` | /new-function | 文字列から関数を生成。`[[Environment]]` はグローバル環境を参照。 |
| `eval(code)` | /eval | **現在のレキシカル環境で実行され、外側変数を読み書きできる。** strict では eval 自身のレキシカル環境を持つ。 |
| `window.eval(code)` | /eval | グローバルスコープで実行される。 |

### 40.2 テキストとして扱われる（安全な）書き込み先

| API | 原典の記述 |
|---|---|
| `elem.textContent = ...` | 「テキストを『安全な方法』で書き込める」「ユーザからのテキストをテキストとして扱う」 |
| `node.append/prepend/before/after/replaceWith(...strings)` | 「テキストは『HTML として』ではなく『テキストとして』挿入され、`<`、`>` のような文字は適切にエスケープされる」「文字列は `elem.textContent` がそうするように安全な方法で挿入される」 |
| `elem.insertAdjacentText(where, text)` | 同じ構文だが `text` を「テキストとして」挿入 |
| `document.createTextNode(text)` | テキストノードを生成 |
| `node.nodeValue` / `node.data` | 非要素ノード（テキスト、コメント）の内容 |

### 40.3 オリジン境界を越えるデータの入口（source）

| API / プロパティ | 原典の記述 |
|---|---|
| `window.addEventListener("message", handler)` の `event.data` | /cross-window-communication。**`event.origin` で送信元オリジンを検証すべき。`window.onmessage` の短縮構文は動作しない。** |
| `location.href` など BOM の location | /browser-environment。別オリジンのウィンドウの `location` は**書き込みのみ可、読み取り不可**。 |
| `document.cookie` | /cookie。`httpOnly` の Cookie は見えない。 |
| `localStorage` / `sessionStorage` | /localstorage。**origin（ドメイン/プロトコル/ポート）に束縛。`storage` イベントは同一オリジンの他ウィンドウでトリガされる（発生元を除く）。** |
| `window.name` | /popup-windows。`window.open(url, name, params)` の `name`。 |
| `window.opener` | /popup-windows。**ポップアップ以外の全ウィンドウでは `null`。接続は双方向。** |
| `event.target.dataset.*` | /event-delegation。behavior パターンで `this[action]()` に流れる。 |
| `getAttribute(name)` / `elem.attributes` | /dom-attributes-and-properties。HTML に書かれたとおりの生の文字列。 |
| `response.text()` / `response.json()` | /fetch。 |
| `fetch` の `url` 引数 | /fetch-api。**サードパーティ由来の URL には `mode: "same-origin"` / `"no-cors"` が「電源オフスイッチ」として使える。** |

---

## 読者が自分で開くべき資料

### なぜ取得できなかったか

**https://javascript.info/（および同サイトの全記事 URL）は、本セッションの組織 egress ポリシーによって `javascript.info:443` へのプロキシ CONNECT が 403 で拒否された。** WebFetch は `EGRESS_BLOCKED`、curl は `CONNECT tunnel failed, response 403` を返した。プロキシ状態エンドポイントの `recentRelayFailures` に `connect_rejected`（"gateway answered 403 to CONNECT (policy denial or upstream failure)"）として記録されている。これは組織のポリシー拒否であり、README の指示どおり再試行も回避もしていない（TLS 検証の無効化、`HTTPS_PROXY` の解除は一切行っていない）。

**ただし本文は代替経路で完全に取得できている。** javascript.info の全記事は公式リポジトリ `javascript-tutorial/en.javascript.info` の Markdown として公開されており、サイトはそれをレンダリングしているだけである（README の "Structure" 節がこの対応を明記）。本ノートの詳細部分はすべてその Markdown の逐語読解に基づく。したがって「失われた情報」はレンダリング後の HTML 固有の要素（実行可能サンドボックス、図版 SVG/PNG、各記事末尾の演習課題とその解答ページ、"codetabs" で埋め込まれるライブデモ、コメント欄）に限られる。

### 読みどころ（読者が自分でアクセスしたとき何を読むべきか）

1. **`https://javascript.info/` のトップページ**: Part 1 / Part 2 / Part 3（追加記事）のパート分けラベルと、各章のカードに書かれた1行要約。本ノートでは「Part 3」の括りだけがサイト表示上のグルーピングとして未確認のままである（リポジトリ側に対応ファイルがない）。ここだけは実物で確認する価値がある。

2. **各記事末尾の「Tasks（課題）」と `solution.md`**: リポジトリには課題 (`task.md`) と解答 (`solution.md`) が合計 500 ファイル以上あり、本ノートでは分量の都合で本文（`article.md` / `index.md`）のみを対象にした。とくに `/closure`、`/prototype-inheritance`、`/bubbling-and-capturing`、`/event-delegation` の課題は、スコープ解決順序・プロトタイプ探索順序・イベント伝播順序を自力で追う訓練になる。サイト上では解答が折りたたみで提示され、実行可能。

3. **ライブで実行できるコード例（`run` / `autorun` マーカー付きのブロック）**: 本ノートに逐語収録したコードのうち、`js run` / `html run autorun` のマーカーが付いたものはサイト上でその場で実行できる。とくに (a) `/closure` の V8 デバッガ最適化の例（`debugger;` で止めて `alert(value)` を打つと変数が見えない、または同名の外側変数が見える）、(b) `/prototype-methods` の `prompt("What's the key?", "__proto__")` を使ったプロトタイプ汚染デモ、(c) `/event-loop` の `setTimeout` / `queueMicrotask` による進捗バーの描画タイミング差、(d) `/regexp-catastrophic-backtracking` のハングするパターン（ブラウザによって挙動が変わる。V8 8.8+ ではハングしない）は、実際に動かさないと体感できない。

4. **図版（SVG/PNG）**: レキシカル環境の遷移図（`lexical-environment-global.svg`、`closure-makecounter-environment.svg` ほか）、プロトタイプチェーン図（`proto-animal-rabbit-chain.svg`、`object-prototype-2.svg`、`object-prototype-null.svg`）、イベントフロー図（`eventflow.svg`、`event-order-bubbling.svg`）、イベントループ図（`eventLoop.svg`、`eventLoop-full.svg`）、CORS シーケンス図（`xhr-another-domain.svg`、`xhr-preflight.svg`）、XSRF/サードパーティ Cookie 図（`cookie-xsrf.svg`、`cookie-third-party.svg` 〜 `-3.svg`）、`insertAdjacentHTML` の挿入位置図（`insert-adjacent.svg`、`before-prepend-append-after.svg`）、URL コンポーネント図（`url-object.svg`）。本ノートは図の内容を文章で補っているが、プロトタイプ汚染の説明（`object-prototype-2.svg`: `__proto__` が `Object.prototype` 上のアクセサであることを示す図）と CORS の preflight シーケンス（`xhr-preflight.svg`）は図のほうが速い。

5. **`/clickjacking` と `/cross-window-communication` の `codetabs` 埋め込みデモ**: 半透明 iframe（`opacity: 0.5`）と完全透明（`opacity: 0`）のクリックジャッキング実演、`beforeunload` による framebusting 回避の実演、`protector` div による防御の実演、`sandbox` iframe で何が動かないかの実演、`postMessage` の往復デモ。いずれもリポジトリ側には demo 用 HTML が別ファイルで置かれており、サイト上でのみインタラクティブに動く。

6. **`/manuals-specifications`（Manuals and specifications）**: ECMA-262 仕様（現行・ドラフト）、MDN、compat テーブルの参照先が整理されている。本ノートでは個々の記事から拾った仕様 URL（https://tc39.es/ecma262/ 、https://dom.spec.whatwg.org 、https://html.spec.whatwg.org 、https://fetch.spec.whatwg.org 、https://url.spec.whatwg.org 、https://xhr.spec.whatwg.org 、https://w3c.github.io/webappsec-referrer-policy/ 、https://w3c.github.io/webappsec-subresource-integrity/ 、https://www.w3.org/TR/uievents 、https://tools.ietf.org/html/rfc6265 、https://tools.ietf.org/html/rfc3986 ）は収録済みだが、一次資料の引き方の指針そのものはこの記事にある。

### 一次ソースを自分で取得する方法（javascript.info がブロックされている環境向け）

```
git clone --depth 1 --filter=blob:none --sparse https://github.com/javascript-tutorial/en.javascript.info.git
cd en.javascript.info
git sparse-checkout set --no-cone '/*.md' '/**/*.md'
```

- 記事本体は `<part>/<chapter>/<article>/article.md`、章の扉は `<part>/<chapter>/index.md`。
- サイト URL への対応: フォルダ名から先頭の `NN-` を除いたものが slug（`1-js/06-advanced-functions/03-closure/article.md` → `https://javascript.info/closure`）。
- 本文中の `*!*` … `*/!*` はハイライト用マーカー、`<info:slug>` は内部リンク、`mdn:...` は MDN へのショートハンド、`[codetabs src="..."]` はライブデモ埋め込み、` ```smart `/` ```warn `/` ```compare ` は枠囲みブロックである（README および `AUTHORING.md` 参照）。
- ローカルでサイトとして表示するサーバは https://github.com/javascript-tutorial/server にある（README に記載）。
