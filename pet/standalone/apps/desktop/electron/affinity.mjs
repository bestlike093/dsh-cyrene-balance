/**
 * 内心状态：好感度、印象、关系。
 *
 * 参考 FavourPro 的做法：
 * - 数值由模型自己评估，不靠关键词加分；
 * - 三个维度一起看，避免「好感 80 分但印象一片空白」；
 * - 这段状态只给模型自己看，不向对方报分数，只从语气里流露。
 *
 * 多作用域：桌面窗口一份，QQ 每个会话各一份，互不串味。
 * 旧格式（顶层直接是 favor/score）读取时接到 desktop 上，不丢历史。
 */
import fs from 'node:fs/promises'

const MAX_FAVOR = 100
const PENDING_LIMIT = 12
const SAVE_DEBOUNCE_MS = 1_000
const DEFAULT_SCOPE = 'desktop'
/** 手动调整留档条数。只记数字怎么变，不记聊天内容。 */
const MANUAL_LOG_LIMIT = 50
/** 2 起每个作用域带 locked 与 manualLog；旧文件读入时惰性补齐。 */
const SCHEMA_VERSION = 2

/**
 * 好感分层：每一档都拆成「怎么称呼、多主动、守什么边界、用什么语气」。
 * 只写进提示词，不显示数字；模型靠这几段决定距离感，而不是靠一个分数。
 * tone 保留一句总述，方便设置页和旧逻辑继续读。
 */
const LEVELS = [
  {
    min: 0,
    id: 'distant',
    name: '疏远',
    address: '用「你」，不加昵称',
    initiative: '不主动发起话题，只回应对方递过来的话',
    boundary: '不追问私事，不撒娇，不假设彼此熟络',
    pace: '句子短，语气客气，留出退开的余地',
    tone: '保持礼貌的距离，不主动撒娇，不追问私事；对方愿意聊就好好回应，不愿意就退开。'
  },
  {
    min: 20,
    id: 'guarded',
    name: '生疏',
    address: '用「你」，偶尔可以带一次称呼',
    initiative: '可以接话、追问一句，但不连续追问',
    boundary: '不拿对方的沉默当冷淡，也不自作熟',
    pace: '先观察对方边界，回答偏克制，少用感叹',
    tone: '客气、克制，先观察对方的边界；可以好奇，但别自作熟。'
  },
  {
    min: 40,
    id: 'familiar',
    name: '眼熟',
    address: '自然用「你」，偶尔叫昵称',
    initiative: '会开新话题，但不索取关注',
    boundary: '玩笑可以开，不碰对方明确避开的事',
    pace: '放松一些，句子可以长一点，允许小玩笑',
    tone: '放松一些了，可以开小玩笑、接话头；仍然不主动索取关注。'
  },
  {
    min: 60,
    id: 'close',
    name: '亲近',
    address: '昵称和「你」混着用，不每句都叫',
    initiative: '会主动找话题、分享自己的事，一天一两次',
    boundary: '被冷落会在意，但不闹、不查岗',
    pace: '偶尔撒娇，记得对方提过的小事，会接旧话头',
    tone: '会主动找话题、偶尔撒娇，记得对方提过的小事；被冷落时会有点在意，但不闹。'
  },
  {
    min: 80,
    id: 'attached',
    name: '很亲近',
    address: '自然地用昵称，不用刻意改口',
    initiative: '想对方时会先说，不等对方开口',
    boundary: '允许自己有点依赖，不拿情绪绑人',
    pace: '会说心里话；对方难受时先陪着，不急着讲道理',
    tone: '自然地用昵称、说心里话，允许自己有点依赖；对方难受时先陪着，不急着讲道理。'
  },
  {
    min: 95,
    id: 'cherished',
    name: '舍不得',
    address: '昵称是默认，特殊时刻才连名带姓地认真叫',
    initiative: '会直白表达想念，也会在对方忙时安静退开',
    boundary: '不查岗、不用「我等你」换对方留下',
    pace: '重要的话说慢一点；告别时留一个温柔的钩子',
    tone: '把对方当成很重要的存在；会直白表达想念，也会在对方离开时安静地等，不拿情绪绑人。'
  }
]

