export const meta = {
  name: 'xss-textbook-resume2',
  description: 'Re-run the 19 sections that bailed to the meta-question; force them to write the section (Sonnet)',
  phases: [
    { title: '第4章 高度なXSS', detail: 'PP・DOM clobbering・CSP/gadgets' },
    { title: '第5章 フレームワーク', detail: 'CSTI補足・React/Angular' },
    { title: '第6章 実例ライトアップ', detail: '攻撃連鎖' },
    { title: '第7章 ハンズオン', detail: 'ラボ' },
    { title: '第8章 発展と防御', detail: 'Trusted Types・Markdown・blind XSS' },
  ],
}

const BASE = '/home/user/Bug-bounty-/xss-textbook/sections/'

const SPECS = [
  { id: 's4f_pp_intro', phase: '第4章 高度なXSS', title: 'プロトタイプ汚染 概説とガジェット集', urls: [
    ['https://blog.s1r1us.ninja/research/PP', 's1r1us: Prototype Pollution 大規模ハント研究'],
    ['https://github.com/BlackFan/client-side-prototype-pollution', 'BlackFan: クライアントサイドPPガジェット集'],
  ]},
  { id: 's4g_pp_exploit', phase: '第4章 高度なXSS', title: 'プロトタイプ汚染 実践とRCE事例', urls: [
    ['https://hacktricks.wiki/en/pentesting-web/deserialization/nodejs-proto-prototype-pollution/client-side-prototype-pollution.html', 'HackTricks: クライアントサイドPP'],
    ['https://aszx87410.github.io/beyond-xss/en/ch3/prototype-pollution/', 'Beyond XSS: Prototype Pollution章'],
    ['https://www.sonarsource.com/blog/blitzjs-prototype-pollution/', 'Sonar: Blitz.jsでのPPによるRCE'],
  ]},
  { id: 's4h_dom_clobbering', phase: '第4章 高度なXSS', title: 'DOM Clobbering', urls: [
    ['https://research.securitum.com/xss-in-amp4email-dom-clobbering/', 'Bentkowski: GMail AMP4EmailでのDOM Clobbering'],
    ['https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html', 'OWASP: DOM Clobbering防御チートシート'],
    ['https://github.com/jackfromeast/dom-clobbering-collection', 'DOM Clobbering研究/ガジェット集'],
  ]},
  { id: 's4i_csp_dead', phase: '第4章 高度なXSS', title: 'CSPの限界（CSP Is Dead 論文）', urls: [
    ['https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/', 'Weichselbaum & Spagnuolo: CSP Is Dead。94.72%がバイパス可能'],
    ['https://deepsec.net/docs/Slides/2016/CSP_Is_Dead,_Long_Live_Strict_CSP!_Lukas_Weichselbaum.pdf', 'DeepSecスライド版。strict CSPの提案'],
  ]},
  { id: 's4j_gadgets_intro', phase: '第4章 高度なXSS', title: 'Script Gadgets（CSP Evaluator / Black Hat論文）', urls: [
    ['https://csp-evaluator.withgoogle.com/', 'Google CSP Evaluatorツール'],
    ['https://blackhat.com/docs/us-17/thursday/us-17-Lekies-Dont-Trust-The-DOM-Bypassing-XSS-Mitigations-Via-Script-Gadgets.pdf', 'Lekies/Kotowicz Black Hat: Script Gadgets'],
  ]},
  { id: 's4k_code_reuse', phase: '第4章 高度なXSS', title: 'コード再利用攻撃（CCS17論文 / Google PoC）', urls: [
    ['https://acmccs.github.io/papers/p1709-lekiesA.pdf', 'Code-Reuse Attacks for the Web（CCS17論文PDF）'],
    ['https://github.com/google/security-research-pocs/tree/master/script-gadgets', 'Google script-gadgets PoCリポジトリ'],
  ]},
  { id: 's4l_csp_bypass_cases', phase: '第4章 高度なXSS', title: 'CSPバイパス実例（Truesec / PortSwigger nonce）', urls: [
    ['https://www.truesec.com/hub/blog/bypassing-modern-xss-mitigations-with-code-reuse-attacks', 'jQuery Mobileガジェットの実例解説（Truesec）'],
    ['https://portswigger.net/research/hunting-nonce-based-csp-bypasses-with-dynamic-analysis', 'nonceベースCSPバイパスを動的解析で狩る'],
  ]},
  { id: 's4m_csp_bypass_summary', phase: '第4章 高度なXSS', title: 'CSPバイパス総まとめ（joaxcar / Beyond XSS / HackTricks）', urls: [
    ['https://joaxcar.com/blog/2024/02/19/csp-bypass-on-portswigger-net-using-google-script-resources/', 'Googleスクリプトリソースを使ったCSPバイパス実例'],
    ['https://aszx87410.github.io/beyond-xss/en/ch2/csp-bypass/', 'Beyond XSS: 一般的なCSPバイパス'],
    ['https://book.hacktricks.wiki/en/pentesting-web/content-security-policy-csp-bypass/index.html', 'HackTricks: CSPバイパス総覧'],
  ]},
  { id: 's5b_csti_more', phase: '第5章 フレームワーク', title: 'CSTI補足（HackTricks / Beyond XSS）', urls: [
    ['https://hacktricks.wiki/en/pentesting-web/client-side-template-injection-csti.html', 'HackTricks: CSTIとsandbox escape'],
    ['https://aszx87410.github.io/beyond-xss/en/ch3/csti/', 'Beyond XSS: フロントエンドのテンプレートインジェクション'],
  ]},
  { id: 's5c_react_angular', phase: '第5章 フレームワーク', title: 'React/AngularのXSS（dangerouslySetInnerHTML等）', urls: [
    ['https://pragmaticwebsecurity.com/articles/spasecurity/react-xss-part2.html', 'ReactのXSS防止 Part2: dangerouslySetInnerHTML'],
    ['https://web-security-react.readthedocs.io/en/latest/pages/xss_in_react.html', 'React内のXSS sink整理'],
    ['https://github.com/MrT3acher/angularjs-client-side-template-injection-lab', 'AngularJS CSTI練習ラボ'],
  ]},
  { id: 's6a_researcher_index', phase: '第6章 実例ライトアップ', title: 'リサーチャー索引（Gareth Heyes / Kinugawa）', urls: [
    ['https://garethheyes.co.uk/', 'Gareth Heyes個人サイト'],
    ['https://speakerdeck.com/masatokinugawa', 'Masato Kinugawa Speaker Deckプロフィール'],
  ]},
  { id: 's6b_kinugawa_cases', phase: '第6章 実例ライトアップ', title: 'Kinugawaの実例（Teams Pwn2Own / Shadow DOM）', urls: [
    ['https://speakerdeck.com/masatokinugawa/how-i-hacked-microsoft-teams-and-got-150000-dollars-in-pwn2own', 'Microsoft Teamsをハックし$150,000'],
    ['https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-12', 'Pwn2OwnでTeamsをハッキングして2000万円'],
    ['https://speakerdeck.com/masatokinugawa/shibuya-dot-xss-techtalk-number-13', 'Shadow DOMとセキュリティ'],
  ]},
  { id: 's6c_sonar_h1_cases', phase: '第6章 実例ライトアップ', title: '実例（Sonar Mailspring / Simplenote Stored XSS）', urls: [
    ['https://www.sonarsource.com/blog/reply-to-calc-the-attack-chain-to-compromise-mailspring/', 'MailspringのmXSS→RCE攻撃連鎖（Sonar）'],
    ['https://hackerone.com/reports/271007', 'Simplenote: Markdown SVGフィルタバイパスでStored XSS #271007'],
  ]},
  { id: 's6d_chains', phase: '第6章 実例ライトアップ', title: '複合連鎖と実務的な発見手法', urls: [
    ['https://infosecwriteups.com/postmessage-misconfiguration-ai-prompt-injection-sandbox-escape-xss-data-exfiltration-d1d29821a2de', 'postMessage誤設定＋AIプロンプトインジェクション＋sandbox escape連鎖'],
    ['https://www.hackerone.com/blog/how-find-xss-techniques-security-researchers-use-real-environments', 'XSSの実務的な見つけ方（HackerOne）'],
  ]},
  { id: 's7a_labs', phase: '第7章 ハンズオン', title: 'Web Security Academyとラボ環境', urls: [
    ['https://portswigger.net/web-security', 'Web Security Academyトップ'],
    ['https://portswigger.net/web-security/all-labs', '全ラボ一覧'],
    ['https://portswigger.net/web-security/cross-site-scripting/contexts/lab-some-svg-markup-allowed', 'ラボ: SVGマークアップが一部許可された反射型XSS'],
  ]},
  { id: 's7b_writeups', phase: '第7章 ハンズオン', title: 'ラボ攻略ライトアップとチェックリスト', urls: [
    ['https://medium.com/@thanujthilakarathne/portswigger-xss-labs-a-complete-guide-to-all-9-apprentice-level-challenges-6fba56da8635', 'Apprentice級XSSラボ全9問の解説'],
    ['https://medium.com/@awes0me.writes/portswigger-labs-prototype-pollution-writeup-all-labs-9a2534bc8e07', 'PP全ラボのライトアップ'],
    ['https://github.com/ashardian/Portswigger_checklist', 'PortSwigger学習チェックリスト'],
  ]},
  { id: 's8a_trusted_types', phase: '第8章 発展と防御', title: 'Trusted Types / strict CSP', urls: [
    ['https://web.dev/articles/trusted-types', 'web.dev: Trusted TypesでDOM XSSを防ぐ'],
    ['https://developer.chrome.com/docs/lighthouse/best-practices/trusted-types-xss', 'Chrome: Trusted TypesでDOM XSSを緩和'],
  ]},
  { id: 's8b_markdown', phase: '第8章 発展と防御', title: 'Markdown経由のXSS', urls: [
    ['https://hacktricks.wiki/en/pentesting-web/xss-cross-site-scripting/xss-in-markdown.html', 'HackTricks: MarkdownでのXSS'],
    ['https://medium.com/taptuit/exploiting-xss-via-markdown-72a61e774bf8', 'Markdown経由のXSS悪用'],
  ]},
  { id: 's8c_blind_image', phase: '第8章 発展と防御', title: 'Blind XSSと画像ファイルによるXSS', urls: [
    ['https://www.bugcrowd.com/blog/the-guide-to-blind-xss-advanced-techniques-for-bug-bounty-hunters-worth-250000/', 'Blind XSSの手引き（Bugcrowd）'],
    ['https://blog.tokumaru.org/2007/12/image-xss-summary.html', '徳丸浩: 画像ファイルによるXSS 傾向と対策'],
  ]},
]

