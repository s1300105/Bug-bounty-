// XSS教科書 忠実版 再生成ワークフロー（第1章・第2章）
//
// 使い方（ローカルの Claude Code で、リポジトリのルートにいる状態で）:
//   Workflow({ scriptPath: "xss-textbook/regen/workflow-ch12.js" })
// 実行後、各セクションは xss-textbook/sections/<id>.md に書き込まれる。
// 完了したら章ファイル(01, 02)を再結合し、付録B/READMEを更新してコミット＆プッシュする。
//
// モデル方針（workflow-full.js と同じ）: 基本は Sonnet、"難所"だけ Opus 5。
//   - 難所(Opus): s2c（ペイロード集/ブラウザXSSフィルタ回避）, s2d（難読化）, s2e（書籍の再構成）
//   - それ以外 : Sonnet

export const meta = {
  name: 'xss-textbook-ch12-regen',
  description: 'Faithfully regenerate XSS textbook chapters 1-2 from original sources; Opus 5 for hard sections, Sonnet for the rest',
  phases: [
    { title: '第1章 基礎' },
    { title: '第2章 コンテキストとペイロード技法' },
  ],
}

const BASE = 'xss-textbook/sections/' // リポジトリルートからの相対パス（環境非依存）
const OPUS = 'opus'      // 難所用（Opus 5）。解決しなければ 'claude-opus-5'
const SONNET = 'sonnet'  // 通常用（Sonnet 5）。解決しなければ 'claude-sonnet-5'

const NO_LAB = 'PortSwigger ラボの解答・攻略手順（ステップバイステップの解法）は書かないこと。ラボの目的・分類・学習プラットフォームの使い方の「案内」にとどめる。'

