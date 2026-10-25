/**
 * dsh-cyrene-pet — 宿主半（Host half）。
 *
 * 给桌宠提供三样东西：
 *   1. 设置存储 /cyrene-pet/state
 *   2. DeepSeek 余额与今日消费 /cyrene-pet/balance
 *   3. 系统状态（CPU / 内存 / GPU / 网速 / 电量）/cyrene-pet/hud
 * 外加一条只读资源路由 /cyrene-pet/asset/:name，给客户端半取立绘。
 *
 * 只读写 <DSH_HOME>/storages/cyrene-pet/，不碰会话、不碰其他插件的数据。
 */
import { execFile, spawn } from 'node:child_process'
import { copyFile, link, mkdir, readFile, readdir, rename, stat, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { cpus, freemem, homedir, totalmem } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ID = 'dsh-cyrene-pet'
const ROUTE_PREFIX = '/cyrene-pet'
const STATE_DIR = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'cyrene-pet')
const STATE_PATH = join(STATE_DIR, 'state.json')
const LEDGER_PATH = join(STATE_DIR, 'ledger.json')
const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const BALANCE_TTL = 30 * 1000
const HUD_TTL = 6 * 1000
const MAX_BODY_BYTES = 32 * 1024

/* 对话提问桥：单题的基础等待时长，多题按题数加时；超时就把请求交还网页卡片 */
const CONVERSATION_ASK_TIMEOUT = 45 * 1000
const CONVERSATION_ASK_STEP_TIMEOUT = 25 * 1000
/* 风险审批：决定只影响这一次，超时同样交还网页卡片 */
const APPROVAL_TIMEOUT = 60 * 1000

const DEFAULTS = Object.freeze({
  version: 1,
  enabled: true,
  nickname: '柒柒',
  apiKey: '',
  balanceThreshold: 20,
  dailyLimit: 0,
  bubbleMode: 'rotate',
  hudDetail: 'full',
  showHud: true,
  scale: 1,
  bubbleFont: 14.5,
  bubbleRadius: 0,
  bubbleAlpha: 0.97,
  hudAlpha: 0.93,
  askEveryMinutes: 45,
  askHandling: 'pet-all',
  asks: [],
  refreshSeconds: 30,
  poseSeconds: 60,
  soundVolume: 0.5,
})

const BUBBLE_MODES = ['rotate', 'info', 'talk', 'today']
const HUD_DETAILS = ['full', 'simple', 'simple2']
/* 对话提问由谁接：桌宠逐题 / 桌宠只接单题 / 两边都问先答先算 / 只走网页卡片 */
const ASK_HANDLINGS = ['pet-all', 'pet-single', 'both', 'web']

let state = { ...DEFAULTS }
let loaded = false
let writeChain = Promise.resolve()

let balanceCache = null
let balanceAt = 0
let balancePending = null
let balanceError = ''
let ledgerCache = null

let lastClientSeen = 0
let hudCache = null
let hudAt = 0
let hudPending = null
let hudRetryAt = 0
let cpuSample = null
let netSample = null

/* ------------------------------ 提问 ------------------------------ */

const SESSION_ROOT = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')

const QUESTION_BANK = [
  { text: '今天想先从哪里开始？', choices: ['写点代码', '理一下计划', '先发会儿呆'] },
  { text: '现在这个时候，你饿了吗？', choices: ['有点饿', '还好', '刚吃过'] },
  { text: '手上的事推进到哪一步了？', choices: ['刚开头', '卡住了', '快收尾'] },
  { text: '今天喝够水了吗？', choices: ['喝了', '还没', '马上就去'] },
  { text: '要不要把最难的那件先挑出来做？', choices: ['现在就上', '再等等', '今天跳过'] },
  { text: '你现在的心情有几分？', choices: ['很好', '一般', '有点累'] },
  { text: '一会儿想吃点什么？', choices: ['随便吃点', '想吃热的', '家里做'] },
  { text: '今天有什么想记下来的小事吗？', choices: ['有一件', '暂时没有', '晚点再说'] },
  { text: '要不要让注意力集中一点？', choices: ['关掉通知', '先放首歌', '就这样'] },
  { text: '上次那个问题，还想继续聊吗？', choices: ['想', '先放着', '换个话题'] },
  { text: '坐了很久了吗？', choices: ['该站起来了', '刚坐下', '还好'] },
  { text: '今天有没有一件让你开心的事？', choices: ['有', '想不起来', '等一下想'] },
  { text: '能休息十分钟的话，你想做什么？', choices: ['躺一会儿', '出去走走', '看看窗外'] },
  { text: '手边的任务，哪个最让你犹豫？', choices: ['第一个', '第二个', '都还好'] },
  { text: '今晚打算几点睡？', choices: ['早点', '正常', '可能会晚'] },
  { text: '要不要把今天的进度写下来？', choices: ['写两句', '不写了', '你帮我记'] },
  { text: '现在适合做费脑的事吗？', choices: ['适合', '不太行', '先试试'] },
  { text: '有什么想让我帮你盯着的事吗？', choices: ['余额', '额度', '暂时没有'] },
  { text: '今天穿得够暖吗？', choices: ['够', '有点冷', '刚好'] },
  { text: '最近睡得怎么样？', choices: ['还行', '有点晚', '不太好'] },
  { text: '明天的事，先想一件？', choices: ['想好了', '再等等', '明天再说'] },
  { text: '现在最需要的是什么？', choices: ['专注', '休息', '有人陪'] },
  { text: '今天有没有久坐不动？', choices: ['有', '没有', '刚动过'] },
  { text: '想听一句夸奖吗？', choices: ['想听', '不用啦', '你随便说'] },
]

let currentAsk = null
let nextAskAt = 0
let askIndex = -1
let lastSessionAt = 0
let sessionScanAt = 0
let emojiList = []

function pickQuestion(now = Date.now()) {
  if (QUESTION_BANK.length === 0) return null
  let index = Math.floor(Math.random() * QUESTION_BANK.length)
  if (QUESTION_BANK.length > 1 && index === askIndex) index = (index + 1) % QUESTION_BANK.length
  askIndex = index
  const item = QUESTION_BANK[index]
  return { id: now, index, text: item.text, choices: [...item.choices] }
}

function askGapMs() {
  return Math.max(5, Number(state.askEveryMinutes) || 45) * 60000
}

function refreshAsk(now = Date.now()) {
  if (!(Number(state.askEveryMinutes) > 0)) {
    currentAsk = null
    return
  }
  if (nextAskAt === 0) {
    nextAskAt = now + 90000
    return
  }
  if (currentAsk === null && now >= nextAskAt) currentAsk = pickQuestion(now)
}