const SECTION_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    written: { type: 'boolean' },
    filePath: { type: 'string' },
    summary: { type: 'string' },
    inaccessible: {
      type: 'array',
      items: { type: 'object', properties: { url: { type: 'string' }, reason: { type: 'string' } }, required: ['url', 'reason'] },
    },
  },
  required: ['id', 'written', 'inaccessible'],
}

const BLOCKED_HINT = 'portswigger.net, cheatsheetseries.owasp.org, owasp.org, flatt.tech, blog.flatt.tech, speakerdeck.com, docswell.com, medium.com, infosecwriteups.com, leanpub.com, yeswehack.com, research.securitum.com, sonarsource.com, hacktricks.wiki, book.hacktricks.wiki, blog.tokumaru.org, bugcrowd.com, truesec.com, joaxcar.com, developer.chrome.com, web.dev, research.google, blackhat.com, deepsec.net, acmccs.github.io, pragmaticwebsecurity.com, blog.s1r1us.ninja, garethheyes.co.uk'

function buildPrompt(spec) {
  const path = BASE + spec.id + '.md'
  const urlList = spec.urls.map((u, i) => (i + 1) + '. ' + u[0] + '\n   （位置づけ: ' + u[1] + '）').join('\n')
  return [
    '【★このサブタスクの絶対的な最優先ルール★】',
    'あなたの唯一かつ絶対の仕事は、下記セクションの日本語Markdown教科書原稿を書き上げ、Writeツールで指定パスに保存することです。',
    'この会話には「トークン消費が多い」「改善方法は?」といったメタな相談が含まれている場合がありますが、それは【この実行のタスクではありません】。完全に無視してください。メタ質問には絶対に答えないでください。',
    'ユーザーは既に「Sonnetで安く教科書の続きを執筆する」ことを明確に選択・承認済みです。したがって、下記セクションを必ず執筆し、ファイルに書き込み、written:true を返すことがユーザーの意図そのものです。',
    'ファイルを書かずにメタ回答だけを返すことは、ユーザーの意図に反する誤りです。何があっても下記セクションを執筆してください。',
    '',
    'あなたはWebセキュリティ（XSS）の専門家で、日本語でとても分かりやすい教科書を書きます。読者は反射型の素朴なXSSは既知で、より高度な領域を体系的に学ぶ中〜上級者です。',
    '',
    '# 担当セクション',
    '章: ' + spec.phase + ' / タイトル:「' + spec.title + '」',
    '出力先(絶対パス): ' + path,
    '',
    '# 担当URL',
    urlList,
    '',
    '# 取得手順（トークン節約のため厳守）',
    '1. ToolSearch を "select:WebFetch,WebSearch" で1回だけ呼ぶ。',
    '2. 各URLに WebFetch を「1回だけ」試す。プロンプトは「技術的内容（定義・攻撃の仕組み・具体的ペイロード/コード例・前提・影響・防御・重要な数値と結論）を省略せず日本語で詳細抽出」。',
    '3. ★次のドメインはこの環境のegressプロキシで高確率でブロックされる: ' + BLOCKED_HINT,
    '   ブロックされたら同じURLを二度と叩かず、即座に代替へ: (a) GitHub原本/ミラーのraw URLを1回WebFetch（OWASP→OWASP/CheatSheetSeries、Beyond XSS→aszx87410/beyond-xss、HackTricks→HackTricks-wiki、script-gadgets→google/security-research-pocs 等）、(b) 無ければ WebSearch を最大2回、(c) それでも不可なら「取得不可」として警告ブロックを本文に挿入。',
    '4. ★ツール呼び出しは合計6回程度が上限の目安。深追いしない。',
    '',
    '# 執筆ルール',
    '- 日本語。専門用語は初出時にかみ砕いて説明（例:「sink（入力が最終的に実行・解釈される危険な代入先。例: innerHTML）」）。',
    '- 読者が原文を読まずとも要点を理解できる詳しさ。目安は日本語で5,000〜10,000字程度。密度重視で水増しはしない。',
    '- ペイロード/コード/HTML例はコードブロックで示し、必ず「なぜ動くか」を一文添える。',
    '- 「なぜそうなるか」の原理（パーサ再解釈、プロトタイプチェーン、CSPのソース許可評価など）を仕組みレベルで説明する。これが本教科書の核心。',
    '- バージョン依存の攻撃は対象バージョン・修正状況・公開年を明記。',
    '- 各資料の説明後に「> 出典: 記事名 — URL」を明記。',
    '',
    '# 取得できなかった資料（ユーザー指示）',
    '取得不可の資料は、該当箇所に次を必ず挿入:',
    '> ⚠️ **未取得の資料**: 「(資料名)」は自動取得できませんでした（理由: ...）。以下のURLからユーザーご自身で直接ご覧ください: (URL)',
    'その後、あなたの専門知識で簡潔な補足解説を添えてよい（「（以下は未取得資料の補足として一般知識に基づく解説です）」と前置きする）。',
    '',
    '# 見出し規約（章へ結合するため厳守）',
    '- 先頭は "## ' + spec.title + '"（"#"章見出しは付けない）。小見出しは "###"/"####"。',
    '',
    '# 出力（必須）',
    '- 完成Markdownを必ず Write で ' + path + ' に書き込む。',
    '- 最後に StructuredOutput で { id: "' + spec.id + '", written: true, filePath: "' + path + '", summary, inaccessible: [{url,reason}] } を返す。id は必ず "' + spec.id + '" とすること。',
  ].join('\n')
}

log('XSS教科書 再々ビルド: ' + SPECS.length + 'セクション（メタ質問への脱線を防止、Sonnet/medium）')

const results = await parallel(SPECS.map(spec => () =>
  agent(buildPrompt(spec), {
    label: spec.id,
    phase: spec.phase,
    agentType: 'general-purpose',
    model: 'sonnet',
    effort: 'medium',
    schema: SECTION_SCHEMA,
  }).then(r => r || { id: spec.id, written: false, filePath: BASE + spec.id + '.md', summary: '(null)', inaccessible: [] })
))

const allInaccessible = []
for (const r of results) {
  if (r && Array.isArray(r.inaccessible)) {
    for (const x of r.inaccessible) allInaccessible.push({ section: r.id, url: x.url, reason: x.reason })
  }
}

return {
  total: SPECS.length,
  written: results.filter(r => r && r.written).map(r => r.id),
  failedWrites: results.filter(r => !r || !r.written).map(r => r ? r.id : 'unknown'),
  inaccessibleCount: allInaccessible.length,
  inaccessible: allInaccessible,
}