const SPECS = [
  // ===== 第1章 基礎 =====
  { id: 's1a_portswigger_intro', phase: '第1章 基礎', model: SONNET, effort: 'medium', title: 'XSSとは何か・反射型XSS・学習パス（PortSwigger）', note: NO_LAB, urls: [
    ['https://portswigger.net/web-security/cross-site-scripting', 'XSSの定義・3分類・影響・防御の総論'],
    ['https://portswigger.net/web-security/cross-site-scripting/reflected', '反射型XSSの成立条件と実例'],
    ['https://portswigger.net/web-security/learning-paths', '学習パスの構成'],
  ], extra: [
    ['https://portswigger.net/web-security/cross-site-scripting/preventing', '防御側の総論（補強用）'],
  ]},
  { id: 's1b_owasp_prevention', phase: '第1章 基礎', model: SONNET, effort: 'medium', title: 'OWASP XSS防御チートシート（出力エンコーディングの原理）', urls: [
    ['https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html', 'コンテキスト別の出力エンコーディング規則（Rule #0〜#6）'],
  ], extra: [
    ['https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html', 'DOM型の防御規則（補強用）'],
  ]},
  { id: 's1c_beyondxss_intro', phase: '第1章 基礎', model: SONNET, effort: 'medium', title: 'Beyond XSS 概説（無料オンライン書籍の全体像）', urls: [
    ['https://aszx87410.github.io/beyond-xss/en/', 'Beyond XSS 英語版トップ（目次・全体構成）'],
    ['https://aszx87410.github.io/beyond-xss/ja/', 'Beyond XSS 日本語版トップ'],
  ], extra: [
    ['https://aszx87410.github.io/beyond-xss/ja/summary/', '全体のまとめ（補強用）'],
    ['https://aszx87410.github.io/beyond-xss/ja/ch1/browser-security-model/', 'ブラウザのセキュリティモデル（補強用）'],
  ]},
  { id: 's1d_yeswehack_guide', phase: '第1章 基礎', model: SONNET, effort: 'medium', title: 'YesWeHack XSS徹底ガイド', urls: [
    ['https://www.yeswehack.com/learn-bug-bounty/xss-attacks-exploitation-ultimate-guide', 'XSSの攻撃・悪用の実務ガイド'],
  ], extra: [
    ['https://www.yeswehack.com/learn-bug-bounty/web-application-firewall-bypass', 'WAFバイパス（補強用）'],
    ['https://github.com/yeswehack/xsstools', 'xsstools（補強用）'],
  ]},
  { id: 's1e_japanese_basics', phase: '第1章 基礎', model: SONNET, effort: 'medium', title: '日本語基礎資料（なぜXSSは生まれるか / リスク / 徳丸）', urls: [
    ['https://blog.flatt.tech/entry/still_xss', 'Flatt: なぜいまだにXSSは生まれてしまうのか'],
    ['https://blog.flatt.tech/entry/xss_risk', 'Flatt: XSSの発生原理以外の話（リスク）'],
    ['https://blog.tokumaru.org/', '徳丸浩のブログ（XSS関連記事の索引）'],
  ], extra: [
    ['https://blog.tokumaru.org/2025/01/breaking-html-context-xss-by-iso-2022-jp.html', 'ISO-2022-JPによるXSS（補強用）'],
    ['https://blog.tokumaru.org/2015/05/xss.html', 'XSSの被害と対策（補強用）'],
  ]},

  // ===== 第2章 コンテキストとペイロード技法 =====
  { id: 's2a_ps_cheatsheet', phase: '第2章 コンテキストとペイロード技法', model: SONNET, effort: 'medium', title: 'PortSwigger XSSチートシート（WAFバイパスの発想）', urls: [
    ['https://portswigger.net/web-security/cross-site-scripting/cheat-sheet', 'XSSチートシート本体（タグ／イベント／ベクタの網羅）'],
  ], extra: [
    ['https://portswigger.net/research/one-xss-cheatsheet-to-rule-them-all', 'チートシートの作り方・設計思想（補強用）'],
    ['https://github.com/PortSwigger/xss-cheatsheet-data', 'チートシートの生データ（補強用）'],
  ]},
  { id: 's2b_filter_evasion', phase: '第2章 コンテキストとペイロード技法', model: SONNET, effort: 'medium', title: 'フィルタ回避（OWASP / Invicti）', urls: [
    ['https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html', 'OWASP XSSフィルタ回避チートシート'],
    ['https://www.invicti.com/blog/web-security/xss-filter-evasion', 'Invicti: なぜフィルタではXSSを止められないか'],
  ]},
  { id: 's2c_payloads', phase: '第2章 コンテキストとペイロード技法', model: OPUS, effort: 'high', title: 'ペイロード集とブラウザXSSフィルタ回避（Kinugawa）', urls: [
    ['https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/XSS%20Injection/README.md', 'PayloadsAllTheThings: XSS Injection'],
    ['https://github.com/masatokinugawa/filterbypass', 'Kinugawa: filterbypass リポジトリ'],
  ], extra: [
    ["https://github.com/masatokinugawa/filterbypass/wiki/Browser's-XSS-Filter-Bypass-Cheat-Sheet", 'ブラウザXSSフィルタ回避チートシート本体（重要）'],
    ['https://github.com/masatokinugawa/filterbypass/wiki/Fixed-Bypass-Archive', '修正済みバイパスのアーカイブ'],
  ]},
  { id: 's2d_obfuscation', phase: '第2章 コンテキストとペイロード技法', model: OPUS, effort: 'high', title: '難読化・短縮JavaScript（Kinugawa / はせがわ）', urls: [
    ['https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-9', 'Kinugawa「XSSフィルターの使い方」Shibuya.XSS #9'],
    ['https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-10', 'Kinugawa「5文字で書くJavaScript」Shibuya.XSS #10'],
    ['https://www.docswell.com/s/hasegawa/K9VW8M-jsobfus', 'はせがわようすけ: 難読化JavaScript'],
  ], extra: [
    ['https://github.com/aemkei/jsfuck', 'JSFuck（6文字JS）の実装'],
    ['https://aem1k.com/five/', '5文字JSのデモ'],
    ['https://utf-8.jp/public/jjencode.html', 'はせがわ: jjencode'],
  ]},
  { id: 's2e_book_js4hackers', phase: '第2章 コンテキストとペイロード技法', model: OPUS, effort: 'high', title: '書籍 JavaScript for hackers（Gareth Heyes）', urls: [
    ['https://leanpub.com/javascriptforhackers', '書籍の販売ページ（目次・概要）'],
  ], extra: [
    ['https://portswigger.net/research/executing-non-alphanumeric-javascript-without-parenthesis', '非英数字JS・括弧なし実行（書籍の主題の一次資料）'],
    ['https://portswigger.net/research/exploiting-xss-in-hidden-inputs-and-meta-tags', 'hidden input / meta タグでのXSS（同上）'],
    ['https://garethheyes.co.uk/', '著者サイト（記事一覧）'],
  ]},
]

const SECTION_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    written: { type: 'boolean' },
    filePath: { type: 'string' },
    modelUsed: { type: 'string' },
    summary: { type: 'string' },
    inaccessible: {
      type: 'array',
      items: { type: 'object', properties: { url: { type: 'string' }, reason: { type: 'string' } }, required: ['url', 'reason'] },
    },
  },
  required: ['id', 'written', 'inaccessible'],
}