function clearAsk() {
  currentAsk = null
  nextAskAt = Date.now() + askGapMs()
}

/* --------------------- 对话提问桥（桌宠 / 网页卡片 / 两边都问） --------------------- */

function petCanTakeQuestion() {
  return state.enabled === true && petChild !== null
}

function askHandlingMode() {
  return ASK_HANDLINGS.includes(state.askHandling) ? state.askHandling : 'pet-all'
}

/* 一整批都要能在桌宠里逐题答：每题都有选项、都不是计划审阅，否则整批让给网页卡片 */
function collectPetQuestions(request) {
  if (!Array.isArray(request?.questions) || request.questions.length === 0) return null
  const questions = []
  for (const question of request.questions) {
    if (question.intent !== undefined) return null
    const options = Array.isArray(question.options) ? question.options : []
    const labels = options.map((option) => clampText(option?.label, 40)).filter((label) => label !== '')
    if (labels.length === 0) return null
    questions.push({
      id: question.id,
      text: clampText(question.question ?? question.header ?? '', 400) || '人家想问你一件事',
      choices: labels,
      multi: question.multiSelect === true,
    })
  }
  return questions
}

/* 多题逐题问，等待时间按题数加长 */
function askWaitMs(questions) {
  return CONVERSATION_ASK_TIMEOUT + Math.max(0, questions.length - 1) * CONVERSATION_ASK_STEP_TIMEOUT
}

function startConversationAsk(questions, request) {
  const pending = {
    id: ++conversationAskSeq,
    questions,
    signal: request.signal ?? null,
    onAbort: null,
    timer: null,
    settled: false,
    resolve: null,
    decision: null,
  }
  pending.decision = new Promise((resolve) => {
    pending.resolve = resolve
  })
  conversationAsk = pending
  pending.timer = setTimeout(() => {
    settleConversationAsk(pending, { kind: 'timeout' })
  }, askWaitMs(questions))
  if (pending.signal !== null) {
    pending.onAbort = () => {
      settleConversationAsk(pending, { kind: 'abort', reason: pending.signal.reason })
    }
    pending.signal.addEventListener('abort', pending.onAbort, { once: true })
  }
  void writeLive().catch(() => {})
  return pending
}

function releaseConversationAsk(pending) {
  if (pending === null) return
  if (pending.timer !== null) clearTimeout(pending.timer)
  pending.timer = null
  if (pending.onAbort !== null && pending.signal !== null) {
    pending.signal.removeEventListener('abort', pending.onAbort)
  }
  pending.onAbort = null
  if (conversationAsk === pending) conversationAsk = null
}

function settleConversationAsk(pending, outcome) {
  if (pending === null || pending.settled) return
  pending.settled = true
  releaseConversationAsk(pending)
  pending.resolve(outcome)
  void writeLive().catch(() => {})
}

/* 把桌宠回传的逐题选项对齐成 ask 期望的答案批次，未答的题按空选项处理 */
function buildAnswerBatch(questions, answers) {
  const picked = new Map()
  for (const item of Array.isArray(answers) ? answers : []) {
    if (item === null || typeof item !== 'object') continue
    const selected = Array.isArray(item.selected)
      ? item.selected.map((label) => clampText(label, 40)).filter((label) => label !== '')
      : []
    picked.set(String(item.id), selected)
  }
  return questions.map((question) => ({
    id: question.id,
    selected: picked.get(String(question.id)) ?? [],
  }))
}

function abortedAnswer(reason) {
  return reason ?? new Error('ask_user_question was aborted before the user answered')
}

/*
 * 挂在 user-questions/request waterfall 最前面。
 * pet-all / pet-single：桌宠接管，网页卡片不弹，超时或答不了再 next() 交还。
 * both：网页卡片照常弹，桌宠也问，谁先答用谁的。
 */
async function bridgeConversationAsk(request, next, ctx) {
  const mode = askHandlingMode()
  if (mode === 'web') return next()
  if (petCanTakeQuestion() !== true) return next()
  if (request.agent === undefined || request.agent === null) return next()
  if (conversationAsk !== null) return next()
  const questions = collectPetQuestions(request)
  if (questions === null) return next()
  if (mode === 'pet-single' && questions.length !== 1) return next()

  const pending = startConversationAsk(questions, request)
  ctx?.logger?.info?.(`${PACKAGE_ID}: 桌宠接管对话提问 #${pending.id}（${questions.length} 题，${mode}）`)
  if (mode === 'both') return raceWithWebCard(pending, next, ctx)

  try {
    const outcome = await pending.decision
    if (outcome.kind === 'abort') throw abortedAnswer(outcome.reason)
    if (outcome.kind === 'timeout') {
      ctx?.logger?.info?.(`${PACKAGE_ID}: 提问 #${pending.id} 超时，交还给网页卡片`)
      return next()
    }
    return { answers: outcome.answers }
  } finally {
    if (pending.settled !== true) {
      pending.settled = true
      releaseConversationAsk(pending)
    }
  }
}

