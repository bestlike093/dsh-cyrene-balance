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
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { createSealedStore, sealText, unsealText } from './companion/state/sealed-store.mjs'
import { utf8Encode } from './companion/system/crypto-kit.mjs'
import {
  applyBondEvent,
  bondLevel,
  bondMood,
  bondSummary,
  bubbleTone,
  frictionBandOf,
  frictionGainFor,
  frictionDecayFor,
  createBodyService,
  createEmotionRuntime,
  createFactStore,
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
  relationStageOf,
  bumpIrritation,
  easeIrritation,
  irritationOf,
  peerBondOf,
  peerBondSummaries,
  peerKeyOf,
  withPeerBond,
  normalizeLedger,
  openingRhythmOf,
  personaHour,
  pickCue,
  recordOpening,
  scheduleAgenda,
  settleFirstImpression,
  resolveTraits,
  sensitivityScaleOf,
  irritationHalfLifeMs,
  scaleIrritationGain,
  THOUGHT_MIN_AGE_MS,
  weightOf,
} from './companion/index.mjs'

const DAY = 24 * 60 * 60 * 1000
const INITIATE_GAP = 10 * 60 * 1000

/*
 * 落盘统一走密封仓库：文件名当身份，路径只在 sealed store 内部拼。
 * 旧明文在第一次读到时自动迁移，备份留在同目录的 .plain.bak。
 */
function readJson(store, file, normalize, fallback) {
  return store.readJson(basename(file), normalize, fallback)
}

function writeJson(store, file, value) {
  try {
    return store.writeJson(basename(file), value)
  } catch {
    /* 写不进去就等下一轮，不能影响桌宠本身 */
  }
}

