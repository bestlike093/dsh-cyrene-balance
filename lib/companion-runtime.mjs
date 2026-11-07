/**
 * 陪伴层在宿主里的运行节奏。
 *
 * 负责三件事：
 *   1. 跟着会话活动记好感（主动来找、一起忙、四类情绪、久不联系）
 *   2. 按由头账本决定什么时候主动开口，并把话交给气泡
 *   3. 把记忆、好感、开口账本落到注入的目录里
 *
 * 这里不碰 Electron、不读全局状态；开关与当前会话都从外面注入，
 * 所以可以在普通 Node 测试里直接跑。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  applyBondEvent,
  bondMood,
  bondSummary,
  createBodyService,
  createEmotionRuntime,
  createIntimacyGate,
  createMemoryStore,
  createThoughtPool,
  DEFAULT_BOND_RULES,
  DEFAULT_SLEEP_WINDOW,
  defaultBond,
  defaultLedger,
  explainToday,
  ledgerSummary,
  markResponse,
  normalizeBond,
  normalizeLedger,
  pickCue,
  recordOpening,
  scheduleAgenda,
  THOUGHT_MIN_AGE_MS,
  weightOf,
} from './companion/index.mjs'

const DAY = 24 * 60 * 60 * 1000
const INITIATE_GAP = 10 * 60 * 1000

function readJson(file, normalize, fallback) {
  try {
    return normalize(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    const temp = `${file}.tmp`
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temp, file)
  } catch {
    /* 写不进去就等下一轮，不能影响桌宠本身 */
  }
}