/* 两边同时问：网页卡片已经转发出去，桌宠这边再等一次，先答的算数 */
async function raceWithWebCard(pending, next, ctx) {
  const web = (async () => {
    try {
      return { ok: true, value: await next() }
    } catch (error) {
      return { ok: false, error }
    }
  })()

  let onAbort = null
  let abortPromise = null
  if (pending.signal !== null) {
    abortPromise = new Promise((_, reject) => {
      onAbort = () => reject(abortedAnswer(pending.signal.reason))
      pending.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  try {
    const first = await Promise.race([
      pending.decision.then((outcome) => ({ from: 'pet', outcome })),
      web.then((result) => ({ from: 'web', result })),
      ...(abortPromise === null ? [] : [abortPromise]),
    ])
    if (first.from === 'web') {
      if (pending.settled !== true) settleConversationAsk(pending, { kind: 'timeout' })
      if (!first.result.ok) throw first.result.error
      return first.result.value
    }
    const outcome = first.outcome
    if (outcome.kind === 'abort') throw abortedAnswer(outcome.reason)
    if (outcome.kind === 'timeout') {
      ctx?.logger?.info?.(`${PACKAGE_ID}: 提问 #${pending.id} 桌宠超时，等网页卡片`)
      const result = await (abortPromise === null ? web : Promise.race([web, abortPromise]))
      if (!result.ok) throw result.error
      return result.value
    }
    return { answers: outcome.answers }
  } finally {
    if (onAbort !== null && pending.signal !== null) pending.signal.removeEventListener('abort', onAbort)
    if (pending.settled !== true) {
      pending.settled = true
      releaseConversationAsk(pending)
    }
  }
}

/* --------------------- 风险审批桥（approval/request） --------------------- */

function petCanApprove() {
  return state.enabled === true && petChild !== null
}

/* displayReason 是本地化文案表，先挑中文、再退英文，最后退审计原因 */
function approvalReasonText(request) {
  const localized = request?.displayReason
  if (localized !== null && localized !== undefined && typeof localized === 'object') {
    const text = clampText(localized.zh ?? localized['zh-CN'] ?? localized.en ?? '', 200)
    if (text !== '') return text
  }
  return clampText(request?.reason, 200)
}

function startApprovalAsk(request) {
  const pending = {
    id: ++approvalAskSeq,
    toolName: clampText(request.toolName, 40) || '工具',
    reason: approvalReasonText(request),
    signal: request.signal ?? null,
    onAbort: null,
    timer: null,
    settled: false,
    resolve: null,
    decision: null,
  }
  pending.decision = new Promise((resolve) => {
    pending.resolve = resolve
  })
  approvalAsk = pending
  pending.timer = setTimeout(() => {
    settleApprovalAsk(pending, { kind: 'timeout' })
  }, APPROVAL_TIMEOUT)
  if (pending.signal !== null) {
    pending.onAbort = () => {
      settleApprovalAsk(pending, { kind: 'cancelled' })
    }
    pending.signal.addEventListener('abort', pending.onAbort, { once: true })
  }
  void writeLive().catch(() => {})
  return pending
}

function releaseApprovalAsk(pending) {
  if (pending === null) return
  if (pending.timer !== null) clearTimeout(pending.timer)
  pending.timer = null
  if (pending.onAbort !== null && pending.signal !== null) {
    pending.signal.removeEventListener('abort', pending.onAbort)
  }
  pending.onAbort = null
  if (approvalAsk === pending) approvalAsk = null
}

function settleApprovalAsk(pending, outcome) {
  if (pending === null || pending.settled) return
  pending.settled = true
  releaseApprovalAsk(pending)
  pending.resolve(outcome)
  void writeLive().catch(() => {})
}

/* 审批结果只认 allowed-once / rejected；超时、取消或桌宠不在时交还网页卡片 */
async function bridgeApproval(request, next, ctx) {
  const mode = askHandlingMode()
  if (mode === 'web') return next()
  if (petCanApprove() !== true) return next()
  if (request.agent === undefined || request.agent === null) return next()
  if (approvalAsk !== null) return next()
  const pending = startApprovalAsk(request)
  ctx?.logger?.info?.(`${PACKAGE_ID}: 桌宠接管风险审批 #${pending.id}（${pending.toolName}，${mode}）`)
  if (mode === 'both') return raceApprovalWithWeb(pending, next, ctx)
  try {
    const outcome = await pending.decision
    if (outcome.kind === 'cancelled') return 'cancelled'
    if (outcome.kind === 'timeout') {
      ctx?.logger?.info?.(`${PACKAGE_ID}: 审批 #${pending.id} 超时，交还给网页卡片`)
      return next()
    }
    return outcome.outcome
  } finally {
    if (pending.settled !== true) {
      pending.settled = true
      releaseApprovalAsk(pending)
    }
  }
}

async function raceApprovalWithWeb(pending, next, ctx) {
  const web = (async () => {
    try {
      return { ok: true, value: await next() }
    } catch (error) {
      return { ok: false, error }
    }
  })()

  let onAbort = null
  let abortPromise = null
  if (pending.signal !== null) {
    abortPromise = new Promise((resolve) => {
      onAbort = () => resolve({ from: 'abort' })
      pending.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  try {
    const first = await Promise.race([
      pending.decision.then((outcome) => ({ from: 'pet', outcome })),
      web.then((result) => ({ from: 'web', result })),
      ...(abortPromise === null ? [] : [abortPromise]),
    ])
    if (first.from === 'abort') return 'cancelled'
    if (first.from === 'web') {
      if (pending.settled !== true) settleApprovalAsk(pending, { kind: 'timeout' })
      if (!first.result.ok) throw first.result.error
      return first.result.value
    }
    const outcome = first.outcome
    if (outcome.kind === 'cancelled') return 'cancelled'
    if (outcome.kind === 'timeout') {
      ctx?.logger?.info?.(`${PACKAGE_ID}: 审批 #${pending.id} 桌宠超时，等网页卡片`)
      const result = await web
      if (!result.ok) throw result.error
      return result.value
    }
    return outcome.outcome
  } finally {
    if (onAbort !== null && pending.signal !== null) pending.signal.removeEventListener('abort', onAbort)
    if (pending.settled !== true) {
      pending.settled = true
      releaseApprovalAsk(pending)
    }
  }
}

/* 桌宠的「任务进程」需要知道最近一次对话活动 */
async function scanSessionActivity(now = Date.now()) {
  if (now - sessionScanAt < 45000) return lastSessionAt
  sessionScanAt = now
  let latest = 0
  try {
    const projects = await readdir(SESSION_ROOT, { withFileTypes: true })
    for (const project of projects) {
      if (project.isDirectory() === false) continue
      const dir = join(SESSION_ROOT, project.name)
      let sessions = []
      try {
        sessions = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const session of sessions) {
        if (session.isDirectory() === false) continue
        try {
          const info = await stat(join(dir, session.name, 'session.v4.jsonl.zstd'))
          if (info.mtimeMs > latest) latest = info.mtimeMs
        } catch {
          /* 这个会话没有归档文件 */
        }
      }
    }
  } catch {
    /* 没有 sessions 目录时保持旧值 */
  }
  if (latest > 0) lastSessionAt = latest
  return lastSessionAt
}

/* --------------------------- 任务进程（todos） --------------------------- */

/* 只跟随根会话：子代理的会话不该把主人正在做的任务挤掉 */
function trackSession(session) {
  if (session === null || session === undefined || session === liveSession) return
  const agents = hostCtx?.get?.('agents')
  if (agents !== undefined && typeof agents.roots === 'function') {
    const roots = agents.roots()
    if (Array.isArray(roots) && roots.length > 0) {
      const owned = roots.some(
        (agent) =>
          agent.session === session ||
          (agent.session?.id !== undefined && session.id !== undefined && agent.session.id === session.id),
      )
      if (!owned) return
    }
  }
  liveSession = session
}

/* 读最近一次活动根会话的 todos 投影；没有投影或没写过任务时返回 null */
function readTodos() {
  if (liveSession === null || hostCtx === null) return null
  try {
    const projections = hostCtx.get('sessionProjections')
    const todos = projections?.stateOf?.(liveSession, 'todos')
    if (!Array.isArray(todos)) return null
    return todos
      .slice(0, 20)
      .map((item) => ({
        content: clampText(item?.content, 80),
        status: item?.status === 'completed' || item?.status === 'in_progress' ? item.status : 'pending',
      }))
      .filter((item) => item.content !== '')
  } catch {
    return null
  }
}

/* ------------------------------ 设置 ------------------------------ */

function clampText(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n?/g, '\n').trim().slice(0, max)
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalize(input) {
  const next = { ...state }
  if (typeof input?.enabled === 'boolean') next.enabled = input.enabled
  if (typeof input?.nickname === 'string') {
    const nickname = clampText(input.nickname, 24)
    next.nickname = nickname === '' ? DEFAULTS.nickname : nickname
  }
  if (typeof input?.apiKey === 'string') next.apiKey = input.apiKey.trim().slice(0, 200)
  if (input?.balanceThreshold !== undefined) {
    next.balanceThreshold = clampNumber(input.balanceThreshold, 0, 100000, DEFAULTS.balanceThreshold)
  }
  if (input?.dailyLimit !== undefined) {
    next.dailyLimit = clampNumber(input.dailyLimit, 0, 100000, DEFAULTS.dailyLimit)
  }
  if (BUBBLE_MODES.includes(input?.bubbleMode)) next.bubbleMode = input.bubbleMode
  if (HUD_DETAILS.includes(input?.hudDetail)) next.hudDetail = input.hudDetail
  if (typeof input?.showHud === 'boolean') next.showHud = input.showHud
  if (input?.scale !== undefined) next.scale = clampNumber(input.scale, 0.6, 1.8, DEFAULTS.scale)
  if (input?.bubbleFont !== undefined) {
    next.bubbleFont = clampNumber(input.bubbleFont, 11, 20, DEFAULTS.bubbleFont)
  }
  if (input?.bubbleRadius !== undefined) {
    next.bubbleRadius = clampNumber(input.bubbleRadius, 0, 18, DEFAULTS.bubbleRadius)
  }
  if (input?.bubbleAlpha !== undefined) {
    next.bubbleAlpha = clampNumber(input.bubbleAlpha, 0.5, 1, DEFAULTS.bubbleAlpha)
  }
  if (input?.hudAlpha !== undefined) {
    next.hudAlpha = clampNumber(input.hudAlpha, 0.4, 1, DEFAULTS.hudAlpha)
  }
  if (input?.askEveryMinutes !== undefined) {
    next.askEveryMinutes = clampNumber(input.askEveryMinutes, 0, 480, DEFAULTS.askEveryMinutes)
  }
  if (ASK_HANDLINGS.includes(input?.askHandling)) next.askHandling = input.askHandling
  if (Array.isArray(input?.asks)) next.asks = input.asks.slice(-30)
  if (input?.refreshSeconds !== undefined) {
    next.refreshSeconds = clampNumber(input.refreshSeconds, 15, 300, DEFAULTS.refreshSeconds)
  }
  if (input?.poseSeconds !== undefined) {
    next.poseSeconds = clampNumber(input.poseSeconds, 0, 600, DEFAULTS.poseSeconds)
  }
  if (input?.soundVolume !== undefined) {
    next.soundVolume = clampNumber(input.soundVolume, 0, 1, DEFAULTS.soundVolume)
  }
  return next
}

/* 旧版 state.json 里拆开的开关，合并进对应的数值设置 */
function migrate(saved) {
  const next = { ...saved }
  if (next.askEnabled === false && next.askEveryMinutes === undefined) next.askEveryMinutes = 0
  if (next.idlePose === false && next.poseSeconds === undefined) next.poseSeconds = 0
  if (next.soundEnabled === false && next.soundVolume === undefined) next.soundVolume = 0
  delete next.askEnabled
  delete next.idlePose
  delete next.soundEnabled
  delete next.avatar
  delete next.x
  delete next.y
  return next
}

async function ensureLoaded() {
  if (loaded) return
  loaded = true
  try {
    const raw = await readFile(STATE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    state = normalize({ ...DEFAULTS, ...migrate(parsed) })
  } catch {
    state = { ...DEFAULTS }
    try {
      await persist()
    } catch {
      /* 默认设置写不进去也不影响运行 */
    }
  }
}

async function persist() {
  const snapshot = JSON.stringify(state, null, 2)
  writeChain = writeChain.then(async () => {
    await mkdir(STATE_DIR, { recursive: true })
    const temp = `${STATE_PATH}.tmp`
    await writeFile(temp, snapshot, 'utf8')
    await rename(temp, STATE_PATH)
  })
  return writeChain
}

function publicState() {
  return {
    enabled: state.enabled,
    petRunning: petChild !== null,
    runtimeError,
    nickname: state.nickname,
    hasKey: state.apiKey !== '' || credentialAvailable || Boolean(process.env.DEEPSEEK_API_KEY),
    balanceThreshold: state.balanceThreshold,
    dailyLimit: state.dailyLimit,
    bubbleMode: state.bubbleMode,
    hudDetail: state.hudDetail,
    showHud: state.showHud,
    scale: state.scale,
    askEveryMinutes: state.askEveryMinutes,
    askHandling: state.askHandling,
    asks: Array.isArray(state.asks) ? state.asks.slice(-30) : [],
    statePath: STATE_PATH,
  }
}

/* ------------------------------ 余额与记账 ------------------------------ */

function beijingDayKey(now = new Date()) {
  const bj = new Date(now.getTime() + 8 * 3600 * 1000)
  const y = bj.getUTCFullYear()
  const m = String(bj.getUTCMonth() + 1).padStart(2, '0')
  const d = String(bj.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function money(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

async function readLedger() {
  if (ledgerCache !== null) return { ...ledgerCache, history: { ...(ledgerCache.history ?? {}) } }
  try {
    const raw = await readFile(LEDGER_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    ledgerCache = {
      day: typeof parsed?.day === 'string' ? parsed.day : beijingDayKey(),
      spent: money(parsed?.spent),
      recharge: money(parsed?.recharge),
      last: typeof parsed?.last === 'number' ? parsed.last : null,
      at: typeof parsed?.at === 'number' ? parsed.at : 0,
      history: parsed?.history && typeof parsed.history === 'object' ? parsed.history : {},
    }
  } catch {
    ledgerCache = { day: beijingDayKey(), spent: 0, recharge: 0, last: null, at: 0, history: {} }
  }
  return { ...ledgerCache, history: { ...ledgerCache.history } }
}

async function writeLedger(ledger) {
  ledgerCache = ledger
  await mkdir(STATE_DIR, { recursive: true })
  const temp = `${LEDGER_PATH}.tmp`
  await writeFile(temp, JSON.stringify(ledger, null, 2), 'utf8')
  await rename(temp, LEDGER_PATH)
}

async function observe(balance) {
  const day = beijingDayKey()
  const ledger = await readLedger()

  if (ledger.day !== day) {
    ledger.history[ledger.day] = { spent: ledger.spent, recharge: ledger.recharge }
    const keys = Object.keys(ledger.history).sort()
    while (keys.length > 7) delete ledger.history[keys.shift()]
    ledger.day = day
    ledger.spent = 0
    ledger.recharge = 0
  }

  if (typeof ledger.last === 'number') {
    const delta = money(ledger.last - balance.total)
    if (delta > 0.0001) ledger.spent = money(ledger.spent + delta)
    else if (delta < -0.0001) ledger.recharge = money(ledger.recharge - delta)
  }

  ledger.last = balance.total
  ledger.at = Date.now()
  await writeLedger(ledger)
  return ledger
}

async function resolveApiKey() {
  if (state.apiKey !== '') return state.apiKey

  const fromEnv = (process.env.DEEPSEEK_API_KEY || '').trim()
  if (fromEnv !== '') return fromEnv

  try {
    const text = await readFile(join(DSH_HOME, '.credentials.yaml'), 'utf8')
    const match = text.match(/DEEPSEEK_API_KEY:\s*(\S+)/)
    if (match !== null && match[1]) {
      credentialAvailable = true
      return match[1].trim()
    }
  } catch {
    /* 没有 dsh 凭据文件时走设置项 */
  }

  return ''
}

async function fetchBalance() {
  const key = await resolveApiKey()
  if (key === '') throw new Error('还没有设置 DeepSeek API Key')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) {
      throw new Error(`API Key 无效或没有权限（HTTP ${res.status}）`)
    }
    if (!res.ok) throw new Error(`余额接口返回 HTTP ${res.status}`)
    const body = await res.json()
    const info = Array.isArray(body?.balance_infos) ? body.balance_infos[0] ?? {} : {}
    return {
      available: Boolean(body?.is_available),
      currency: String(info.currency || 'CNY'),
      total: money(info.total_balance),
      granted: money(info.granted_balance),
      toppedUp: money(info.topped_up_balance),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function queryBalance(force = false) {
  const now = Date.now()
  const ttl = Math.max(15000, Math.min(300000, (Number(state.refreshSeconds) || 30) * 1000))
  if (!force && balanceCache !== null && now - balanceAt < ttl) return balanceCache
  if (balancePending !== null) return balancePending

  balancePending = (async () => {
    try {
      const balance = await fetchBalance()
      const ledger = await observe(balance)
      balanceError = ''
      balanceCache = {
        ...balance,
        spent: ledger.spent,
        recharge: ledger.recharge,
        day: ledger.day,
        at: ledger.at,
        threshold: state.balanceThreshold,
        dailyLimit: state.dailyLimit,
        overThreshold:
          state.balanceThreshold > 0 && balance.total < state.balanceThreshold,
        overBudget: state.dailyLimit > 0 && ledger.spent > state.dailyLimit,
      }
      balanceAt = Date.now()
      return balanceCache
    } catch (error) {
      balanceError = error?.message ?? String(error)
      throw error
    } finally {
      balancePending = null
    }
  })()

  return balancePending
}

/* ------------------------------ 系统状态 ------------------------------ */

const SYS_PROBE_PS = [
  '$r=[ordered]@{}',
  '$net=@(Get-NetAdapterStatistics -ErrorAction SilentlyContinue)',
  'if($net.Count){$r.net=@{r=[double](($net|Measure-Object ReceivedBytes -Sum).Sum);s=[double](($net|Measure-Object SentBytes -Sum).Sum)}}else{$r.net=$null}',
  '$b=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue|Select-Object -First 1',
  'if($b){$r.bat=@{p=[int]$b.EstimatedChargeRemaining;charging=[bool]($b.BatteryStatus -eq 2 -or $b.BatteryStatus -ge 6)}}else{$r.bat=$null}',
  '$g=Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue|Measure-Object -Property UtilizationPercentage -Sum',
  'if($g.Sum -ne $null){$r.gpu=[math]::Round([double]$g.Sum,1)}else{$r.gpu=$null}',
  'ConvertTo-Json -InputObject $r -Compress -Depth 4',
].join('; ')

function runPowerShell(script, timeout) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout, windowsHide: true },
      (error, stdout) => resolve(error ? '' : String(stdout || '')),
    )
  })
}

function sampleCpu() {
  let idle = 0
  let total = 0
  for (const cpu of cpus()) {
    const t = cpu.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  const sample = { idle, total, at: Date.now() }
  let percent = null
  if (cpuSample !== null && sample.at > cpuSample.at) {
    const idleDelta = sample.idle - cpuSample.idle
    const totalDelta = sample.total - cpuSample.total
    if (totalDelta > 0) percent = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)))
  }
  cpuSample = sample
  return percent
}

function memoryInfo() {
  const total = totalmem()
  const free = freemem()
  const used = Math.max(0, total - free)
  return {
    percent: total > 0 ? Math.round((used / total) * 100) : 0,
    usedGB: Math.round((used / 1024 ** 3) * 10) / 10,
    totalGB: Math.round((total / 1024 ** 3) * 10) / 10,
  }
}

async function probeHud() {
  const now = Date.now()
  if (hudCache !== null && now - hudAt < HUD_TTL) return hudCache
  if (hudPending !== null) return hudPending
  if (now < hudRetryAt) return hudCache

  const cpu = sampleCpu()
  const memory = memoryInfo()

  hudPending = (async () => {
    let extra = null
    const out = await runPowerShell(SYS_PROBE_PS, 8000)
    if (out.trim() === '') {
      hudRetryAt = Date.now() + 30000
    } else {
      try {
        extra = JSON.parse(out)
      } catch {
        hudRetryAt = Date.now() + 30000
      }
    }

    let netDown = null
    let netUp = null
    if (extra?.net && typeof extra.net.r === 'number') {
      const sample = { r: extra.net.r, s: extra.net.s, at: Date.now() }
      if (netSample !== null && sample.at > netSample.at) {
        const dt = (sample.at - netSample.at) / 1000
        if (dt > 0.2) {
          netDown = Math.max(0, Math.round(((sample.r - netSample.r) / dt) * 10) / 10)
          netUp = Math.max(0, Math.round(((sample.s - netSample.s) / dt) * 10) / 10)
        }
      }
      netSample = sample
    }

    hudCache = {
      cpu,
      mem: memory.percent,
      memUsedGB: memory.usedGB,
      memTotalGB: memory.totalGB,
      gpu: typeof extra?.gpu === 'number' ? Math.max(0, Math.min(100, Math.round(extra.gpu))) : null,
      netDown,
      netUp,
      battery: typeof extra?.bat?.p === 'number' ? extra.bat.p : null,
      charging: Boolean(extra?.bat?.charging),
      at: Date.now(),
    }
    hudAt = Date.now()
    return hudCache
  })()

  try {
    return await hudPending
  } finally {
    hudPending = null
  }
}

/* ------------------------------ HTTP ------------------------------ */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`请求体超过 ${MAX_BODY_BYTES} 字节`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error(`JSON 解析失败：${error?.message ?? String(error)}`))
      }
    })
    req.on('error', reject)
  })
}