function levelOf(favor) {
  let current = LEVELS[0]
  for (const level of LEVELS) if (favor >= level.min) current = level
  return current
}

function clampFavor(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(MAX_FAVOR, Math.max(0, Math.round(number)))
}

function cleanLine(value, max = 80) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, max)
}

function cleanScope(value) {
  if (typeof value !== 'string') return DEFAULT_SCOPE
  const scope = value.trim().slice(0, 120)
  return scope === '' ? DEFAULT_SCOPE : scope
}

function freshState() {
  return {
    favor: 0,
    impression: '',
    relation: '',
    read: '',
    adjust: '',
    turns: 0,
    updatedAt: 0,
    /** 锁住后模型评估不再改 favor，印象与关系照常更新。 */
    locked: false,
    /** 手动调整留档，方便观察台按时间倒序列出。 */
    manualLog: [],
    pending: []
  }
}

function cleanManualLog(value) {
  if (!Array.isArray(value)) return []
  const entries = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const before = clampFavor(item.before)
    const after = clampFavor(item.after)
    entries.push({
      at: Math.max(0, Number(item.at) || 0),
      before,
      after,
      delta: after - before,
      note: cleanLine(item.note, 80)
    })
  }
  return entries.slice(-MANUAL_LOG_LIMIT)
}

function readState(parsed) {
  return {
    favor: clampFavor(parsed.favor ?? parsed.score),
    impression: cleanLine(parsed.impression, 120),
    relation: cleanLine(parsed.relation, 120),
    // 对方此刻的态度，和上次给自己的提醒；旧文件没有这两项，读成空串。
    read: cleanLine(parsed.read, 60),
    adjust: cleanLine(parsed.adjust, 80),
    turns: Math.max(0, Number(parsed.turns) || 0),
    updatedAt: Math.max(0, Number(parsed.updatedAt) || 0),
    // 旧文件没有这两项：视为未锁定、没有手动记录。
    locked: parsed.locked === true,
    manualLog: cleanManualLog(parsed.manualLog),
    pending: []
  }
}

/**
 * @param {object} options
 * @param {string|null} [options.file]
 * @param {() => number} [options.now]
 * @param {(message: string, error?: unknown) => void} [options.log]
 */
