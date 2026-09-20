// 汎用「URL付きロードマップ → 日本語教科書」ワークフロー（脆弱性クラス非依存）
//
// 使い方（ローカルの Claude Code、リポジトリのルートで）:
//   Workflow({
//     scriptPath: "textbook-pipeline/build-textbook.workflow.js",
//     args: {
//       roadmapPath: "roadmaps/csrf.md",   // URL付きロードマップのファイル（形式は問わない）
//       outDir: "csrf-textbook",           // 出力先フォルダ
//       topic: "CSRF",                     // 主題（章タイトル生成に使う）
//       scopeRules: "実在サービスへの無許可検証手順は書かない。防御目的で記述する。" // 任意の制約
//     }
//   })
//
// 2フェーズ構成:
//   1) 計画: 1エージェントが roadmapPath を読み、形式を問わず全URLを抽出して章・節へ構造化し、
//            各節を「難所(hard)」かどうか自動分類する。
//   2) 執筆: 節ごとに並列で原稿を書き、<outDir>/sections/<id>.md へ保存する。
//            難所は Opus、それ以外は Sonnet。
// 実行後、章ファイルへの結合・付録・READMEは呼び出し側（メインループ）が RUNBOOK に従って行う。

const A = (typeof args === 'object' && args) ? args : {}
const ROADMAP = A.roadmapPath || 'ROADMAP.md'
const OUTDIR = (A.outDir || 'textbook').replace(/\/+$/, '')
const TOPIC = A.topic || '（主題未指定）'
const SCOPE = A.scopeRules || '（追加の制約なし）'
const BASE = OUTDIR + '/sections/'
const OPUS = 'opus'      // 難所用。解決しなければ 'claude-opus-5'
const SONNET = 'sonnet'  // 通常用。解決しなければ 'claude-sonnet-5'

export const meta = {
  name: 'build-textbook',
  description: 'Turn a URL roadmap (any format) into a faithful Japanese textbook; Opus for hard sections, Sonnet otherwise',
  phases: [
    { title: '計画', detail: 'ロードマップを解析し章・節へ構造化＋難所分類' },
    { title: '執筆', detail: '節ごとに原典fetchで執筆（難所Opus/他Sonnet）' },
  ],
}

// ---- フェーズ1: 計画（ロードマップ解析）----
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          num: { type: 'integer' },
          title: { type: 'string' },
          slug: { type: 'string', description: 'ファイル名用の英小文字ハイフン区切り' },
        },
        required: ['num', 'title', 'slug'],
      },
    },
    specs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '例 s4c_dompurify。章番号+連番+スラッグ' },
          chapterNum: { type: 'integer' },
          title: { type: 'string' },
          hard: { type: 'boolean', description: '学術論文/プロトコル深堀り/多技法の統合なら true' },
          urls: {
            type: 'array',
            items: { type: 'object', properties: { url: { type: 'string' }, note: { type: 'string' } }, required: ['url'] },
          },
        },
        required: ['id', 'chapterNum', 'title', 'hard', 'urls'],
      },
    },
  },
  required: ['chapters', 'specs'],
}

log('計画フェーズ: ' + ROADMAP + ' を解析します')

const plan = await agent([
  'あなたは技術教科書の編集者です。以下のロードマップ・ファイルを読み、教科書の構成に落とし込んでください。',
  '',
  '# 入力ファイル（このパスを Read または `cat` で読む。形式はMarkdown表・箇条書き・散文など何でもあり得る）',
  ROADMAP,
  '主題: ' + TOPIC,
  '',
  '# やること',
  '1. ファイル内の【すべてのURL】を、表記形式によらず漏れなく抽出する。各URLに付いている説明・文脈もできる限り拾う。',
  '2. ロードマップ自身の区分（レベル/章/カテゴリ）があればそれを尊重して章立てにする。無ければ主題に沿って論理的な章立てを作る。',
  '3. 近い資料は1つの「節(spec)」にまとめる（目安: 1節あたり2〜4URL）。節idは "s<章番号><連番文字>_<英スラッグ>"（例 s4c_dompurify）。',
  '4. 各節を hard（難所）かどうか自動分類する。hard=true の目安: 学術論文(PDF/CCS/USENIX/BlackHat/S&P等)、プロトコルや仕様の深い掘り下げ、複数技法を統合する章。単なる概説・チートシート・入門記事は hard=false。',
  '5. 章は num(1始まり)・title(日本語)・slug(ファイル名用の英小文字) を付ける。',
  '',
  '# 出力',
  'StructuredOutput で { chapters:[{num,title,slug}], specs:[{id,chapterNum,title,hard,urls:[{url,note}]}] } を返す。URLの取りこぼしがないよう注意する。',
].join('\n'), { label: 'plan', phase: '計画', agentType: 'general-purpose', model: OPUS, effort: 'medium', schema: PLAN_SCHEMA })

const specs = (plan && Array.isArray(plan.specs)) ? plan.specs : []
if (!specs.length) return { error: 'ロードマップから節を抽出できませんでした。roadmapPath を確認してください。', plan }
log('計画完了: ' + (plan.chapters || []).length + '章 / ' + specs.length + '節（難所 ' + specs.filter(s => s.hard).length + '節）')