const ASSET_TYPES = {
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
}

async function sendAsset(res, name) {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    sendJson(res, 400, { ok: false, error: { code: 'bad-name', message: '资源名不合法' } })
    return
  }
  const type = ASSET_TYPES[extname(name).toLowerCase()]
  if (type === undefined) {
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '不支持的资源类型' } })
    return
  }
  try {
    const file = join(ASSET_DIR, name)
    const info = await stat(file)
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error('资源不可用')
    const body = await readFile(file)
    res.statusCode = 200
    res.setHeader('content-type', type)
    res.setHeader('cache-control', 'public, max-age=86400')
    res.end(body)
  } catch {
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `没有这个资源：${name}` } })
  }
}

/* ------------------------------ 桌面桌宠进程 ------------------------------ */

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PET_APP_DIR = join(PACKAGE_ROOT, 'pet')
const RUNTIME_DIR = join(STATE_DIR, 'runtime')
const PET_EXE = join(RUNTIME_DIR, 'DeepSeek Harness.exe')
const PET_ENTRY = join(RUNTIME_DIR, 'resources', 'app')
const LIVE_PATH = join(STATE_DIR, 'live.json')
const PET_STATUS_PATH = join(STATE_DIR, 'pet-status.json')
const PET_WINDOW_PATH = join(STATE_DIR, 'pet-window.json')
const COMMAND_PATH = join(STATE_DIR, 'pet-command.json')

