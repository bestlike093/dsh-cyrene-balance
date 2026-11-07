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
import { createHash } from 'node:crypto'
import { cp, copyFile, link, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { cpus, freemem, homedir, hostname, totalmem } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createSessionBridge, resolveSessionId, sessionRunning, sessionTitle } from './session-bridge.js'
import { buildPersonaPrompt } from './persona.mjs'
import { detectModelSource, sanitizeModelId } from '../pet/model-pack.mjs'
import { createCompanionRuntime } from './companion-runtime.mjs'
import { createQqHost } from './qq-host.mjs'
import {
  createBackupBundle,
  createMemoryStore,
  createPlainBackup,
  decryptBackup,
  encryptBackup,
  extractMemoryCandidates,
  INTIMACY_DEFAULTS,
  inspectBackup,
  IS_PUBLIC_EDITION,
  normalizeMemory,
  parsePlainBackup,
  planSpeak,
  synthesizeSpeech
} from './companion/index.mjs'
import { normalizeAbility, playRound, summarizeAbility } from './ability.mjs'
import { createSyncBridge, createSyncEndpoint } from './sync-bridge.mjs'
import { isStaleRev, mergeStatePatch, nextRev } from './state-merge.mjs'

const PACKAGE_ID = 'dsh-cyrene-pet'
const PLUGIN_VERSION = (() => {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    const version = JSON.parse(raw)?.version
    return typeof version === 'string' ? version : ''
  } catch {
    return ''
  }
})()
const ROUTE_PREFIX = '/cyrene-pet'
/* CYRENE_PET_HOME 用于把整套存储指到临时目录，便于隔离测试；默认仍在 DSH_HOME 下 */
const STATE_DIR = process.env.CYRENE_PET_HOME
  ? resolve(process.env.CYRENE_PET_HOME)
  : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'cyrene-pet')
const STATE_PATH = join(STATE_DIR, 'state.json')
const VAULT_PATH = join(STATE_DIR, 'secret.vault.json')
const MEMORY_VAULT_PATH = join(STATE_DIR, 'memory.vault.json')
const LEGACY_MEMORY_PATH = join(STATE_DIR, 'memory.json')
const LEDGER_PATH = join(STATE_DIR, 'ledger.json')
const ABILITY_PATH = join(STATE_DIR, 'ability.json')
const MODELS_DIR = join(STATE_DIR, 'models')
const SPEECH_DIR = join(STATE_DIR, 'speech')
/* 背景图存在数据目录里，不跟发行物走：换版本、重装插件都不丢 */
const BACKGROUND_DIR = join(STATE_DIR, 'backgrounds')
/* 整库备份只收陪伴数据，密钥仓库、模型、语音缓存、日志一律不进备份。 */
const BACKUP_JSON_FILES = Object.freeze({
  bond: join(STATE_DIR, 'bond.json'),
  opening: join(STATE_DIR, 'opening.json'),
  body: join(STATE_DIR, 'body.json'),
  thoughts: join(STATE_DIR, 'thoughts.json'),
  ledger: join(STATE_DIR, 'ledger.json'),
  ability: join(STATE_DIR, 'ability.json'),
})
const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
/* 多端同步只碰陪伴数据目录；节点名取主机名，避免两台机器落到同一个 HLC 节点 */
const syncBridge = createSyncBridge({ dir: STATE_DIR, node: hostname() || 'local' })

/* 会话桥只读：发送能力未开放，send 固定返回 send-unavailable */
const sessionBridge = createSessionBridge()
let boundSessionId = null

/* 换机器就解不开：口令 = SHA256(MachineGuid | 用户名 | 版本标签) */
const VAULT_SALT_LABEL = 'cyrene-pet-vault-v1'

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const BALANCE_TTL = 30 * 1000
const HUD_TTL = 6 * 1000
const MAX_BODY_BYTES = 32 * 1024

/* 对话提问桥：单题的基础等待时长，多题按题数加时；超时就把请求交还网页卡片 */
const CONVERSATION_ASK_TIMEOUT = 45 * 1000
const CONVERSATION_ASK_STEP_TIMEOUT = 25 * 1000
/* 风险审批：决定只影响这一次，超时同样交还网页卡片 */
const APPROVAL_TIMEOUT = 60 * 1000

/* ---------------------------- 密钥仓库 ---------------------------- */

/*
 * API Key 只存在 VAULT_PATH 的密文里，state.json 里始终保持空串。
 * 口令由本机 MachineGuid + 当前用户名派生：配置被拷到别的机器就解不开。
 * 它挡的是配置文件被拷贝、同步、上传；同机同用户的进程仍可解开，README 里如实写。
 */

let secretStorePromise = null
let hasVaultKey = false
let vaultError = ''
/* normalize 是同步的，这里的值由调用点在 persist 之后统一刷进仓库 */
let pendingApiKey

/*
 * 宿主的子进程环境不保证回调一定回来：拿不到 MachineGuid 时宁可降级成
 * 「只有用户名」的口令，也不能把整条启动链挂在这里。
 */
function runCapture(file, args, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`执行 ${file} 超时（${timeoutMs}ms）`))
    }, timeoutMs)
    timer.unref?.()
    execFile(file, args, { windowsHide: true, timeout: timeoutMs }, (error, stdout) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(String(stdout))
    })
  })
}

async function machinePassword() {
  let guid = ''
  try {
    const text = await runCapture('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'])
    const line = text
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.startsWith('MachineGuid'))
    guid = line?.split(/\s+/).pop() ?? ''
  } catch {
    guid = ''
  }
  const user = process.env.USERNAME ?? process.env.USER ?? ''
  return createHash('sha256').update(`${guid}|${user}|${VAULT_SALT_LABEL}`).digest('hex')
}

async function createSecretStore() {
  const { VaultStore, VaultLlmSecretStore } = await import('./vault/index.js')
  const storage = {
    async read() {
      try {
        return await readFile(VAULT_PATH, 'utf8')
      } catch {
        return null
      }
    },
    async write(text) {
      await writeFile(VAULT_PATH, text, { mode: 0o600 })
    },
    async writeAtomic(text) {
      const temp = `${VAULT_PATH}.tmp`
      await writeFile(temp, text, { mode: 0o600 })
      await rename(temp, VAULT_PATH)
    },
  }
  const vault = new VaultStore(storage)
  await vault.unlock(await machinePassword())
  return new VaultLlmSecretStore(vault)
}

async function getSecretStore() {
  if (secretStorePromise === null) {
    secretStorePromise = createSecretStore().catch((error) => {
      secretStorePromise = null
      vaultError = error instanceof Error ? error.message : String(error)
      throw error
    })
  }
  return secretStorePromise
}

async function flushPendingApiKey() {
  if (pendingApiKey === undefined) return
  const value = pendingApiKey
  pendingApiKey = undefined
  try {
    const store = await withTimeout(getSecretStore(), 6000, null)
    if (store === null) throw new Error('加密仓库暂时不可用，密钥没有写入')
    if (value === '') {
      await store.clearApiKey()
      hasVaultKey = false
    } else {
      await store.setApiKey(value)
      hasVaultKey = true
    }
    vaultError = ''
  } catch (error) {
    vaultError = error instanceof Error ? error.message : String(error)
  }
}

/* 仓库解锁要拿 MachineGuid、读文件、解密，任一步卡住都只降级，不阻塞启动 */
function withTimeout(promise, ms, fallback) {
  const guarded = promise.catch(() => fallback)
  return Promise.race([
    guarded,
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(fallback), ms)
      timer.unref?.()
    }),
  ])
}

async function refreshVaultFlag() {
  try {
    const key = await withTimeout(
      getSecretStore().then((store) => store.getApiKey()),
      6000,
      null,
    )
    hasVaultKey = key !== null
  } catch {
    hasVaultKey = false
  }
}

/* ---------------------------- 记忆加密仓库 ---------------------------- */

/*
 * 记忆不再明文落盘：单独一个 vault 文件，口令与 API Key 仓库同源。
 * 旧版 memory.json 在第一次解锁时迁进密文，原文改名留作一次性备份。
 */
let memoryVaultPromise = null
let memoryVaultError = ''

async function createMemoryVault() {
  const { VaultStore } = await import('./vault/index.js')
  const storage = {
    async read() {
      try {
        return await readFile(MEMORY_VAULT_PATH, 'utf8')
      } catch {
        return null
      }
    },
    async write(text) {
      await writeFile(MEMORY_VAULT_PATH, text, { mode: 0o600 })
    },
    async writeAtomic(text) {
      const temp = `${MEMORY_VAULT_PATH}.tmp`
      await writeFile(temp, text, { mode: 0o600 })
      await rename(temp, MEMORY_VAULT_PATH)
    },
  }
  const vault = new VaultStore(storage)
  await vault.unlock(await machinePassword())
  await migrateLegacyMemory(vault)
  return vault
}