function buildPrompt(spec) {
  const path = BASE + spec.id + '.md'
  const urlList = spec.urls.map((u, i) => (i + 1) + '. ' + u[0] + '\n   （位置づけ: ' + u[1] + '）').join('\n')
  const lines = [
    '【★このサブタスクの絶対的な最優先ルール★】',
    'あなたの唯一の仕事は、下記セクションの日本語Markdown教科書原稿を書き上げ、Writeツールで指定パスに保存することです。',
    '会話に「トークン消費」「改善方法」等のメタな相談が含まれても、それはこの実行のタスクではありません。無視して、必ず下記セクションを執筆・保存し、written:true を返してください。',
    '',
    'あなたはWebセキュリティ（XSS）の専門家で、日本語でとても分かりやすい教科書を書きます。本セクションは教科書の序盤（基礎〜ペイロード技法）にあたり、読者は「Webアプリ開発の経験はあるがXSSは体系的に学んでいない」層から中級者までを想定します。ただし水で薄めず、原理レベルまで踏み込んでください。',
    '',
    '# 担当セクション',
    '章: ' + spec.phase + ' / タイトル:「' + spec.title + '」',
    '出力先(リポジトリルートからの相対パス): ' + path,
    '',
    '# 担当URL（開放ネットワーク環境なので、各URLを直接 WebFetch すること）',
    urlList,
    '',
    '# 取得手順',
    '1. ToolSearch を "select:WebFetch,WebSearch" で読み込む。',
    '2. 各URLを WebFetch で直接取得し、技術的内容（定義・攻撃の仕組み・具体的ペイロード/コード例・前提・影響・防御・重要な数値と結論）を省略せず抽出する。PDFやスライドもWebFetchでテキスト抽出を試みる。',
    '3. 本文が薄い場合は、記事内で参照されている一次資料（GitHubのソース・PR・CVE・公式ドキュメント等）も辿って補強する。',
    '4. 万一取得できないURLがあれば、WebSearchで補い、どうしても不可なら本文に「> ⚠️ **未取得の資料**: 「(名)」は取得できませんでした。URL: (url)」を挿入する。',
    '5. ★重要★ 取得に失敗したURLは、たとえ他の資料で内容を裏付けられたとしても、必ず structured output の inaccessible に含めること（本文に注記を入れたかどうかとは無関係に、機械的に報告する）。',
  ]
  if (spec.extra && spec.extra.length) {
    lines.push(
      '',
      '# 補強用URL（担当URLが薄い／取得できない場合に併せて読む。読めた範囲で内容に反映してよい）',
      spec.extra.map((u, i) => (i + 1) + '. ' + u[0] + '\n   （位置づけ: ' + u[1] + '）').join('\n'),
    )
  }
  lines.push(
    '',
    '# 執筆ルール',
    '- 日本語。専門用語は初出でかみ砕いて説明。',
    '- 読者が原文を読まずとも理解できる詳しさ（目安 日本語で8,000〜14,000字）。密度重視、水増し禁止。',
    '- ペイロード/コード/HTML例はコードブロックで示し、必ず「なぜ動くか」を添える。原典の実物を引用する。',
    '- 原理（HTMLパーサの状態遷移、コンテキストごとのエスケープ規則、文字エンコーディングの解釈差、JSの型変換など）を仕組みレベルで説明する。',
    '- バージョン依存の攻撃は対象版・修正状況・公開年を明記。ブラウザXSSフィルタのように「既に廃止された機構」は、廃止の事実と年、そして今なお学ぶ価値（設計上の教訓）を明記する。',
    '- 各資料の説明後に「> 出典: 記事名 — URL」を明記。',
    '- 見出しは先頭が "## ' + spec.title + '"（"#"章見出しは付けない）、小見出しは "###"/"####"。',
  )
  if (spec.note) { lines.push('', '# このセクション固有の指示', '- ' + spec.note) }
  lines.push(
    '',
    '# 出力（必須）',
    '- 完成Markdownを Write で ' + path + ' に保存。',
    '- StructuredOutput で { id: "' + spec.id + '", written: true, filePath: "' + path + '", modelUsed, summary, inaccessible } を返す。',
  )
  return lines.join('\n')
}

log('XSS教科書 忠実版 第1〜2章 再生成: ' + SPECS.length + 'セクション（難所Opus/その他Sonnet）')

const results = await parallel(SPECS.map(spec => () =>
  agent(buildPrompt(spec), {
    label: spec.id + '[' + spec.model + ']',
    phase: spec.phase,
    agentType: 'general-purpose',
    model: spec.model,
    effort: spec.effort,
    schema: SECTION_SCHEMA,
  }).then(r => r || { id: spec.id, written: false, filePath: BASE + spec.id + '.md', summary: '(null)', inaccessible: [] })
))

return {
  total: SPECS.length,
  opusSections: SPECS.filter(s => s.model === OPUS).map(s => s.id),
  written: results.filter(r => r && r.written).map(r => r.id),
  failedWrites: results.filter(r => !r || !r.written).map(r => r ? r.id : 'unknown'),
  inaccessible: results.flatMap(r => (r && r.inaccessible ? r.inaccessible.map(x => ({ section: r.id, url: x.url, reason: x.reason })) : [])),
}