const PET_LINES = [
  '嗨♪ 人家在这儿呢。',
  '今天也一起走一段吧？',
  '渴不渴？人家给你倒杯水。',
  '窗外的风很轻呢……',
  '别熬太晚哦，好不好？',
  '人家数到三，你就休息一下。',
  '这段代码，看起来有点难呢。',
  '失败了也没关系，我们再试一次。',
  '你把事情做完的样子，很好看♪',
  '有点累了？靠一会儿吧。',
  '今天的花，开得刚刚好。',
  '人家一直在这里，不用回头找。',
  '慢慢来，时间够的。',
  '要不要听人家说个秘密？',
  '你的眼睛里有光，我看见了。',
  '下雨了也不怕，我陪你等晴天。',
  '这件事，你做得比昨天好。',
  '如果迷路了，就看看星星。',
  '我偷偷把你的名字，写进了风里。',
  '好啦，继续吧。人家看着你♪',
]

let petChild = null
let liveTimer = null
let commandTimer = null
let commandMtime = 0
let liveRotation = 0
let forceTalkUntil = 0
let poseAt = 0
let credentialAvailable = false
let runtimeError = ''

/* 正在等桌宠回答的对话提问；同一时间只接一个 */
let conversationAsk = null
let conversationAskSeq = Date.now()

