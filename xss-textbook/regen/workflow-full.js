// XSS教科書 忠実版 一括再生成ワークフロー（開放ネットワーク環境＝ローカルで実行する用）
//
// 使い方（ローカルの Claude Code で、リポジトリのルートにいる状態で）:
//   Workflow({ scriptPath: "xss-textbook/regen/workflow-full.js" })
// 実行後、各セクションは xss-textbook/sections/<id>.md に書き込まれる。
// 完了したら章ファイル(03〜08)を再結合し、付録B/READMEを更新してコミット＆プッシュする。
//
// モデル方針: 基本は Sonnet、"難所"だけ Opus 5。
//   - 難所(Opus): s4g, s4h, s4i, s4j, s4k, s4m, s5a
//   - それ以外 : Sonnet
// ※ model のエイリアス 'opus' / 'sonnet' が解決されない環境では、
//   'claude-opus-5' / 'claude-sonnet-5' に置き換える。
// ※ s4a〜s4e は既に忠実版に再生成済みのため対象外。

export const meta = {
  name: 'xss-textbook-full-regen',
  description: 'Faithfully regenerate remaining XSS textbook sections from originals; Opus 5 for hard sections, Sonnet for the rest',
  phases: [
    { title: '第3章 DOMベースXSS' },
    { title: '第4章 高度なXSS' },
    { title: '第5章 フレームワーク' },
    { title: '第6章 実例ライトアップ' },
    { title: '第7章 ハンズオン' },
    { title: '第8章 発展と防御' },
  ],
}

const BASE = 'xss-textbook/sections/' // リポジトリルートからの相対パス（環境非依存）
const OPUS = 'opus'      // 難所用（Opus 5）。解決しなければ 'claude-opus-5'
const SONNET = 'sonnet'  // 通常用（Sonnet 5）。解決しなければ 'claude-sonnet-5'

const NO_LAB = 'このセクションでは PortSwigger ラボの解答・攻略手順（ステップバイステップの解法）は書かないこと。ラボの目的・分類・学習プラットフォームの使い方・チェックリストの「案内」にとどめる。'
const BURP_DOC = 'DOM Invader / Burp の説明は、PortSwigger 公式ドキュメントを直接 WebFetch して読み、機能・設定・操作を正確に記述すること（ただしラボ攻略は書かない）。'