export function createCompanionRuntime({
  dir,
  now = () => Date.now(),
  isBondEnabled = () => true,
  isOpeningEnabled = () => true,
  isPetRunning = () => true,
  getSessionView = () => null,
  getRecentSessions = async () => [],
  openingOptions = {},
  memoryStore: injectedMemoryStore = null,
  bodyService: injectedBodyService = null,
  emotionRuntime: injectedEmotionRuntime = null,
  thoughtPool: injectedThoughtPool = null,
  intimacyGate: injectedIntimacyGate = null,
  getSettings = () => ({}),
  getPersonaText = () => '',
  textToEmotion = null,
  log = () => {},
} = {}) {
  if (typeof dir !== 'string' || dir === '') throw new Error('companion-runtime 需要注入 dir')

  const bondPath = join(dir, 'bond.json')
  const openingPath = join(dir, 'opening.json')
  const memoryPath = join(dir, 'memory.json')
  const memory = injectedMemoryStore ?? createMemoryStore({ filePath: memoryPath, now })

  /* 身体与情绪都在共用层：这里只决定什么时候推进、什么时候把结论交给气泡。 */
  const body =
    injectedBodyService ??
    createBodyService({
      file: join(dir, 'body.json'),
      getSleepWindow: () => getSettings()?.companion?.body?.sleepWindow ?? DEFAULT_SLEEP_WINDOW,
      now,
      log: (message, error) => log?.(`[body] ${message}`, error),
    })
  const emotion =
    injectedEmotionRuntime ??
    createEmotionRuntime({
      getSettings,
      now,
      log: (message, error) => log?.(`[emotion] ${message}`, error),
    })
  /* 没说出口的念头先攒着；主动开口时和记忆一起参与挑选，不另开一条通道。 */
  const thoughts =
    injectedThoughtPool ??
    createThoughtPool({
      file: join(dir, 'thoughts.json'),
      now,
      log: (message, error) => log?.(`[thoughts] ${message}`, error),
    })
  void thoughts.ready()

  /*
   * 亲密层运行时：只在旅人版打开。公开版由 edition.mjs 把整条模块换成关闭占位，
   * 这里再按设置开关收一道，避免私用配置被带进公开包。
   */
  const intimacy =
    injectedIntimacyGate ??
    createIntimacyGate({
      file: join(dir, 'intimacy.json'),
      now,
      log: (message, error) => log?.(`[intimacy] ${message}`, error),
    })
  let lastIntimacy = null
  let lastIntimacyCheckAt = 0

  let lastBodyNote = ''
  let lastExpression = null

  let bond = readJson(bondPath, normalizeBond, defaultBond(now()))
  let ledger = readJson(openingPath, normalizeLedger, defaultLedger(now()))
  let pendingOpening = null
  let lastCheck = 0
  let lastTalk = null
  let lastInitiateAt = 0
  let seenAt = 0
  let lastEmotionText = ''

  function addBond(type, amount) {
    const rule = DEFAULT_BOND_RULES.find((item) => item.id === type)
    if (rule === undefined) return null
    const { bond: next, applied } = applyBondEvent(bond, { type, amount }, { now: now() })
    bond = next
    writeJson(bondPath, bond)
    return applied
  }

  function isIntimacyEnabled() {
    return getSettings()?.companion?.intimacy?.enabled === true
  }

  /*
   * 会话活动是唯一输入：用户发言时判断这一轮能不能靠近；助手回复落盘后推进一格。
   * 插件无权改写宿主回复，所以 filterReply 只作为数据层出口给桌宠与后续通道使用。
   */
  function noteIntimacy(last) {
    if (isIntimacyEnabled() === false) {
      lastIntimacy = null
      return
    }
    const atNow = now()
    if (last?.role === 'assistant' && lastIntimacy?.open === true) {
      const stage = lastIntimacy.stage
      if (stage !== 'none' && stage !== 'afterglow') {
        try {
          intimacy.noteTurn(atNow)
        } catch (error) {
          log('[intimacy] 推进阶段失败，这一轮保持原状', error)
        }
      }
      lastIntimacy = null
      return
    }
    if (last?.role !== 'user') return
    if (atNow - lastIntimacyCheckAt < 3000) return
    lastIntimacyCheckAt = atNow

    let bodySnapshot = null
    try {
      bodySnapshot = body.snapshot()
    } catch {
      bodySnapshot = null
    }
    const summary = bondSummary(bond, atNow)
    try {
      const result = intimacy.check({
        at: atNow,
        settings: getSettings(),
        personaText: getPersonaText(),
        scope: 'desktop',
        userText: typeof last.text === 'string' ? last.text : '',
        energy: Number(bodySnapshot?.energy),
        relationTier: summary.level,
        relationFavor: summary.affinity,
        lastSeenAt: lastTalk ?? 0,
      })
      lastIntimacy = result.open === true ? result : null
    } catch (error) {
      lastIntimacy = null
      log('[intimacy] 判断失败，这一轮按普通陪伴处理', error)
    }
  }

  function intimacyPrompt() {
    if (isIntimacyEnabled() === false || lastIntimacy?.open !== true) return ''
    try {
      return intimacy.promptFor(lastIntimacy.tone, lastIntimacy.proactive === true)
    } catch (error) {
      log('[intimacy] 取提示词失败', error)
      return ''
    }
  }

  /** 输出侧红线：返回过滤后的文本；关闭时原样返回。 */
  function filterIntimacyReply(text) {
    if (isIntimacyEnabled() === false) return { ok: true, text: String(text ?? ''), reason: 'disabled' }
    try {
      return intimacy.filterReply(text, now())
    } catch (error) {
      log('[intimacy] 输出过滤失败，退回安全台词', error)
      return { ok: false, text: '……今天先这样吧。', reason: 'error' }
    }
  }

  function noteEmotion(text) {
    const line = typeof text === 'string' ? text.trim().slice(0, 200) : ''
    if (line === '' || line === lastEmotionText) return
    lastEmotionText = line
    const hit = (words) => words.some((word) => line.includes(word))
    if (hit(['对不起', '抱歉', '我错了', '原谅我'])) {
      addBond('apologize')
    } else if (hit(['别难过', '抱抱', '不哭', '我在呢', '有我在'])) {
      addBond('comfort')
    } else if (hit(['别生气', '不气', '哄哄', '乖啦', '消消气'])) {
      addBond('soothe')
    } else if (hit(['好累', '累死', '熬夜', '加班', '困了', '没睡好', '撑不住'])) {
      addBond('care')
    }
  }

  /* 用户一句话 → 表现层情绪。只做粗略归类，不冒充语义理解。 */
  function detectEmotion(text) {
    if (typeof textToEmotion === 'function') {
      try {
        const value = textToEmotion(text)
        if (typeof value === 'string' && value !== '') return value
      } catch {
        /* 自定义分类失败就退回内置规则 */
      }
    }
    const line = typeof text === 'string' ? text : ''
    if (line === '') return 'neutral'
    if (/(对不起|抱歉|我错了|原谅我|难过|委屈|想哭|撑不住)/.test(line)) return 'sad'
    if (/(生气|烦死|讨厌|气死|别理我)/.test(line)) return 'angry'
    if (/(太棒|好耶|开心|高兴|喜欢|哈哈|谢谢)/.test(line)) return 'happy'
    if (/(害羞|不好意思|脸红)/.test(line)) return 'shy'
    if (/(累|困|熬夜|加班|没睡好)/.test(line)) return 'tired'
    if (/(！|!|真的吗|居然)/.test(line)) return 'surprised'
    return 'neutral'
  }

  /**
   * 真的说上话之后才推进身体：社交力气跟着消耗；睡着时被叫到就记一笔打断，
   * 再让她醒来。失败不影响这一轮回复，也不挡后面的主动开口。
   */
  async function noteBodyTurn(text) {
    try {
      await body.tick()
      const line = typeof text === 'string' ? text.trim() : ''
      if (line !== '') {
        const cost = Math.min(4, 0.8 + line.length * 0.06)
        await body.noteChat(cost)
      }
      const snapshot = body.snapshot()
      if (snapshot?.asleep === true && line !== '' && snapshot?.justWoke !== true) {
        await body.markInterrupted()
        await body.wake()
      }
      lastBodyNote = body.describe()
    } catch (error) {
      log('[body] 身体层结算失败，这一轮按平常状态说话', error)
    }
  }

  /* 会话文件有新动静：记一次主动来找，隔久了结算 neglect，并接住上一次开口 */
  function noteActivity(sessionAt) {
    const at = Number(sessionAt)
    if (!Number.isFinite(at) || at <= 0 || at <= seenAt) return
    const atNow = now()
    seenAt = at

    if (pendingOpening !== null && atNow - pendingOpening.at < 6 * 60 * 60 * 1000) {
      ledger = markResponse(ledger, atNow)
      writeJson(openingPath, ledger)
      pendingOpening = null
    }

    if (isBondEnabled() === false) return
    const view = getSessionView()
    const last = view?.last ?? null

    if (lastTalk !== null && at - lastTalk > 3 * DAY) {
      addBond('neglect', Math.max(1, Math.floor((at - lastTalk) / DAY)))
    }
    if (last?.role === 'user') {
      noteEmotion(last.text)
      const emotionTag = detectEmotion(last.text)
      emotion.noteUserTurn({ emotion: emotionTag })
      lastExpression = emotion.decideExpression(emotionTag)
      void noteBodyTurn(last.text)
    }
    noteIntimacy(last)
    if (last?.role === 'user' && atNow - lastInitiateAt >= INITIATE_GAP) {
      lastInitiateAt = atNow
      addBond('initiate')
    }
    if (view?.busy === true) addBond('together')
    lastTalk = at
  }

  function openingText(cue) {
    const text = typeof cue?.text === 'string' ? cue.text.trim().slice(0, 60) : ''
    if (cue?.kind === 'schedule') return text === '' ? '到点了哦，别忘了手上的安排。' : `到点了，${text}`
    if (cue?.kind === 'unfinished') return `上次说的「${text}」，后来怎么样了？`
    if (cue?.kind === 'memory') return `忽然想起「${text}」……你还在忙吗？`
    if (cue?.kind === 'reunion') return '你回来啦……人家刚刚还在想你呢♪'
    return ''
  }

  async function maybeOpen() {
    if (isOpeningEnabled() === false || isPetRunning() === false) return null
    const atNow = now()
    if (atNow - lastCheck < 60 * 1000) return null
    lastCheck = atNow
    const hour = new Date(atNow).getHours()
    if (hour >= 23 || hour < 8) return null
    if (pendingOpening !== null) return null

    /* 睡着了就不叫醒她；休息需求很高时也先忍住。 */
    try {
      const bodySnapshot = await body.tick()
      lastBodyNote = body.describe()
      if (bodySnapshot?.asleep === true) return null
    } catch (error) {
      log('[body] 主动开口前推进失败，按平常状态继续', error)
    }
    if (emotion.shouldHoldBackOpening() === true) return null

    let memories = []
    try {
      const items = await memory.recall('', { limit: 5 })
      memories = items.map((item) => ({ text: item.text, weight: weightOf(item, atNow), key: item.id }))
    } catch {
      memories = []
    }

    /* 攒够时间的念头也当成一次「想起」：仍然经过同一套账本与记忆闸门。 */
    try {
      await thoughts.ready()
      const pending = thoughts
        .list({ status: 'open', limit: 5 })
        .filter((item) => typeof item.text === 'string' && item.text !== '')
        .filter((item) => atNow - item.at >= THOUGHT_MIN_AGE_MS)
        .map((item) => ({
          text: item.text,
          weight: Math.min(1, Math.max(0.6, item.weight)),
          key: `thought:${item.id}`,
        }))
      memories = [...pending, ...memories]
    } catch (error) {
      log('[thoughts] 读取念头失败，这一轮只按记忆挑', error)
    }

    /* 未完话题：只拿有标题的近期会话，排除当前正开着的这一条 */
    let unfinished = []
    try {
      const current = getSessionView()?.id ?? null
      const sessions = await getRecentSessions()
      unfinished = (Array.isArray(sessions) ? sessions : [])
        .filter((item) => item !== null && typeof item === 'object')
        .filter((item) => item.id !== current && typeof item.title === 'string' && item.title.trim() !== '')
        .filter((item) => Number.isFinite(Number(item.updatedAt)))
        .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
        .slice(0, 4)
        .map((item) => ({
          text: item.title.trim().slice(0, 40),
          lastAt: Number(item.updatedAt),
          key: `session:${item.id}`,
        }))
    } catch {
      unfinished = []
    }

    const cue = pickCue({
      now: atNow,
      agenda: scheduleAgenda(atNow),
      unfinished,
      lastTalkAt: lastTalk,
      memories,
      ledger,
      options: openingOptions,
    })
    if (cue === null) {
      thoughts.recordDecision({ speak: false, gate: 'no_reason', reason: 'no_cue' })
      return null
    }
    const text = openingText(cue)
    if (text === '') {
      thoughts.recordDecision({ speak: false, gate: 'hard', reason: 'empty_text' })
      return null
    }
    ledger = recordOpening(ledger, cue, atNow)
    writeJson(openingPath, ledger)
    const thoughtId = typeof cue.key === 'string' && cue.key.startsWith('thought:')
      ? cue.key.slice('thought:'.length)
      : ''
    if (thoughtId !== '') thoughts.markUsed(thoughtId)
    thoughts.recordDecision({
      speak: true,
      source: thoughtId === '' ? cue.kind : 'thought',
      gate: 'open',
      reason: 'topic_match',
      text,
      thoughtId,
    })
    pendingOpening = { at: atNow, kind: cue.kind, text }
    return pendingOpening
  }

  /** 恢复整库备份后重新读陪伴数据，避免内存状态覆盖刚恢复的文件。 */
  async function reload() {
    bond = readJson(bondPath, normalizeBond, defaultBond(now()))
    ledger = readJson(openingPath, normalizeLedger, defaultLedger(now()))
    pendingOpening = null
    lastIntimacy = null
    await body.reload?.()
    await thoughts.reload?.()
    await intimacy.load?.()
    return snapshot()
  }

  function takeOpeningLine() {
    if (pendingOpening === null) return ''
    if (now() - pendingOpening.at > 5 * 60 * 1000) {
      pendingOpening = null
      return ''
    }
    const line = pendingOpening.text
    pendingOpening = null
    return line
  }

  function snapshot() {
    let bodySnapshot = null
    try {
      bodySnapshot = body.snapshot()
    } catch {
      bodySnapshot = null
    }
    return {
      bond: bondSummary(bond, now()),
      mood: bondMood(bond, now()),
      openings: ledgerSummary(ledger, now()),
      memoryCount: memory.snapshot().items.length,
      today: explainToday(bond, now()),
      rules: DEFAULT_BOND_RULES.map((rule) => ({ id: rule.id, label: rule.label })),
      body: bodySnapshot,
      bodyNote: lastBodyNote,
      emotion: emotion.snapshot(),
      expression: lastExpression,
      thoughts: thoughts.snapshot(),
      intimacy: {
        enabled: isIntimacyEnabled(),
        open: lastIntimacy?.open === true,
        stage: lastIntimacy?.stage ?? 'none',
        label: lastIntimacy?.label ?? '',
        reason: lastIntimacy?.reason ?? 'disabled',
        state: intimacy.snapshot(),
      },
    }
  }

  return {
    noteActivity,
    reload,
    maybeOpen,
    takeOpeningLine,
    snapshot,
    addBond,
    getRecentSessions,
    memory,
    thoughts,
    intimacyPrompt,
    filterIntimacyReply,
    intimacy,
    get bond() {
      return bond
    },
    get ledger() {
      return ledger
    },
  }
}