/* 正在等桌宠决定的风险审批 */
let approvalAsk = null
let approvalAskSeq = Date.now()

/* 任务进程：桌宠读到的是「最近一次活动的根会话」的 todos 投影 */
let hostCtx = null
let liveSession = null

async function findDesktopExe() {
  const candidates = [
    process.env.DSH_DESKTOP_EXE,
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe'),
    join(process.env.PROGRAMFILES ?? '', 'DeepSeek Harness', 'DeepSeek Harness.exe'),
  ].filter((value) => typeof value === 'string' && value !== '')
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return ''
}

async function ensureRuntime() {
  if (existsSync(PET_EXE) && existsSync(PET_ENTRY)) return
  const source = await findDesktopExe()
  if (source === '') throw new Error('没有找到 DeepSeek Harness 桌面端，桌宠暂时起不来')

  const sourceDir = dirname(source)
  await mkdir(join(RUNTIME_DIR, 'resources'), { recursive: true })

  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue
    const from = join(sourceDir, entry.name)
    const to = join(RUNTIME_DIR, entry.name)
    if (existsSync(to)) continue
    try {
      await link(from, to)
    } catch {
      try {
        await copyFile(from, to)
      } catch {
        /* 单个文件拿不到不影响其它文件 */
      }
    }
  }

  const localesFrom = join(sourceDir, 'locales')
  const localesTo = join(RUNTIME_DIR, 'locales')
  if (existsSync(localesFrom) && !existsSync(localesTo)) {
    await mkdir(localesTo, { recursive: true })
    for (const name of await readdir(localesFrom)) {
      try {
        await copyFile(join(localesFrom, name), join(localesTo, name))
      } catch {
        /* 语言包缺失不影响运行 */
      }
    }
  }

  if (!existsSync(PET_ENTRY)) {
    await symlink(PET_APP_DIR, PET_ENTRY, 'junction')
  }
}

/* dsh 宿主可能以 Node 模式跑（Electron 二进制 + ELECTRON_RUN_AS_NODE=1），
   这个标记会让桌宠也被当成 Node 执行，所以 spawn 前要摘掉 */
function petSpawnEnv() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function startPet() {
  if (petChild !== null || state.enabled !== true) return
  void (async () => {
    try {
      await ensureRuntime()
      petChild = spawn(PET_EXE, ['--no-sandbox'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: petSpawnEnv(),
      })
      petChild.on('exit', () => {
        petChild = null
      })
      petChild.unref()
      runtimeError = ''
    } catch (error) {
      runtimeError = error?.message ?? String(error)
      hostCtx?.logger?.warn?.(`${PACKAGE_ID}: 桌宠启动失败：${runtimeError}`)
    }
  })()
}

function restartPet() {
  stopPet()
  setTimeout(() => startPet(), 600)
}

function stopPet() {
  if (petChild === null) return
  try {
    petChild.kill()
  } catch {
    /* 进程已退出 */
  }
  petChild = null
}