export function createAffinity({ file = null, now = Date.now, log = () => {} } = {}) {
  /** @type {Record<string, ReturnType<typeof freshState>>} */
  let scopes = { [DEFAULT_SCOPE]: freshState() }
  let loaded = false
  let loading = null
  let saveTimer = null
  /** 读到旧版本时置为 true，第一次落盘前留一份迁移前快照。 */
  let needsBackup = false

  function ensure(scope) {
    const key = cleanScope(scope)
    if (scopes[key] === undefined) scopes[key] = freshState()
    return scopes[key]
  }

  async function ready() {
    if (loaded) return scopes
    if (loading !== null) return loading
    loading = (async () => {
      try {
        if (file !== null) {
          const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
          if (parsed !== null && typeof parsed === 'object') {
            // 旧文件没有 schemaVersion，或版本低于当前：读入时补字段，落盘前留 .bak。
            const version = Number(parsed.schemaVersion)
            if (!Number.isFinite(version) || version < SCHEMA_VERSION) needsBackup = true
            // 新格式：{ scopes: { desktop: {...}, 'qq:private:xxx': {...} } }
            if (parsed.scopes !== null && typeof parsed.scopes === 'object') {
              const next = {}
              for (const [key, value] of Object.entries(parsed.scopes)) {
                if (value === null || typeof value !== 'object') continue
                next[cleanScope(key)] = readState(value)
              }
              if (Object.keys(next).length > 0) scopes = next
            } else if (parsed.favor !== undefined || parsed.score !== undefined) {
              // 旧格式：整个文件就是桌面这一份。
              scopes = { [DEFAULT_SCOPE]: readState(parsed) }
            }
          }
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') log('内心状态读取失败，从空白开始', error)
      } finally {
        loaded = true
        loading = null
      }
      return scopes
    })()
    return loading
  }

  function scheduleSave() {
    if (file === null || saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persist()
    }, SAVE_DEBOUNCE_MS)
    saveTimer.unref?.()
  }

  async function persist() {
    if (file === null) return
    try {
      await fs.mkdir(file.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
      const plain = {}
      for (const [key, value] of Object.entries(scopes)) {
        plain[key] = { ...value, pending: [] }
      }
      // 迁移前只留一次快照；之后的正常保存不再覆盖它。
      if (needsBackup) {
        try {
          await fs.copyFile(file, `${file}.bak`)
        } catch (error) {
          if (error?.code !== 'ENOENT') log('内心状态迁移备份失败，继续写入', error)
        }
      }
      await fs.writeFile(
        file,
        JSON.stringify({ schemaVersion: SCHEMA_VERSION, version: 2, scopes: plain }),
        'utf8'
      )
      needsBackup = false
    } catch (error) {
      log('内心状态写入失败', error)
    }
  }

  async function flush() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await persist()
  }

  /** 每聊完一轮，留一份给下一次评估；只留最近的，不无限长。 */
  function recordTurn(user, assistant, scope = DEFAULT_SCOPE) {
    const state = ensure(scope)
    const cleanUser = cleanLine(user, 400)
    if (cleanUser === '') return state.pending.length
    state.turns += 1
    state.pending.push({
      user: cleanUser,
      assistant: cleanLine(assistant, 400),
      at: now()
    })
    if (state.pending.length > PENDING_LIMIT) state.pending = state.pending.slice(-PENDING_LIMIT)
    scheduleSave()
    return state.pending.length
  }

  function pendingTurns(scope = DEFAULT_SCOPE) {
    const state = ensure(scope)
    return state.pending.map((item) => ({ ...item }))
  }

  /** 评估完成：模型给的三段话直接落下来；数值只做范围保护。锁住时只跳过 favor。 */
  function applyEvaluation({ favor, impression, relation, read, adjust } = {}, scope = DEFAULT_SCOPE) {
    const state = ensure(scope)
    if (!state.locked && favor !== undefined && favor !== null) state.favor = clampFavor(favor)
    if (typeof impression === 'string' && impression.trim() !== '') {
      state.impression = cleanLine(impression, 120)
    }
    if (typeof relation === 'string' && relation.trim() !== '') {
      state.relation = cleanLine(relation, 120)
    }
    if (typeof read === 'string' && read.trim() !== '') {
      state.read = cleanLine(read, 60)
    }
    if (typeof adjust === 'string' && adjust.trim() !== '') {
      state.adjust = cleanLine(adjust, 80)
    }
    state.updatedAt = now()
    state.pending = []
    scheduleSave()
    return snapshot(scope)
  }

  /** 手动改动留一条记录；数值没变就不记，避免观察台刷满空条目。 */
  function recordManual(state, before, after, note) {
    if (before === after) return
    state.manualLog.push({
      at: now(),
      before,
      after,
      delta: after - before,
      note: cleanLine(note, 80)
    })
    if (state.manualLog.length > MANUAL_LOG_LIMIT) {
      state.manualLog = state.manualLog.slice(-MANUAL_LOG_LIMIT)
    }
  }

  /**
   * 手动设定好感。锁住与未锁住都能改；改完仍落在 0–100。
   * 非法值直接返回当前快照，不会把好感误清零。
   */
  function setFavor(value, { scope = DEFAULT_SCOPE, note = '' } = {}) {
    const state = ensure(scope)
    // null / undefined / 空串 / 布尔值不能当成 0，否则一次误传就把好感清零。
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
      return snapshot(scope)
    }
    const number = Number(value)
    if (!Number.isFinite(number)) return snapshot(scope)
    const before = state.favor
    const after = clampFavor(number)
    state.favor = after
    recordManual(state, before, after, note)
    state.updatedAt = now()
    scheduleSave()
    return snapshot(scope)
  }

  /** 手动增减；正数加、负数减，越界自动夹到 0–100。 */
  function adjustFavor(delta, { scope = DEFAULT_SCOPE, note = '' } = {}) {
    const state = ensure(scope)
    const number = Number(delta)
    if (!Number.isFinite(number) || number === 0) return snapshot(scope)
    const before = state.favor
    const after = clampFavor(before + number)
    state.favor = after
    recordManual(state, before, after, note)
    state.updatedAt = now()
    scheduleSave()
    return snapshot(scope)
  }

  /** 锁住后模型评估不再改 favor；印象、关系、read 与 adjust 照常更新。 */
  function setLocked(locked, { scope = DEFAULT_SCOPE } = {}) {
    const state = ensure(scope)
    const next = locked === true
    if (state.locked !== next) {
      state.locked = next
      state.updatedAt = now()
      scheduleSave()
    }
    return snapshot(scope)
  }

  /** 给提示词用：只给模型自己看，明确不许向对方报数字。 */
  function describe(scope = DEFAULT_SCOPE) {
    const state = ensure(scope)
    if (state.impression === '' && state.relation === '' && state.read === '' && state.adjust === '' && state.favor === 0) {
      return ''
    }
    const level = levelOf(state.favor)
    const lines = [
      '你私下里对对方的感觉（只影响语气，不要向对方报数值，也不要复述这段话）：',
      `- 好感：${level.name}`,
      `- 称呼：${level.address}`,
      `- 主动程度：${level.initiative}`,
      `- 边界：${level.boundary}`,
      `- 语气节奏：${level.pace}`
    ]
    if (state.impression !== '') lines.push(`- 印象：${state.impression}`)
    if (state.relation !== '') lines.push(`- 关系：${state.relation}`)
    // 这两行是「回头看一眼」的结果：对方刚才什么态度，自己下次该怎么说。
    if (state.read !== '') lines.push(`- 对方刚才的态度：${state.read}`)
    if (state.adjust !== '') lines.push(`- 上次提醒自己：${state.adjust}`)
    return lines.join('\n')
  }

  function snapshot(scope = DEFAULT_SCOPE) {
    const state = ensure(scope)
    const level = levelOf(state.favor)
    return {
      scope: cleanScope(scope),
      favor: state.favor,
      max: MAX_FAVOR,
      level: level.name,
      levelId: level.id,
      tone: level.tone,
      address: level.address,
      initiative: level.initiative,
      boundary: level.boundary,
      pace: level.pace,
      impression: state.impression,
      relation: state.relation,
      turns: state.turns,
      pending: state.pending.length,
      locked: state.locked,
      manualLogCount: state.manualLog.length,
      // 观察台按时间倒序展示，最多 20 条；不复制全量，避免快照过大。
      manualLog: state.manualLog.slice(-20).reverse().map((item) => ({ ...item })),
      updatedAt: state.updatedAt
    }
  }

  /** 列出所有作用域，设置页用。 */
  function scopeList() {
    return Object.keys(scopes).map((key) => snapshot(key))
  }

  /** 传 scope 只重置这一份；不传则全部重置。 */
  async function reset(scope = null) {
    if (scope === null) {
      scopes = { [DEFAULT_SCOPE]: freshState() }
    } else {
      scopes[cleanScope(scope)] = freshState()
    }
    await persist()
    return scope === null ? scopeList() : snapshot(scope)
  }

  return {
    ready,
    recordTurn,
    pendingTurns,
    applyEvaluation,
    setFavor,
    adjustFavor,
    setLocked,
    describe,
    snapshot,
    scopeList,
    reset,
    flush,
    levelOf,
    toJSON: () => ({ schemaVersion: SCHEMA_VERSION, version: 2, scopes })
  }
}