export function createCompanionRuntime({
  dir,
  now = () => Date.now(),
  isBondEnabled = () => true,
  isOpeningEnabled = () => true,
  /* 身体轴关掉时，不推进精力、也不把身体结论交给提示词。 */
  isBodyEnabled = () => true,
  isPetRunning = () => true,
  getSessionView = () => null,
  getRecentSessions = async () => [],
  openingOptions = {},
  memoryStore: injectedMemoryStore = null,
  factStore: injectedFactStore = null,
  bodyService: injectedBodyService = null,
  emotionRuntime: injectedEmotionRuntime = null,
  thoughtPool: injectedThoughtPool = null,
  intimacyGate: injectedIntimacyGate = null,
  sealedStore: injectedSealedStore = null,
  getSettings = () => ({}),
  getPersonaText = () => '',
  textToEmotion = null,
  log = () => {},
} = {}) {
  if (typeof dir !== 'string' || dir === '') throw new Error('companion-runtime 需要注入 dir')

  /*
   * 陪伴数据统一过密封层。下面三个模块只认得 fs 的形状，
   * 拿到的是明文，落到盘上的是密文，由这里做最后一层翻译。
   */
  const sealed =
    injectedSealedStore ??
    createSealedStore({
      dir,
      log: (message, error) => log?.(`[sealed] ${message}`, error),
    })

  function readSealed(file) {
    const text = sealed.readText(basename(file), null)
    if (text === null) {
      const error = new Error(`没有这个文件：${file}`)
      error.code = 'ENOENT'
      throw error
    }
    return text
  }

  const sealedAsyncFs = {
    async readFile(file) {
      return readSealed(file)
    },
    async writeFile(file, text) {
      sealed.writeText(basename(file), text)
    },
    async mkdir() {},
    async copyFile(from, to) {
      sealed.writeText(basename(to), readSealed(from))
    },
  }

  const sealedSyncFs = {
    readFileSync(file) {
      return readSealed(file)
    },
    writeFileSync(file, text) {
      sealed.writeText(basename(file), text)
    },
  }

  const bondPath = join(dir, 'bond.json')
  const openingPath = join(dir, 'opening.json')
  const memoryPath = join(dir, 'memory.json')
  const memory = injectedMemoryStore ?? createMemoryStore({ filePath: memoryPath, now })

  /* 结构化记忆走同一个密封口径：文件名叫 facts.json，口令和密封仓库同源。 */
  const FACT_FILE = 'facts.json'
  const facts =
    injectedFactStore ??
    createFactStore({
      filePath: join(dir, FACT_FILE),
      seal: async (value) => JSON.parse(sealText(FACT_FILE, JSON.stringify(value))),
      open: async (sealed) => utf8Encode(unsealText(FACT_FILE, JSON.stringify(sealed))),
      now,
      log: (message, error) => log?.(`[facts] ${message}`, error),
    })
  void facts.load()

  /* 身体与情绪都在共用层：这里只决定什么时候推进、什么时候把结论交给气泡。 */
  const body =
    injectedBodyService ??
    createBodyService({
      file: join(dir, 'body.json'),
      getSleepWindow: () => getSettings()?.companion?.body?.sleepWindow ?? DEFAULT_SLEEP_WINDOW,
      /* 精力掉多快跟着性格参数走 */
      getTraits: () => traitsNow(),
      fs: sealedAsyncFs,
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
      fs: sealedAsyncFs,
      now,
      log: (message, error) => log?.(`[thoughts] ${message}`, error),
    })
  void thoughts.ready()

  /*
   * 亲密层运行时：只在完整版打开。公开版由 edition.mjs 把整条模块换成关闭占位，
   * 这里再按设置开关收一道，避免私用配置被带进公开包。
   */
  const intimacy =
    injectedIntimacyGate ??
    createIntimacyGate({
      file: join(dir, 'intimacy.json'),
      fs: sealedSyncFs,
      now,
      log: (message, error) => log?.(`[intimacy] ${message}`, error),
    })
  let lastIntimacy = null
  let lastIntimacyCheckAt = 0

  let lastBodyNote = ''
  let lastExpression = null

  /* 主人一进门就在 60 以上。老数据只补这一次，之后按事件自己涨落。 */
  let bond = readJson(sealed, bondPath, normalizeBond, defaultBond(now(), 'owner'))
  if (bond.ownerStartApplied !== true) {
    bond = {
      ...bond,
      ownerStartApplied: true,
      affinity: Math.max(bond.affinity, 62),
      familiarity: Math.max(bond.familiarity, 62),
    }
    writeJson(sealed, bondPath, bond)
  }
  let ledger = readJson(sealed, openingPath, normalizeLedger, defaultLedger(now()))
  let pendingOpening = null
  let lastCheck = 0
  let lastTalk = null
  let lastInitiateAt = 0
  let seenAt = 0
  let lastEmotionText = ''
  let lastGreetDay = ''

  function addBond(type, amount) {
    const rule = DEFAULT_BOND_RULES.find((item) => item.id === type)
    if (rule === undefined) return null
    const { bond: next, applied } = applyBondEvent(bond, { type, amount }, { now: now(), gainScale: bondGainScale() })
    bond = next
    writeJson(sealed, bondPath, bond)
    return applied
  }

  /*
   * 多对象好感：群友和私聊的陌生人各存一份，跟桌面的 bond 分开。
   * 群里人来人往，谁都不该因为她对主人的亲近而受益，也不该拖累那条线。
   */
  const peerPath = join(dir, 'bonds-peers.json')
  const peerLoaded = readJson(
    sealed,
    peerPath,
    (raw) => ({
      bonds: raw?.bonds !== null && typeof raw?.bonds === 'object' ? raw.bonds : {},
      irritations:
        raw?.irritations !== null && typeof raw?.irritations === 'object' ? raw.irritations : {},
    }),
    { bonds: {}, irritations: {} },
  )
  let peerBonds = peerLoaded.bonds
  let peerIrritations = peerLoaded.irritations

  /*
   * 同伴名单：主人在设置里点名谁算主人、重要、次重要。
   * 单独存一份密文——清空好感不该把人从名单里踢掉，反过来也一样。
   * 键跟好感键同一套（qq:<openId> / qq:group:<群>:<发送者>），
   * 所以同一个人换到群里说话，仍然认得出来。
   */
  const PEER_TIER_KEYS = ['owner', 'important', 'secondary']

  function pickPeerKeys(list) {
    return (Array.isArray(list) ? list : [])
      .map((item) => (typeof item === 'string' ? item.trim().slice(0, 96) : ''))
      .filter((item) => item !== '')
      .slice(0, 200)
  }

  function normalizePeerTiers(raw) {
    const out = {}
    for (const key of PEER_TIER_KEYS) out[key] = pickPeerKeys(raw?.[key])
    return out
  }

  let peerTiers = sealed.readJson('peer-tiers.json', normalizePeerTiers, {
    owner: [],
    important: [],
    secondary: [],
  })

  /** 名单里查这一条来源属于哪一档；没点名就是 guest。 */
  function peerTierOf(source) {
    const key = peerKeyFor(source)
    if (key === '' || key === 'desktop') return 'guest'
    for (const tier of PEER_TIER_KEYS) {
      if (peerTiers[tier].includes(key)) return tier
    }
    return 'guest'
  }

  /** 来源自带档位优先；没写就让名单说话。 */
  function tierOf(source) {
    const explicit = typeof source?.tier === 'string' ? source.tier : ''
    if (explicit !== '' && explicit !== 'guest') return explicit
    return peerTierOf(source)
  }

  function getPeerTiers() {
    const out = {}
    for (const key of PEER_TIER_KEYS) out[key] = [...peerTiers[key]]
    return out
  }

  function setPeerTiers(next) {
    peerTiers = normalizePeerTiers(next)
    sealed.writeJson('peer-tiers.json', peerTiers)
    return getPeerTiers()
  }

  function writePeerState() {
    writeJson(sealed, peerPath, { bonds: peerBonds, irritations: peerIrritations })
  }

  function peerKeyFor(source) {
    return peerKeyOf('', source)
  }

  /* 见到这个人说话：前十句话先定一次第一印象，之后按事件累积。 */
  function notePeerSeen(source, amount = 1, text = '') {
    const key = peerKeyFor(source)
    if (key === '' || key === 'desktop') return null
    const tier = tierOf(source)
    let current = peerBondOf(peerBonds, key, now(), { tier })

    const line = typeof text === 'string' ? text.trim().slice(0, 120) : ''
    if (line !== '' && current.probe.done !== true) {
      current = {
        ...current,
        probe: { lines: [...current.probe.lines, line].slice(-10), done: false },
      }
      current = settleFirstImpression(current, now()).bond
    }

    const { bond: next, applied } = applyBondEvent(current, { type: 'seen', amount }, { now: now(), gainScale: bondGainScale() })
    peerBonds = withPeerBond(peerBonds, key, next, now())
    writePeerState()
    return applied
  }

  /*
   * 性格速度参数：自动值从人格文本推导，用户在设置里可以逐项覆盖。
   * 每次都重新解析，改完设置立刻生效，不用重启。
   */
  function traitsNow() {
    const cfg = getSettings()?.companionTraits
    if (cfg === null || cfg === undefined || typeof cfg !== 'object') {
      return resolveTraits({}).traits
    }
    return resolveTraits({ auto: cfg.auto, overrides: cfg.overrides }).traits
  }

  /*
   * 念旧倾向：只从人格文本推，范围 [-1, 1]，0 表示不抬不压。
   * 与 traitsNow() 分开取，免得 resolveTraits 的乘性结构把 0 变成常数。
   */
  function recallBiasNow() {
    const raw = Number(getSettings()?.companionTraits?.recallBias)
    if (!Number.isFinite(raw)) return 0
    return Math.max(-1, Math.min(1, raw))
  }

  /* 好感与熟悉各自的涨速，交给 applyBondEvent 缩放正向事件。 */
  function bondGainScale() {
    const traits = traitsNow()
    const axis = sensitivityOf('relation')
    return {
      affinity: traits.affinityGainScale * axis,
      familiarity: traits.familiarityGainScale * axis,
    }
  }

  /*
   * 主动开口的节奏：由 opennessScale 推出来。
   *
   * 换算规则放在 opening.mjs 的 openingRhythmOf 里，那边是纯函数、可以单测；
   * 这里只负责取当前性格值。间隔与额度两条各自成线，不共用乘子。
   */
  function openingOptionsNow() {
    const scale = Number(traitsNow().opennessScale)
    return { ...openingOptions, ...openingRhythmOf(scale) }
  }

  /* 四轴灵敏度：只乘事件权重，不改结构与上限。没配过就是 1。 */
  function sensitivityOf(axis) {
    return sensitivityScaleOf(getSettings()?.companionAxes?.[axis]?.sensitivity)
  }

  /* 身体能量读数：给耦合用，读不到就当平常（78）。 */
  function currentEnergy() {
    try {
      const energy = Number(body.snapshot()?.energy)
      return Number.isFinite(energy) ? energy : 78
    } catch {
      return 78
    }
  }

  /* 烦躁是短时情绪：攒得快，也会自己消，不需要每日上限。
     桌面也记一份：主人在自己电脑前最该看见她烦不烦，不能只对外人有情绪。 */
  function notePeerIrritation(source, delta, kind = 'comfort') {
    const key = peerKeyFor(source)
    if (key === '') return 0
    const slot = key === 'desktop' ? 'desktop' : key
    const traits = traitsNow()
    const halfLife = irritationHalfLifeMs(traits)
    const amount = Number(delta)
    const stamp = now()
    if (Number.isFinite(amount) && amount < 0) {
      /* 负向不再线性累减：刚被惹到的十分钟里，安抚只带走一点点；
         过了冷静期才按 kind 的比例回温，而且始终留一点余温。
         关系亲近时更容易哄好：半衰期按快照层同一口径缩短。 */
      const relationScore =
        key === 'desktop'
          ? bondLevel(bond).score
          : bondLevel(peerBondOf(peerBonds, key, stamp, { tier: tierOf(source) })).score
      const decay = frictionDecayFor(relationScore)
      const eased = easeIrritation(peerIrritations[slot], {
        kind,
        now: stamp,
        halfLifeMs: halfLife / decay,
      })
      peerIrritations = { ...peerIrritations, [slot]: eased.state }
    } else {
      /* 累了更容易被点着：涨幅按快照层同一口径放大。 */
      const gain = frictionGainFor(currentEnergy())
      const scaled =
        scaleIrritationGain(Number.isFinite(amount) ? amount : 0, traits) *
        sensitivityOf('friction') *
        gain
      peerIrritations = {
        ...peerIrritations,
        [slot]: bumpIrritation(peerIrritations[slot], scaled, stamp, halfLife),
      }
    }
    writePeerState()
    return irritationOf(peerIrritations[slot], stamp, halfLife)
  }

  /* 主人亲手调的那一下：把某个人的烦躁定到 value，不做累加。
     值域 0~100，0 就是「消气了」；写盘后返回按半衰期折算的即时值。 */
  function setPeerIrritation(source, value) {
    const key = peerKeyFor(source)
    if (key === '') return null
    const num = Number(value)
    if (!Number.isFinite(num)) return null
    const slot = key === 'desktop' ? 'desktop' : key
    const stamped = now()
    peerIrritations = {
      ...peerIrritations,
      [slot]: { value: Math.round(Math.min(100, Math.max(0, num))), at: stamped },
    }
    writePeerState()
    return irritationOf(peerIrritations[slot], stamped, irritationHalfLifeMs(traitsNow()))
  }

  /* 桌面观察台递过来的「消气 / 调整」意图。
     约定写在 dir/friction-intent.json，读完即删；同一条重复应用也是同一个值。
     只认 desktop 与 qq: 前缀，数值夹在 0~100，别的来源一律当没看见。 */
  function applyPendingFrictionIntent() {
    const file = join(dir, 'friction-intent.json')
    let raw = ''
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      return null
    }

    let applied = null
    try {
      const body = JSON.parse(raw)
      const scope = typeof body?.scope === 'string' ? body.scope.trim() : ''
      const allowed =
        scope === 'desktop' || scope.startsWith('qq:private:') || scope.startsWith('qq:group:')
      const value = Number(body?.value)
      if (allowed && Number.isFinite(value)) applied = setPeerIrritation(scope, value)
    } catch {
      /* 坏文件直接放弃，别把这一轮回复拖住 */
      return null
    }

    try {
      unlinkSync(file)
    } catch {
      /* 删不掉就算了：下次再读到同一个值是幂等的 */
    }
    return applied
  }

  /* 给提示词用：好感折算成 0~100，烦躁按半衰期回落。 */
  function peerStateFor(source) {
    const key = peerKeyFor(source)
    if (key === '' || key === 'desktop') {
      return {
        key: 'desktop',
        affinity: Math.round((bond.affinity + 100) / 2),
        familiarity: Math.round(bond.familiarity),
        irritation: irritationOf(peerIrritations.desktop, now(), irritationHalfLifeMs(traitsNow())),
        /* 关系档按同一张表算好带出去：面板和提示词读的是同一个结论。 */
        relationStage: relationStageOf(bond, now()),
        bond,
      }
    }
    const tier = tierOf(source)
    const current = peerBondOf(peerBonds, key, now(), { tier })
    return {
      key,
      affinity: Math.round((current.affinity + 100) / 2),
      familiarity: Math.round(current.familiarity),
      irritation: irritationOf(peerIrritations[key], now(), irritationHalfLifeMs(traitsNow())),
      relationStage: relationStageOf(current, now()),
      bond: current,
      tier,
    }
  }

  function peerStateList() {
    return peerBondSummaries(peerBonds, now()).map((item) => ({
      ...item,
      affinity: Math.round((item.affinity + 100) / 2),
      irritation: irritationOf(peerIrritations[item.key], now(), irritationHalfLifeMs(traitsNow())),
    }))
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
        /*
         * 桌面主会话 = 主人。第三人（群聊、QQ 远端）在上面的 scope 判定里
         * 已经被挡掉了，这一条只决定「门槛怎么算、频率给多少」。
         */
        relationKind: 'owner',
        traits: traitsNow(),
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
      return intimacy.promptFor(lastIntimacy.tone, lastIntimacy.proactive === true, lastIntimacy.ink)
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

  /* 一句话 → 关系事件。词表刻意保守：宁可漏判，也不要因为一句普通话就改动关系。
     顺序就是优先级——一句话里同时命中几个词时，只记分量更重的那个。 */
  const USER_EVENT_CUES = [
    { id: 'shareSecret', words: ['只跟你说', '没跟别人说过', '没告诉过别人', '第一个告诉你'] },
    { id: 'deepTalk', words: ['其实我一直', '说实话我', '从来没跟人', '一直没敢说'] },
    { id: 'promise', words: ['说好了', '约好了', '答应你', '以后一起'] },
    { id: 'recallPraise', words: ['你上次说', '你之前提过', '记得你说', '你跟我说过'] },
    { id: 'harshWords', words: ['滚开', '闭嘴吧', '你真烦', '别管我', '讨厌你'] },
    { id: 'praise', words: ['好厉害', '真棒', '太可爱', '喜欢你', '你真好', '好聪明'] },
    { id: 'teased', words: ['哈哈哈', '笑死', '被你逗', '太好笑了', 'hhh'] },
    { id: 'shareJoy', words: ['太好了', '我过了', '我拿到了', '搞定了', '成功了', '赢了'] },
    { id: 'sharePain', words: ['难过', '委屈', '想哭', '压力好大', '撑不住'] },
    { id: 'apologize', words: ['对不起', '抱歉', '我错了', '原谅我'] },
    { id: 'comfort', words: ['别难过', '抱抱', '不哭', '我在呢', '有我在'] },
    { id: 'soothe', words: ['别生气', '不气', '哄哄', '乖啦', '消消气'] },
    { id: 'care', words: ['好累', '累死', '熬夜', '加班', '困了', '没睡好'] },
  ]

  /* 敷衍单独判：只有整句就是「嗯」「哦」这类才算，否则「嗯，我今天……」也会被误记。 */
  function detectUserEvent(line) {
    const compact = line.replace(/\s+/g, '')
    for (const rule of USER_EVENT_CUES) {
      if (rule.words.some((word) => compact.includes(word))) return rule.id
    }
    if (compact.length > 0 && compact.length <= 4 && /^(嗯+|哦+|行吧|随便|知道了|好吧)$/.test(compact)) {
      return 'perfunctory'
    }
    return null
  }

  function noteEmotion(text) {
    const line = typeof text === 'string' ? text.trim().slice(0, 200) : ''
    if (line === '' || line === lastEmotionText) return
    lastEmotionText = line
    const hit = (words) => words.some((word) => line.includes(word))
    /* 烦躁的唯一输入：被催促、被嫌弃、被反复打断时涨；被哄、被道歉时落。
       词表刻意收窄，宁可漏判，不要因为一句普通的「好烦」就对她发火。 */
    if (hit(['闭嘴', '烦死了', '别说了', '说了多少遍', '你听不懂', '怎么又', '没用', '你笨'])) {
      notePeerIrritation('desktop', 12)
    } else if (hit(['对不起', '抱歉', '我错了', '原谅我'])) {
      /* 道歉比哄更重：分开认，回温比例不一样。 */
      notePeerIrritation('desktop', -1, 'apology')
    } else if (hit(['别生气', '不气', '消消气', '哄哄', '乖啦'])) {
      notePeerIrritation('desktop', -1, 'comfort')
    }
    const eventId = detectUserEvent(line)
    if (eventId !== null) addBond(eventId)
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
    /* 身体轴关掉：整层不推进，也不产出提示词。 */
    if (isBodyEnabled() === false) {
      lastBodyNote = ''
      return
    }
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

  /* 本地日期键，用来判断「今天第一次」；不能用 toISOString，凌晨会被算成前一天。 */
  function dayKeyOf(at) {
    const d = new Date(at)
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  }

  /* 会话文件有新动静：记一次主动来找，隔久了结算 neglect，并接住上一次开口 */
  function noteActivity(sessionAt) {
    const at = Number(sessionAt)
    if (!Number.isFinite(at) || at <= 0 || at <= seenAt) return
    const atNow = now()
    seenAt = at

    if (pendingOpening !== null && atNow - pendingOpening.at < 6 * 60 * 60 * 1000) {
      ledger = markResponse(ledger, atNow)
      writeJson(sealed, openingPath, ledger)
      pendingOpening = null
    }

    if (isBondEnabled() === false) return
    const view = getSessionView()
    const last = view?.last ?? null

    if (lastTalk !== null && at - lastTalk > 3 * DAY) {
      addBond('neglect', Math.max(1, Math.floor((at - lastTalk) / DAY)))
      addBond('comeBack')
    }
    if (last?.role === 'user') {
      noteEmotion(last.text)
      const emotionTag = detectEmotion(last.text)
      emotion.noteUserTurn({ emotion: emotionTag })
      lastExpression = emotion.decideExpression(emotionTag)
      void noteBodyTurn(last.text)

      /* 每一轮的细碎推进：回一句、当天第一次开口、深夜还在一起 */
      addBond('reply')
      const dayKey = dayKeyOf(atNow)
      if (lastGreetDay !== dayKey) {
        lastGreetDay = dayKey
        addBond('greet')
      }
      const hour = new Date(atNow).getHours()
      if (hour >= 23 || hour < 4) addBond('lateNight')
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
    /* 时段按人格时区算：机器换时区或进夏令时，「几点算深夜」不该跟着漂。 */
    const hour = personaHour(atNow)
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

    /* 很烦的时候先别开口：摩擦档 strained 时暂停，阈值用快照层同一张表。 */
    const desktopIrritation = irritationOf(
      peerIrritations.desktop,
      atNow,
      irritationHalfLifeMs(traitsNow()),
    )
    const frictionBand = frictionBandOf(desktopIrritation, traitsNow().irritationTolerance)
    if (frictionBand.key === 'strained') return null

    let memories = []
    try {
      const items = await memory.recall('', { limit: 5 })
      /*
       * 只有开口候选带念旧偏置：它只换这一层类内抽签的衰减形状。
       * recallFrom / scoreOf / pruneMemory 仍走 30 天原行为——
       * 尤其 pruneMemory 决定删不删，「想起的分量」不能变成「记忆是否存在」。
       */
      const recallBias = recallBiasNow()
      memories = items.map((item) => ({
        text: item.text,
        weight: weightOf(item, atNow, recallBias),
        key: item.id,
      }))
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
      options: openingOptionsNow(),
    })
    if (cue === null) {
      thoughts.recordDecision({ speak: false, gate: 'no_reason', reason: 'no_cue' })
      return null
    }
    /*
     * 句末温度只落在气泡这一条通道上：不进回复正文，也不补 turn 槽。
     * 温度取好感（-100~100 折成 0~1），陌生关系下不加；
     * `companion.bubbleTone = false` 时整条关掉。
     *
     * baseText 是加工前的原文，只给气泡用加工后的 text。
     * 决策记录会落盘，存原文才不会把温度痕迹写进 state、日后又回流成候选。
     */
    const baseText = openingText(cue)
    const bubbleWarmth = bondSummary(bond, atNow).affinity / 100
    const text = bubbleTone(baseText, {
      warmth: bubbleWarmth,
      enabled: getSettings()?.companion?.bubbleTone !== false,
    })
    if (text === '') {
      thoughts.recordDecision({ speak: false, gate: 'hard', reason: 'empty_text' })
      return null
    }
    ledger = recordOpening(ledger, cue, atNow)
    writeJson(sealed, openingPath, ledger)
    const thoughtId = typeof cue.key === 'string' && cue.key.startsWith('thought:')
      ? cue.key.slice('thought:'.length)
      : ''
    if (thoughtId !== '') thoughts.markUsed(thoughtId)
    thoughts.recordDecision({
      speak: true,
      source: thoughtId === '' ? cue.kind : 'thought',
      gate: 'open',
      reason: 'topic_match',
      /* text 存原文，spoken 存真正进了气泡的那句；温度只在气泡通道。 */
      text: baseText,
      spoken: text,
      thoughtId,
    })
    pendingOpening = { at: atNow, kind: cue.kind, text }
    return pendingOpening
  }

  /** 恢复整库备份后重新读陪伴数据，避免内存状态覆盖刚恢复的文件。 */
  async function reload() {
    bond = readJson(sealed, bondPath, normalizeBond, defaultBond(now()))
    ledger = readJson(sealed, openingPath, normalizeLedger, defaultLedger(now()))
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
      bodyNote: isBodyEnabled() ? lastBodyNote : '',
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
    notePeerSeen,
    notePeerIrritation,
    setPeerIrritation,
    applyPendingFrictionIntent,
    peerStateFor,
    peerStateList,
    peerTierOf,
    tierOf,
    getPeerTiers,
    setPeerTiers,
    getRecentSessions,
    memory,
    factStore: facts,
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