function pickEmoji(overBudget, nearLimit, overThreshold, speak) {
  if (overBudget) return 'poorwallet'
  if (nearLimit) return 'thinking'
  if (overThreshold) return 'Whatswrong'
  if (speak) return liveRotation % 2 === 0 ? 'Gigglelots' : 'hello'
  return liveRotation % 4 === 0 ? 'shyshort' : 'HI'
}

function buildLive(balance, hud) {
  liveRotation += 1
  const mode = state.bubbleMode
  const talk = PET_LINES[liveRotation % PET_LINES.length]
  const total = balance === null ? '还没连上余额' : `${Number(balance.total).toFixed(2)} 元`
  const spent = balance === null ? 0 : Number(balance.spent) || 0
  const limit = Number(state.dailyLimit) || 0
  const ratio = limit > 0 ? spent / limit : 0
  const overBudget = limit > 0 && spent > limit
  const nearLimit = limit > 0 && !overBudget && ratio >= 0.8
  const overThreshold = Boolean(balance?.overThreshold)
  const forcedTalk = Date.now() < forceTalkUntil

  let line = ''
  let speak = false

  if (mode === 'talk') {
    line = talk
    speak = true
  } else if (mode === 'info') {
    line = `余额 ${total}`
  } else if (mode === 'today') {
    line = balance === null ? '还没有设置 API Key 呢。' : `今日消费 ${spent.toFixed(2)} 元`
  } else if (liveRotation % 2 === 0) {
    line = `余额 ${total}`
  } else {
    line = talk
    speak = liveRotation % 4 === 0
  }

  if (forcedTalk) {
    line = talk
    speak = true
  } else if (overBudget) {
    line = `今日用掉 ${spent.toFixed(2)} 元，超过 ${limit.toFixed(0)} 的额度了…`
    speak = true
  } else if (nearLimit) {
    line = `今日已用 ${spent.toFixed(2)} 元，快到 ${limit.toFixed(0)} 了呢。`
    speak = true
  }

  refreshAsk()

  return {
    at: Date.now(),
    nickname: state.nickname,
    bubbleMode: mode,
    showHud: state.showHud,
    hudDetail: state.hudDetail,
    scale: state.scale,
    bubbleFont: state.bubbleFont,
    bubbleRadius: state.bubbleRadius,
    bubbleAlpha: state.bubbleAlpha,
    hudAlpha: state.hudAlpha,
    askEnabled: Number(state.askEveryMinutes) > 0,
    askEveryMinutes: state.askEveryMinutes,
    askHandling: askHandlingMode(),
    ask:
      conversationAsk === null
        ? currentAsk
        : {
            id: conversationAsk.id,
            source: 'conversation',
            questions: conversationAsk.questions.map((question) => ({
              id: question.id,
              text: question.text,
              choices: question.choices,
              multi: question.multi,
            })),
          },
    approval:
      approvalAsk === null
        ? null
        : {
            id: approvalAsk.id,
            tool: approvalAsk.toolName,
            reason: approvalAsk.reason,
          },
    asks: Array.isArray(state.asks) ? state.asks.slice(-30) : [],
    todos: readTodos(),
    lastSessionAt,
    emojiList,
    refreshSeconds: state.refreshSeconds,
    idlePose: Number(state.poseSeconds) > 0,
    poseSeconds: state.poseSeconds,
    soundEnabled: Number(state.soundVolume) > 0,
    soundVolume: state.soundVolume,
    hasKey: state.apiKey !== '' || credentialAvailable || Boolean(process.env.DEEPSEEK_API_KEY),
    balanceError,
    balanceThreshold: state.balanceThreshold,
    dailyLimit: state.dailyLimit,
    line,
    emoji: pickEmoji(overBudget, nearLimit, overThreshold, speak),
    speak,
    ms: speak ? 3200 : 4200,
    poseAt,
    quota: {
      limit,
      spent: Number(spent.toFixed(2)),
      ratio: Number(ratio.toFixed(3)),
      overBudget,
      nearLimit,
    },
    balance:
      balance === null
        ? null
        : {
            total: balance.total,
            spent: balance.spent,
            recharge: balance.recharge,
            currency: balance.currency,
            overThreshold: balance.overThreshold,
            overBudget: balance.overBudget,
            day: balance.day,
          },
    hud,
  }
}

async function writeLive() {
  let balance = null
  try {
    balance = await queryBalance(false)
  } catch {
    balance = balanceCache
  }
  let hud = null
  try {
    hud = await probeHud()
  } catch {
    hud = hudCache
  }

  const live = buildLive(balance, hud)
  void scanSessionActivity().catch(() => {})
  await mkdir(STATE_DIR, { recursive: true })
  const temp = `${LIVE_PATH}.tmp`
  await writeFile(temp, JSON.stringify(live, null, 2), 'utf8')
  await rename(temp, LIVE_PATH)
}

async function pollCommand() {
  try {
    const info = await stat(COMMAND_PATH)
    if (info.mtimeMs === commandMtime) return
    commandMtime = info.mtimeMs
    const command = JSON.parse(await readFile(COMMAND_PATH, 'utf8'))
    if (command === null || typeof command !== 'object') return

    if (command.action === 'state' && command.patch !== null && typeof command.patch === 'object') {
      state = normalize({ ...state, ...command.patch })
      await persist()
      await writeLive()
    } else if (command.action === 'say') {
      forceTalkUntil = Date.now() + 6000
      await writeLive()
    } else if (command.action === 'pose') {
      poseAt = Date.now()
      await writeLive()
    } else if (command.action === 'refresh') {
      balanceCache = null
      balanceAt = 0
      await writeLive()
    } else if (command.action === 'answer') {
      const askId = Number(command.askId) || 0
      const matched = conversationAsk !== null && askId !== 0 && askId === conversationAsk.id
      if (matched) {
        const questions = conversationAsk.questions
        const batch = buildAnswerBatch(questions, command.answers)
        const askedAt = Date.now()
        const entries = questions.map((question, index) => ({
          at: askedAt,
          question: question.text.slice(0, 120),
          answer: batch[index].selected.length > 0 ? batch[index].selected.join('、').slice(0, 60) : '（跳过）',
        }))
        const list = Array.isArray(state.asks) ? state.asks : []
        state.asks = [...list, ...entries].slice(-30)
        await persist()
        settleConversationAsk(conversationAsk, { kind: 'answer', answers: batch })
      } else {
        const question = clampText(command.question, 120)
        const answer = clampText(command.answer, 60)
        if (question !== '' && answer !== '') {
          const list = Array.isArray(state.asks) ? state.asks : []
          state.asks = [...list, { at: Date.now(), question, answer }].slice(-30)
          await persist()
        }
      }
      clearAsk()
      await writeLive()
    } else if (command.action === 'approval') {
      const approvalId = Number(command.approvalId) || 0
      if (approvalAsk !== null && approvalId !== 0 && approvalId === approvalAsk.id) {
        const decision = command.decision === 'allowed-once' ? 'allowed-once' : 'rejected'
        settleApprovalAsk(approvalAsk, { kind: 'decision', outcome: decision })
      }
      await writeLive()
    } else if (command.action === 'restartPet') {
      state.enabled = true
      await persist()
      restartPet()
      await writeLive()
    } else if (command.action === 'stopPet') {
      state.enabled = false
      await persist()
      stopPet()
      await writeLive()
    }
  } catch {
    /* 命令文件还没生成，或正写到一半 */
  }
}