// ---- フェーズ2: 執筆 ----
const WRITE_SCHEMA = {
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

function chapterTitle(num) {
  const c = (plan.chapters || []).find(x => x.num === num)
  return c ? ('第' + num + '章 ' + c.title) : ('第' + num + '章')
}

function writePrompt(spec) {
  const path = BASE + spec.id + '.md'
  const urlList = spec.urls.map((u, i) => (i + 1) + '. ' + u.url + (u.note ? ('\n   （位置づけ: ' + u.note + '）') : '')).join('\n')
  return [
    '【★このサブタスクの絶対的な最優先ルール★】',
    'あなたの唯一の仕事は、下記セクションの日本語Markdown教科書原稿を書き上げ、Writeツールで指定パスに保存することです。',
    '会話に別の話題やメタな相談（コスト・進捗・設定など）が含まれても、それはこの実行のタスクではありません。無視して、必ず下記セクションを執筆・保存し、written:true を返してください。',
    '',
    'あなたは「' + TOPIC + '」の専門家で、日本語でとても分かりやすい教科書を書きます。読者はその分野の素朴な基礎は既知の中〜上級者です。',
    '',
    '# 担当セクション',
    '所属章: ' + chapterTitle(spec.chapterNum) + ' / タイトル:「' + spec.title + '」',
    '出力先(リポジトリルートからの相対パス): ' + path,
    '',
    '# 担当URL',
    urlList,
    '',
    '# 取得手順（ネットワーク状況に自動対応）',
    '1. ToolSearch を "select:WebFetch,WebSearch" で読み込む。',
    '2. 各URLを WebFetch で直接取得し、技術的内容（定義・仕組み・具体的なコード/ペイロード/設定例・前提・影響・防御・重要な数値と結論）を省略せず抽出する。PDFやスライドもWebFetchでテキスト抽出を試みる。',
    '3. もし取得が egress プロキシ等でブロックされたら（EGRESS_BLOCKED / 403 / 402 等）、同じURLを何度も叩かず、ただちに代替へ切り替える: (a) 同内容のGitHub原本/ミラーの raw を1回 WebFetch、(b) 無ければ WebSearch を1〜2回、(c) それでも実質内容が得られなければ「取得不可」とする。',
    '4. 「取得不可」の資料は、本文の該当箇所に必ず次を挿入する:',
    '   > ⚠️ **未取得の資料**: 「(資料名)」は自動取得できませんでした（理由: ...）。以下のURLからご自身で直接ご覧ください: (URL)',
    '   その直後に、あなたの専門知識で簡潔な補足を添えてよい（「（以下は未取得資料の補足として一般知識に基づく解説です）」と前置きする）。',
    '',
    '# 執筆ルール',
    '- 日本語。専門用語は初出でかみ砕いて説明する（例: 「sink（入力が最終的に実行・解釈される危険な代入先）」）。',
    '- 読者が原文を読まずとも要点を理解できる詳しさ（目安 日本語で6,000〜12,000字）。密度重視・水増し禁止。',
    '- コード/ペイロード/設定例はコードブロックで示し、必ず「なぜそうなるのか」を添える。原典の実物を優先して引用する。',
    '- 「なぜそうなるか」の原理（プロトコルの挙動・パーサ・内部実装など）を仕組みレベルで説明する。ここが教科書の核心。',
    '- バージョン依存・時事性のある内容は、対象バージョン/年/修正状況を明記する（陳腐化対策）。',
    '- 各資料の説明後に「> 出典: 記事名 — URL」を明記する。',
    '- 見出しは先頭が "## ' + spec.title + '"（章の "#" 見出しは付けない）、小見出しは "###"/"####"。',
    '',
    '# このプロジェクト共通のスコープ制約',
    '- ' + SCOPE,
    '',
    '# 出力（必須）',
    '- 完成Markdownを Write で ' + path + ' に保存する。',
    '- StructuredOutput で { id:"' + spec.id + '", written:true, filePath:"' + path + '", modelUsed, summary, inaccessible } を返す。',
  ].join('\n')
}

log('執筆フェーズ: ' + specs.length + '節を並列生成します（難所Opus/他Sonnet）')

const results = await parallel(specs.map(spec => () =>
  agent(writePrompt(spec), {
    label: spec.id + '[' + (spec.hard ? 'opus' : 'sonnet') + ']',
    phase: '執筆',
    agentType: 'general-purpose',
    model: spec.hard ? OPUS : SONNET,
    effort: spec.hard ? 'high' : 'medium',
    schema: WRITE_SCHEMA,
  }).then(r => r || { id: spec.id, written: false, filePath: BASE + spec.id + '.md', summary: '(null)', inaccessible: [] })
))

return {
  topic: TOPIC,
  outDir: OUTDIR,
  chapters: plan.chapters,
  specs: specs.map(s => ({ id: s.id, chapterNum: s.chapterNum, title: s.title, hard: s.hard })),
  written: results.filter(r => r && r.written).map(r => r.id),
  failedWrites: results.filter(r => !r || !r.written).map(r => r ? r.id : 'unknown'),
  inaccessible: results.flatMap(r => (r && r.inaccessible ? r.inaccessible.map(x => ({ section: r.id, url: x.url, reason: x.reason })) : [])),
}