async function migrateLegacyMemory(vault) {
  try {
    const existing = await vault.load()
    if (existing !== null) return
    const raw = await readFile(LEGACY_MEMORY_PATH, 'utf8')
    const legacy = normalizeMemory(JSON.parse(raw))
    if (legacy.items.length === 0) return
    await vault.save(legacy)
    await rename(LEGACY_MEMORY_PATH, `${LEGACY_MEMORY_PATH}.migrated.bak`).catch(() => {})
  } catch {
    /* 没有旧文件、或旧文件读不出来：按空记忆继续 */
  }
}

async function getMemoryVault() {
  if (memoryVaultPromise === null) {
    memoryVaultPromise = createMemoryVault().catch((error) => {
      memoryVaultPromise = null
      memoryVaultError = error instanceof Error ? error.message : String(error)
      throw error
    })
  }
  return memoryVaultPromise
}

/* 交给共用记忆层的读写适配器：调用方只看到 JSON 文本，密文与解锁都在这里 */
const memoryStore = createMemoryStore({
  readText: async () => {
    const vault = await getMemoryVault()
    const data = await vault.load()
    return data === null ? null : JSON.stringify(data)
  },
  writeText: async (text) => {
    const vault = await getMemoryVault()
    await vault.save(JSON.parse(text))
    memoryVaultError = ''
  },
})

/* ---------------- QQ 官方通道：密文与宿主接线 ---------------- */

const QQ_VAULT_PATH = join(STATE_DIR, 'qq.vault.json')
let qqVaultPromise = null

async function createQqVault() {
  const { VaultStore } = await import('./vault/index.js')
  const storage = {
    async read() {
      try {
        return await readFile(QQ_VAULT_PATH, 'utf8')
      } catch {
        return null
      }
    },
    async write(text) {
      await writeFile(QQ_VAULT_PATH, text, { mode: 0o600 })
    },
    async writeAtomic(text) {
      const temp = `${QQ_VAULT_PATH}.tmp`
      await writeFile(temp, text, { mode: 0o600 })
      await rename(temp, QQ_VAULT_PATH)
    },
  }
  const vault = new VaultStore(storage)
  await vault.unlock(await machinePassword())
  return vault
}

async function getQqVault() {
  if (qqVaultPromise === null) {
    qqVaultPromise = createQqVault().catch((error) => {
      qqVaultPromise = null
      throw error
    })
  }
  return qqVaultPromise
}

async function loadQqSecret() {
  const vault = await getQqVault()
  const data = await vault.load()
  return typeof data?.appSecret === 'string' ? data.appSecret : ''
}

async function saveQqSecret(appSecret) {
  const vault = await getQqVault()
  const data = (await vault.load()) ?? {}
  await vault.save({ ...data, appSecret: String(appSecret ?? '') })
}

const qqHost = createQqHost({
  getState: () => state,
  filterText: filterOutboundText,
  loadSecret: loadQqSecret,
  saveSecret: saveQqSecret,
  onDecision: (outcome) => {
    if (approvalAsk !== null) settleApprovalAsk(approvalAsk, { kind: 'decision', outcome })
  },
  logger: {
    warn: (message) => {
      hostCtx?.logger?.warn?.(message)
      void bootLog(message)
    },
  },
})

/* ---------------------------- 启动日志 ---------------------------- */

/*
 * 桌宠起不来时，宿主日志经常拿不到。这里单独落一份 <STATE_DIR>/pet-boot.log，
 * 只记启动链路的关键节点；桌宠子进程自身的 stdout/stderr 写 pet-spawn.log。
 */

const BOOT_LOG = join(STATE_DIR, 'pet-boot.log')
const SPAWN_LOG = join(STATE_DIR, 'pet-spawn.log')

async function bootLog(message) {
  const line = `${new Date().toISOString()} pid=${process.pid} ${message}\n`
  try {
    await mkdir(STATE_DIR, { recursive: true })
    await writeFile(BOOT_LOG, line, { encoding: 'utf8', flag: 'a' })
  } catch {
    /* 日志写不进去也不影响桌宠本身 */
  }
}

function spawnLogFd() {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    return openSync(SPAWN_LOG, 'a')
  } catch {
    return 'ignore'
  }
}

const DEFAULTS = Object.freeze({
  version: 1,
  /* 乐观并发：每次写回加一；旧客户端不带 rev 时仍按合并处理 */
  rev: 0,
  enabled: true,
  nickname: '旅人',
  apiKey: '',
  balanceThreshold: 20,
  dailyLimit: 0,
  bubbleMode: 'rotate',
  ui: 'pet',
  /* 形象渲染：立绘（默认，纯静态图）/ live2d（需自备模型，公开版不带） */
  renderer: 'sprite',
  /* 自定义素材包：空 = 内置立绘；否则对应 models/<id>/ */
  modelId: '',
  modelNotice: '',
  hudDetail: 'full',
  showHud: true,
  scale: 1,
  bubbleFont: 14.5,
  bubbleRadius: 0,
  outline: 'light',
  /* 人格七段：留空回落默认，填了整段替换，额外说明追加 */
  persona: { enabled: true, sections: {}, extraPrompt: '' },
  bubbleAlpha: 0.97,
  hudAlpha: 0.93,
  askEveryMinutes: 45,
  askHandling: 'pet-all',
  asks: [],
  refreshSeconds: 30,
  poseSeconds: 60,
  soundVolume: 0.5,
  /* 换肤：三套配色，只换界面，不动素材 */
  theme: 'pink',
  /* 背景图：id 指向数据目录 backgrounds/ 里的文件，dim 是遮罩浓度 0~0.85；rotateMinutes 为 0 表示不轮换 */
  background: { id: '', dim: 0.35, rotateMinutes: 0 },
  /* 首次启动的单张向导卡；老用户迁移时视为已看过 */
  onboarded: false,
  /* 语音朗读：默认系统语音；配好本地 TTS 后走本机合成 */
  speechEnabled: false,
  speechProvider: 'system',
  ttsEndpoint: 'http://127.0.0.1:9880',
  ttsRefAudio: '',
  /* 陪伴层：好感随相处变化；主动开口按由头账本限流，两个都能单独关 */
  bondEnabled: true,
  openingEnabled: true,
  /* 亲密层：旅人版默认关，用户显式打开才生效；公开版永远不生效 */
  intimacy: {
    enabled: false,
    perDay: INTIMACY_DEFAULTS.perDay,
    cooldownHours: INTIMACY_DEFAULTS.cooldownHours,
    idleHours: INTIMACY_DEFAULTS.idleHours,
    aftercareMinutes: INTIMACY_DEFAULTS.aftercareMinutes,
  },
  /* 自动记忆：默认开；首次写入时在设置页留一条可见提示 */
  memoryEnabled: true,
  memoryFirstWriteAt: 0,
  memoryNoticeDismissed: false,
  /* 绑定会话：null = 跟随当前活动会话；选择器做好后只改这个字段 */
  boundSessionId: null,
  /* 多端同步：空令牌 = 端点关闭；配对令牌由用户自己填，不自动公开 */
  syncToken: '',
  /* QQ 官方通道：只存非敏感配置；AppSecret 在 qq.vault.json，进不了 state.json */
  qq: {
    enabled: false,
    appId: '',
    ownerOpenIds: [],
    targetKind: 'c2c',
    targetId: '',
    webhookPort: 17321,
    webhookPath: '/qq/webhook',
  },
})

const BUBBLE_MODES = ['rotate', 'info', 'talk', 'today']
/* 立绘描边：白边（默认）/ 深边 / 按亮度自动 / 不加 */
/* 界面模式：完整立绘 / 只显示审批卡片 */
const UI_MODES = ['pet', 'card']
/* 形象渲染：静态立绘（默认）/ Live2D（模型自备，公开版不带） */
const RENDERERS = ['sprite', 'live2d']
/* 换肤：粉（默认）/ 蓝 / 墨 */
const THEMES = ['pink', 'blue', 'ink']
/* 语音引擎：系统语音 / 本机 TTS */
const SPEECH_PROVIDERS = ['system', 'local']
/* 立绘描边：light 白边（默认）/ dark 深边 / auto 按亮度 / none 不加 */
const OUTLINES = ['light', 'dark', 'auto', 'none']
const HUD_DETAILS = ['full', 'simple', 'simple2']
/* 人格七段，与 companion-core/persona.mjs 的 SECTION_ORDER 一致 */
const PERSONA_SECTIONS = ['identity', 'lore', 'worldview', 'lifeview', 'values', 'manner', 'style']
/* 注入点排在主题插件 cyrene:persona（约 100）之后、工具策略（500）之前 */
const PERSONA_SECTION = 'cyrene:companion'
const PERSONA_ORDER = 150
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
let activeSessionView = null
let activeSessionAt = 0
let memoryIngestTotal = -1
let memoryIngestSession = ''
let memoryIngestPending = false
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
  void qqHost
    .pushApproval({ summary: `${pending.toolName}：${pending.reason || '需要你拍板'}` })
    .catch(() => {})
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