/* ------------------------------ 入口 ------------------------------ */

export const name = PACKAGE_ID
export const inject = ['webServer']

export function apply(ctx) {
  ctx.effect(() => {
    hostCtx = ctx
    return () => {
      hostCtx = null
      liveSession = null
    }
  }, `${PACKAGE_ID}: host context`)

  /* 跟着最新的根会话走，长按时读它的 todos 投影 */
  ctx.effect(
    () =>
      ctx.on(
        'session/event',
        (session) => {
          trackSession(session)
        },
        { global: true },
      ),
    `${PACKAGE_ID}: todo session tracking`,
  )

  ctx.effect(() => {
    const disposeBridge = ctx.on(
      'user-questions/request',
      (request, next) => bridgeConversationAsk(request, next, ctx),
      { prepend: true },
    )
    return () => {
      disposeBridge()
      if (conversationAsk !== null) settleConversationAsk(conversationAsk, { kind: 'timeout' })
    }
  }, `${PACKAGE_ID}: conversation ask bridge`)

  ctx.effect(() => {
    const disposeApproval = ctx.on(
      'approval/request',
      (request, next) => bridgeApproval(request, next, ctx),
      { prepend: true },
    )
    return () => {
      disposeApproval()
      if (approvalAsk !== null) settleApprovalAsk(approvalAsk, { kind: 'cancelled' })
    }
  }, `${PACKAGE_ID}: approval bridge`)

  ctx.effect(() => {
    void ensureLoaded().then(() => {
      ctx.logger?.info?.(
        `${PACKAGE_ID}: 已挂载（${state.nickname}，桌宠${state.enabled ? '开启' : '关闭'}${runtimeError === '' ? '' : `，运行时问题：${runtimeError}`}）`,
      )
      startPet(ctx)
      void readdir(join(ASSET_DIR, 'emoji'))
        .then((files) => {
          emojiList = files.filter((file) => /\.png$/i.test(file)).map((file) => file.replace(/\.png$/i, ''))
        })
        .catch(() => {
          /* 没有 emoji 目录时留给渲染层兜底 */
        })
      clearInterval(liveTimer)
      liveTimer = setInterval(() => {
        void writeLive().catch(() => {})
      }, 4000)
      clearInterval(commandTimer)
      commandTimer = setInterval(() => {
        void pollCommand()
      }, 1200)
      void writeLive().catch(() => {})
    })

    return () => {
      clearInterval(liveTimer)
      liveTimer = null
      clearInterval(commandTimer)
      commandTimer = null
      stopPet()
    }
  }, `${PACKAGE_ID}: desktop pet lifecycle`)

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
          try {
            if (route === '/state' && req.method === 'GET') {
              await ensureLoaded()
              sendJson(res, 200, { ok: true, value: publicState() })
              return
            }

            if (route === '/state' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              state = normalize(body)
              await persist()
              sendJson(res, 200, { ok: true, value: publicState() })
              return
            }

            /* 设置页的启停控制：start / stop / restart */
            if (route === '/control' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              const action = body?.action
              if (action === 'start') {
                state.enabled = true
                await persist()
                startPet()
              } else if (action === 'stop') {
                state.enabled = false
                await persist()
                stopPet()
              } else if (action === 'restart') {
                state.enabled = true
                await persist()
                restartPet()
              } else {
                sendJson(res, 400, {
                  ok: false,
                  error: { code: 'bad-action', message: `没有这个动作：${String(action)}` },
                })
                return
              }
              await writeLive()
              sendJson(res, 200, { ok: true, value: publicState() })
              return
            }

            if (route === '/balance' && req.method === 'GET') {
              await ensureLoaded()
              const force = url.searchParams.get('force') === '1'
              try {
                const value = await queryBalance(force)
                sendJson(res, 200, { ok: true, value })
              } catch (error) {
                sendJson(res, 200, {
                  ok: false,
                  value: balanceCache,
                  error: { code: 'balance-failed', message: error?.message ?? String(error) },
                })
              }
              return
            }

            if (route === '/hello' && req.method === 'POST') {
              const body = await readJsonBody(req)
              const seen = { at: new Date().toISOString(), pid: process.pid, ...body }
              await mkdir(STATE_DIR, { recursive: true })
              await writeFile(join(STATE_DIR, 'client-seen.json'), JSON.stringify(seen, null, 2), 'utf8')
              sendJson(res, 200, { ok: true })
              return
            }

            if (route === '/hud' && req.method === 'GET') {
              if (url.searchParams.get('c') === '1' && Date.now() - lastClientSeen > 30000) {
                lastClientSeen = Date.now()
                try {
                  await mkdir(STATE_DIR, { recursive: true })
                  await writeFile(
                    join(STATE_DIR, 'heartbeat.json'),
                    JSON.stringify({ at: new Date().toISOString(), pid: process.pid }, null, 2),
                    'utf8',
                  )
                } catch {
                  /* 心跳写不进去不影响状态读取 */
                }
              }
              const value = await probeHud()
              sendJson(res, 200, { ok: true, value })
              return
            }

            if (route.startsWith('/asset/') && req.method === 'GET') {
              await sendAsset(res, decodeURIComponent(route.slice('/asset/'.length)))
              return
            }

            sendJson(res, 404, {
              ok: false,
              error: { code: 'not-found', message: `没有这个路由：${req.method} ${route}` },
            })
          } catch (error) {
            ctx.logger?.warn?.(`${PACKAGE_ID}: ${req.method} ${route} 失败`, error)
            sendJson(res, 400, {
              ok: false,
              error: { code: 'bad-request', message: error?.message ?? String(error) },
            })
          }
        },
      }),
    `${PACKAGE_ID}: pet routes`,
  )
}