const SPECS = [
  // ===== 第3章（Burp/DOM Invader の説明を公式ドキュメントで正確化）=====
  { id: 's3a_dom_basic', phase: '第3章 DOMベースXSS', model: SONNET, effort: 'medium', title: 'DOMベースXSSの基礎とDOM Invader導入', note: BURP_DOC, urls: [
    ['https://portswigger.net/web-security/cross-site-scripting/dom-based', 'DOM XSFのsource/sink体系'],
    ['https://portswigger.net/blog/introducing-dom-invader', 'DOM Invaderの背景'],
  ]},
  { id: 's3b_dominvader_docs', phase: '第3章 DOMベースXSS', model: SONNET, effort: 'medium', title: 'DOM Invader実践（Burp公式ドキュメント）', note: BURP_DOC, urls: [
    ['https://portswigger.net/burp/documentation/desktop/tools/dom-invader', 'DOM Invaderの機能一覧'],
    ['https://portswigger.net/burp/documentation/desktop/tools/dom-invader/dom-xss', 'DOM XSS検出手順'],
    ['https://portswigger.net/burp/documentation/desktop/testing-workflow/input-validation/xss/web-message-dom-xss', 'web message経由のDOM XSS'],
  ]},
  { id: 's3c_dominvader_more', phase: '第3章 DOMベースXSS', model: SONNET, effort: 'medium', title: 'DOM Invader補足（HackTricks / Medium）', note: BURP_DOC, urls: [
    ['https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/dom-invader.html', 'HackTricksのDOM Invader解説'],
    ['https://hacksheets.medium.com/dom-invader-burp-suite-tool-to-find-dom-based-xss-easily-3cb09adf4d44', 'DOM Invader実践記事'],
  ]},
  { id: 's3d_ja_domxss', phase: '第3章 DOMベースXSS', model: SONNET, effort: 'medium', title: '日本語DOM XSS資料（はせがわ / Flatt SPA）', urls: [
    ['https://www.docswell.com/s/hasegawa/ZDWWWK-2022-03-14-212823', 'はせがわ JavaScript Security beyond HTML5'],
    ['https://blog.flatt.tech/entry/spa_injection', 'Flatt: SPAにおけるインジェクション'],
  ]},
  { id: 's3e_postmessage', phase: '第3章 DOMベースXSS', model: SONNET, effort: 'medium', title: 'postMessage経由のDOM XSS', urls: [
    ['https://www.yeswehack.com/learn-bug-bounty/introduction-postmessage-vulnerabilities', 'postMessage脆弱性入門'],
    ['https://labs.detectify.com/writeups/postmessage-xss-on-a-million-sites/', 'AddThis実例'],
    ['https://www.intigriti.com/researchers/blog/hacking-tools/exploiting-postmessage-vulnerabilities', '高度な連鎖'],
  ]},

  // ===== 第4章の残り =====
  { id: 's4f_pp_intro', phase: '第4章 高度なXSS', model: SONNET, effort: 'medium', title: 'プロトタイプ汚染 概説とガジェット集', urls: [
    ['https://blog.s1r1us.ninja/research/PP', 's1r1us: Prototype Pollution'],
    ['https://github.com/BlackFan/client-side-prototype-pollution', 'BlackFan: PPガジェット集'],
  ]},
  { id: 's4g_pp_exploit', phase: '第4章 高度なXSS', model: OPUS, effort: 'high', title: 'プロトタイプ汚染 実践とRCE事例', urls: [
    ['https://hacktricks.wiki/en/pentesting-web/deserialization/nodejs-proto-prototype-pollution/client-side-prototype-pollution.html', 'HackTricks: クライアントサイドPP'],
    ['https://aszx87410.github.io/beyond-xss/en/ch3/prototype-pollution/', 'Beyond XSS: PP'],
    ['https://www.sonarsource.com/blog/blitzjs-prototype-pollution/', 'Sonar: Blitz.js PP→RCE'],
  ]},
  { id: 's4h_dom_clobbering', phase: '第4章 高度なXSS', model: OPUS, effort: 'high', title: 'DOM Clobbering', urls: [
    ['https://research.securitum.com/xss-in-amp4email-dom-clobbering/', 'Bentkowski: AMP4Email DOM Clobbering'],
    ['https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html', 'OWASP: DOM Clobbering防御'],
    ['https://github.com/jackfromeast/dom-clobbering-collection', 'ガジェット集'],
  ]},
  { id: 's4i_csp_dead', phase: '第4章 高度なXSS', model: OPUS, effort: 'high', title: 'CSPの限界（CSP Is Dead 論文）', urls: [
    ['https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/', 'CSP Is Dead 論文'],
    ['https://deepsec.net/docs/Slides/2016/CSP_Is_Dead,_Long_Live_Strict_CSP!_Lukas_Weichselbaum.pdf', 'DeepSecスライド'],
  ]},
  { id: 's4j_gadgets_intro', phase: '第4章 高度なXSS', model: OPUS, effort: 'high', title: 'Script Gadgets（CSP Evaluator / Black Hat論文）', urls: [
    ['https://csp-evaluator.withgoogle.com/', 'CSP Evaluator'],
    ['https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf', 'Black Hat: Script Gadgets'],
  ]},
  { id: 's4k_code_reuse', phase: '第4章 高度なXSS', model: OPUS, effort: 'high', title: 'コード再利用攻撃（CCS17論文 / Google PoC）', urls: [
    ['https://acmccs.github.io/papers/p1709-lekiesA.pdf', 'Code-Reuse Attacks for the Web（論文PDF）'],
    ['https://github.com/google/security-research-pocs/tree/master/script-gadgets', 'Google script-gadgets PoC'],
  ]},
  { id: 's4l_csp_bypass_cases', phase: '第4章 高度なXSS', model: SONNET, effort: 'medium', title: 'CSPバイパス実例（Truesec / PortSwigger nonce）', urls: [
    ['https://www.truesec.com/hub/blog/bypassing-modern-xss-mitigations-with-code-reuse-attacks', 'jQuery Mobileガジェット実例'],
    ['https://portswigger.net/research/hunting-nonce-based-csp-bypasses-with-dynamic-analysis', 'nonceベースCSPバイパス'],
  ]},
  { id: 's4m_csp_bypass_summary', phase: '第4章 高度なXSS', model: OPUS, effort: 'high', title: 'CSPバイパス総まとめ（joaxcar / Beyond XSS / HackTricks）', urls: [
    ['https://joaxcar.com/blog/2024/02/19/csp-bypass-on-portswigger-net-using-google-script-resources/', 'Googleスクリプトリソースでのバイパス'],
    ['https://aszx87410.github.io/beyond-xss/en/ch2/csp-bypass/', 'Beyond XSS: CSPバイパス'],
    ['https://book.hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html', 'HackTricks: CSPバイパス総覧'],
  ]},

  // ===== 第5章 =====
  { id: 's5a_csti', phase: '第5章 フレームワーク', model: OPUS, effort: 'high', title: 'クライアントサイドテンプレートインジェクション（CSTI / AngularJS）', urls: [
    ['https://portswigger.net/web-security/cross-site-scripting/contexts/client-side-template-injection', 'CSTIの基礎'],
    ['https://portswigger.net/research/xss-without-html-client-side-template-injection-with-angularjs', 'AngularJSでのCSTI/sandbox escape'],
  ]},
  { id: 's5b_csti_more', phase: '第5章 フレームワーク', model: SONNET, effort: 'medium', title: 'CSTI補足（HackTricks / Beyond XSS）', urls: [
    ['https://hacktricks.wiki/en/pentesting-web/client-side-template-injection-csti.html', 'HackTricks: CSTI'],
    ['https://aszx87410.github.io/beyond-xss/en/ch3/csti/', 'Beyond XSS: CSTI'],
  ]},
  { id: 's5c_react_angular', phase: '第5章 フレームワーク', model: SONNET, effort: 'medium', title: 'React/AngularのXSS（dangerouslySetInnerHTML等）', urls: [
    ['https://pragmaticwebsecurity.com/articles/spasecurity/react-xss-part2.html', 'React XSS Part2'],
    ['https://web-security-react.readthedocs.io/en/latest/pages/xss_in_react.html', 'React内XSS sink整理'],
    ['https://github.com/MrT3acher/angularjs-client-side-template-injection-lab', 'AngularJS CSTIラボ'],
  ]},

  // ===== 第6章 =====
  { id: 's6a_researcher_index', phase: '第6章 実例ライトアップ', model: SONNET, effort: 'low', title: 'リサーチャー索引（Gareth Heyes / Kinugawa）', urls: [
    ['https://garethheyes.co.uk/', 'Gareth Heyes個人サイト'],
    ['https://speakerdeck.com/masatokinugawa', 'Kinugawa Speaker Deck'],
  ]},
  { id: 's6b_kinugawa_cases', phase: '第6章 実例ライトアップ', model: SONNET, effort: 'medium', title: 'Kinugawaの実例（Teams Pwn2Own / Shadow DOM）', urls: [
    ['https://speakerdeck.com/masatokinugawa/how-i-hacked-microsoft-teams-and-got-150000-dollars-in-pwn2own', 'Teams $150,000'],
    ['https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-12', 'Teams 2000万円'],
    ['https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-13', 'Shadow DOMとセキュリティ'],
  ]},
  { id: 's6c_sonar_h1_cases', phase: '第6章 実例ライトアップ', model: SONNET, effort: 'medium', title: '実例（Sonar Mailspring / Simplenote Stored XSS）', urls: [
    ['https://www.sonarsource.com/blog/reply-to-calc-the-attack-chain-to-compromise-mailspring/', 'Mailspring mXSS→RCE'],
    ['https://hackerone.com/reports/271007', 'Simplenote Stored XSS'],
  ]},
  { id: 's6d_chains', phase: '第6章 実例ライトアップ', model: SONNET, effort: 'medium', title: '複合連鎖と実務的な発見手法', urls: [
    ['https://infosecwriteups.com/postmessage-misconfiguration-ai-prompt-injection-sandbox-escape-xss-data-exfiltration-d1d29821a2de', 'postMessage+AI+sandbox escape連鎖'],
    ['https://www.hackerone.com/blog/how-find-xss-techniques-security-researchers-use-real-environments', 'XSSの実務的な見つけ方'],
  ]},

  // ===== 第7章（ラボ攻略は書かない）=====
  { id: 's7a_labs', phase: '第7章 ハンズオン', model: SONNET, effort: 'low', title: 'Web Security Academyとラボ環境', note: NO_LAB, urls: [
    ['https://portswigger.net/web-security', 'Web Security Academy'],
    ['https://portswigger.net/web-security/all-labs', '全ラボ一覧'],
    ['https://portswigger.net/web-security/cross-site-scripting/contexts/lab-some-svg-markup-allowed', 'SVGラボ'],
  ]},
  { id: 's7b_writeups', phase: '第7章 ハンズオン', model: SONNET, effort: 'low', title: 'ラボ攻略ライトアップとチェックリスト', note: NO_LAB, urls: [
    ['https://medium.com/@thanujthilakarathne/portswigger-xss-labs-a-complete-guide-to-all-9-apprentice-level-challenges-6fba56da8635', 'Apprentice級XSSラボ解説'],
    ['https://medium.com/@awes0me.writes/portswigger-labs-prototype-pollution-writeup-all-labs-9a2534bc8e07', 'PP全ラボ'],
    ['https://github.com/ashardian/Portswigger_checklist', 'チェックリスト'],
  ]},

  // ===== 第8章 =====
  { id: 's8a_trusted_types', phase: '第8章 発展と防御', model: SONNET, effort: 'medium', title: 'Trusted Types / strict CSP', urls: [
    ['https://web.dev/articles/trusted-types', 'web.dev: Trusted Types'],
    ['https://developer.chrome.com/docs/lighthouse/best-practices/trusted-types-xss', 'Chrome: Trusted Types'],
  ]},
  { id: 's8b_markdown', phase: '第8章 発展と防御', model: SONNET, effort: 'low', title: 'Markdown経由のXSS', urls: [
    ['https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/xss-in-markdown.html', 'HackTricks: Markdown XSS'],
    ['https://medium.com/taptuit/exploiting-xss-via-markdown-72a61e774bf8', 'Markdown XSS悪用'],
  ]},
  { id: 's8c_blind_image', phase: '第8章 発展と防御', model: SONNET, effort: 'low', title: 'Blind XSSと画像ファイルによるXSS', urls: [
    ['https://www.bugcrowd.com/blog/the-guide-to-blind-xss-advanced-techniques-for-bug-bounty-hunters-worth-250000/', 'Blind XSSの手引き'],
    ['https://blog.tokumaru.org/2007/12/image-xss-summary.html', '徳丸: 画像XSS'],
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
    'あなたはWebセキュリティ（XSS）の専門家で、日本語でとても分かりやすい教科書を書きます。読者は反射型の素朴なXSSは既知の中〜上級者です。',
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
    '',
    '# 執筆ルール',
    '- 日本語。専門用語は初出でかみ砕いて説明。',
    '- 読者が原文を読まずとも理解できる詳しさ（目安 日本語で6,000〜12,000字）。密度重視、水増し禁止。',
    '- ペイロード/コード/HTML例はコードブロックで示し、必ず「なぜ動くか」を添える。原典の実物を引用する。',
    '- 原理（パーサ再解釈、プロトタイプチェーン、CSPのソース許可評価など）を仕組みレベルで説明する。',
    '- バージョン依存の攻撃は対象版・修正状況・公開年を明記。',
    '- 各資料の説明後に「> 出典: 記事名 — URL」を明記。',
    '- 見出しは先頭が "## ' + spec.title + '"（"#"章見出しは付けない）、小見出しは "###"/"####"。',
  ]
  if (spec.note) { lines.push('', '# このセクション固有の指示', '- ' + spec.note) }
  lines.push(
    '',
    '# 出力（必須）',
    '- 完成Markdownを Write で ' + path + ' に保存。',
    '- StructuredOutput で { id: "' + spec.id + '", written: true, filePath: "' + path + '", modelUsed, summary, inaccessible } を返す。',
  )
  return lines.join('\n')
}

log('XSS教科書 忠実版 一括再生成: ' + SPECS.length + 'セクション（難所Opus/その他Sonnet）')

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