/*
 * 宿主活会话补全：running 优先信 sessions.get()，拿不到再让调用方回落到
 * 文件里的 turn 事件。标题只做顺手补全，不为冷启动列表额外解压历史。
 */
function hostSessionOf(id) {
  if (typeof id !== 'string' || id === '' || hostCtx === null) return null
  try {
    const sessions = hostCtx.get?.('sessions')
    if (sessions === undefined || sessions === null || typeof sessions.get !== 'function') return null
    return sessions.get(id) ?? null
  } catch {
    return null
  }
}

function applyHostSessionMeta(sessions) {
  for (const item of sessions) {
    const live = hostSessionOf(item?.id)
    if (live === null) continue
    const running = sessionRunning(live)
    if (running !== undefined) item.running = running
    if (item.title === null || item.title === undefined || item.title === '') {
      const title = sessionTitle(live)
      if (title !== '') item.title = title
    }
  }
  return sessions
}

/* 最新会话的一屏快照：给桌宠显示「她正在做什么」，5 秒内只算一次 */
async function refreshActiveSession(now = Date.now()) {
  if (now - activeSessionAt < 5000) return activeSessionView
  activeSessionAt = now

  let targetId = boundSessionId
  if (targetId === null) {
    let newest = null
    try {
      const list = await sessionBridge.listSessions()
      const all = []
      for (const workspace of list.workspaces) {
        for (const session of workspace.sessions) all.push(session)
      }
      applyHostSessionMeta(all)
      for (const session of all) {
        if (newest === null || session.updatedAt > newest.updatedAt) newest = session
      }
    } catch {
      return activeSessionView
    }
    targetId = newest?.id ?? null
  }

  if (targetId === null) {
    activeSessionView = null
    return null
  }

  try {
    const view = await sessionBridge.readSession(targetId, { limit: 8 })
    if (view !== null) {
      void ingestActiveSessionMemory(view)
      const host = hostSessionOf(view.id)
      const hostRunning = sessionRunning(host)
      activeSessionView = {
        id: view.id,
        workspace: view.workspace,
        title: view.title || sessionTitle(host) || null,
        busy: hostRunning ?? view.busy,
        updatedAt: view.updatedAt,
        total: view.total,
        last: view.last,
        messages: view.messages.slice(-4).map((item) => ({
          kind: item.kind,
          role: item.role ?? null,
          text: clampText(item.text, 160),
        })),
        tools: Array.isArray(view.tools) ? view.tools : [],
      }
    }
  } catch {
    /* 正在写入的会话读坏了就保留上一份 */
  }
  return activeSessionView
}

/*
 * 从最近的用户发言里挑出值得记住的事，落进 memory.json。
 * 只认明确的自述、偏好、近期事件和「记住……」，不把代码和闲话塞进去。
 */
async function ingestActiveSessionMemory(view) {
  if (state.memoryEnabled === false) return
  if (memoryIngestPending || view === null || !Array.isArray(view.messages)) return
  if (view.id === memoryIngestSession && view.total === memoryIngestTotal) return
  memoryIngestPending = true
  try {
    await memoryStore.load()
    const existing = new Set(
      memoryStore.snapshot().items.map((item) => `${item.slot}:${item.text}`),
    )
    const candidates = []
    for (const message of view.messages) {
      if (message?.role !== 'user' || message?.kind !== 'message') continue
      candidates.push(...extractMemoryCandidates(message.text))
    }

    let changed = false
    for (const item of candidates.slice(0, 4)) {
      const key = `${item.slot}:${item.text}`
      if (existing.has(key)) continue
      existing.add(key)
      try {
        await memoryStore.remember({ ...item, source: 'session' })
        changed = true
      } catch {
        /* 单条记不进去不挡下一条 */
      }
    }
    memoryIngestSession = view.id
    memoryIngestTotal = view.total
    if (changed) {
      /* 第一次自动写入时留一条可见记录，设置页会提示一次，可手动关掉 */
      if (!(Number(state.memoryFirstWriteAt) > 0)) {
        state.memoryFirstWriteAt = Date.now()
        await persist()
      }
      syncPromptMemory()
    }
  } catch {
    /* 会话读得到但记忆写不进去时，下一轮再说 */
  } finally {
    memoryIngestPending = false
  }
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

/**
 * 把用户挑的素材复制进 storages/cyrene-pet/models/<id>/。
 * 只做复制，不引用原始路径——用户挪走文件后桌宠不会突然白掉。
 */
async function installModel(sourcePath, name) {
  const raw = String(sourcePath ?? '').trim().replace(/^"(.*)"$/, '$1')
  if (raw === '') throw new Error('先填一个素材文件夹或文件的路径')

  const source = resolve(raw)
  let detected
  try {
    detected = detectModelSource(source)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('这个路径不存在，再确认一下？')
    throw error
  }

  const id = sanitizeModelId(name === undefined || name === '' ? basename(source) : name)
  const target = join(MODELS_DIR, id)
  await mkdir(MODELS_DIR, { recursive: true })
  await rm(target, { recursive: true, force: true })

  /* 单文件就收进目录里，统一按 <id>/<entry> 取 */
  if (detected.entry === basename(source)) {
    await mkdir(target, { recursive: true })
    await cp(source, join(target, detected.entry))
  } else {
    await cp(source, target, { recursive: true })
  }

  return { id, kind: detected.kind, entry: detected.entry }
}

function normalize(input) {
  const next = { ...state }
  if (Number.isFinite(Number(input?.rev))) next.rev = Math.max(0, Math.floor(Number(input.rev)))
  if (typeof input?.enabled === 'boolean') next.enabled = input.enabled
  if (typeof input?.nickname === 'string') {
    const nickname = clampText(input.nickname, 24)
    next.nickname = nickname === '' ? DEFAULTS.nickname : nickname
  }
  if (typeof input?.apiKey === 'string') {
    /*
     * 不明文落 state.json；只有非空输入才算「用户填了新密钥」。
     * 前端和旧 state 都会回传空字符串，那是「这次没填」的意思，
     * 不能拿它去清空仓库——之前就是这里把已经存好的 key 抹掉了。
     */
    const incoming = input.apiKey.trim().slice(0, 200)
    if (incoming !== '') pendingApiKey = incoming
    next.apiKey = ''
  }
  /* 清空密钥改成显式动作，避免空字符串被误判 */
  if (input?.clearApiKey === true) {
    pendingApiKey = ''
    next.apiKey = ''
  }
  if (input?.balanceThreshold !== undefined) {
    next.balanceThreshold = clampNumber(input.balanceThreshold, 0, 100000, DEFAULTS.balanceThreshold)
  }
  if (input?.dailyLimit !== undefined) {
    next.dailyLimit = clampNumber(input.dailyLimit, 0, 100000, DEFAULTS.dailyLimit)
  }
  if (BUBBLE_MODES.includes(input?.bubbleMode)) next.bubbleMode = input.bubbleMode
  if (UI_MODES.includes(input?.ui)) next.ui = input.ui
  if (RENDERERS.includes(input?.renderer)) next.renderer = input.renderer
  if (typeof input?.modelId === 'string') {
    const id = input.modelId.trim()
    next.modelId = /^[a-z0-9][a-z0-9-_]{0,63}$/i.test(id) ? id : ''
  }
  if (typeof input?.modelNotice === 'string') next.modelNotice = clampText(input.modelNotice, 200)
  if (HUD_DETAILS.includes(input?.hudDetail)) next.hudDetail = input.hudDetail
  if (typeof input?.showHud === 'boolean') next.showHud = input.showHud
  if (input?.scale !== undefined) next.scale = clampNumber(input.scale, 0.6, 1.8, DEFAULTS.scale)
  if (input?.bubbleFont !== undefined) {
    next.bubbleFont = clampNumber(input.bubbleFont, 11, 20, DEFAULTS.bubbleFont)
  }
  if (input?.bubbleRadius !== undefined) {
    next.bubbleRadius = clampNumber(input.bubbleRadius, 0, 18, DEFAULTS.bubbleRadius)
  }
  if (OUTLINES.includes(input?.outline)) next.outline = input.outline
  if (input?.persona !== undefined) {
    const persona = input.persona ?? {}
    const sections = {}
    for (const key of PERSONA_SECTIONS) {
      const value = persona.sections?.[key]
      if (typeof value === 'string' && value.trim() !== '') sections[key] = clampText(value, 4000)
    }
    next.persona = {
      enabled: persona.enabled !== false,
      sections,
      extraPrompt: typeof persona.extraPrompt === 'string' ? clampText(persona.extraPrompt, 2000) : '',
    }
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
  if (THEMES.includes(input?.theme)) next.theme = input.theme
  if (input?.background !== undefined && input.background !== null && typeof input.background === 'object') {
    const id = typeof input.background.id === 'string' ? input.background.id.trim() : ''
    const dim = Number(input.background.dim)
    const rotate = Number(input.background.rotateMinutes)
    next.background = {
      id: /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id) ? id : '',
      dim: Number.isFinite(dim) ? Math.min(0.85, Math.max(0, dim)) : DEFAULTS.background.dim,
      rotateMinutes: Number.isFinite(rotate) ? Math.min(240, Math.max(0, Math.round(rotate))) : 0,
    }
  }
  if (input?.intimacy !== undefined && input.intimacy !== null && typeof input.intimacy === 'object') {
    const source = input.intimacy
    next.intimacy = {
      enabled: IS_PUBLIC_EDITION ? false : source.enabled === true,
      perDay: clampNumber(source.perDay, 1, 8, DEFAULTS.intimacy.perDay),
      cooldownHours: clampNumber(source.cooldownHours, 1, 24, DEFAULTS.intimacy.cooldownHours),
      idleHours: clampNumber(source.idleHours, 1, 24, DEFAULTS.intimacy.idleHours),
      aftercareMinutes: clampNumber(source.aftercareMinutes, 5, 240, DEFAULTS.intimacy.aftercareMinutes),
    }
  }
  if (typeof input?.onboarded === 'boolean') next.onboarded = input.onboarded
  if (typeof input?.speechEnabled === 'boolean') next.speechEnabled = input.speechEnabled
  if (SPEECH_PROVIDERS.includes(input?.speechProvider)) next.speechProvider = input.speechProvider
  if (typeof input?.ttsEndpoint === 'string') {
    next.ttsEndpoint = clampText(input.ttsEndpoint, 200)
  }
  if (typeof input?.ttsRefAudio === 'string') {
    next.ttsRefAudio = clampText(input.ttsRefAudio, 500)
  }
  if (typeof input?.bondEnabled === 'boolean') next.bondEnabled = input.bondEnabled
  if (typeof input?.openingEnabled === 'boolean') next.openingEnabled = input.openingEnabled
  if (typeof input?.memoryEnabled === 'boolean') next.memoryEnabled = input.memoryEnabled
  if (input?.memoryFirstWriteAt !== undefined) {
    next.memoryFirstWriteAt = clampNumber(input.memoryFirstWriteAt, 0, Number.MAX_SAFE_INTEGER, 0)
  }
  if (typeof input?.memoryNoticeDismissed === 'boolean') {
    next.memoryNoticeDismissed = input.memoryNoticeDismissed
  }
  if (typeof input?.boundSessionId === 'string') {
    const id = input.boundSessionId.trim().slice(0, 120)
    next.boundSessionId = id === '' ? null : id
  }
  if (typeof input?.syncToken === 'string') {
    next.syncToken = clampText(input.syncToken, 128)
  }
  if (input?.qq !== undefined && input.qq !== null && typeof input.qq === 'object') {
    const source = input.qq
    const owners = Array.isArray(source.ownerOpenIds) ? source.ownerOpenIds : []
    next.qq = {
      enabled: source.enabled === true,
      appId: clampText(source.appId, 80),
      ownerOpenIds: [...new Set(owners.map((owner) => clampText(owner, 80)).filter((owner) => owner !== ''))].slice(0, 5),
      targetKind: source.targetKind === 'group' ? 'group' : 'c2c',
      targetId: clampText(source.targetId, 80),
      webhookPort: clampNumber(source.webhookPort, 1, 65535, DEFAULTS.qq.webhookPort),
      webhookPath: (() => {
        const raw = clampText(source.webhookPath, 120)
        if (raw === '') return DEFAULTS.qq.webhookPath
        const withSlash = raw.startsWith('/') ? raw : `/${raw}`
        return withSlash.replace(/\/{2,}/g, '/')
      })(),
    }
  }
  return next
}

/* 旧版 state.json 里拆开的开关，合并进对应的数值设置 */
function migrate(saved) {
  const next = { ...saved }
  if (next.askEnabled === false && next.askEveryMinutes === undefined) next.askEveryMinutes = 0
  if (next.idlePose === false && next.poseSeconds === undefined) next.poseSeconds = 0
  if (next.soundEnabled === false && next.soundVolume === undefined) next.soundVolume = 0
  /* 旧 state 没有向导标记 = 已经用过一阵子的人，不再弹首次卡片 */
  if (typeof next.onboarded !== 'boolean') next.onboarded = true
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
    const legacyKey = typeof parsed?.apiKey === 'string' ? parsed.apiKey.trim() : ''
    state = normalize({ ...DEFAULTS, ...migrate(parsed) })
    boundSessionId = state.boundSessionId ?? null
    if (legacyKey !== '') {
      /* 旧版明文：搬进密钥仓库，随后覆写 state.json 把明文抹掉 */
      pendingApiKey = legacyKey
      await flushPendingApiKey()
      await persist()
    } else {
      await refreshVaultFlag()
    }
  } catch {
    state = { ...DEFAULTS }
    boundSessionId = null
    try {
      await persist()
    } catch {
      /* 默认设置写不进去也不影响运行 */
    }
    await refreshVaultFlag()
  }
}

async function persist() {
  state = { ...state, rev: nextRev(state.rev) }
  const snapshot = JSON.stringify(state, null, 2)
  writeChain = writeChain.then(async () => {
    await mkdir(STATE_DIR, { recursive: true })
    const temp = `${STATE_PATH}.tmp`
    await writeFile(temp, snapshot, 'utf8')
    await rename(temp, STATE_PATH)
    remountPersona(hostCtx?.systemPrompt)
  })
  return writeChain
}

/* ---------------------------- 整库备份 ---------------------------- */

async function readBackupJson(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function writeBackupJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true })
  const temp = `${filePath}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, filePath)
}

/* 备份里不写 API Key、会话绑定和机器路径，避免把本机秘密带出去。 */
function settingsForBackup() {
  const next = normalize(state)
  next.apiKey = ''
  next.boundSessionId = null
  next.syncToken = ''
  return next
}

async function collectBackupData() {
  await memoryStore.load()
  const files = {}
  for (const [key, filePath] of Object.entries(BACKUP_JSON_FILES)) {
    files[key] = await readBackupJson(filePath)
  }
  return {
    settings: settingsForBackup(),
    memory: memoryStore.snapshot(),
    bond: files.bond,
    opening: files.opening,
    body: files.body,
    thoughts: files.thoughts,
    ledger: files.ledger,
    ability: files.ability,
  }
}

function backupFileName(encrypted) {
  const day = new Date().toISOString().slice(0, 10)
  return `cyrene-pet-backup-${day}.${encrypted ? 'enc.json' : 'json'}`
}

async function exportBackup(passphrase, encrypted) {
  const bundle = createBackupBundle(await collectBackupData(), {
    app: {
      package: PACKAGE_ID,
      edition: process.env.CYRENE_PET_EDITION ?? 'public',
    },
  })
  if (!encrypted) {
    return { fileName: backupFileName(false), backup: createPlainBackup(bundle) }
  }
  return { fileName: backupFileName(true), backup: await encryptBackup(bundle, passphrase) }
}

function assertRestorable(value, label) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`备份里的${label}不是可识别的对象`)
  }
  return value
}

/* 恢复整库：先校验，再一次性写入；写坏的备份不会只恢复一半。 */
async function restoreBackup(bundle) {
  const data = bundle.data
  const settings = assertRestorable(data.settings, '设置')
  const memory = assertRestorable(data.memory, '记忆')
  if (memory !== null && !Array.isArray(memory.items)) {
    throw new Error('备份里的记忆列表不可用')
  }

  if (settings !== null) {
    state = normalize({ ...DEFAULTS, ...settings, apiKey: '', boundSessionId: null })
    boundSessionId = null
    await persist()
  }

  if (memory !== null) {
    await memoryStore.replace(memory)
    syncPromptMemory()
  }

  /* 先把所有文件都验一遍，确认整份备份可用，再开始覆盖。 */
  const files = {}
  for (const [key, filePath] of Object.entries(BACKUP_JSON_FILES)) {
    const value = assertRestorable(data[key], key)
    if (value !== null) files[key] = { filePath, value }
  }

  for (const [key, entry] of Object.entries(files)) {
    if (key === 'ability') await writeAbility(entry.value)
    else {
      if (key === 'ledger') ledgerCache = null
      await writeBackupJson(entry.filePath, entry.value)
      if (key === 'ledger') ledgerCache = null
    }
  }

  try {
    await companionRuntime.reload()
  } catch {
    /* 运行时重载失败时，下一次重启仍会读到恢复后的文件 */
  }
  await writeLive()
  return {
    memoryCount: memoryStore.snapshot().items.length,
    hasSettings: settings !== null,
  }
}

/*
 * 人格 section：与主题插件的 cyrene:persona 互斥。
 * 主题已注册人格时只记一条日志，不重复注入，省得两套人设打架。
 */
let disposePersonaSection = null
/* 陪伴层记下的事：只取权重靠前的几条，拼进人格 section，让新会话也能接住上次的话 */
let promptMemoryLines = []

function remountPersona(prompt) {
  if (disposePersonaSection !== null) {
    try {
      disposePersonaSection()
    } catch {
      /* 旧 section 跟着插件 fiber 一起没了 */
    }
    disposePersonaSection = null
  }
  if (!prompt || typeof prompt.section !== 'function') return
  let themeOrder
  try {
    themeOrder = prompt.getSectionOrder?.('cyrene:persona')
  } catch {
    themeOrder = undefined
  }
  if (Number.isFinite(themeOrder)) {
    hostCtx?.logger?.info?.(`${PACKAGE_ID}: 主题插件已注入 cyrene:persona，跳过 cyrene:companion`)
    return
  }
  const { text } = buildPersonaPrompt({
    nickname: state.nickname,
    companion: { persona: state.persona },
    memories: promptMemoryLines,
  })
  const intimacyText = companionRuntime.intimacyPrompt()
  const fullText = intimacyText === '' ? text : `${text}\n\n${intimacyText}`
  try {
    disposePersonaSection = prompt.section({ name: PERSONA_SECTION, order: PERSONA_ORDER, text: fullText })
  } catch (error) {
    runtimeError = `人格注入失败：${error?.message ?? String(error)}`
  }
}

function publicState() {
  return {
    rev: state.rev ?? 0,
    version: PLUGIN_VERSION,
    enabled: state.enabled,
    petRunning: petChild !== null,
    runtimeError,
    nickname: state.nickname,
    hasKey: hasVaultKey || credentialAvailable || Boolean(process.env.DEEPSEEK_API_KEY),
    vaultError,
    balanceThreshold: state.balanceThreshold,
    dailyLimit: state.dailyLimit,
    bubbleMode: state.bubbleMode,
    ui: state.ui,
    renderer: state.renderer,
    theme: state.theme,
    background: state.background ?? { id: '', dim: 0.35 },
    onboarded: state.onboarded,
    speechProvider: state.speechProvider,
    ttsEndpoint: state.ttsEndpoint,
    ttsRefAudio: state.ttsRefAudio,
    modelId: state.modelId,
    modelNotice: state.modelNotice,
    hudDetail: state.hudDetail,
    showHud: state.showHud,
    scale: state.scale,
    askEveryMinutes: state.askEveryMinutes,
    askHandling: state.askHandling,
    asks: Array.isArray(state.asks) ? state.asks.slice(-30) : [],
    bondEnabled: state.bondEnabled,
    openingEnabled: state.openingEnabled,
    intimacy: state.intimacy,
    intimacyEdition: IS_PUBLIC_EDITION ? 'public' : 'qiqi',
    memoryEnabled: state.memoryEnabled,
    memoryFirstWriteAt: state.memoryFirstWriteAt,
    memoryNoticeDismissed: state.memoryNoticeDismissed,
    memoryVaulted: true,
    memoryVaultError,
    boundSessionId: state.boundSessionId,
    syncEnabled: state.syncToken !== '',
    /* 非敏感配置回给本机设置页；AppSecret 不在里面 */
    qq: state.qq,
    qqView: qqHost.describe(),
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

async function readAbility() {
  try {
    const raw = await readFile(ABILITY_PATH, 'utf8')
    return normalizeAbility(JSON.parse(raw))
  } catch {
    return normalizeAbility(null)
  }
}

async function writeAbility(stats) {
  await mkdir(STATE_DIR, { recursive: true })
  const temp = `${ABILITY_PATH}.tmp`
  await writeFile(temp, JSON.stringify(normalizeAbility(stats), null, 2), 'utf8')
  await rename(temp, ABILITY_PATH)
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
  /* 设置面板填的 Key 存在密钥仓库里，优先级最高 */
  try {
    const stored = await (await getSecretStore()).getApiKey()
    if (stored !== null && stored !== '') {
      hasVaultKey = true
      return stored
    }
  } catch (error) {
    vaultError = error instanceof Error ? error.message : String(error)
  }

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

function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error(`请求体超过 ${limit} 字节`))
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

/* ---------------------------- 背景图 ---------------------------- */

const BACKGROUND_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
}
const BACKGROUND_MAX_BYTES = 24 * 1024 * 1024

function safeBackgroundId(name) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name) ? name : ''
}

/* 只认数据目录里真实存在的图片；清单里没有的名字一律不发 */
async function listBackgrounds() {
  try {
    const names = await readdir(BACKGROUND_DIR)
    const items = []
    for (const name of names) {
      if (safeBackgroundId(name) === '') continue
      const type = BACKGROUND_TYPES[extname(name).toLowerCase()]
      if (type === undefined) continue
      try {
        const info = await stat(join(BACKGROUND_DIR, name))
        if (!info.isFile()) continue
        items.push({ id: name, size: info.size, type, addedAt: Math.round(info.mtimeMs) })
      } catch {
        /* 单张读不到就跳过，不影响整份清单 */
      }
    }
    items.sort((a, b) => a.addedAt - b.addedAt)
    return items
  } catch {
    return []
  }
}

async function saveBackground(body) {
  const raw = typeof body?.dataUrl === 'string' ? body.dataUrl : ''
  const match = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(raw)
  if (match === null) throw new Error('图片格式不对，请重新选择')
  const ext = Object.keys(BACKGROUND_TYPES).find((key) => BACKGROUND_TYPES[key] === match[1].toLowerCase())
  if (ext === undefined) throw new Error('只支持 PNG / JPG / GIF / WebP / AVIF')
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length === 0) throw new Error('图片是空的')
  if (bytes.length > BACKGROUND_MAX_BYTES) throw new Error('图片超过 24MB，换一张小一点的吧')
  await mkdir(BACKGROUND_DIR, { recursive: true })
  const name = `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`
  await writeFile(join(BACKGROUND_DIR, name), bytes)
  return { id: name, size: bytes.length, type: BACKGROUND_TYPES[ext] }
}

async function removeBackground(id) {
  const name = safeBackgroundId(id)
  if (name === '') throw new Error('背景名不合法')
  await rm(join(BACKGROUND_DIR, name), { force: true })
}

async function sendBackground(res, name) {
  const id = safeBackgroundId(name)
  const type = BACKGROUND_TYPES[extname(id).toLowerCase()]
  if (id === '' || type === undefined) {
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '没有这张背景' } })
    return
  }
  try {
    const file = join(BACKGROUND_DIR, id)
    const info = await stat(file)
    if (!info.isFile()) throw new Error('不是文件')
    const body = await readFile(file)
    res.statusCode = 200
    res.setHeader('content-type', type)
    res.setHeader('cache-control', 'private, max-age=300')
    res.setHeader('x-content-type-options', 'nosniff')
    res.end(body)
  } catch {
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '没有这张背景' } })
  }
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
let restartTimer = null
let commandMtime = 0
let liveRotation = 0
let forceTalkUntil = 0
let poseAt = 0
/* 桌宠提交的设置因 rev 过期被拒时，把原因带到下一次 live 里 */
let liveNotice = ''
/* 本地 TTS：每次合成给一个递增序号，客户端只播新序号，避免重复触发 */
let speechSeq = 0
let speechClip = null
let lastAutoSpeakAt = 0
/* 合成失败后静默一分钟，避免每句话都等同一个超时 */
let localTtsVetoUntil = 0

/*
 * 输出侧红线：宿主对话正文插件改不了，但凡是从插件流出去的文本
 * （气泡、主动开口、TTS、后续 QQ 通道）都先过这一道。
 */
function filterOutboundText(text) {
  const source = String(text ?? '')
  if (source === '') return source
  try {
    const result = companionRuntime.filterIntimacyReply(source)
    return typeof result?.text === 'string' ? result.text : source
  } catch {
    return source
  }
}

async function speakWithLocalTts(text, reason = 'manual') {
  const safeText = filterOutboundText(text)
  if (Date.now() < localTtsVetoUntil) {
    speechClip = { seq: ++speechSeq, at: Date.now(), url: '', reason: 'cooldown' }
    return
  }
  const plan = planSpeak({
    voice: {
      enabled: state.speechEnabled === true,
      provider: 'local',
      localUrl: state.ttsEndpoint,
      refAudioPath: state.ttsRefAudio,
      maxChars: 120,
      trigger: 'every',
      minIntervalSeconds: 0
    },
    quiet: null,
    text: safeText,
    reason,
    now: Date.now(),
    lastAutoSpeakAt
  })
  if (!plan.ok) {
    speechClip = { seq: ++speechSeq, at: Date.now(), url: '', reason: plan.reason }
    return
  }

  const result = await synthesizeSpeech({
    endpoint: plan.endpoint,
    text: plan.text,
    refAudioPath: plan.refAudioPath,
    promptLang: plan.promptLang,
    timeoutMs: 20000
  })
  if (!result.ok) {
    localTtsVetoUntil = Date.now() + 60000
    speechClip = { seq: ++speechSeq, at: Date.now(), url: '', reason: result.error, detail: result.detail }
    return
  }
  localTtsVetoUntil = 0

  const hash = createHash('sha1').update(plan.text).digest('hex').slice(0, 16)
  await mkdir(SPEECH_DIR, { recursive: true })
  const file = join(SPEECH_DIR, `${hash}.wav`)
  await writeFile(file, result.audio)
  if (plan.autoSpeakAt !== null) lastAutoSpeakAt = plan.autoSpeakAt
  speechClip = { seq: ++speechSeq, at: Date.now(), url: pathToFileURL(file).href, text: plan.text }
}
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
  if (petChild !== null || state.enabled !== true) {
    void bootLog(`startPet skip (petChild=${petChild !== null}, enabled=${state.enabled})`)
    return
  }
  void (async () => {
    try {
      await ensureRuntime()
      const fd = spawnLogFd()
      petChild = spawn(PET_EXE, ['--no-sandbox', `--user-data-dir=${STATE_DIR}`], {
        detached: true,
        stdio: ['ignore', fd, fd],
        windowsHide: true,
        env: petSpawnEnv(),
      })
      void bootLog(`startPet spawned pid=${petChild.pid}`)
      petChild.on('error', (error) => {
        void bootLog(`pet error: ${error?.message ?? String(error)}`)
      })
      petChild.on('exit', (code, signal) => {
        void bootLog(`pet exit code=${code} signal=${signal}`)
        petChild = null
      })
      petChild.unref()
      runtimeError = ''
    } catch (error) {
      runtimeError = error?.message ?? String(error)
      void bootLog(`startPet failed: ${runtimeError}`)
      hostCtx?.logger?.warn?.(`${PACKAGE_ID}: 桌宠启动失败：${runtimeError}`)
    }
  })()
}

function restartPet() {
  stopPet()
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    startPet()
  }, 600)
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

/* ---------------------------- 陪伴层 ---------------------------- */

/*
 * 好感 / 记忆 / 开口账本都落在 STATE_DIR 下的独立 JSON，不走 state.json。
 * 运行节奏本体在 companion-runtime.mjs，这里只把宿主状态注入进去。
 */
const companionRuntime = createCompanionRuntime({
  dir: STATE_DIR,
  memoryStore,
  isBondEnabled: () => state.bondEnabled !== false,
  isOpeningEnabled: () => state.openingEnabled !== false && state.enabled === true,
  isPetRunning: () => petChild !== null,
  getSessionView: () => activeSessionView,
  getSettings: () => ({
    companion: {
      emotion: state.emotionSettings ?? {},
      body: state.bodySettings ?? {},
      intimacy: state.intimacy ?? {},
    },
  }),
  getPersonaText: () =>
    buildPersonaPrompt({
      nickname: state.nickname,
      companion: { persona: state.persona },
    }).text,
  log: (message, error) => hostCtx?.logger?.warn?.(`${PACKAGE_ID}: ${message}`, error),
  getRecentSessions: async () => {
    const list = await sessionBridge.listSessions()
    const sessions = []
    for (const workspace of list.workspaces) {
      for (const session of workspace.sessions) {
        sessions.push({
          id: session.id,
          title: typeof session.title === 'string' ? session.title : '',
          updatedAt: session.updatedAt,
        })
      }
    }
    applyHostSessionMeta(sessions)
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)

    /*
     * listSessions 只读元信息，没打开过的会话拿不到标题。
     * 只给最近几条补一次标题，读完会进 bridge 缓存，不会每次重读。
     */
    const current = activeSessionView?.id ?? null
    const candidates = sessions.filter((item) => item.id !== current).slice(0, 4)
    for (const item of candidates) {
      if (item.title.trim() !== '') continue
      try {
        const full = await sessionBridge.readSession(item.id, { limit: 1 })
        if (typeof full?.title === 'string') item.title = full.title
      } catch {
        /* 读不到就交给下一条，不挡主动开口 */
      }
    }
    return sessions.filter((item) => item.title.trim() !== '')
  },
})

/* 把记忆里最靠前的几条同步进人格 section；没变化就不重挂，省得反复动系统提示 */
function refreshPromptMemoryLines() {
  let items = []
  try {
    items = companionRuntime.memory.snapshot().items
  } catch {
    items = []
  }
  const next = items
    .slice()
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        Number(b.mentions) - Number(a.mentions) ||
        Number(b.lastAt) - Number(a.lastAt),
    )
    .slice(0, 8)
    .map((item) => String(item.text).replace(/\s+/g, ' ').trim())
    .filter((text) => text !== '')
  if (next.join('\n') === promptMemoryLines.join('\n')) return false
  promptMemoryLines = next
  return true
}

function syncPromptMemory() {
  if (!refreshPromptMemoryLines()) return
  remountPersona(hostCtx?.systemPrompt)
}

function addBond(type, amount) {
  return companionRuntime.addBond(type, amount)
}

async function noteCompanionActivity(sessionAt) {
  const before = companionRuntime.intimacyPrompt()
  await companionRuntime.noteActivity(sessionAt)
  const after = companionRuntime.intimacyPrompt()
  if (before !== after) remountPersona(hostCtx?.systemPrompt)
}

async function maybeOpen() {
  await companionRuntime.maybeOpen()
}

function takeOpeningLine() {
  return filterOutboundText(companionRuntime.takeOpeningLine())
}

function companionSnapshot() {
  return companionRuntime.snapshot()
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
  /* 主动开口只在合适的时候插一句，不盖掉余额预警 */
  const opening = takeOpeningLine()

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
  } else if (opening !== '' && mode !== 'info' && mode !== 'today') {
    line = opening
    speak = true
  }

  refreshAsk()

  return {
    at: Date.now(),
    rev: state.rev ?? 0,
    notice: liveNotice,
    nickname: state.nickname,
    persona: state.persona,
    bubbleMode: mode,
    showHud: state.showHud,
    hudDetail: state.hudDetail,
    scale: state.scale,
    background: {
      id: typeof state.background?.id === 'string' ? state.background.id : '',
      dim: Number(state.background?.dim) || 0,
      rotateMinutes: Number(state.background?.rotateMinutes) || 0,
    },
    bubbleFont: state.bubbleFont,
    bubbleRadius: state.bubbleRadius,
    outline: state.outline,
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
    session: activeSessionView,
    boundSession: boundSessionId,
    emojiList,
    refreshSeconds: state.refreshSeconds,
    idlePose: Number(state.poseSeconds) > 0,
    poseSeconds: state.poseSeconds,
    soundEnabled: Number(state.soundVolume) > 0,
    soundVolume: state.soundVolume,
    speechEnabled: state.speechEnabled === true,
    speechProvider: state.speechProvider,
    speech: speechClip,
    theme: state.theme,
    onboarded: state.onboarded,
    ui: state.ui,
    renderer: state.renderer,
    modelId: state.modelId,
    modelNotice: state.modelNotice,
    hasKey: hasVaultKey || credentialAvailable || Boolean(process.env.DEEPSEEK_API_KEY),
    vaultError,
    balanceError,
    balanceThreshold: state.balanceThreshold,
    dailyLimit: state.dailyLimit,
    line: filterOutboundText(line),
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
    mood: companionSnapshot().mood,
    companion: companionSnapshot(),
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

  /* 会话快照失败不影响余额与状态栏 */
  try {
    await refreshActiveSession()
  } catch {
    /* 保留上一份 */
  }

  /* 陪伴层跟着会话节奏走：有新动静才记好感，再判断要不要主动开口 */
  let sessionAt = lastSessionAt
  try {
    sessionAt = await scanSessionActivity()
  } catch {
    /* 扫描失败就沿用上一份活动时间 */
  }
  try {
    await noteCompanionActivity(sessionAt)
  } catch {
    /* 身体与情绪结算失败不挡气泡 */
  }
  try {
    await memoryStore.load()
    syncPromptMemory()
  } catch {
    /* 记忆文件坏了也不影响气泡 */
  }
  try {
    await maybeOpen()
  } catch {
    /* 开口失败不影响余额与状态栏 */
  }

  const live = buildLive(balance, hud)
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
      /* 桌宠窗口带着读到时的 rev；对不上说明网页设置已经改过，跳过这次整块写入 */
      if (isStaleRev(command.rev, state.rev)) {
        liveNotice = '设置已经在别处更新过了，这次改动没有写入…'
        await writeLive()
        liveNotice = ''
      } else {
        const touchedTts = command.patch.speechProvider !== undefined ||
          command.patch.ttsEndpoint !== undefined ||
          command.patch.ttsRefAudio !== undefined
        const qqBefore = JSON.stringify(state.qq)
        liveNotice = ''
        state = normalize(mergeStatePatch(state, command.patch))
        if (touchedTts) localTtsVetoUntil = 0
        await persist()
        await flushPendingApiKey()
        if (command.patch.qq !== undefined && command.patch.qq !== null) {
          const secretPatch = command.patch.qq.appSecret
          if (typeof secretPatch === 'string') {
            try {
              await saveQqSecret(secretPatch)
            } catch (error) {
              liveNotice = `QQ 密文没写进去：${error?.message ?? error}`
            }
          }
          /* 配置没动就不重绑端口，免得白掉一次回调 */
          const qqChanged = JSON.stringify(state.qq) !== qqBefore || typeof secretPatch === 'string'
          if (qqChanged) await qqHost.restart()
        }
        await writeLive()
      }
    } else if (command.action === 'say') {
      forceTalkUntil = Date.now() + 6000
      await writeLive()
    } else if (command.action === 'pose') {
      poseAt = Date.now()
      await writeLive()
    } else if (command.action === 'closeness') {
      /* 主动贴近一次；每日上限由 bond 事件规则自己管，关掉好感记录时不动数据 */
      if (state.bondEnabled !== false) addBond('closeness')
      await writeLive()
    } else if (command.action === 'refresh') {
      balanceCache = null
      balanceAt = 0
      await writeLive()
    } else if (command.action === 'speak') {
      const text = clampText(command.text, 200)
      if (text !== '') await speakWithLocalTts(text, command.reason === 'auto' ? 'auto' : 'manual')
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
    } else if (command.action === 'importModel') {
      try {
        const installed = await installModel(command.path, command.name)
        state.modelId = installed.id
        state.renderer = installed.kind === 'live2d' ? 'live2d' : 'sprite'
        state.modelNotice = `已导入 ${installed.kind} 素材：${installed.id}♪`
        await persist()
        restartPet()
      } catch (error) {
        state.modelNotice = `导入没成功：${error?.message ?? error}`
        await persist()
      }
      await writeLive()
    } else if (command.action === 'resetModel') {
      state.modelId = ''
      state.renderer = 'sprite'
      state.modelNotice = '已用回内置立绘♪'
      await persist()
      restartPet()
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
export const inject = ['webServer', 'systemPrompt']

export function apply(ctx) {
  ctx.effect(() => {
    hostCtx = ctx
    return () => {
      hostCtx = null
      liveSession = null
      if (disposePersonaSection !== null) {
        try {
          disposePersonaSection()
        } catch {
          /* 已经随 fiber 卸下 */
        }
        disposePersonaSection = null
      }
    }
  }, `${PACKAGE_ID}: host context`)

  /* QQ 通道跟着插件一起起停；没配置就静默待命 */
  ctx.effect(() => {
    void ensureLoaded()
      .then(() => qqHost.start())
      .catch((error) => {
        hostCtx?.logger?.warn?.(`${PACKAGE_ID}: QQ 通道启动失败 ${error?.message ?? error}`)
      })
    return () => {
      void qqHost.stop()
    }
  }, `${PACKAGE_ID}: qq channel`)

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
    let bootTimer = null
    /* ensureLoaded 失败也要把桌宠拉起来：设置读不到就用默认值，功能先能用 */
    const boot = () => {
      ctx.logger?.info?.(
        `${PACKAGE_ID}: 已挂载（${state.nickname}，桌宠${state.enabled ? '开启' : '关闭'}${runtimeError === '' ? '' : `，运行时问题：${runtimeError}`}）`,
      )
      void bootLog(`mounted nickname=${state.nickname} enabled=${state.enabled} runtimeError=${runtimeError}`)
      remountPersona(ctx.systemPrompt)
      startPet()
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
    }

    /* 15 秒还没读完设置就先按当前状态启动，桌宠不能陪着一起等 */
    void Promise.race([
      ensureLoaded().then(() => true),
      new Promise((resolve) => {
        bootTimer = setTimeout(() => {
          bootTimer = null
          resolve(false)
        }, 15000)
        bootTimer.unref?.()
      }),
    ])
      .then((loadedOk) => {
        if (!loadedOk) void bootLog('ensureLoaded timeout after 15s, booting with current state')
        boot()
      })
      .catch((error) => {
        const message = error?.message ?? String(error)
        runtimeError = message
        void bootLog(`ensureLoaded failed: ${message}`)
        ctx.logger?.warn?.(`${PACKAGE_ID}: 设置加载失败，按默认值继续`, error)
        boot()
      })

    return () => {
      clearTimeout(bootTimer)
      bootTimer = null
      clearTimeout(restartTimer)
      restartTimer = null
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
              /* 带 rev 的客户端先对版本；对不上就拒绝，不把旧页面整份盖回来 */
              if (isStaleRev(body?.rev, state.rev)) {
                sendJson(res, 409, {
                  ok: false,
                  error: { code: 'stale', message: '设置已经在别处更新过了，刷新后再试' },
                  value: publicState(),
                })
                return
              }
              state = normalize(mergeStatePatch(state, body))
              await persist()
              await flushPendingApiKey()
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

            /* 多端同步：空令牌时端点关闭，不会在局域网里裸奔 */
            if (route.startsWith('/sync/')) {
              await ensureLoaded()
              const endpoint = createSyncEndpoint({ bridge: syncBridge, token: state.syncToken })
              const body = req.method === 'POST' ? await readJsonBody(req) : undefined
              const result = await endpoint({
                method: req.method,
                url: `${route}${url.search}`,
                headers: req.headers,
                body,
              })
              sendJson(res, result.status, result.value)
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

            /* ---------------- 会话桥（只读） ---------------- */

            if (route === '/sessions' && req.method === 'GET') {
              const value = await sessionBridge.listSessions()
              for (const workspace of value.workspaces) applyHostSessionMeta(workspace.sessions)
              sendJson(res, 200, { ok: true, value })
              return
            }

            if (route === '/sessions/recent' && req.method === 'GET') {
              const value = await companionRuntime.getRecentSessions()
              sendJson(res, 200, { ok: true, value })
              return
            }

            if (route === '/sessions/bind' && req.method === 'POST') {
              const body = await readJsonBody(req)
              const raw = typeof body?.id === 'string' ? body.id.trim() : ''
              if (raw === '') {
                boundSessionId = null
                state.boundSessionId = null
                activeSessionAt = 0
                await persist()
                sendJson(res, 200, { ok: true, value: { id: null, bound: false } })
                return
              }
              const located = await sessionBridge.locate(raw)
              if (located === null) {
                sendJson(res, 404, {
                  ok: false,
                  error: { code: 'session-not-found', message: '找不到这个会话' },
                })
                return
              }
              boundSessionId = raw
              state.boundSessionId = raw
              activeSessionAt = 0
              await persist()
              sendJson(res, 200, { ok: true, value: { id: raw, bound: true, workspace: located.workspace } })
              return
            }

            if (route === '/sessions/history' && req.method === 'GET') {
              const id = url.searchParams.get('id') ?? resolveSessionId(boundSessionId, activeSessionView?.id)
              const limit = Number(url.searchParams.get('limit') ?? '')
              const value = await sessionBridge.readSession(id, Number.isFinite(limit) && limit > 0 ? { limit } : {})
              if (value === null) {
                sendJson(res, 404, {
                  ok: false,
                  error: { code: 'session-not-found', message: '找不到这个会话' },
                })
                return
              }
              sendJson(res, 200, { ok: true, value })
              return
            }

            if (route === '/stream' && req.method === 'GET') {
              const id = url.searchParams.get('id') ?? resolveSessionId(boundSessionId, activeSessionView?.id)
              const located = await sessionBridge.locate(id)
              if (located === null) {
                sendJson(res, 404, {
                  ok: false,
                  error: { code: 'session-not-found', message: '找不到这个会话' },
                })
                return
              }
              res.writeHead(200, {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-cache, no-transform',
                connection: 'keep-alive',
                'x-accel-buffering': 'no',
              })
              res.write(`event: ready\ndata: ${JSON.stringify({ id, workspace: located.workspace })}\n\n`)
              const stop = sessionBridge.watch(
                id,
                (fresh, meta) => {
                  try {
                    if (fresh.length === 0) {
                      res.write(`event: sync\ndata: ${JSON.stringify(meta)}\n\n`)
                      return
                    }
                    res.write(`event: messages\ndata: ${JSON.stringify({ messages: fresh, total: meta.total })}\n\n`)
                  } catch {
                    /* 客户端断开 */
                  }
                },
                (error) => {
                  try {
                    res.write(`event: error\ndata: ${JSON.stringify({ message: error?.message ?? String(error) })}\n\n`)
                  } catch {
                    /* 客户端断开 */
                  }
                },
              )
              const keepAlive = setInterval(() => {
                try {
                  res.write(': ping\n\n')
                } catch {
                  /* 客户端断开 */
                }
              }, 15000)
              keepAlive.unref?.()
              req.on('close', () => {
                clearInterval(keepAlive)
                stop()
                try {
                  res.end()
                } catch {
                  /* 已经关了 */
                }
              })
              return
            }

            if (route === '/send' && req.method === 'POST') {
              /* 能力未开放：读掉 body 之后固定 501，不排队、不重试、不写假成功 */
              try {
                await readJsonBody(req)
              } catch {
                /* body 不合法也按同一结论回 */
              }
              const failure = sessionBridge.send()
              res.writeHead(501, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
              })
              res.end(
                JSON.stringify({
                  ok: false,
                  error: { code: failure.code, message: failure.reason },
                }),
              )
              return
            }

            if (route === '/companion' && req.method === 'GET') {
              await ensureLoaded()
              try {
                await memoryStore.load()
              } catch {
                /* 记忆文件坏了也照常返回好感与账本 */
              }
              sendJson(res, 200, { ok: true, ...companionSnapshot() })
              return
            }

            if (route === '/companion/ability' && req.method === 'GET') {
              const stats = await readAbility()
              sendJson(res, 200, { ok: true, stats, summary: summarizeAbility(stats) })
              return
            }

            if (route === '/companion/ability' && req.method === 'POST') {
              const body = await readJsonBody(req)
              const current = await readAbility()
              const played = playRound(current, body?.choice)
              if (played === null) throw new Error('出拳只能是 rock / paper / scissors')
              await writeAbility(played.stats)
              sendJson(res, 200, {
                ok: true,
                stats: played.stats,
                summary: summarizeAbility(played.stats),
                round: played.round,
              })
              return
            }

            if (route === '/companion/bond' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              const type = typeof body?.type === 'string' ? body.type.trim() : ''
              if (state.bondEnabled === false) throw new Error('好感记录已关闭')
              const applied = addBond(type, Number(body?.amount))
              if (applied === null) throw new Error(`未知的好感事件：${type}`)
              sendJson(res, 200, { ok: true, ...companionSnapshot() })
              return
            }

            if (route === '/companion/memory' && req.method === 'GET') {
              const items = await memoryStore.recall('', { limit: 50 })
              sendJson(res, 200, {
                ok: true,
                items: items.map((item) => ({
                  id: item.id,
                  slot: item.slot,
                  text: item.text,
                  pinned: item.pinned,
                  mentions: item.mentions,
                  lastAt: item.lastAt,
                })),
              })
              return
            }

            if (route === '/companion/memory' && req.method === 'POST') {
              const body = await readJsonBody(req)
              const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 400) : ''
              if (text === '') throw new Error('记忆内容不能为空')
              const slot = ['identity', 'preference', 'event', 'relation'].includes(body?.slot)
                ? body.slot
                : 'event'
              const memory = await memoryStore.remember({ text, slot, source: 'manual' })
              syncPromptMemory()
              sendJson(res, 200, { ok: true, count: memory.items.length })
              return
            }

            if (route === '/companion/memory/pin' && req.method === 'POST') {
              const body = await readJsonBody(req)
              const id = typeof body?.id === 'string' ? body.id.trim() : ''
              if (id === '') throw new Error('缺少要固定的记忆 id')
              const memory = await memoryStore.pin(id, body?.pinned !== false)
              syncPromptMemory()
              sendJson(res, 200, { ok: true, count: memory.items.length })
              return
            }

            if (route === '/companion/memory/forget' && req.method === 'POST') {
              const body = await readJsonBody(req)
              const id = typeof body?.id === 'string' ? body.id.trim() : ''
              if (id === '') throw new Error('缺少要忘掉的记忆 id')
              const memory = await memoryStore.forget(id)
              syncPromptMemory()
              sendJson(res, 200, { ok: true, count: memory.items.length })
              return
            }

            /* 自动记忆开关只改这两个字段，避免把公开快照整份回写丢掉密钥 / 人格设置 */
            if (route === '/companion/memory/settings' && req.method === 'POST') {
              const body = await readJsonBody(req)
              /* 带 rev 的旧页面同样要挡：别让过期的开关状态盖回较新的设置 */
              if (isStaleRev(body?.rev, state.rev)) {
                sendJson(res, 409, {
                  ok: false,
                  error: { code: 'stale', message: '设置已经在别处更新过了，刷新后再试' },
                  value: publicState(),
                })
                return
              }
              let changed = false
              if (typeof body?.enabled === 'boolean' && body.enabled !== state.memoryEnabled) {
                state.memoryEnabled = body.enabled
                changed = true
              }
              if (typeof body?.noticeDismissed === 'boolean' &&
                  body.noticeDismissed !== state.memoryNoticeDismissed) {
                state.memoryNoticeDismissed = body.noticeDismissed
                changed = true
              }
              if (changed) await persist()
              sendJson(res, 200, { ok: true, value: publicState() })
              return
            }

            /* 导出明文备份；导入时整份替换，仍走同一套清洗与容量限制 */
            if (route === '/companion/memory/export' && req.method === 'GET') {
              await memoryStore.load()
              sendJson(res, 200, {
                ok: true,
                exportedAt: Date.now(),
                memory: memoryStore.snapshot(),
              })
              return
            }

            if (route === '/companion/memory/import' && req.method === 'POST') {
              const body = await readJsonBody(req, 4 * 1024 * 1024)
              const payload = body?.memory ?? body
              if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
                throw new Error('备份里没有可用的记忆列表')
              }
              const memory = await memoryStore.replace(payload)
              syncPromptMemory()
              sendJson(res, 200, { ok: true, count: memory.items.length })
              return
            }

            /* 整库备份：加密导出、明文导出、恢复，三件事分开走 */
            if (route === '/companion/backup/export' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req, 1024 * 1024)
              const encrypted = body?.encrypted !== false
              const passphrase = typeof body?.passphrase === 'string' ? body.passphrase : ''
              const { fileName, backup } = await exportBackup(passphrase, encrypted)
              sendJson(res, 200, { ok: true, fileName, backup })
              return
            }

            if (route === '/companion/backup/restore' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req, 8 * 1024 * 1024)
              const raw = body?.backup
              const kind = inspectBackup(raw).kind
              if (kind === 'unknown') throw new Error('这不是可识别的整库备份')
              const bundle = kind === 'encrypted'
                ? await decryptBackup(raw, typeof body?.passphrase === 'string' ? body.passphrase : '')
                : parsePlainBackup(raw)
              const result = await restoreBackup(bundle)
              restartPet()
              sendJson(res, 200, { ok: true, ...result })
              return
            }

            /* 轮换本机密钥材料：数据保留，重新生成盐并重加密 */
            if (route === '/companion/vault/rotate' && req.method === 'POST') {
              await ensureLoaded()
              const password = await machinePassword()
              const secretStore = await getSecretStore()
              await secretStore.vault.rotate(password)
              const memoryVault = await getMemoryVault()
              await memoryVault.rotate(password)
              await refreshVaultFlag()
              sendJson(res, 200, { ok: true })
              return
            }

            /* ---------------- 背景图（自定义壁纸） ---------------- */

            if (route === '/backgrounds' && req.method === 'GET') {
              await ensureLoaded()
              sendJson(res, 200, {
                ok: true,
                items: await listBackgrounds(),
                active: state.background ?? { id: '', dim: 0.35 },
              })
              return
            }

            if (route === '/backgrounds' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req, 34 * 1024 * 1024)
              const item = await saveBackground(body)
              state.background = {
                id: item.id,
                dim: state.background?.dim ?? 0.35,
                rotateMinutes: state.background?.rotateMinutes ?? 0,
              }
              await persist()
              sendJson(res, 200, { ok: true, item, active: state.background })
              return
            }

            if (route === '/backgrounds/remove' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              await removeBackground(body?.id)
              if ((state.background?.id ?? '') === String(body?.id ?? '')) {
                state.background = {
                  id: '',
                  dim: state.background?.dim ?? 0.35,
                  rotateMinutes: state.background?.rotateMinutes ?? 0,
                }
                await persist()
              }
              sendJson(res, 200, { ok: true, active: state.background })
              return
            }

            if (route.startsWith('/background/') && req.method === 'GET') {
              await sendBackground(res, decodeURIComponent(route.slice('/background/'.length)))
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
