import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  net,
  shell,
  Tray,
  Menu,
  nativeImage,
  screen,
  desktopCapturer,
  powerMonitor,
  safeStorage,
  session,
  Notification
} from 'electron'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import tls from 'node:tls'
import { connect as tcpConnect } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  DecisionGateway,
  LocalLoopbackChannel,
  OwnerPolicy,
  PermissionBroker,
  RockPaperScissors,
  SessionModeGate,
  applyIncomingMessage,
  createLocalTtsProvider,
  parseOwnerAllowlist,
  segmentAt
} from '../../../packages/core/dist/index.js'
import { DEFAULT_SETTINGS } from '../../../packages/shared/dist/index.js'
import {
  AesGcmProvider,
  KeyRingVaultStore,
  MemoryVaultStorage,
  VaultClient,
  VaultServiceSecretStore,
  createVault,
  createVaultBackup,
  migrateLegacyLlmKey,
  openVaultBackup,
  restrictPermissions,
  scrubLegacyLlmKey,
  writeRestoredKeyRing
} from '../../../packages/vault/dist/index.js'
import { IPC_CHANNELS, assertChannel, createWindowOptions } from '../dist/index.js'
import { QqOfficialChannel } from '../dist/remote/qqOfficialChannel.js'
import { QqGatewayChannel } from '../dist/remote/qqGatewayChannel.js'
import { QqBotApiClient } from '../dist/remote/qqbot-api-client.js'
import { createChatService, describeSpeaker } from './chat.mjs'
import { createIntimacyGate } from './intimacy.mjs'
import {
  createPhotoStudio,
  photoMediaUrl,
  resolvePhotoFolder,
  shouldSelfieInChat,
  wantsSelfie
} from './photo-studio.mjs'
import {
  analyzeStyle,
  describeFormatAdvice,
  describeStyle,
  detectCorrection,
  extractMemeCandidates
} from './social.mjs'
import { createSocialProfileStore } from './social-profile.mjs'
import { createMemeDictionary } from './meme-dictionary.mjs'
import {
  buildProactiveNote,
  buildReviewNote,
  createProactiveGate,
  pickCloserLine,
  resolveOpeningCue,
  proactiveLimitsFromPresence
} from './proactive.mjs'
import { planMemoryRecall } from './memory-intent.mjs'
import { assertActionAllowed, assertCoinCount, needsConfirmation } from './bilibili.mjs'
import { parseSearch, parseVideoInfo, searchUrl, videoInfoUrl, playerUrl, parseSubtitleList, parseTranscript } from './bilibiliApi.mjs'
import { buildActionRequest, parseActionResponse } from './bilibiliActions.mjs'
import { signWbiUrl } from './wbi.mjs'
import { extractArticle } from './article.mjs'
import { humanTime } from './human-time.mjs'
import { importHistoryCandidates } from './history-import.mjs'
import { burstDelay, splitReply } from './reply-split.mjs'
import { createGroupReplyGate } from './group-reply-gate.mjs'
import { createGroupManners } from './group-manners.mjs'
import { classifyGroupAddress } from './group-address.mjs'
import { redactLogText } from './log-redact.mjs'
import { OCR_SCRIPT, summarizeScreenText } from './screen-reader.mjs'
import { createCompanionService } from './companion.mjs'
import { createEmotionRuntime } from './emotion-runtime.mjs'
import { createDailyBudget } from './daily-budget.mjs'
import { createOfflineReply, createRequestGate } from './request-guard.mjs'
import { createMemoryGuard } from './memory-guard.mjs'
import { createDailyPlanService } from './daily-plan.mjs'
import { createPresenceService } from './presence.mjs'
import { fetchWeather } from './presence.mjs'
import { nextMoment, localDayKey, pickUpcomingDates, renderUpcomingLine } from './moment-clock.mjs'
import { assessTiming, emptyRhythm, normalizeRhythm, recordActivity } from './timing.mjs'
import { createSystemStats } from './system-stats.mjs'
import { createAssetLibrary } from './assets.mjs'
import { createBalanceMonitor } from './balance-monitor.mjs'
import { createLedgerStore } from './balance-ledger-store.mjs'
import { describeBalance, describeSystem } from './environment-note.mjs'
import { describeAnniversaries } from './anniversary.mjs'
import { createGameDailyService } from './game-daily.mjs'
import { createGameDailyStore } from './game-daily-store.mjs'
import { createGameAssistantService } from './game-assistant.mjs'
import { readSlices, systemTimeZone } from './balance-ledger.mjs'
import { createMemoryStore } from './memory.mjs'
import { createEmbeddingService } from './embedding.mjs'
import { DEFAULT_SLEEP_WINDOW, createBodyService } from './body-state.mjs'
import { createModelStore } from './models.mjs'
import { createPackStore } from './packs.mjs'
import { createStickerInbox } from './sticker-inbox.mjs'
import { createStickerLibrary } from './sticker-library.mjs'
import { createAffinity } from './affinity.mjs'
import { THOUGHT_MIN_AGE_MS, createThoughtPool } from './thoughts.mjs'
import { createAgendaRuntime } from './agenda-runtime.mjs'
import { canHandoff, createHandoffStore, summarizeHandoffTopic } from './handoff.mjs'
import { createInsightService } from './insight.mjs'
import { createFactStore } from './memory-facts.mjs'
import { createSpeechHabitStore } from './speech-habits.mjs'
import { createInnerStateService } from './inner-state.mjs'
import { buildPersonaPrompt } from './persona.mjs'
import { buildDailyReview, localDateKey, renderSummary, writeDailyReview } from './daily-review.mjs'
import {
  buildReflection,
  renderReflectionMarkdown,
  sanitizeReflectionText,
  writeReflection
} from './reflection.mjs'
import { isLoopbackEndpoint, planSpeak, probeTtsEndpoint, toTtsEndpoint } from './voice-service.mjs'
import { createSettingsSync } from './sync.mjs'
import { SYNC_SECRET_FIELD, SYNC_SECRET_SERVICE } from './syncCrypto.mjs'
import { createDshSpeechWatcher } from './dsh-speech.mjs'
import { toSpokenLine } from './dsh-speech-voice.mjs'
import {
  mergeLayer,
  sanitizeSettingsPatch,
  SETTINGS_TOP_KEYS
} from '../dist/main/settings-patch.js'
import { quietModeAt } from '../dist/main/quiet-mode.js'
import { clampBoundsToWorkArea, dockBoundsToBottomRight } from '../dist/main/window-bounds.js'
import { presenceIntervalMs } from '../dist/main/state.js'
import { describeError } from '../dist/main/error.js'
import { buildMemoryDigest } from '../dist/main/memory.js'
import { registerQueryChannels } from '../dist/main/ipc/queries.js'
import { registerVoiceChannels } from '../dist/main/ipc/voice.js'
import { registerMutationChannels, runBackup } from '../dist/main/ipc/mutations.js'
import { registerModelChannels } from '../dist/main/ipc/models.js'
import { registerMemoryChannels } from '../dist/main/ipc/memory.js'
import { registerVaultChannels } from '../dist/main/ipc/vault.js'
import { registerBackupChannels } from '../dist/main/ipc/backup.js'
import { registerSecretChannels } from '../dist/main/ipc/secrets.js'
import { registerChatChannels } from '../dist/main/ipc/chat.js'
import { registerCompanionAgendaChannels } from '../dist/main/ipc/companion.js'
import { registerInsightChannels } from '../dist/main/ipc/insight.js'
import { registerSyncChannels } from '../dist/main/ipc/sync.js'
import { registerDiagnosticsChannels } from '../dist/main/ipc/diagnostics.js'
import { registerWakeVoiceChannels } from '../dist/main/ipc/wake-voice.js'
import { createAsrBackend } from './asr-backend.mjs'
import { assessmentSchema, compareAssessments, scoreAssessment } from '../../../../../lib/companion/persona/persona-assessment.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 单实例锁。
 *
 * 桌宠常驻托盘，双开会同时抢 settings.json、memory.bin、状态栏采样和
 * webhook 端口；第二个实例只会让「设置莫名其妙回滚」。拿不到锁就直接退出，
 * 由 whenReady 里的单实例判断兜住后续装配。
 */
const singleInstanceLock = app.requestSingleInstanceLock()
if (!singleInstanceLock) app.quit()

// Windows 靠这个 ID 把通知、任务栏分组、托盘归到桌宠自己名下；不设会落到 electron.exe。
app.setAppUserModelId('com.dshpet.desktop')

/**
 * 开发期环境变量开关。
 *
 * PET_* / QQ_BOT_* 能改媒体根、同步目录和 QQ 凭据来源，等于一条绕过设置页的
 * 接管路径。打包版一律不认，只有未打包且显式 PET_DEV_MODE=1 时才生效。
 */
const devEnvEnabled = !app.isPackaged && process.env.PET_DEV_MODE === '1'
function devEnv(name, fallback = '') {
  if (!devEnvEnabled) return fallback
  const value = process.env[name]
  return typeof value === 'string' && value !== '' ? value : fallback
}

const userData = app.getPath('userData')
const settingsPath = path.join(userData, 'settings.json')

/**
 * 同步目录与最近一次导出 / 合并时间。
 * 和 backup-prefs 同构：路径偏好不进 settings.json，也就不进同步包本身。
 */
const syncPrefsFile = path.join(userData, 'sync-prefs.json')
let syncPrefsCache = null
const statePath = path.join(userData, 'state.json')
const taskLogPath = path.join(userData, 'tasks.log')
const vaultKeysPath = path.join(userData, 'vault-keys.json')
const vaultStatePath = path.join(userData, 'vault-state.json')
const secretsPath = path.join(userData, 'secrets.bin')
const balanceLedgerPath = path.join(userData, 'balance-ledger.json')
/** 每日巡视与反思都只写这两个目录，路径不接受渲染侧传入。 */
const reportsDir = path.join(userData, 'reports')
const reflectionDir = path.join(userData, 'notes', 'reflection')
/** 当天记忆起点，用来算「今天新增了几条」；跨天自动换基线。 */
const dailyStatePath = path.join(userData, 'daily-state.json')
/** 聊过的内容加密后存这里；没有加密仓库就不写，明文不落盘。 */
const memoryPath = path.join(userData, 'memory.bin')
/** 聊天窗口的历史单独一份：记忆是给模型的摘要，历史是给用户回看的记录。 */
const chatHistoryPath = path.join(userData, 'chat.bin')
/** 陪伴层状态：心情、断言记忆、话头、最近用过的表情。同样只在加密仓库可用时落盘。 */
const companionPath = path.join(userData, 'companion.bin')
/** 猜拳战绩只存四个计数，坏了整体丢弃，不影响启动。 */
const rpsStatePath = path.join(userData, 'rps-state.json')

// 余额只查一个端点，硬编码在这里，不开放给渲染侧传 URL。
const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance'
const BALANCE_SERVICE = 'deepseek'
const BALANCE_FIELD = 'api_key'

/**
 * 媒体根目录：Live2D 模型所在的父目录。
 *
 * 模型由使用者自己从作者处下载后导入，统一放在 userData/models，
 * 这样卸载重装、换版本都不会丢，也不受安装目录写权限限制。
 * PET_MEDIA_ROOT 只用于开发期临时指到别处。
 *
 * 渲染进程永远拿不到真实绝对路径，只能经 pet-media://model/<相对路径> 访问，
 * 这样即使模型目录里有别的东西，页面也读不到。
 */
const mediaRoot = devEnv('PET_MEDIA_ROOT') || path.join(userData, 'models')

/**
 * 随包素材根：开发时是仓库根 assets/，打包后是 app 根 assets/。
 * electron-builder.yml 里 assets/** 已按这个位置写死，两边必须一致。
 */
/** DSH 插件版运行根是 pet/，素材在 pet/standalone/assets；独立版直接跑时在根 assets。 */
const bundledAssetsRoot = path.join(app.getAppPath(), 'standalone', 'assets')
const assetsRoot = fsSync.existsSync(bundledAssetsRoot)
  ? bundledAssetsRoot
  : path.join(app.getAppPath(), 'assets')

/**
 * 应用图标：Cyrene 自绘素材（来源见 assets/ATTRIBUTION.md）。
 * 窗口与任务栏都用它，读不到时交给 Electron 回落到可执行文件图标。
 */
const appIconPath = path.join(assetsRoot, 'cyrene', 'icons', 'app-cyrene.png')

/** 随包素材清单：扫目录、拼 pet-media://asset 地址，逻辑放在 assets.mjs。 */
const assetLibrary = createAssetLibrary({ root: assetsRoot })

/** Live2D 模型库：扫描 / 导入 / 校验都在这里，主进程只做接线。 */
const modelStore = createModelStore({ root: mediaRoot, log })

/**
 * 用户导入的静态素材（字体 / 图标 / 气泡 / 表情），与 models 目录严格分开。
 * PET_PACKS_ROOT 只用于开发期临时指到别处。
 */
const packsRoot = devEnv('PET_PACKS_ROOT') || path.join(userData, 'packs')

/**
 * 照片目录：拍照模块创建时填进来，媒体协议按这个根读图。
 * 先声明成可变量，是因为协议注册比拍照模块更早。
 */
let photoRootDir = ''
/** 内置素材包跟 assets 走：开发时在仓库根，打包后在 asar 内的 app 根。 */
const builtinPacksRoot = devEnv('PET_BUILTIN_PACKS_ROOT') || path.join(assetsRoot, 'packs')
const packStore = createPackStore({ root: packsRoot, builtinRoot: builtinPacksRoot, log })
/** QQ 偷来的表情包先落这里，用户确认后才进素材包。 */
const stickerInbox = createStickerInbox({ root: packsRoot, log })
void stickerInbox.ensure().catch((error) => log('[boot] 表情收件箱初始化失败：', String(error?.message ?? error)))

/**
 * 表情库：只用 Cyrene 自己的两套素材。
 * - cyrene/sticker：气泡小图（数钱、摸摸头）
 * - sticker-packs/cyrene-agent：整套情绪表情
 * 用户素材包仍保留扫描，但只用于解析历史图片，不进预览、不参与聊天挑图。
 */
const stickerLibrary = createStickerLibrary({
  roots: [
    {
      id: 'builtin-cyrene-sticker',
      source: 'builtin',
      packId: 'cyrene-sticker',
      packName: 'Cyrene 小贴纸',
      dir: path.join(assetsRoot, 'cyrene', 'sticker'),
      prefix: 'cyrene/sticker'
    },
    {
      id: 'builtin-cyrene-agent',
      source: 'builtin',
      packId: 'cyrene-agent',
      packName: 'Cyrene 表情包',
      dir: path.join(assetsRoot, 'sticker-packs', 'cyrene-agent'),
      prefix: 'sticker-packs/cyrene-agent'
    },
    // QQ 偷来的表情：只参与聊天挑图，不在预览里重复列一遍素材包。
    {
      id: 'pack',
      source: 'pack',
      packId: 'qq-auto',
      packName: 'QQ 偷来的',
      dir: path.join(packsRoot, 'qq-auto'),
      prefix: 'qq-auto',
      listed: false,
      chat: true
    },
    // 只在历史消息里还引用着旧 id 时兜底解析，
    // 不进预览、不参与挑图，避免老会话里的表情变成破图。
    {
      id: 'builtin-cyrene-stand',
      source: 'builtin',
      dir: path.join(assetsRoot, 'cyrene', 'stand'),
      prefix: 'cyrene/stand',
      listed: false,
      chat: false
    },
    {
      id: 'pack',
      source: 'pack',
      packName: '用户素材',
      dir: packsRoot,
      prefix: '',
      listed: false,
      chat: false
    }
  ],
  log
})

/**
 * 好感度：只记一起说过多少话，用来调语气。
 * 落在 userData/affinity.json；读不到就从「初识」开始，不影响聊天。
 */
const affinity = createAffinity({
  file: path.join(userData, 'affinity.json'),
  log
})

/**
 * 念头池与「正在陪对方」这段时间的状态。
 *
 * 两份都只在观察台里被读到：念头池留她攒下的、还没说出口的话；
 * 日程状态记「这一次陪伴到几点结束」。落盘失败不影响聊天。
 */
const thoughtPool = createThoughtPool({
  file: path.join(userData, 'thoughts.json'),
  log
})

const agendaRuntime = createAgendaRuntime({
  file: path.join(userData, 'agenda-runtime.json'),
  log
})
void agendaRuntime.ready().catch((error) => log('[boot] 日程运行时初始化失败：', String(error?.message ?? error)))

const handoffStore = createHandoffStore({
  file: path.join(userData, 'handoff.json'),
  log
})
void handoffStore.ready().catch((error) => log('[boot] 承接记录初始化失败：', String(error?.message ?? error)))
/** 刚切过去、还没把承接说出口的那个窗口；只说一次，不反复提醒。 */
let pendingHandoffScope = ''

/**
 * 结构化记忆：偏好、人物、项目、约定。
 * 和原始对话分开存：原文用来回看，事实用来在以后的对话里被想起。
 */
const factStore = createFactStore({
  filePath: path.join(userData, 'memory-facts.bin'),
  getMaxFacts: () => settings?.companion?.memory?.maxItems,
  seal: async (value) => {
    if (vaultClient === null) throw new Error('vault 未就绪，拒绝以明文写结构化记忆')
    return await vaultClient.seal(value, { kind: 'envelope' })
  },
  open: async (sealed) => {
    if (vaultClient === null) throw new Error('vault 未就绪，拒绝读取结构化记忆')
    return await vaultClient.open(sealed)
  },
  now: Date.now,
  log
})

/**
 * 说话习惯：只听她自己的句子，学一点语气和打字节奏。
 * 只落统计，不落原句；群聊按群维度累计。
 */
const speechHabits = createSpeechHabitStore({
  filePath: path.join(userData, 'speech-habits.bin'),
  // 旧的明文文件：读到就接过来，落盘换成密文后再删掉。
  legacyPath: path.join(userData, 'speech-habits.json'),
  now: Date.now,
  log,
  // 和结构化记忆同一把信封：习惯画像也不留明文在磁盘上。
  seal: async (value) => {
    if (vaultClient === null) throw new Error('vault 未就绪，拒绝以明文写说话习惯')
    return await vaultClient.seal(value, { kind: 'envelope' })
  },
  open: async (sealed) => {
    if (vaultClient === null) throw new Error('vault 未就绪，拒绝读取说话习惯')
    return await vaultClient.open(sealed)
  }
})

/**
 * 群聊格式画像：只落统计结果，不落原句。
 * 重启后仍能接着用上次学到的节奏；旧画像按 7 天衰减，不会一直停在过去。
 */
const socialProfileStore = createSocialProfileStore({
  filePath: path.join(userData, 'social-profile.json'),
  now: Date.now,
  log
})

/**
 * 群梗词典：记「见过 / 用过 / 有人接 / 被反问」四件事。
 * 含义判断留给模型，这里只按使用效果排可用度，被反复反问的梗自动退役。
 */
const memeDictionary = createMemeDictionary({
  filePath: path.join(userData, 'meme-dictionary.json'),
  now: Date.now,
  log
})
const innerStateService = createInnerStateService({
  getSettings: () => settings,
  getApiKey: async () => {
    const store = requireSecretStore()
    return await store.get(BALANCE_SERVICE, BALANCE_FIELD)
  },
  relationship: affinity,
  facts: factStore,
  now: Date.now,
  fetchImpl: (url, init) => net.fetch(url, init),
  log
})
/** 本机设置同步：只写 userData/sync（或 PET_SYNC_DIR），不连远端端点。 */
let settingsSync = null

// 必须在 app ready 之前声明权限，否则 fetch / img 会把 pet-media 判成不透明来源。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pet-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

let settings = DEFAULT_SETTINGS
let win = null

/** 第二个实例被拦住后，把已经存在的桌宠窗口叫到前面。 */
app.on('second-instance', () => {
  if (win === null || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

let tray = null
let gateway = null
let qq = null
/**
 * 语音唤醒：运行时按需下载，默认关闭。
 * 只持有状态与下载器；麦克风权限看它的 isEnabled()，关掉即恢复默认拒绝。
 */
let wakeVoice = null
/** 语音输入后端；麦克风窗口只在开关打开时存在。 */
let asr = null
let micWin = null
/** 权限检查是同步的，开关状态先落在这个变量里。 */
let asrMicEnabled = false
let webhookServer = null
/**
 * QQ 运行状态：设置页只读，不参与决策。
 * state: off（未启用）/ starting（正在连）/ ready（可用）/ error（配置或连接失败）
 */
const qqRuntime = {
  enabled: false,
  transport: 'gateway',
  state: 'off',
  reason: '',
  webhookListening: false,
  webhookPort: 0,
  webhookError: '',
  /**
   * 观察模式：凭据齐全但主人名单为空时，先连上网关记录来源。
   * 此时可以收消息、不能拍板，用户绑定 openid 后自动退出观察模式。
   */
  observeOnly: false,
  /** 最近一条入站消息的发送者 openid；设置页用它做一键绑定。 */
  lastInboundOpenId: '',
  lastInboundAt: 0
}
function setQqRuntime(patch) {
  Object.assign(qqRuntime, patch)
}
let sessionIdleTimer = null
/** 装配失败时保持 null；IPC 会明确报错，不静默降级。 */
let vault = null
/** 启动时密钥环重建/隔离的提示；只在主界面加载完成后送一次。 */
let vaultStartupNotice = null
let vaultNoticeDelivered = false
/** seal / open 的唯一出口；vault 失败时保持 null，记忆宁可不写也不退回明文。 */
let vaultClient = null
let secretStore = null
/**
 * 旧密钥迁移失败的原因；非 null 表示 settings.json 里可能还留着明文 Key。
 * 一旦置上就不能自己消失：只有下一次迁移成功才清空，避免「重启一次看着就没事了」。
 */
let legacyKeyMigrationWarning = null
/** 独立设置窗；单例，关闭后置回 null。 */
let settingsWin = null
/** 游戏页；单例。排班与记录从设置窗里独立出来，避免设置页无限变长。 */
let gameWin = null
/** 弹幕层：全屏透明、不吃鼠标，只负责把字横着放过去。 */
let danmakuWin = null
/** 陪看窗：一个普通浏览器窗，只允许停在 B 站域名里。 */
let biliWin = null
/** 能力中心；单例。 */
let abilityWin = null
/** 观察台；单例。 */
let insightWin = null
let memoryConsoleWin = null
/** 表情包预览页；单例，和审核队列共用一份磁盘真相。 */
let stickerWin = null
/** 背景库独立页；单例，和 DSH 插件共用 userData/backgrounds 目录。 */
let backgroundsWin = null
/** 会话页；聊天历史与 QQ 会话合并在一页，单例。 */
let sessionsWin = null
/** 猜拳战绩只留内存：小游戏没有跨会话留存的价值，重启即清。 */
/** 猜拳战绩：内存一份，落盘一份；非自洽数据整体忽略。 */
const rpsGame = new RockPaperScissors()

async function loadRpsStats() {
  try {
    const raw = await fs.readFile(rpsStatePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!rpsGame.restore(parsed)) log('[rps] 战绩不自洽，已忽略：', rpsStatePath)
  } catch (error) {
    // 首次启动没有文件是正常情况，不吵。
    if (error?.code !== 'ENOENT') log('[rps] 战绩读取失败：', error?.message ?? error)
  }
}

async function saveRpsStats() {
  try {
    await fs.writeFile(rpsStatePath, JSON.stringify(rpsGame.stats), 'utf8')
  } catch (error) {
    // 写不进去不影响出拳，只记一条。
    log('[rps] 战绩写入失败：', error?.message ?? error)
  }
}
/** 首次引导窗；也是单例，走完或关掉后置回 null。 */
let onboardingWin = null
/** 主窗口渲染侧的实时状态，由 renderer 定时上报，供设置窗展示诊断。 */
let lastRenderInfo = null
/** 聊天窗；单例，关闭后置回 null。 */
let chatWin = null

// mergeLayer / sanitizeSettingsPatch / SETTINGS_TOP_KEYS 已迁到 src/main/settings-patch.ts。

/** 记忆：加密落盘 + 提示词片段。未启用时只在内存里留历史。 */
const memoryStore = createMemoryStore({
  filePath: memoryPath,
  getMaxItems: () => settings?.companion?.memory?.maxItems,
  seal: async (value) => {
    if (vaultClient === null) throw new Error('vault 未就绪，拒绝以明文写记忆')
    return await vaultClient.seal(value, { kind: 'envelope' })
  },
  open: async (sealed) => {
    if (vaultClient === null) throw new Error('vault 未就绪，无法读取记忆')
    // 轮换密钥后旧记忆的 keyEpoch 会落后，但仍要能读：keyId 还在 ring 里。
    return await vaultClient.open(sealed, { allowLegacyEpoch: true })
  },
  log
})

function memoryEnabled() {
  return settings?.companion?.memory?.enabled === true
}

/**
 * 向量检索。
 *
 * 设置里填了兼容 /embeddings 的服务，或者本机起了 Ollama，才会真的发请求；
 * 其余情况 resolveConfig 会直接返回 off，检索仍然只走 BM25，不产生额外延迟。
 */
const embeddingService = createEmbeddingService({
  getConfig: () => settings?.companion?.memory?.embedding ?? null,
  fetchImpl: (url, init) => net.fetch(url, init),
  log
})

/**
 * 身体层：精力、困意、睡眠债、饥饿、社交能量。
 *
 * 关机期间时间照走，读盘时补算（最多 72 小时）。正文只落一句体感，
 * 数值留在本地，不给对方看。
 */
const bodyService = createBodyService({
  file: path.join(userData, 'body.json'),
  getSleepWindow: () => settings?.companion?.body?.sleepWindow ?? DEFAULT_SLEEP_WINDOW,
  now: Date.now,
  log
})

/**
 * 身体层统一入口：回复与主动开口共用同一份体感。
 * 关掉时返回空串，模型就不会凭空说自己困或饿。
 *
 * 这里顺手做两件只有「真的说上话」才会发生的事：
 * - 有人来找她说话，社交力气要跟着消耗；同一小段时间里连发只算一次，
 *   免得敲得快反而像被罚。
 * - 如果她本来在睡，这一句就是把她叫醒的那一下，记一笔，醒来时才知道自己没睡安稳。
 * 两件都是顺手做，失败不影响这一轮回复。
 */
/*
 * 身体层有两个开关：旧的身体分组（companion.body）和四条轴里的 body（companion.axes.body）。
 * 任一关掉都算关，避免设置页两处各说各话。
 */
function bodyLayerOn() {
  return (
    settings?.companion?.body?.enabled !== false &&
    settings?.companion?.axes?.body?.enabled !== false
  )
}

async function readBodyNote(options = {}) {
  if (!bodyLayerOn()) return ''
  try {
    await bodyService.tick()
    const text = typeof options?.text === 'string' ? options.text.trim() : ''
    if (text !== '') {
      // 长句更费神，但封顶；短句按最低一档算。
      const cost = Math.min(4, 0.8 + text.length * 0.06)
      await bodyService.noteChat(cost)
    }
    const snapshot = bodyService.snapshot()
    // 睡梦里被叫到：先记一笔打断，再真的醒来。醒来只结算梦，不动已经欠下的睡眠债。
    // 刚醒的 90 分钟里不重复记，免得连着说几句话就被算成被吵醒好几次。
    if (snapshot?.asleep === true && text !== '' && snapshot?.justWoke !== true) {
      await bodyService.markInterrupted()
      await bodyService.wake()
    }
    return bodyService.describe()
  } catch (error) {
    log('身体层结算失败，这一轮按平常状态说话', error)
    return ''
  }
}

/**
 * 聊天历史：和记忆同一套加密封装，但单独文件、独立上限。
 * 记忆是给模型的摘要，历史是给用户回看的原文；两者不能混用一份。
 */
const chatHistoryStore = createMemoryStore({
  filePath: chatHistoryPath,
  maxItems: 200,
  seal: async (value) => {
    if (vaultClient === null) throw new Error('vault 未就绪，拒绝以明文写聊天历史')
    return await vaultClient.seal(value, { kind: 'envelope' })
  },
  open: async (sealed) => {
    if (vaultClient === null) throw new Error('vault 未就绪，无法读取聊天历史')
    // 同记忆：轮换后旧会话仍按原 keyId 解开，不因为 epoch 前进读不出来。
    return await vaultClient.open(sealed, { allowLegacyEpoch: true })
  },
  log
})

// buildMemoryDigest 已迁到 src/main/memory.ts，调用点注入存储与历史。

/**
 * 陪伴层：心情、断言记忆、话头、表情偏好。
 *
 * 这些是「同一个自己」的连续性，跨对话、跨重启都要在；
 * 但它比聊天原文更敏感（断言里会有人名、习惯、情绪），所以和记忆同一套加密，
 * vault 没就绪时读不到也不写，绝不退回明文。
 */
/**
 * 情绪运行时：余波、表情实验、需求状态。
 *
 * 全部默认关闭；打开后只影响表现层和主动开口的分寸，不进入提示词。
 */
const emotionRuntime = createEmotionRuntime({
  getSettings: () => settings,
  now: Date.now,
  log
})

const companionService = createCompanionService({
  load: async () => {
    if (vaultClient === null) return null
    let sealed
    try {
      sealed = await fs.readFile(companionPath, 'utf8')
    } catch (error) {
      // 第一次运行没有文件是正常状态，不当错误。
      if (error?.code === 'ENOENT') return null
      throw error
    }
    // 盘上是 JSON 信封；open 出来是明文字节，交给 core 前再解成对象。
    const bytes = await vaultClient.open(JSON.parse(sealed.replace(/^\uFEFF/, '')), {
      allowLegacyEpoch: true
    })
    return JSON.parse(new TextDecoder().decode(bytes))
  },
  save: async (state) => {
    if (vaultClient === null) throw new Error('vault 未就绪，拒绝以明文写陪伴状态')
    const sealed = await vaultClient.seal(state, { kind: 'envelope' })
    // 先写临时文件再改名：断电或崩溃时不会留下半份 JSON。
    const temp = `${companionPath}.tmp`
    await fs.writeFile(temp, JSON.stringify(sealed), 'utf8')
    await fs.rename(temp, companionPath)
  },
  getSettings: () => settings,
  // 情绪余波与需求：只影响表现层，读不到就退回原行为。
  emotion: emotionRuntime,
  // 主动开口的分层节奏：好感高一点就多给几次机会，低落时少打扰。
  // 读不到就按 0（刚认识）处理，不改变原来的默认分寸。
  favor: () => {
    try {
      return affinity.snapshot('desktop').favor
    } catch {
      return 0
    }
  },
  log
})

/**
 * 每日节目单：一天问一次模型「今天怎么过」。
 *
 * 放在聊天之前创建，聊天发送前顺手触发；不等待，也不阻塞回复。
 * 失败时保持原样，节目单继续沿用昨天的结构。
 */
const dailyPlanService = createDailyPlanService({
  getSettings: () => settings,
  getApiKey: async () => {
    const store = requireSecretStore()
    return await store.get(BALANCE_SERVICE, BALANCE_FIELD)
  },
  companion: companionService,
  now: Date.now,
  fetchImpl: (url, init) => net.fetch(url, init),
  log
})

/**
 * 每日额度：只记「今天用了多少 token」，跨日自动归零。
 *
 * 这份计数不含对话内容，落明文没有泄露风险；坏文件按新一天处理。
 */
const dailyBudgetPath = path.join(userData, 'daily-budget.json')
const dailyBudget = createDailyBudget({
  getSettings: () => settings,
  now: Date.now,
  readState: () => {
    try {
      return JSON.parse(fs.readFileSync(dailyBudgetPath, 'utf8'))
    } catch {
      return null
    }
  },
  writeState: (state) => {
    try {
      fs.writeFileSync(dailyBudgetPath, JSON.stringify(state), 'utf8')
    } catch (error) {
      log('额度状态落盘失败', error)
    }
  },
  log
})

/**
 * 请求守门与离线兜底：一个拦住短时间内的重复请求，一个在模型失联时垫一句。
 * 两项都读设置页的开关，关掉后行为与以前完全一致。
 */
const requestGate = createRequestGate({ getSettings: () => settings, log })
const offlineReply = createOfflineReply({ getSettings: () => settings, log })

/**
 * 用户开口时，把当前日程段临时挂起。
 *
 * 只挂起真实存在的段：没有节目单就什么都不写，避免观察台出现一条空记录。
 * 续期和 30 分钟上限都交给 agendaRuntime，这里不另设定时器。
 */
async function noteAgendaSuspendedForChat() {
  try {
    const plan = await companionService.currentAgenda()
    if (plan === null) {
      log('日程挂起跳过：还没有节目单')
      return
    }
    const segment = segmentAt(plan, Date.now())
    if (segment === null) {
      log('日程挂起跳过：此刻没有日程段')
      return
    }
    const snapshot = agendaRuntime.suspend({
      date: plan.date,
      segmentId: segment.id,
      title: segment.title,
      reason: 'chat',
      // 睡觉单独记：提示词和观察台都要知道这不是普通的「先停一下」。
      kind: segment.kind
    })
    log(
      `日程挂起：${segment.title || segment.id}，还会陪你 ${Math.max(
        1,
        Math.round((snapshot.remainingMs ?? 0) / 60000)
      )} 分钟`
    )
  } catch (error) {
    log('日程挂起失败', error)
  }
}

/** 对话里只轻轻带一句「本来在做什么」，不抢走对方正在说的话。 */
function agendaChatNote() {
  const snapshot = agendaRuntime.snapshot()
  if (snapshot.suspended !== true) return ''
  const title = typeof snapshot.title === 'string' ? snapshot.title.trim() : ''
  if (snapshot.interrupted === true) {
    return '你刚才其实在睡，被这一句叫醒了。这不是睡够了，只是先陪对方一会儿；如果自然，可以带一点刚醒的迷糊。不用每句话都提。'
  }
  const what = title === '' ? '你本来在按自己的日程做事' : `你本来在「${title}」`
  return `${what}，现在先陪对方聊一会儿。不用每句话都提这件事，只有在自然的时候带一句就好。`
}

/** 把 scope 说成人能懂的地方，提示词和界面里都不出现 openid。 */
function scopeLabel(scope) {
  if (scope === 'desktop') return '桌面'
  if (typeof scope !== 'string') return '另一个窗口'
  if (scope.startsWith('qq:group')) return 'QQ 群'
  if (scope.startsWith('qq:')) return 'QQ 私聊'
  return '另一个窗口'
}

/** 用户从另一个窗口切过来：把上一段没说完的话记下来，等这一轮开头轻轻接上。 */
async function noteScopeSwitch({ from, to, history } = {}) {
  if (!canHandoff(from, to)) return
  const topic = summarizeHandoffTopic(history)
  if (topic === '') return
  try {
    await handoffStore.ready()
    const result = handoffStore.write({ fromScope: from, toScope: to, topic })
    if (result?.ok === true) pendingHandoffScope = to
  } catch (error) {
    log('跨窗口承接写入失败', error)
  }
}

/** 用户开口这一轮的额外背景：日程被打断 + 刚换窗口没说完的话 + 今天该穿什么。 */
async function buildCompanionExtra(payload = {}) {
  const notes = []
  try {
    const agenda = agendaChatNote()
    if (agenda !== '') notes.push(agenda)
  } catch (error) {
    log('日程提示读取失败', error)
  }
  const scope = typeof payload?.scope === 'string' ? payload.scope : ''
  if (scope !== '' && pendingHandoffScope === scope) {
    pendingHandoffScope = ''
    try {
      await handoffStore.ready()
      // 只消费一次：这句话说过就收起来，免得每轮都像刚想起来。
      const handoff = handoffStore.consumeFor(scope)
      if (handoff !== null) {
        notes.push(
          `你刚从${scopeLabel(handoff.fromScope)}过来。${handoff.topic}，话还没说完。如果对方没有换话题，就自然接一句；不要提「承接记录」这种说法，也别把原话复述一遍。`
        )
      }
    } catch (error) {
      log('跨窗口承接读取失败', error)
    }
  }
  try {
    const lifestyle =
      typeof presenceService?.currentLifestyleNote === 'function'
        ? await presenceService.currentLifestyleNote()
        : ''
    if (typeof lifestyle === 'string' && lifestyle.trim() !== '') notes.push(lifestyle.trim())
  } catch (error) {
    log('节日穿搭提示读取失败', error)
  }
  try {
    const environment = await readEnvironmentNote()
    if (environment !== '') notes.push(environment)
  } catch (error) {
    log('余额与电脑状态提示读取失败', error)
  }
  try {
    const anniversary = readAnniversaryNote()
    if (anniversary !== '') notes.push(anniversary)
  } catch (error) {
    log('纪念日提示读取失败', error)
  }
  return notes.join('\n')
}

/**
 * 贴近时刻：默认关闭。
 *
 * 只记「今天有过一次」，不记内容；文件里只有日期、次数和最后一次的时间。
 * 开关在设置里，打开前要二次确认；群聊与 QQ 远端一律不经过这里。
 */
const intimacyGate = createIntimacyGate({
  file: path.join(userData, 'intimacy.json'),
  fs: fsSync,
  log
})
try {
  intimacyGate.load()
} catch (error) {
  log(`[intimacy] 读取失败：${error?.message ?? error}`)
}

// ---------- AI 工具执行器 ----------
// 把 chat.mjs 里模型要调的工具名，映射到本进程真实能力。
// 只读工具直接调 B 站函数；写操作走 biliWrite（策略 + 二次确认）；落库走 factStore。
// 一律返回「结果对象」不抛网络错误——错误也作为结果回给模型，由它决定怎么回应。

/** 落库工具：把模型提炼的知识 / 教训写进结构化记忆，默认 scope=shared 跨渠道共享。 */
async function runAddFactsTool(args) {
  const list = Array.isArray(args?.facts) ? args.facts : []
  const incoming = list
    .filter((item) => item !== null && typeof item === 'object')
    .map((item) => ({
      kind: typeof item.kind === 'string' && item.kind !== '' ? item.kind : 'knowledge',
      text: String(item.text ?? '').trim(),
      source: typeof item.source === 'string' ? item.source.slice(0, 80) : '',
      confidence: item.confidence
    }))
    .filter((item) => item.text !== '')
  if (incoming.length === 0) return { ok: false, message: '没有可写入的记忆' }
  await factStore.load()
  // upsert 可能因为去重、超限返回 ok:false：如实告诉模型，别让它以为已经记住。
  const result = factStore.upsert(incoming, Date.now(), 'shared')
  const added = Number(result?.added ?? 0)
  const reinforced = Number(result?.reinforced ?? 0)
  if (added + reinforced <= 0) {
    return {
      ok: false,
      message: '没有写入新记忆：内容与已有记忆重复、被去重或超出上限',
      result
    }
  }
  return { ok: true, result }
}

/** 写操作工具：模型只给 bvid，这里先转成 aid 再交给 biliWrite。 */
async function runBiliWriteTool(args, confirmed, source) {
  const action = String(args?.action ?? '')
  const bvid = String(args?.bvid ?? '')
  // QQ 来源看不到桌面确认弹窗，写操作一律拒绝，避免挂死。
  if (source?.channel === 'qq' && confirmed !== true) {
    return { ok: false, error: 'QQ 来源暂不支持写操作，请在桌面上让我做' }
  }
  const info = await biliVideoInfo(bvid)
  const aid = Number(info?.aid ?? 0)
  if (!Number.isInteger(aid) || aid <= 0) {
    return { ok: false, error: '拿不到视频 aid，写操作做不了' }
  }
  const params = {
    video: { aid, bvid },
    ...(typeof args?.message === 'string' && args.message !== '' ? { message: args.message } : {}),
    ...(Number.isInteger(args?.coinCount) ? { coinCount: args.coinCount } : {})
  }
  return await biliWrite(action, params, confirmed)
}

/** 工具总闸：按名字分发。 */
async function runPetTool(name, args, ctx = {}) {
  const confirmed = ctx?.confirmed === true
  const source = ctx?.source ?? null
  try {
    switch (name) {
      case 'bili_search':
        return await biliSearch(String(args?.keyword ?? ''))
      case 'bili_video_info':
        return await biliVideoInfo(String(args?.bvid ?? ''))
      case 'bili_subtitle_list':
        return await biliSubtitleList(String(args?.bvid ?? ''), String(args?.cid ?? ''))
      case 'bili_transcript':
        return await biliTranscript(String(args?.subtitleUrl ?? ''))
      case 'bili_article':
        return await biliArticle(String(args?.url ?? ''))
      case 'bili_write':
        return await runBiliWriteTool(args, confirmed, source)
      case 'memory_add_facts':
        return await runAddFactsTool(args)
      default:
        return { ok: false, error: `未知工具：${name}` }
    }
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) }
  }
}

/** 写操作二次确认：桌面弹系统对话框，等用户拍板。拒绝 / 弹窗失败都按不允许处理。 */
async function requestPetConfirm(info) {
  const name = info?.name ?? ''
  const action = name === 'bili_write' ? String(info?.args?.action ?? '') : name
  const bvid = String(info?.args?.bvid ?? '')
  const actionLabel =
    ({ like: '点赞', coin: '投币', favorite: '收藏', comment: '发评论', reply: '回复' })[action] ?? action
  const detail =
    bvid !== ''
      ? `视频 ${bvid}${typeof info?.message === 'string' && info.message !== '' ? `\n${info.message}` : ''}`
      : String(info?.message ?? '')
  try {
    const options = {
      type: 'warning',
      buttons: ['允许', '拒绝'],
      defaultId: 1,
      cancelId: 1,
      title: '需要你确认',
      message: `她想要执行「${actionLabel}」`,
      detail: detail.trim() === '' ? undefined : detail.trim(),
      noLink: true
    }
    const result =
      win === null || win.isDestroyed()
        ? await dialog.showMessageBox(options)
        : await dialog.showMessageBox(win, options)
    return { allowed: result?.response === 0 }
  } catch (error) {
    log('写操作确认弹窗失败，按拒绝处理', error)
    return { allowed: false }
  }
}

/** 聊天服务：密钥现取现用，短期历史在内存，长期记忆加密落盘。 */
const chatService = createChatService({
  getSettings: () => settings,
  getApiKey: async () => {
    const store = requireSecretStore()
    return await store.get(BALANCE_SERVICE, BALANCE_FIELD)
  },
  getPersonaText: (current) => buildPersonaPrompt(current).text,
  // 记忆摘要按会话取：桌面只读桌面的原文，QQ 每个会话只读自己的那一桶。
  // 先判断这句话要哪一类记忆：「在干嘛」就别翻三个月前的事，「还记不记得」才放宽。
  getMemoryDigest: async (text, scope) => {
    const plan = planMemoryRecall(text)
    const query = typeof text === 'string' ? text : ''
    // 「在干嘛」这类当下状态用最近几轮就够；明确问旧事时按相关度翻。
    // 先宽一点取候选，向量只算这一小批，不把整份记忆送出去。
    const bm25 = plan.preferRecent
      ? []
      : memoryStore.search(query, { scope, limit: Math.max(plan.memoryCount * 3, 12) })
    // 同义改写时 BM25 可能一条不中；用最近几条当向量候选，让混合检索还有机会。
    const pool =
      bm25.length > 0
        ? bm25
        : memoryStore.recent(Math.max(plan.memoryCount * 3, 12), scope)
    const vectorScores =
      plan.preferRecent || pool.length === 0
        ? null
        : await embeddingService.scoreAll(
            query,
            pool.map((item) => ({ id: item.id, text: item.text }))
          )
    // 一条都没命中时仍退回最近记忆，不让提示词里出现空段。
    const recalled = plan.preferRecent
      ? []
      : memoryStore.search(query, { scope, limit: plan.memoryCount, vectorScores })
    const picked = recalled.length > 0 ? recalled : memoryStore.recent(plan.memoryCount, scope)
    // 记忆进提示词时也带上「前天」这种说法：她知道是哪一天，而不是一串时间戳。
    const items = picked.map((item) => {
      const when = humanTime(item.at)
      return when === '' ? item : { ...item, when }
    })
    return buildMemoryDigest({
      enabled: memoryEnabled(),
      ...memoryStore.stats(),
      count: items.length,
      items,
      historyLength: chatService.history(scope).length,
      query: typeof text === 'string' ? text : ''
    })
  },
  getCompanion: () => companionService,
  // 每日 token 额度：发请求前先看一眼，拿不到 usage 时不记假账。
  getDailyBudget: () => dailyBudget,
  // 频率守门：短时间被刷屏时先停一轮，不打到服务端。
  getRequestGate: () => requestGate,
  // 离线兜底：模型失联时用本地句接住，不写历史。
  getOfflineReply: () => offlineReply,
  // 身体感觉：回复时也带着此刻的体感，累的时候句子自然短一点。
  getBodyNote: readBodyNote,
  // 贴近时刻：默认关。开关打开、桌面本机、次数与冷却都允许、且这一轮有由头时，
  // 才给一段分寸；其余时候回空串，模型不会知道有这回事。
  getIntimacyNote: async ({ text, scope }) => {
    const zone = typeof scope === 'string' && scope !== '' ? scope : 'desktop'
    // 桌面本来就在一起；QQ 私聊要主人逐个打开，群聊不在其列。
    if (zone !== 'desktop' && settings?.companion?.intimacy?.peers?.[zone] !== true) return ''
    // 精力见底就不靠近；身体层关着或读不到时按「拿不到精力」处理，不拦。
    let energy
    if (bodyLayerOn()) {
      try {
        await bodyService.tick()
        const snapshot = bodyService.snapshot()
        if (Number.isFinite(snapshot?.energy)) energy = snapshot.energy
      } catch (error) {
        log('贴近时刻读精力失败，这一轮按拿不到精力处理', error)
      }
    }
    // 关系档：生疏时只收着，亲近之后才放开；读不到就按「还没有数据」处理。
    // 好感数值优先——上游用 50 / 75 两个门槛压档，本地 favor 同量程，直接照搬。
    let relationTier = ''
    let relationFavor = null
    try {
      await affinity.ready()
      const bond = affinity.snapshot(zone)
      relationTier = bond?.levelId ?? ''
      relationFavor = Number.isFinite(bond?.favor) ? bond.favor : null
    } catch (error) {
      log('贴近时刻读关系档失败，这一轮按没有数据处理', error)
    }
    const verdict = intimacyGate.check({
      settings,
      scope: zone,
      userText: typeof text === 'string' ? text : '',
      personaText: buildPersonaPrompt(settings).text,
      relationTier,
      relationFavor,
      energy,
      at: Date.now()
    })
    return verdict.open ? intimacyGate.promptFor(verdict.tone, verdict.proactive === true) : ''
  },
  // 红线过滤对所有桌面回复生效：开关关着时直接放行，不改一个字。
  filterIntimacy: (text) => intimacyGate.filterReply(text, Date.now()),
  // 真说出口才推进一格：第一次计一次数，到顶自动收场并留余韵。
  // 收场会回报 ended，顺手记一笔额外的社交消耗——这一场比平时更累。
  onIntimacySpoken: (scope = 'desktop') => {
    const next = intimacyGate.noteTurn(undefined, scope)
    if (next?.ended === true && bodyLayerOn()) {
      void bodyService.noteChat(4).catch((error) => log('贴近收场消耗记账失败', error))
    }
    return next
  },
  // 用户真的开口时，把当前日程段临时挂起；主动开口不走这里。
  onUserMessage: noteAgendaSuspendedForChat,
  // 换窗口时把上一段没说完的话带过去；只记一句摘要，不搬原文。
  onScopeSwitch: noteScopeSwitch,
  // 这一轮的额外背景：日程被打断、刚换窗口、今天该穿什么。失败就静默省略。
  getCompanionExtra: buildCompanionExtra,
  // 表情清单：只给标签，不给磁盘路径；模型按标签写 [[表情:xxx]]。
  getStickerHint: () => stickerLibrary.promptHint(),
  // 关系状态：每个来源各读各的，读不到由聊天层自己跳过。
  getAffinityNote: async (scope) => {
    await affinity.ready()
    return affinity.describe(scope)
  },
  // 结构化记忆：按当前这句话召回，不把整本记忆塞进提示词。
  // 纠错时多取几条证据，问当下时少取几条，避免答非所问。
  getFactNote: async (text, scope, source = null) => {
    await factStore.load()
    const said = typeof text === 'string' ? text : ''
    // 「你记错了」这类话，先落到上一轮真正端出去的那条记忆上，再重新召回。
    // 降级发生在提示词拼装之前，所以这一轮就不会把刚被否认的事再说一遍。
    if (said !== '' && detectCorrection(said).corrected) {
      const demoted = factStore.noteDenial()
      if (demoted.ok === true) {
        log(`[memory] 被否认后降级：${demoted.before} → ${demoted.after}（${demoted.text.slice(0, 30)}）`)
      }
    }
    const plan = planMemoryRecall(said)
    const digest = factStore.digest({
      query: said,
      count: plan.factCount,
      scope,
      // 群聊只带「随时可提」的记忆；私聊才给「被问到再说」的条目。
      context: typeof scope === 'string' && scope.startsWith('qq:group') ? 'group' : 'private'
    })
    // 顺手听一句她怎么说话：只统计形状，不存原句。
    // 群聊按群维度累计：一个群的说话方式比单独某个人更值得参考。
    let habit = ''
    try {
      await speechHabits.load()
      const habitKey =
        typeof scope === 'string' && scope.startsWith('qq:group')
          ? scope.split('#')[0]
          : scope
      const sender =
        source?.senderId ?? source?.userId ?? source?.openId ?? source?.sender ?? ''
      speechHabits.observe(habitKey, said, sender)
      habit = speechHabits.note(habitKey)
    } catch (error) {
      log(`[habits] 这一轮跳过：${error?.message ?? error}`)
    }
    return habit === '' ? digest : `${digest}\n\n${habit}`
  },
  // 群聊语感：只用网关内存里的最近几条消息做统计，不落盘、不写记忆。
  // 样本太少就返回空串，宁可不写画像，也不拿两句话当规律。
  getSocialNote: async ({ scope }) => {
    if (qq === null || typeof qq.recentMessages !== 'function') return ''
    if (typeof scope !== 'string' || !scope.startsWith('qq:group')) return ''
    const key = scope.slice(3)
    // 样本扩到 200 条；重启后即使内存空了，也能接着用上次落盘的统计结果。
    const messages = qq.recentMessages(key, 200)
    await socialProfileStore.load()
    const saved = socialProfileStore.get(scope)
    if (messages.length < 6 && saved === null) return ''
    const fresh = messages.length >= 6 ? analyzeStyle(messages) : null
    const style = fresh === null ? saved : socialProfileStore.remember(scope, fresh) ?? fresh
    const described = describeStyle(style)
    const format = describeFormatAdvice(style)
    const imitate = settings?.channels?.qq?.imitateFormat !== false
    const memes = messages.length >= 6 ? extractMemeCandidates(messages, { limit: 3 }) : []
    // 候选先入词典，再看哪些以前真的用过、有人接。
    await memeDictionary.load()
    if (memes.length > 0) memeDictionary.observe(scope, memes)
    const usable = memeDictionary.digest(scope, 3)
    const lines = []
    if (described !== '' && imitate) lines.push(`这群人的说话方式：${described}`)
    if (format !== '' && imitate) lines.push(`这条回复可以这样发：${format}`)
    if (memes.length > 0) {
      lines.push(
        `群里反复出现的说法：${memes.map((item) => `「${item.phrase}」`).join('、')}。只在你确定含义时顺着用；不确定就别接，更不要解释它。`
      )
    }
    const proven = usable.filter((item) => item.pickedUp > 0).map((item) => item.phrase)
    const risky = usable.filter((item) => item.askedBack > 0).map((item) => item.phrase)
    if (proven.length > 0) lines.push(`以前用过、有人接的：${proven.map((item) => `「${item}」`).join('、')}`)
    if (risky.length > 0) lines.push(`以前用了有人反问的：${risky.map((item) => `「${item}」`).join('、')}，别再用了`)
    return lines.join('\n')
  },
  // 每条消息前顺手确保今天的节目单在；内部有「一天一次」与并发合并，不会重复打模型。
  beforeSend: () => {
    void dailyPlanService.ensure()
  },
  onExchange: async ({ user, assistant, at, scope, source }) => {
    // 对方开口了：这一本「说了没人接」的账就此作废，收场不该再补一句。
    // QQ 在进模型前已经即时清过一次，这里是幂等的；桌面只能等到这一轮走完才知道。
    proactiveGate.noteUserSpoke(typeof scope === 'string' && scope !== '' ? scope : 'desktop')
    // 作息只为桌面记：QQ 那头可能人在外面、也可能半夜在手机上，
    // 混进来会把「这个点在不在电脑前」算歪。
    noteDesktopActivity(typeof scope === 'string' && scope !== '' ? scope : 'desktop', at)
    // 内心状态先记一笔：即使长期记忆关掉，这几轮对话也要留给下次评估。
    // scope 决定这份好感与记忆归谁：桌面一份，QQ 每个会话各一份。
    await affinity.ready()
    affinity.recordTurn(user, assistant, scope)
    // 攒够几轮就在后台评估一次；不等结果，也不影响这一轮回复。
    innerStateService.maybeUpdate(scope)
    if (!memoryEnabled()) return
    // 原文摘要仍共用一份，但给外部渠道的话留来源与说话人，
    // 免得摘要时把群里 A 的话算到 B 头上。
    // 群友的群消息在入站时已经写过：这里不重复写，避免同一条记两遍。
    if (source?.channel === 'qq' && source.chatType === 'group' && source.isOwner !== true) {
      // 入站已写，跳过用户那半；她的回复仍要记。
    } else {
      const tag =
        source?.channel === 'qq'
          ? source.chatType === 'group'
            ? `［QQ 群聊｜${describeSpeaker(source) || '群友'}］`
            : '［QQ 私聊］'
          : ''
      memoryStore.appendTurn('user', `${tag}${user}`, at, source, scope)
    }
    memoryStore.appendTurn('assistant', assistant, at, null, scope)
  },
  // 聊天历史独立落盘；加密仓库不可用时 appendTurn 返回 false，自动退回内存。
  // scope 必须一起写：assistant 那一半没有 source，只能靠它跟着同一轮走。
  persistTurn: (turn) => {
    chatHistoryStore.appendTurn(turn.role, turn.content, turn.at, turn.source, turn.scope ?? null)
  },
  persistClear: () => chatHistoryStore.clear(),
  fetchImpl: (url, init) => net.fetch(url, init),
  // 工具执行：模型 tool_calls 时由 chat.mjs 回调到这里；写操作走二次确认。
  runTool: runPetTool,
  requestConfirm: requestPetConfirm,
  log
})

/** 单张表情上限 8MB；超过就跳过，避免把内存和磁盘打满。 */
const QQ_STICKER_MAX_BYTES = 8 * 1024 * 1024
/**
 * 偷图分寸：默认开，群聊也偷。
 *
 * 这两项没进设置页，先用环境变量兜底；
 * PET_STICKER_STEAL=0 全关，PET_STICKER_GROUP=0 只偷私聊。
 */
const STICKER_STEAL_ENABLED = process.env.PET_STICKER_STEAL !== '0'
const STICKER_STEAL_IN_GROUP = process.env.PET_STICKER_GROUP !== '0'
/** 每个会话每天最多收这么多张，防止一个热闹的群把磁盘塞满。 */
const STICKER_STEAL_DAILY_CAP = (() => {
  const raw = Number(process.env.PET_STICKER_DAILY_CAP)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 40
})()
/** key 是「会话 + 日期」，只放内存：重启后重新计数，不影响已经收下的图。 */
const stickerStealBudget = new Map()
const STICKER_STEAL_BUDGET_LIMIT = 200

function stickerStealBudgetKey(info) {
  const now = new Date()
  return `${info.chatType}:${info.openId}:${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

/** 今天这个会话还有额度吗？有就顺手扣一张。 */
function takeStickerStealBudget(info) {
  if (stickerStealBudget.size > STICKER_STEAL_BUDGET_LIMIT) stickerStealBudget.clear()
  const key = stickerStealBudgetKey(info)
  const used = stickerStealBudget.get(key) ?? 0
  if (used >= STICKER_STEAL_DAILY_CAP) return false
  stickerStealBudget.set(key, used + 1)
  return true
}

/** 下载失败时退回刚扣掉的那张额度：失败不该烧掉一天的收图机会。 */
function refundStickerStealBudget(info) {
  const key = stickerStealBudgetKey(info)
  const used = stickerStealBudget.get(key) ?? 0
  stickerStealBudget.set(key, Math.max(0, used - 1))
}

/**
 * 把 QQ 消息里的图片下载到待审核目录。
 * 内容重复的会在 inbox 里被指纹挡掉，这里只负责下载和计数。
 */
async function saveQqImages(info, images) {
  if (!STICKER_STEAL_ENABLED) return []
  if (info.chatType === 'group' && !STICKER_STEAL_IN_GROUP) return []
  const saved = []
  for (const image of images) {
    if (image.size > QQ_STICKER_MAX_BYTES) {
      log(`[sticker] 跳过过大的图片：${image.size} bytes`)
      continue
    }
    if (!takeStickerStealBudget(info)) {
      log(`[sticker] 今天这个会话已经收满 ${STICKER_STEAL_DAILY_CAP} 张，先不偷了`)
      break
    }
    try {
      const response = await net.fetch(image.url)
      if (!response.ok) {
        log(`[sticker] 下载失败 HTTP ${response.status}`)
        refundStickerStealBudget(info)
        continue
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength > QQ_STICKER_MAX_BYTES) {
        log(`[sticker] 下载后超过上限，丢弃：${buffer.byteLength} bytes`)
        refundStickerStealBudget(info)
        continue
      }
      const item = await stickerInbox.add({
        buffer,
        contentType: image.contentType,
        source: 'qq',
        chatType: info.chatType,
        // 群号与发图的人分开记：以后想知道「这张是从哪个群顺来的」还能查到。
        groupOpenId: info.chatType === 'group' ? info.openId : '',
        senderOpenId: info.senderOpenId,
        filename: image.filename,
        // AI 自动分拣默认开启；设置里可以显式关掉。
        autoApprove: settings.sticker?.autoApprove !== false
      })
      saved.push(item)
    } catch (error) {
      // 网络挂了、inbox 写失败：额度退回去，下一张还能试。
      refundStickerStealBudget(info)
      log(`[sticker] 保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return saved
}

/**
 * 模型偶尔会忘了写 [[表情:…]]：按回复里的情绪词兜底挑一张。
 * 这是「让桌宠真的会发图」的保险，不替代模型自己的判断。
 */
const STICKER_FALLBACK_RULES = [
  { pattern: /(晚安|去睡|睡觉啦|睡咯)/, label: '晚安' },
  { pattern: /(早安|早上好)/, label: '早安' },
  { pattern: /(哈哈|笑死|嘿嘿|好耶|太棒|厉害|开心)/, label: '好耶' },
  { pattern: /(抱抱|抱一下|贴贴)/, label: '抱抱' },
  { pattern: /(想你|想我|念你)/, label: '想我' },
  { pattern: /(呜呜|委屈|难过|不开心|心疼)/, label: '委屈' },
  { pattern: /(加油|可以的|没问题|别怕)/, label: '加油' },
  { pattern: /(谢谢|多谢|太好了)/, label: '谢谢' },
  { pattern: /(害羞|脸红)/, label: '害羞' },
  { pattern: /(晚安啦|困了|累了)/, label: '困了' }
]

/** 每个会话 10 分钟内最多自动补一张，免得把被动回复额度刷光。 */
const QQ_STICKER_FALLBACK_GAP_MS = 10 * 60 * 1000
const lastQqStickerAt = new Map()

/**
 * 兜底挑图：先看回复本身，再看用户这句话。
 * 返回空串表示这次不补。
 */
function fallbackStickerLabel(reply, userText, chatKey) {
  const now = Date.now()
  const previous = lastQqStickerAt.get(chatKey) ?? 0
  if (now - previous < QQ_STICKER_FALLBACK_GAP_MS) return ''
  const text = `${reply}\n${userText}`
  for (const rule of STICKER_FALLBACK_RULES) {
    if (rule.pattern.test(text)) return rule.label
  }
  return ''
}

/** 斗图回敬的间隔：半小时内最多一次，免得每次发图都追着回。 */
const QQ_STOLEN_REPLY_GAP_MS = 30 * 60 * 1000
const lastStolenReplyAt = new Map()

/**
 * 从「QQ 偷来的」素材包里随手挑一张发回去。
 *
 * 这些图没有语义标签，只能随机挑；所以只在对方只发图、没说话时用，
 * 而且有半小时冷却，避免变成无脑复读机。
 */
async function replyWithStolenSticker(channel, chatKey) {
  if (typeof channel.replyImage !== 'function') return false
  const now = Date.now()
  if (now - (lastStolenReplyAt.get(chatKey) ?? 0) < QQ_STOLEN_REPLY_GAP_MS) return false
  const picked = await stickerLibrary.pickStolen()
  if (picked === null) return false
  try {
    const bytes = await fs.readFile(picked.abs)
    const ok = await channel.replyImage(picked.contentType, bytes)
    if (ok) {
      lastStolenReplyAt.set(chatKey, now)
      log(`[sticker] 用偷来的图回敬了一张（${picked.file}）`)
    }
    return ok
  } catch (error) {
    log(`[sticker] 回敬失败：${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * QQ 普通聊天：主人发来的文本走本地聊天服务，再用被动回复窗口发回去。
 * 带图消息先偷进待审核队列，绝不自动入库。
 * 官方限制私聊每小时 4 条、群 5 分钟 5 条；超出时 replyText 返回 false 并记日志。
 */
/**
 * 长回复连发：按句子拆成两三条，中间留一点打字时间。
 *
 * 官方 QQ 接口没有「正在输入」状态，只有通道自己支持时才调一次；
 * 不支持时只靠句间停顿，读起来也像人在一段段打。
 * 拆段后某一条没发出去，就把剩下的合起来再试一次，
 * 不让后半句悄无声息地丢掉。
 */
async function sendBurstReply(channel, chatType, openId, text) {
  // 官方 QQ 的被动回复有次数限制（私聊每小时 4 条），拆太多会把窗口用光。
  // 所以只对确实很长的回复拆两条，而且门槛放得比桌面气泡高。
  const parts = splitReply(text, { minLength: 90, maxParts: 2 })
  if (parts.length <= 1) return channel.replyText(chatType, openId, text)
  let sent = false
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) {
      if (typeof channel.setInputStatus === 'function') {
        try {
          await channel.setInputStatus(openId, true)
        } catch (error) {
          log(`[qq] 正在输入状态没设上：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      await new Promise((resolve) => setTimeout(resolve, burstDelay(parts[index - 1])))
    }
    const ok = await channel.replyText(chatType, openId, parts[index])
    if (ok === true) {
      sent = true
      continue
    }
    if (index > 0) {
      try {
        await channel.replyText(chatType, openId, parts.slice(index).join(''))
      } catch (error) {
        log(`[qq] 剩下的半句没补上：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    break
  }
  if (typeof channel.setInputStatus === 'function') {
    try {
      await channel.setInputStatus(openId, false)
    } catch {
      // 状态复位失败不影响已经发出去的内容，下一次会重新设。
    }
  }
  if (sent && parts.length > 1) log(`[qq] 连发 ${parts.length} 条（${chatType}:${openId}）`)
  return sent
}

async function handleQqChat(info) {
  const channel = qq
  if (channel === null || typeof channel.replyText !== 'function') return

  // 群里被 @ 说明对方明确在叫她；陌生人也回，但要单独限流，别把模型额度刷光。
  if (info.chatType === 'group' && info.mentioned === true && info.isOwner !== true) {
    const verdict = groupReplyGate.allow({
      scope: `qq:group:${info.openId}`,
      senderOpenId: info.senderOpenId
    })
    if (verdict.ok !== true) {
      log(`[qq] 群里 @ 回复跳过（${verdict.reason ?? 'rate-limited'}）`)
      return
    }
  }

  const images = Array.isArray(info.images) ? info.images : []
  const saved = images.length > 0 ? await saveQqImages(info, images) : []

  // 主人要照片：先在本地按下快门，这一轮回复完再把图递过去。
  // 群里只认主人，陌生人一句「拍张照」不该把桌面画面要走。
  const wantsPhoto = shouldSelfieInChat({
    text: info.content,
    chatType: info.chatType,
    isOwner: info.isOwner === true
  })
  let selfie = null
  if (wantsPhoto) {
    const taken = await photoStudio.take()
    if (taken.ok === true) {
      try {
        selfie = { contentType: 'image/png', bytes: await fs.readFile(taken.photo.path) }
      } catch (error) {
        log(`[qq] 刚拍的照片读不出来：${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      log(`[qq] 拍照没成（${taken.reason ?? 'unknown'}）`)
    }
  }

  const fresh = saved.filter((item) => item.duplicate !== true)
  const dupCount = saved.length - fresh.length
  const autoCount = fresh.filter((item) => item.autoApproved === true).length
  const pendingCount = fresh.length - autoCount
  // 群里人多，偷图这件事不汇报；只有主人发图、或被明确叫到时才说一句。
  const mayReportSticker =
    info.chatType !== 'group' || info.mentioned === true || info.isOwner === true
  const stickerNote =
    fresh.length > 0 && mayReportSticker
      ? `\n\n（收到 ${fresh.length} 张：${autoCount} 张自动收下了，${pendingCount} 张等你确认${
          dupCount > 0 ? `；另外 ${dupCount} 张库里已经有了` : ''
        }）`
      : ''

  // 纯图片消息不走聊天，避免模型对着空文本硬回一句。
  if (info.content === '') {
    if (fresh.length > 0 && mayReportSticker) {
      await channel.replyText(
        info.chatType,
        info.openId,
        `偷到 ${fresh.length} 张啦♪ ${autoCount} 张人家先收进「自动收下」，${
          pendingCount > 0 ? `${pendingCount} 张等你点一下` : '都挺像表情包的'
        }${dupCount > 0 ? `；还有 ${dupCount} 张以前就收过` : ''}。`
      )
    }
    // 对方只丢了一张图过来：顺手拿库里偷来的图回敬一张，像真的在斗图。
    if (saved.some((item) => item.packId === 'qq-auto')) {
      await replyWithStolenSticker(channel, `${info.chatType}:${info.openId}`)
    }
    return
  }

  try {
    const chatKey = `${info.chatType}:${info.openId}`
    const groupScope = info.chatType === 'group' ? `qq:group:${info.openId}` : ''
    // 主动开口的账本按会话分开：群和私聊不互相抵消。
    const proactiveScope =
      info.chatType === 'group' ? `qq:group:${info.openId}` : `qq:private:${info.openId}`
    // 对方开口了：先清掉「发出去没人接」的账，止损立刻解除。
    // 顺序要在调模型之前，这一轮不该因为旧账被拦；但清账前留一份快照，
    // 模型没回成时原样还回去，下一轮主动开口仍会被收敛。
    const silenceBefore = proactiveGate.peekSilence(proactiveScope)
    proactiveGate.noteUserSpoke(proactiveScope)
    // 之前问过、还没结论的话头，交给这一轮一起判断要不要接。
    const reviews = proactiveGate.pendingReviews(proactiveScope)
    const reviewNote = buildReviewNote(reviews)
    // 先看这句话是不是在接上次的梗、或者没听懂在反问；只对群聊记账。
    if (groupScope !== '') {
      await memeDictionary.load()
      memeDictionary.observeReply(groupScope, info.content)
    }
    // 照片已经真拍下来了：这一轮的话得跟它配得上，别嘴上说「拍好了」手里却没有。
    const photoHint =
      selfie === null
        ? ''
        : '（这一轮已经真拍下一张，照片会跟着回复一起发出去；可以顺口提一句。）'
    // 来源必须一起传下去：网关只给纯文本，模型不知道这句话是从 QQ 来的。
    const result = await chatService.send({
      text: info.content,
      reviewNote: [reviewNote, photoHint].filter((line) => line !== '').join('\n'),
      source: {
        channel: 'qq',
        chatType: info.chatType,
        openId: info.openId,
        senderOpenId: info.senderOpenId,
        msgId: info.msgId,
        // 主人的消息单独标出来：群聊里「你」指谁，靠这个字段区分。
        isOwner: info.isOwner === true
      }
    })
    if (result?.ok !== true) {
      // 这一轮没回成：止损账还回去，别让「对方其实没等到回应」被当成已解除。
      proactiveGate.restoreSilence(proactiveScope, silenceBefore)
      log(`[qq] 聊天未回复：${result?.reason ?? 'unknown'}`)
      return
    }
    const reply = typeof result.reply === 'string' ? result.reply.trim() : ''
    if (reply === '') return
    const sent = await sendBurstReply(
      channel,
      info.chatType,
      info.openId,
      `${reply}${stickerNote}`
    )
    log(`[qq] 聊天回复${sent ? '已发送' : '未发送'}（${info.chatType}:${info.openId}）`)
    // 真发出去才记「用了一个梗」，没发出去的只当没说过。
    if (sent && groupScope !== '') memeDictionary.markUsed(groupScope, reply)
    // 顺手记下刚说过什么：下一句接话时，才知道是不是还在同一条线上。
    if (sent && groupScope !== '') groupLastSpoken.set(groupScope, { text: reply, at: Date.now() })
    // 回应也占一次「刚说完」：别隔两秒又自己接一句。
    if (sent && groupScope !== '') groupManners.noteSpoken(groupScope)
    // 这一轮已经带着话头提示回过了：从待复核里结掉，避免下轮反复注入同一件事。
    // 模型具体判定成什么不在这里区分——回复本身已经把它处理掉了。
    if (sent && reviews.length > 0) {
      for (const item of reviews) proactiveGate.resolveOpenLoop(proactiveScope, item.id, 'done')
    }

    // 刚被要的那张照片先发：被动回复额度有限，它比随手补的表情重要。
    if (sent && selfie !== null && typeof channel.replyImage === 'function') {
      try {
        const ok = await channel.replyImage(selfie.contentType, selfie.bytes)
        log(`[qq] 照片${ok ? '已发送' : '未发送'}（${info.chatType}:${info.openId}）`)
      } catch (error) {
        log(`[qq] 照片发送失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // 文字先发出去，再补一张表情：模型自己点了就用它的标签，忘了就按情绪兜底补一张。
    let label = typeof result.stickerLabel === 'string' ? result.stickerLabel.trim() : ''
    const fromModel = label !== ''
    if (label === '') label = fallbackStickerLabel(reply, info.content, chatKey)

    if (sent && selfie === null && label !== '') {
      const picked = await stickerLibrary.pick(label)
      if (picked === null) {
        log(`[qq] 表情标签没对上：${label}`)
      } else if (typeof channel.replyImage === 'function') {
        try {
          const bytes = await fs.readFile(picked.abs)
          const ok = await channel.replyImage(picked.contentType, bytes)
          log(
            `[qq] 表情${ok ? '已发送' : '未发送'}（${picked.label} ← ${fromModel ? label : `兜底:${label}`}）`
          )
          if (ok) lastQqStickerAt.set(chatKey, Date.now())
        } catch (error) {
          log(`[qq] 表情发送失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  } catch (error) {
    log(`[qq] 聊天处理失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 主动开口的闸门：按群记账，冷却与每日上限都在模块里，主进程不再另存一份。
 *
 * 分寸跟着设置页走：getLimits 每次判断现读 settings.presence，
 * 改完「多久说一次」或「夜间不扰」，下一句就按新的来。
 * 设置还没读出来时返回默认，绝不因为缺字段把闸门关死。
 */
const proactiveGate = createProactiveGate({
  getLimits: () => proactiveLimitsFromPresence(settings?.presence),
  levelOf: (scope) => {
    try {
      return affinity.snapshot(scope).levelId
    } catch {
      return null
    }
  }
})

/** 群 @ 回复的独立闸门：陌生人也回，但不能连点刷额度。 */
const groupReplyGate = createGroupReplyGate()

/**
 * 群聊接话的分寸：热聊不插、刚说完不连说、大群没人叫不主动。
 * 计数只在内存里，重启清空；宁可少接一次。
 */
const groupManners = createGroupManners()
/**
 * 她在这个群最后说的一句话。
 *
 * 只留最近一条、只放在内存里：用来判断「对方是不是在接她刚说的话」。
 * 重启就清空——宁可少接一次，也不把旧话当成现在还在聊。
 */
const groupLastSpoken = new Map()

/** 读这个群相关的事实，只给「话题命中」用；读不到就当没有，别让插话依赖记忆是否开启。 */
async function loadProactiveFacts(scope) {
  try {
    await factStore.load()
    const snapshot = factStore.snapshot(scope)
    const list = Array.isArray(snapshot?.facts) ? snapshot.facts : []
    return list
      .map((item) => (typeof item?.text === 'string' ? item.text : ''))
      .filter((item) => item !== '')
  } catch {
    return []
  }
}

/**
 * 群里的主动开口：只在两种时候考虑——
 * 有人叫了她的名字，或话题撞上了她记得的事。
 *
 * 分寸在 proactive.mjs（深夜不说、半小时内不重复、每天最多三次），
 * 再和桌面端共享同一个日预算；群里没人接话不算进桌面的降速。
 * 这里只负责真正发出去，以及发送成功后才记账。
 */
async function maybeSpeakInGroup(info) {
  const channel = qq
  if (channel === null || typeof channel.replyText !== 'function') return
  if (info.chatType !== 'group') return
  const text = typeof info.content === 'string' ? info.content.trim() : ''
  if (text === '') return

  const scope = `qq:group:${info.openId}`
  // 先看这条消息和她是什么关系：在叫她、在接她的话、聊到她在意的事，还是别人之间的闲聊。
  // 这一层不决定回不回，只决定「值不值得交给后面的分寸判断」。
  await factStore.load()
  // 快照可能为 null（读失败）：topic 取空数组，不抛 TypeError，别让整条群插话中断。
  const groupSnapshot = factStore.snapshot(scope)
  const topics = (Array.isArray(groupSnapshot?.facts) ? groupSnapshot.facts : [])
    .filter((fact) => fact !== null && typeof fact === 'object' && fact.archived !== true)
    .slice(-12)
    .map((fact) => (typeof fact.text === 'string' ? fact.text : ''))
    .filter((item) => item !== '')
  const address = classifyGroupAddress({
    text,
    mentioned: info.mentioned === true,
    wakeWords: settings.wakeWords,
    lastSpoken: groupLastSpoken.get(scope) ?? null,
    topics
  })
  if (address.level === 'ambient') return

  // 接话的分寸：群里正聊得热闹、她刚说完、大群里没人叫，都先不插。
  // 被点名时直接放行——叫她就该应声，这点礼貌不能被降频挡掉。
  const manner = groupManners.judge({
    scope,
    addressed: address.level === 'addressed',
    memberCount: info.memberCount
  })
  if (manner.allow !== true) {
    log(`[qq] 群里的这一条先不接（${manner.reason ?? 'manner'}）`)
    return
  }

  // 「主动台词」关着时，只接明确叫她的和刚聊完的，不自己找话头。
  if (address.level === 'topic' && settings?.presence?.aiEnabled !== true) return

  // 精力也参与群里的分寸：困到不行时只应被叫到的，不接别人的话头；
  // 只是累了就不自己找话题，刚聊完的那条线仍可以接。
  let groupBody = null
  if (bodyLayerOn()) {
    await bodyService.tick()
    groupBody = bodyService.snapshot()
  }
  const groupFlags = groupBody?.flags ?? {}
  if (groupFlags.exhausted === true && address.level !== 'addressed') return
  if ((groupFlags.lowEnergy === true || groupFlags.drained === true) && address.level === 'topic') {
    return
  }

  const decision = proactiveGate.decide(scope, {
    text,
    speaker: info.senderOpenId,
    // 平台只把明确 @ 她的群消息推成这个事件；被叫到就直接接。
    addressed: address.level === 'addressed',
    // 刚说完、对方还在这条线上：算回应，不需要另找由头。
    continuation: address.level === 'continuation',
    wakeWords: settings.wakeWords,
    facts: await loadProactiveFacts(scope)
  })
  if (decision.speak !== true) return

  // 与桌面端共享日预算：同一个账本，今天总共说太多次就不再开口。
  // 不共享未回应降速——群里没人接话，不代表桌面上也该少说。
  const fingerprint = `${scope}:${decision.reason}`
  const sharedGate = await companionService.allowsSharedOpening(fingerprint)
  if (sharedGate.allowed !== true) {
    log(`[qq] 主动开口跳过（共享预算：${sharedGate.reason ?? 'unknown'}）`)
    return
  }

  try {
    const result = await chatService.send({
      text,
      source: {
        channel: 'qq',
        chatType: 'group',
        openId: info.openId,
        senderOpenId: info.senderOpenId,
        msgId: info.msgId,
        isOwner: false
      },
      proactive: { note: buildProactiveNote(decision) }
    })
    if (result?.ok !== true) return
    const reply = typeof result.reply === 'string' ? result.reply.trim() : ''
    if (reply === '') return
    // 三个群收到同一句话，是最容易被看穿的破绽：先看别的会话刚说过没有。
    const duplicate = proactiveGate.findDuplicate(scope, reply)
    if (duplicate.duplicate) {
      log(`[qq] 主动开口跳过（与 ${duplicate.scope} 撞车，相似度 ${duplicate.similarity}）`)
      return
    }
    const sent = await channel.replyText('group', info.openId, reply)
    if (!sent) return
    proactiveGate.markSpoke(scope, reply)
    // 主动说出去的话也要留在记忆里：不然下次开场会像没说过一样重来。
    // 只记她自己这一句，不替群里的人补回应；source 留着，方便回看是在哪个群说的。
    if (memoryEnabled()) {
      memoryStore.appendTurn(
        'assistant',
        reply,
        new Date().toISOString(),
        {
          channel: 'qq',
          chatType: 'group',
          openId: info.openId,
          msgId: info.msgId,
          proactive: true,
          reason: decision.reason
        },
        scope
      )
    }
    groupLastSpoken.set(scope, { text: reply, at: Date.now() })
    // 刚说完这一句：八秒内不接下一句，别在群里像复读机。
    groupManners.noteSpoken(scope)
    // 主动说出去的话里如果抛了问题，记成待复核的话头：
    // 对方回来时先判断「这件事是不是已经聊过了」，而不是到点再问一遍。
    if (/[？?]|吗|呢|要不要|怎么样|好不好/.test(reply)) {
      proactiveGate.noteOpened(scope, { question: reply.slice(0, 80) })
    }
    await companionService.noteSharedOpening(fingerprint)
    log(`[qq] 主动开口（${decision.reason}）：${reply.slice(0, 40)}`)
  } catch (error) {
    log(`[qq] 主动开口失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 主进程日志：控制台 + userData/logs/main.log。
 * 打包后用户看不到控制台，崩溃、通道失败、素材 404 就只能靠猜。
 * 单文件 5 MB 轮转，最多保留 3 份归档（main.log.1 ~ .3），总量有硬上限。
 * 落盘前统一脱敏；写日志失败一律静默，绝不能因为日志写不进去把主流程带崩。
 */
const logDir = path.join(userData, 'logs')
const logFilePath = path.join(logDir, 'main.log')
const LOG_MAX_BYTES = 5 * 1024 * 1024
/** 除当前文件外最多再保留三份归档。 */
const LOG_ARCHIVE_COUNT = 3
let logReady = false
let logBytes = 0

/** 轮转：删最旧、依次后移，再让当前文件变成 .1。失败时退回清空当前文件。 */
function rotateLogFile() {
  try {
    fsSync.rmSync(`${logFilePath}.${LOG_ARCHIVE_COUNT}`, { force: true })
  } catch {
    // 删不掉就交给后面的 rename 失败分支处理
  }
  for (let index = LOG_ARCHIVE_COUNT - 1; index >= 1; index -= 1) {
    try {
      fsSync.renameSync(`${logFilePath}.${index}`, `${logFilePath}.${index + 1}`)
    } catch {
      // 某一份不存在或改名失败，不影响继续轮转
    }
  }
  try {
    fsSync.renameSync(logFilePath, `${logFilePath}.1`)
  } catch {
    try {
      fsSync.writeFileSync(logFilePath, '')
    } catch {
      // 目录只读：退回只有控制台
    }
  }
}

function appendLogFile(line) {
  try {
    if (!logReady) {
      fsSync.mkdirSync(logDir, { recursive: true })
      logReady = true
      try {
        logBytes = fsSync.statSync(logFilePath).size
      } catch {
        logBytes = 0
      }
    }
    if (logBytes > LOG_MAX_BYTES) {
      rotateLogFile()
      logBytes = 0
    }
    // 控制台保留原文；落盘的这一份必须脱敏。
    const safeLine = redactLogText(line)
    fsSync.appendFileSync(logFilePath, safeLine)
    logBytes += Buffer.byteLength(safeLine)
  } catch {
    // 磁盘满 / 目录只读：退回只有控制台
  }
}

function formatLogArg(value) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function log(...args) {
  console.log('[desktop]', ...args)
  appendLogFile(`${new Date().toISOString()} [desktop] ${args.map(formatLogArg).join(' ')}\n`)
}

const BUILTIN_WAKE_WORDS = ['昔涟', '迷迷', '德谬歌', '小涟']

/**
 * 语音唤醒词和文字唤醒是两份名单。
 * 文字唤醒决定「要不要接话」，语音唤醒决定「这一轮要不要出声」；
 * 前者在群聊里要宽一点，后者在家里只留最顺口的那个称呼就好。
 */
const BUILTIN_VOICE_WAKE_WORDS = ['发句语音']

/**
 * 时刻表记账：同一天同一类时刻只说一次。
 * key 自带日期，跨天自然失效；换日时顺手清掉旧 key，Set 不会越攒越长。
 */
const spokenMoments = new Set()

/**
 * 从记忆里找最近几天的考试、面试这类约定。
 * 记忆没开、接口变了、一条都没命中，都只返回空数组——
 * 时刻表少说一句没关系，不能因此把主动开口整条路弄断。
 */
function upcomingFromMemory(now) {
  try {
    const found = memoryStore.search('考试 面试 答辩 日期', { scope: 'desktop', limit: 20 })
    const rows = Array.isArray(found) ? found : Array.isArray(found?.items) ? found.items : []
    const texts = rows
      .map((row) => String(row?.text ?? row?.content ?? ''))
      .filter((text) => text !== '')
    return pickUpcomingDates({ memories: texts, now, horizonDays: 3 })
  } catch {
    return []
  }
}

/**
 * 「DSH 语音」四个场景，各管一段路：
 * reply 每条回复都念、wakeWord 只在叫名字那轮、
 * autonomous 她主动开口时、moments 早晚和每日回顾。
 *
 * 没写过 dshScenes 的老配置退回 readDsh 一个开关，等价于 reply。
 */
function dshSceneEnabled(scene) {
  const voice = settings?.voice
  // 老配置只有 readDsh 一个开关：它亮着就等价于「收到回复就念」。
  // 设置页第一次动这四个场景时会顺手把旧字段清掉，之后不再回弹。
  if (voice?.readDsh === true && scene === 'reply') return true
  return voice?.dshScenes?.[scene] === true
}

/** 这一句里有没有叫到「语音唤醒词」。和文字唤醒分开读，互不借用。 */
function hasVoiceWakeWord(text) {
  if (typeof text !== 'string' || text === '') return false
  // 配置里可能混进空格或空项：先收干净，再逐条比。
  const configured = Array.isArray(settings?.voice?.voiceWakeWords)
    ? settings.voice.voiceWakeWords
        .map((word) => (typeof word === 'string' ? word.trim() : ''))
        .filter((word) => word !== '')
    : []
  const words = configured.length > 0 ? configured : BUILTIN_VOICE_WAKE_WORDS
  return words.some((word) => text.includes(word))
}

/** 场景那盏灯亮着就顺手挂一句提炼稿；没给场景就只出字。 */
function speechFor(text, scene) {
  if (scene === null || scene === undefined) return null
  if (!dshSceneEnabled(scene)) return null
  return toSpokenLine(text, { maxChars: settings?.voice?.maxChars })
}

/** 主进程主动说一句。窗口不在或已销毁就安静跳过，不排队补发。 */
function sendBubble(text, motion = null, meta = null) {
  if (typeof text !== 'string' || text.trim() === '') return false
  if (win === null || win.isDestroyed()) return false
  const explicit = typeof meta?.speakText === 'string' && meta.speakText !== '' ? meta.speakText : null
  const speakText = explicit ?? speechFor(text, meta?.scene)
  win.webContents.send('pet:bubble', {
    text,
    // AI 挑的动作名；渲染层按素材真实能力决定播不播，null 表示这句不带动作。
    motion: typeof motion === 'string' && motion !== '' ? motion : null,
    // 可选表情 id：渲染层按素材目录换成图片贴在气泡里，null 表示这句不配图。
    emojiId: typeof meta?.emojiId === 'string' && meta.emojiId !== '' ? meta.emojiId : null,
    // 可选 ack 键：只有带它的气泡才显示「知道了」，点击后升 confirmed。
    ackSegment:
      typeof meta?.ackSegment === 'string' && meta.ackSegment !== '' ? meta.ackSegment : null,
    // 气泡显示原文，念出来的是另一句提炼过的；null 表示这一句不出声。
    speakText: typeof speakText === 'string' && speakText !== '' ? speakText : null
  })
  return true
}

/**
 * 桌宠开口的唯一出口。
 *
 * 从前十来处各调各的 sendBubble，「这句话该不该记账」散在各处，漏掉一处就是
 * 一条看不见的裂缝 —— 用户点击那条路就漏过：自主 tick 不知道刚刚才说过话，
 * 十几秒后又冒一句，两个气泡顶在一起互相打断。
 * 收拢之后记账策略跟着 origin 走，新场景只要选对 origin 就不会再漏。
 *
 * origin:
 *   proactive  她自己想到一件事要说：占每日额度、进未回应队列、写记忆
 *   closer     收场善后：走 markClosed，占额度，不写记忆（善后不算新话头）
 *   onDemand   用户戳她（单击）：只记冷却与去重池，不占额度、不进未回应队列，写记忆
 *   reply      在回应用户（DSH 回复念出、唤醒词应答）：不记账，本来就是被叫到的
 *   notice     系统播报（时刻、日程、每日回顾、余额告警）：不记账，不占她的开口额度
 *
 * 场景特有的副作用（log、lastSpokenAt、认领日程段落、收起念头）留在调用点，
 * 这里只管「发出去」和「记什么账」。
 */
/* 同句去重：自主循环等不到回应时会一拍一拍重复同一句，「连弹三个相同提问」就是这么来的。
   主动 / 播报类台词在冷却期内重复就直接吞掉；用户主动触发（onDemand / reply）不受限，
   点击反馈必须每次都有响应。渲染层 onBubble 还有一层同样口径的兜底。 */
const SPEAK_REPEAT_COOLDOWN_MS = 10 * 60 * 1000
let lastSpeakOutText = null
let lastSpeakOutAt = 0

function speakOut({
  text,
  motion = null,
  emojiId = null,
  ackSegment = null,
  speakText = null,
  scene = null,
  origin = 'notice',
  scope = 'desktop',
  reason = ''
}) {
  if (
    origin !== 'onDemand' &&
    origin !== 'reply' &&
    typeof text === 'string' &&
    text === lastSpeakOutText &&
    Date.now() - lastSpeakOutAt < SPEAK_REPEAT_COOLDOWN_MS
  ) {
    log('[speak] 冷却期内重复台词，不再推送：', text.slice(0, 24))
    return false
  }

  const meta = {}
  if (typeof emojiId === 'string' && emojiId !== '') meta.emojiId = emojiId
  if (typeof ackSegment === 'string' && ackSegment !== '') meta.ackSegment = ackSegment
  if (typeof speakText === 'string' && speakText !== '') meta.speakText = speakText
  if (typeof scene === 'string' && scene !== '') meta.scene = scene

  const sent = sendBubble(text, motion, meta)
  // 窗口不在或已销毁就没真说出去，这种时候不记账，下一拍还有机会。
  if (!sent) return false

  lastSpeakOutText = text
  lastSpeakOutAt = Date.now()

  if (origin === 'proactive') proactiveGate.markSpoke(scope, text)
  else if (origin === 'closer') proactiveGate.markClosed(scope)
  else if (origin === 'onDemand') proactiveGate.markSpokeOnDemand(scope, text)

  // 说过的话要留在记忆里。不写回去，她下次不知道自己刚才说过什么，
  // 会像没发生过一样重新开场。只记自己这一句，不替对方编回应。
  if ((origin === 'proactive' || origin === 'onDemand') && memoryEnabled()) {
    memoryStore.appendTurn(
      'assistant',
      text,
      new Date().toISOString(),
      { channel: scope, proactive: origin === 'proactive', reason },
      scope
    )
  }
  return true
}

/**
 * DSH 回复念出：只读会话文件，有新回复就交给 sendBubble。
 *
 * 气泡留原文；要出声时另送一句提炼过的，代码、路径、分点都先剥掉。
 * 监听只看 reply / wakeWord 这两盏灯，其余场景不依赖会话文件。
 */
const dshSpeech = createDshSpeechWatcher({
  onReply: (text, info) => {
    const shouldSpeak =
      dshSceneEnabled('reply') || (dshSceneEnabled('wakeWord') && hasVoiceWakeWord(info?.userText))
    const spoken = shouldSpeak ? toSpokenLine(text, { maxChars: settings?.voice?.maxChars }) : null
    speakOut({ text, speakText: spoken, origin: 'reply' })
  },
  log
})

function syncDshSpeech(voice = settings?.voice) {
  const scenes = voice?.dshScenes ?? {}
  // 四盏灯任意一盏亮着，语音服务都得在。
  // 只开「自主开口」或「特定时刻」时，回复监听用不上，
  // 但那两盏灯的句子照样要念，扬声器不能因为监听没开就不启动。
  const anyDsh =
    voice?.readDsh === true ||
    scenes.reply === true ||
    scenes.wakeWord === true ||
    scenes.autonomous === true ||
    scenes.moments === true
  if (anyDsh && !dshSpeech.isRunning()) dshSpeech.start()
  else if (!anyDsh && dshSpeech.isRunning()) dshSpeech.stop()
}

/**
 * 主动开口的账：上次说话、今天开过几次、沉默从哪天算起。
 *
 * 只存时间与计数，不存内容。单独一份文件，免得被窗口位置整体覆写；
 * 读坏了当作第一次启动，写失败也不挡这一次开口。
 */
const presenceStateFile = path.join(userData, 'presence-state.json')
let presenceState = {}
try {
  const restoredPresence = JSON.parse(fsSync.readFileSync(presenceStateFile, 'utf8'))
  presenceState =
    restoredPresence !== null && typeof restoredPresence === 'object' ? restoredPresence : {}
} catch {
  presenceState = {}
}

function persistPresenceState(next) {
  if (next === null || typeof next !== 'object') return
  presenceState = next
  void writeJson(presenceStateFile, next).catch(() => {})
}

/**
 * 主动说话的情境层。
 *
 * 和聊天服务分开：主动台词不该写进聊天历史，也不该被「正在聊天」挡住。
 * 密钥、人格、记忆全部复用主进程现成的那一份。
 */
const presenceService = createPresenceService({
  getSettings: () => settings,
  getApiKey: async () => {
    const store = requireSecretStore()
    return await store.get(BALANCE_SERVICE, BALANCE_FIELD)
  },
  // 主动说话发生在桌面：只取桌面这一桶，群里的事不拿来当主动话题。
  getMemoryDigest: (text) => {
    const items = memoryStore.recent(40, 'desktop')
    return buildMemoryDigest({
      enabled: memoryEnabled(),
      ...memoryStore.stats(),
      count: items.length,
      items,
      historyLength: chatService.history('desktop').length,
      query: typeof text === 'string' ? text : ''
    })
  },
  getPersonaText: (current) => buildPersonaPrompt(current).text,
  // 真实心情、未完话头、主动说话的表情候选都从陪伴层取，不再由时间硬推。
  getCompanion: () => companionService,
  // 表情情绪：余波还没散完时先维持上一张脸，实验组再决定要不要换。
  // 默认关着时 decideExpression 原样返回，和旧行为一致。
  decideEmotion: (emotion) => emotionRuntime.decideExpression(emotion),
  // 动作清单来自渲染层每 2 秒的上报；还没上报过就是 null，提示词里不会凭空出现动作。
  getMotionCatalog: () => lastRenderInfo?.motion ?? null,
  // 身体感觉：开口前先推进到现在；累就是累，不假装精神。
  getBodyNote: readBodyNote,
  // 余额与电脑状态：只读现成数据，拿不到就少一句。
  getEnvironmentNote: readEnvironmentNote,
  // 纪念日：只在临近时出现，来源必须有原话。
  getAnniversaryNote: readAnniversaryNote,
  // 识屏：默认关；打开后十分钟最多读一次，读到多少算多少。
  getScreenNote: readScreenNote,
  // 余额是否真的低于阈值：只看最近一次真实抓取，不把「设过阈值」当低。
  getBalanceLow: balanceLowNow,
  fetchImpl: (url, init) => net.fetch(url, init),
  // 上次说话与今天开过几次要跨重启；文件和读写都留在主进程。
  loadState: () => presenceState,
  saveState: persistPresenceState,
  log
})

/**
 * 观察台快照。
 *
 * 七路数据源各自独立：谁没准备好就空着，其它照常给。
 * 这里只读，不改任何状态；唯一的写入是「这次运行里被叫到几次」。
 */
const insight = createInsightService({
  chatHistoryStore,
  memoryStore,
  socialProfileStore,
  thoughtPool,
  agendaRuntime,
  bodyService,
  presenceService,
  affinity,
  proactiveGate,
  handoffStore,
  // 观察台读的是同一份设置，开关状态与运行时完全一致。
  getIntimacyPeers: () => settings?.companion?.intimacy?.peers ?? {},
  log
})

/**
 * 桌面状态条的系统指标。
 *
 * 采样器只往主窗口推；窗口不在就丢弃这一拍，不排队。桌面状态条默认关闭，
 * 但采样很轻（3 秒一次 os 差值 + 6 秒一次 PowerShell），常驻不影响启动。
 */
const systemStats = createSystemStats({
  app,
  log,
  onStats: (stats) => {
    if (win === null || win.isDestroyed()) return
    win.webContents.send('pet:system:stats', stats)
  }
})

/**
 * 余额与电脑状态：只读现成数据，不为这一句话额外拉起采样。
 *
 * 余额取账本里最新的一片；电脑状态取 HUD 的采样快照，
 * 采样过期就当作没看见，不为了知道电量去催 HUD 打开。
 */
async function readEnvironmentNote() {
  const parts = []

  try {
    if (settings?.modules?.['builtin.balance']?.enabled === true) {
      const ledger = await ensureBalanceStore().ensureLedger()
      const slices = ledger?.slices
      let latest = null
      if (slices !== null && typeof slices === 'object') {
        for (const slice of Object.values(slices)) {
          if (!slice || typeof slice.date !== 'string') continue
          if (latest === null || slice.date > latest.date) latest = slice
        }
      }
      if (latest !== null) {
        parts.push(describeBalance({ amount: latest.balance, threshold: latest.threshold }))
      }
    }
  } catch (error) {
    log('余额提示读取失败', error)
  }

  try {
    parts.push(describeSystem(systemStats.snapshot()))
  } catch (error) {
    log('系统状态提示读取失败', error)
  }

  return parts.filter((part) => part !== '').join('')
}

/** 识屏：十分钟最多读一次；同一块屏幕没必要反复认，也省点电。 */
const SCREEN_NOTE_TTL_MS = 10 * 60_000
const SCREEN_OCR_TIMEOUT_MS = 12_000
let screenNoteCache = { at: 0, text: '', failed: false }
/** 识屏失败只压 2 分钟：OCR 脚本被删、PowerShell 被策略拦住这类可恢复错误不该等满 10 分钟。 */
const SCREEN_NOTE_FAIL_TTL_MS = 2 * 60_000
let screenNoteInFlight = null
let ocrScriptPath = null

async function ensureOcrScript() {
  if (ocrScriptPath !== null) return ocrScriptPath
  const dir = path.join(app.getPath('userData'), 'cache')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'screen-ocr.ps1')
  // 带 BOM，老版本 PowerShell 才会按 UTF-8 读这个脚本。
  await fs.writeFile(file, `\uFEFF${OCR_SCRIPT}`, 'utf8')
  ocrScriptPath = file
  return file
}

function runScreenOcr(script, imagePath, outPath) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-ImagePath',
        imagePath,
        '-OutPath',
        outPath
      ],
      { windowsHide: true, timeout: SCREEN_OCR_TIMEOUT_MS },
      (error) => {
        if (error) reject(error)
        else resolve()
      }
    )
  })
}

/**
 * 识屏：把当前屏幕上的字收成一句，交给提示词。
 *
 * 默认不读；只有设置里明确打开才动。图片落在自己的 userData 缓存里，
 * OCR 完就删，不往外传。失败就当没看见，不每轮重试。
 */
async function readScreenNote() {
  if (settings?.presence?.screen?.enabled !== true) return ''
  // 成功结果按 10 分钟缓存；失败结果只压 2 分钟就允许重试。
  const ttl = screenNoteCache.failed === true ? SCREEN_NOTE_FAIL_TTL_MS : SCREEN_NOTE_TTL_MS
  if (Date.now() - screenNoteCache.at < ttl) return screenNoteCache.text
  if (screenNoteInFlight !== null) return screenNoteInFlight

  screenNoteInFlight = (async () => {
    const dir = path.join(app.getPath('userData'), 'cache')
    const imagePath = path.join(dir, `screen-${process.pid}.png`)
    const outPath = `${imagePath}.json`
    try {
      await fs.mkdir(dir, { recursive: true })
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1280, height: 800 }
      })
      const primary = screen.getPrimaryDisplay()
      const source =
        sources.find((item) => String(item.display_id) === String(primary.id)) ?? sources[0]
      if (!source || source.thumbnail.isEmpty()) return ''

      await fs.writeFile(imagePath, source.thumbnail.toPNG())
      const script = await ensureOcrScript()
      await runScreenOcr(script, imagePath, outPath)

      const raw = await fs.readFile(outPath, 'utf8')
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
      const text = summarizeScreenText(parsed?.lines)
      screenNoteCache = { at: Date.now(), text, failed: false }
      return text
    } catch (error) {
      log('识屏读取失败：', error?.message ?? error)
      // 失败短缓存：2 分钟后重试，不每轮都打 PowerShell，也不堵满整个 TTL。
      screenNoteCache = { at: Date.now(), text: '', failed: true }
      return ''
    } finally {
      screenNoteInFlight = null
      await fs.rm(imagePath, { force: true }).catch(() => {})
      await fs.rm(outPath, { force: true }).catch(() => {})
    }
  })()

  return screenNoteInFlight
}

/** 纪念日：只在临近时说话；只认有原话作证的记录，缺日期就不算。 */
function readAnniversaryNote() {
  try {
    return describeAnniversaries(factStore.snapshot().facts).note
  } catch (error) {
    log('纪念日提示读取失败', error)
    return ''
  }
}

/**
 * 作息：只记「这个点常不常在电脑前」，不记说了什么。
 *
 * 文件读写都是尽力而为：读坏了就当作还没认识这个人，写失败了下一拍再写。
 * 不允许一份作息文件影响主动说话本身。
 */
const rhythmFile = path.join(userData, 'presence-rhythm.json')
let rhythmState = emptyRhythm()
let rhythmSaveTimer = null
/** 桌面上一次有人说话的时间；时机模型靠它判断「刚聊完」。 */
let lastDesktopUserSpokeAt = 0

try {
  rhythmState = normalizeRhythm(JSON.parse(fsSync.readFileSync(rhythmFile, 'utf8')))
} catch {
  rhythmState = emptyRhythm()
}

function saveRhythmSoon() {
  if (rhythmSaveTimer !== null) return
  rhythmSaveTimer = setTimeout(() => {
    rhythmSaveTimer = null
    void fs.writeFile(rhythmFile, JSON.stringify(rhythmState)).catch((error) => {
      log('作息保存失败：', error?.message ?? error)
    })
  }, 5_000)
  rhythmSaveTimer.unref?.()
}

/** 退出前把防抖窗口里的最后一笔作息同步写掉，不让 5 秒防抖吞掉它。 */
function flushRhythmNow() {
  if (rhythmSaveTimer !== null) {
    clearTimeout(rhythmSaveTimer)
    rhythmSaveTimer = null
  }
  try {
    fsSync.writeFileSync(rhythmFile, JSON.stringify(rhythmState))
  } catch (error) {
    log('作息退出落盘失败：', error?.message ?? error)
  }
}

/** 桌面上有人说话：记一笔作息，顺便把「刚聊完」的计时起点推到现在。 */
function noteDesktopActivity(scope, at) {
  if (scope !== 'desktop') return
  // at 可能是 ISO 字符串（onExchange 传来）：Date.parse 兜一层，别把整条作息压成「此刻」。
  const stamp =
    Number.isFinite(Number(at)) && Number(at) > 0
      ? Number(at)
      : typeof at === 'string' && at !== '' && Number.isFinite(Date.parse(at))
        ? Date.parse(at)
        : Date.now()
  lastDesktopUserSpokeAt = stamp
  rhythmState = recordActivity(rhythmState, stamp)
  saveRhythmSoon()
}

/** 系统空闲多久（毫秒）。拿不到就返回 null，不拿它拦人。 */
function systemIdleMs() {
  try {
    const seconds = Number(powerMonitor.getSystemIdleTime())
    return Number.isFinite(seconds) ? Math.max(0, seconds) * 1000 : null
  } catch {
    return null
  }
}

let presenceTimer = null

// presenceIntervalMs 已迁到 src/main/state.ts，调用点传原始分钟值。

// quietModeAt 已迁到 src/main/quiet-mode.ts，调用点显式传 settings.presence.quiet。

/**
 * 主动说话定时器：每 30 秒对一次表，到点才请求模型。
 * 不把间隔直接写进 setInterval —— 设置改完要立刻生效，不用等这一轮走完。
 */
let lastSpokenAt = 0
/** 节目单 ensure 的 in-flight 去重：30 秒一拍的 presenceTick 不叠加生成请求。 */
let dailyPlanEnsureInFlight = null
/** 锁屏或休眠期间不搭话；唤醒后把计时起点推到现在，不补发。 */
let systemAsleep = false

/** 有话头到点时把间隔缩到四成，早一点开口；说完就恢复正常节奏。 */
const LOOP_NUDGE_INTERVAL_SCALE = 0.4

/** 收场多久问一次账本。十分钟足够——收场本来就不是抢时间的事。 */
const CLOSING_TICK_MS = 10 * 60_000
let closingTimer = null
/** 上一拍还没跑完就跳过这一拍，避免同一个会话被连发两句。 */
let closingBusy = false

/**
 * 收场：主动说过、很久没人应的会话，把这句话轻轻放下。
 *
 * 只处理 QQ 私聊。群里一句话没人接太常见，冒一句「那我去忙了」更突兀；
 * 桌面气泡本来就是自言自语，也不需要收尾。
 *
 * 不走模型：这时候最怕模型自己加戏（追问、道歉、解释），
 * 也不值得为一个没人看的句号再付一次生成。文案由 pickCloserLine 轮换。
 */
async function closingTick() {
  if (closingBusy) return
  if (systemAsleep) return

  closingBusy = true
  try {
    for (const scope of proactiveGate.scopes()) {
      // 桌面：她自己在气泡里说过一句，很久没人接，就往回收一句。
      if (scope === 'desktop') {
        const desktopDecision = proactiveGate.decideCloser(scope)
        if (desktopDecision.speak !== true) continue
        const delivered = speakOut({ text: pickCloserLine(desktopDecision.index), scene: 'autonomous', origin: 'closer', scope })
        // 窗口已销毁时 speakOut 返回 false：没真说出去，日志不能写成「已收场」。
        if (delivered !== true) {
          log('[desktop] 收场没送出去（窗口不可用），留到下一拍')
          continue
        }
        log(`[desktop] 收场（第 ${desktopDecision.index} 次）`)
        continue
      }

      // QQ 只处理私聊。群里一句话没人接太常见，隔几小时补一句更突兀。
      if (!scope.startsWith('qq:private:')) continue
      const channel = qq
      if (channel === null || typeof channel.replyText !== 'function') continue
      const openId = scope.slice('qq:private:'.length)
      if (openId === '') continue
      const decision = proactiveGate.decideCloser(scope)
      if (decision.speak !== true) continue

      const line = pickCloserLine(decision.index)
      try {
        const sent = await channel.replyText('private', openId, line)
        // 只有真发出去才记账，失败留到下一拍再试。
        if (!sent) continue
        proactiveGate.markClosed(scope)
        log(`[qq] 收场（第 ${decision.index} 次）：${line}`)
      } catch (error) {
        log(`[qq] 收场失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } finally {
    closingBusy = false
  }
}

function startClosingTimer() {
  if (closingTimer !== null) return
  closingTimer = setInterval(() => {
    void closingTick()
  }, CLOSING_TICK_MS)
  closingTimer.unref?.()
}

function startPresenceTimer() {
  if (presenceTimer !== null) return
  presenceTimer = setInterval(() => {
    void presenceTick()
  }, 30_000)
  presenceTimer.unref?.()
}

/**
 * 挑一条今天可以说的念头：先排掉刚攒下的，再按分量、再按新旧。
 * 读不到池子不影响主动开口，只是退回日程与话头。
 */
function nextSpeakableThought() {
  try {
    const now = Date.now()
    const open = thoughtPool.list({ scope: 'desktop', status: 'open', limit: 20 })
    return (
      open
        .filter((item) => now - item.createdAt >= THOUGHT_MIN_AGE_MS)
        .sort(
          (left, right) =>
            Number(right.weight ?? 0) - Number(left.weight ?? 0) || right.createdAt - left.createdAt
        )[0] ?? null
    )
  } catch (error) {
    log(`[desktop] 读取念头池失败：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function presenceTick() {
  if (settings?.presence?.aiEnabled !== true) return
  if (win === null || win.isDestroyed() || !win.isVisible()) return
  if (systemAsleep) return
  // 临时安静（专注模式）：到点自动恢复，不需要改设置。
  if (isTemporarilyQuiet()) return
  // 夜间不扰：静音与「只留提醒」都跳过搭话；降频把间隔拉长到 3 倍。
  const quietMode = quietModeAt(new Date(), settings?.presence?.quiet)
  if (quietMode === 'silent' || quietMode === 'urgentOnly') return

  // 时机：刚聊完、人不在电脑前，都先让出这一拍。
  // 常聊的时段可以早一点，深夜则明显慢一点；尺度由 timing 统一算。
  const timing = assessTiming({
    now: Date.now(),
    lastUserSpokeAt: lastDesktopUserSpokeAt,
    idleMs: systemIdleMs(),
    rhythm: rhythmState
  })
  if (timing.speak !== true) {
    log(`[desktop] 这一拍时机不对（${timing.reason}）`)
    return
  }

  // 主动说话前顺手确保今天的节目单在；不等它，先按现有安排说话。
  // 生成成功要几秒，下一拍才会用上；失败就继续沿用昨天的结构。
  // in-flight 去重：30 秒一拍，生成要几秒到几十秒，慢请求不能叠加成并发写同一份。
  if (dailyPlanEnsureInFlight === null) {
    dailyPlanEnsureInFlight = Promise.resolve()
      .then(() => dailyPlanService.ensure())
      .catch((error) => {
        log('[desktop] 节目单生成失败', error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        dailyPlanEnsureInFlight = null
      })
  }

  // 有放置够久、还没回访过的话头时，允许提前一次。
  const loop =
    typeof companionService?.pendingLoop === 'function' ? await companionService.pendingLoop() : null

  // 开口账本：每天有上限；连续开口、对方一直没接话时把间隔拉长。
  const pacing =
    typeof companionService?.openingPacing === 'function'
      ? await companionService.openingPacing()
      : null
  if (pacing?.blockedReason === 'daily_limit') return

  const scale = loop !== null ? LOOP_NUDGE_INTERVAL_SCALE : 1
  const answeredScale =
    typeof pacing?.intervalScale === 'number' && pacing.intervalScale > 0 ? pacing.intervalScale : 1
  const interval =
    presenceIntervalMs(settings?.presence?.intervalMinutes) *
    (quietMode === 'reduce' ? 3 : 1) *
    scale *
    answeredScale *
    timing.scale
  // 重启后也要认上一次开口时间，避免刚打开就立刻搭话。
  const lastSpoken = Math.max(
    lastSpokenAt,
    typeof pacing?.lastSpokenAt === 'number' ? pacing.lastSpokenAt : 0
  )
  if (Date.now() - lastSpoken < interval) return

  // 特定时刻排在念头池前面：早安、晚安、天气转坏都有明确的时间窗，错过就没了。
  // 这些句子由时刻表自己写，不经过模型——一句话的问候没必要等一次推理。
  const momentNow = new Date()
  const momentDay = localDayKey(momentNow)
  for (const key of spokenMoments) {
    if (!key.startsWith(momentDay)) spokenMoments.delete(key)
  }
  const momentWeather =
    settings?.presence?.useWeather === false
      ? null
      : await fetchWeather({ city: settings?.presence?.city })
  const moment = nextMoment({
    now: momentNow,
    spokenKeys: spokenMoments,
    weatherAlert: typeof momentWeather?.alertNote === 'string' ? momentWeather.alertNote : '',
    name: typeof settings?.nickname === 'string' ? settings.nickname : ''
  })
  if (moment !== null) {
    spokenMoments.add(moment.key)
    lastSpokenAt = Date.now()
    log(`[desktop] 时刻开口：${moment.kind}`)
    speakOut({ text: moment.line, scene: 'moments', origin: 'notice' })
    return
  }

  // 重要日子：考试、面试这类，从记忆里自己找，提前三天开始提。
  // 同一件事只说一次，key 用日期收尾，换个日子才算新的一件。
  const upcoming = upcomingFromMemory(momentNow)
  if (upcoming.length > 0) {
    const item = upcoming[0]
    const upcomingKey = `${momentDay}:upcoming:${item.date.toISOString().slice(0, 10)}`
    if (!spokenMoments.has(upcomingKey)) {
      spokenMoments.add(upcomingKey)
      lastSpokenAt = Date.now()
      log(`[desktop] 时刻开口：upcoming ${item.label}`)
      speakOut({
        text: renderUpcomingLine(item, typeof settings?.nickname === 'string' ? settings.nickname : ''),
        scene: 'moments',
        origin: 'notice'
      })
      return
    }
  }

  // 陪伴层先回答「这一拍为什么开口」：日程段落、未完话头、很久没联系。
  // 先有由头，再过闸门；没有由头就不硬找话题，这一拍安静地过去。
  // 身体状态也参与判断：睡着了、精力见底就安静过去，只是累了先不挑日常话题。
  let body = null
  if (bodyLayerOn()) {
    await bodyService.tick()
    body = bodyService.snapshot()
    // 睡着或深夜安静＝真的在休息：休息需求被满足一点。
    // 没有这个出口，rest 只会自然回升、6 小时后把主动开口永久压停。
    const flags = body?.flags ?? {}
    if (flags.exhausted === true || flags.asleep === true || quietMode === 'reduce') {
      emotionRuntime.noteRest()
    }
  }
  // 念头池排在最前：先挑一条攒了二十分钟以上、还没说过的。
  const thought = nextSpeakableThought()
  const opening = await companionService.pickOpening({ body, thought })
  const cue = resolveOpeningCue({
    opening,
    loop,
    now: Date.now(),
    lastSpokeAt: lastSpoken
  })
  const cueDecision = proactiveGate.decideByCue('desktop', cue)
  const focusText = opening !== null ? opening.note : (loop?.text ?? '')
  if (cueDecision.speak !== true) {
    log(`[desktop] 这一拍没有开口（${cueDecision.reason}）`)
    try {
      thoughtPool.recordDecision({
        scope: 'desktop',
        speak: false,
        source: opening?.kind ?? 'none',
        reason: cueDecision.reason,
        text: focusText,
        thoughtId: opening?.thoughtId ?? ''
      })
    } catch {
      // 观察台少一条记录没关系，别影响这一拍。
    }
    return
  }
  // 间隔只在真的说出话之后占用：模型超时、返回空都不该烧掉一整拍。
  const result = await presenceService.nextLine(loop !== null ? 'loop' : 'auto', focusText)
  if (typeof result.line === 'string' && result.line !== '') {
    lastSpokenAt = Date.now()
    // 记账与写记忆都交给 speakOut 按 origin='proactive' 处理：占 desktop 这一本账的
    // 每日额度，不影响 QQ；很久没人接时，收场会往回收一句。
    speakOut({
      text: result.line,
      motion: result.motion,
      emojiId: result.emojiId,
      scene: 'autonomous',
      origin: 'proactive',
      reason: cueDecision.reason
    })
    // 日程段落说完就认领，同一段今天不再重复提。
    if (opening !== null && opening.segmentId !== null) await companionService.claimAgenda()
    // 真正说出口之后才记为回访过；没说出话就留到下一拍再试。
    if (loop !== null) companionService.markLoopNudged(loop.id)
    // 一条念头说出去就收起来，之后不再拿同一件事开场。
    if (opening !== null && opening.thoughtId !== null) {
      thoughtPool.markUsed(opening.thoughtId, { scope: 'desktop' })
    }
    // 机会账本只在真正开口后记账；空回复不占今天的额度。
    if (opening !== null) await companionService.noteSpoken?.(opening, result.line)
    try {
      thoughtPool.recordDecision({
        scope: 'desktop',
        speak: true,
        source: opening?.kind ?? 'none',
        gate: 'open',
        reason: cueDecision.reason,
        text: result.line,
        thoughtId: opening?.thoughtId ?? ''
      })
    } catch {
      // 同上：记录失败不打扰已经说出口的话。
    }
  } else {
    try {
      thoughtPool.recordDecision({
        scope: 'desktop',
        speak: false,
        source: opening?.kind ?? 'none',
        reason: 'empty_reply',
        text: focusText,
        thoughtId: opening?.thoughtId ?? ''
      })
    } catch {
      // 同上。
    }
    if (opening !== null) await companionService.noteOpeningFailed?.(opening)
  }
}

/** 由 registerIpc 注入的日报执行入口；定时器通过它触发，不复制第二套逻辑。 */
let dailyReviewRunner = null
let dailyReviewTimer = null
let lastDailyReviewDate = null

/**
 * 每日巡视定时器：每 30 秒对一次表。
 * 关掉开关只是不触发；同一天最多跑一次，避免休眠唤醒后连续补跑。
 */
function startDailyReviewTimer() {
  if (dailyReviewTimer !== null) return
  dailyReviewTimer = setInterval(() => {
    const care = settings?.companion?.care?.dailyReview
    if (care?.enabled !== true) return
    if (dailyReviewRunner === null) return
    // 临时安静期间连提醒也一起停，结束后不补发。
    if (isTemporarilyQuiet()) return

    const now = new Date()
    const today = localDateKey(now)
    if (lastDailyReviewDate === today) return

    const at = typeof care.at === 'string' ? care.at : '22:30'
    const [hour, minute] = at.split(':').map((part) => Number(part))
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return
    // 用「到点没到点」判断，不用「正好这一分钟」：
    // 休眠、关盖子、系统卡顿都会让 30 秒轮询错过整分钟，旧写法当天就不发了。
    const dueMinutes = hour * 60 + minute
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    if (nowMinutes < dueMinutes) return

    // 夜间不扰选「完全静音」时，日报也不发；降频与「保留提醒」都照常。
    if (quietModeAt(now, settings?.presence?.quiet) === 'silent') return

    lastDailyReviewDate = today
    // 失败要兜住：runner reject 时不能变成 unhandled rejection，
    // 当天日期已在上面记过、不再重试，所以更要留一条可查的日志。
    void dailyReviewRunner()
      .then((result) => {
        if (result?.ok === true && typeof result.summary === 'string' && result.summary !== '') {
          speakOut({ text: result.summary, scene: 'moments', origin: 'notice' })
        }
      })
      .catch((error) => {
        log('[daily] 每日巡视执行失败：', error instanceof Error ? error.message : String(error))
      })
  }, 30_000)
  dailyReviewTimer.unref?.()
}

let tempFileSeq = 0

/** 读 JSON 时统一去 BOM：手工编辑 / PowerShell / 备份工具常写出带 BOM 的 UTF-8。 */
async function readJsonFile(file) {
  const raw = await fs.readFile(file, 'utf8')
  return JSON.parse(raw.replace(/^\uFEFF/, ''))
}

async function readJson(file, fallback) {
  try {
    return await readJsonFile(file)
  } catch {
    return fallback
  }
}

/**
 * 设置文件单独处理：主文件坏了先用 .bak，绝不再静默回默认。
 * 两份都不可用时把主文件改名隔离，留证据，也避免下一次写入覆盖唯一的坏文件。
 */
async function readSettings() {
  const candidates = [settingsPath, `${settingsPath}.bak`]
  for (let index = 0; index < candidates.length; index += 1) {
    const file = candidates[index]
    try {
      const value = await readJsonFile(file)
      // JSON 合法不等于结构正确：历史版本曾把文件写成一行路径字符串，
      // 解析能过但没有 window，启动时会在 createWindowOptions 崩掉。
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('settings 根节点不是对象')
      }
      if (index > 0) {
        log('[settings] 主设置不可用，已从备份读取')
        await writeSettings(value).catch((error) =>
          log('[settings] 备份回写失败：', error?.message ?? error)
        )
      }
      return value
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      log('[settings] 读取失败：', file, error?.message ?? error)
    }
  }

  try {
    const quarantine = `${settingsPath}.corrupt-${Date.now()}`
    await fs.rename(settingsPath, quarantine)
    log('[settings] 设置文件与备份均不可用，已隔离：', quarantine)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      log('[settings] 隔离损坏设置失败：', error?.message ?? error)
    }
  }
  return {}
}

/*
 * 插件侧与设置窗是两个进程，都会整份重写 settings.json。
 * 两边必须用同一个锁文件，否则「读-改-写」会互相覆盖。
 */
const SETTINGS_LOCK_PATH = `${settingsPath}.lock`

async function withSettingsLock(run) {
  const deadline = Date.now() + 2000
  for (;;) {
    let handle = null
    try {
      await fs.mkdir(path.dirname(settingsPath), { recursive: true })
      handle = await fs.open(SETTINGS_LOCK_PATH, 'wx')
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      // 进程崩溃/强杀会留下锁文件：超过 30 秒没人续的锁按残留处理，清掉重试，
      // 否则一次崩溃之后每次写设置都永久失败。
      try {
        const stat = await fs.stat(SETTINGS_LOCK_PATH)
        if (Date.now() - stat.mtimeMs > 30_000) {
          await fs.rm(SETTINGS_LOCK_PATH, { force: true })
          log('[settings] 清理崩溃残留的设置锁')
          continue
        }
      } catch {
        // 锁刚好被别人释放：回到循环顶部再抢一次。
        continue
      }
      if (Date.now() >= deadline) throw new Error('等待 settings.lock 超时')
      await new Promise((resolve) => setTimeout(resolve, 20))
      continue
    }
    try {
      return await run()
    } finally {
      await handle.close().catch(() => {})
      await fs.rm(SETTINGS_LOCK_PATH, { force: true }).catch(() => {})
    }
  }
}

/** 每次写设置前备份上一份可解析的内容；坏文件不配覆盖好备份。 */
async function writeSettings(value) {
  // 再兜一道：调用方把路径、字符串或数组递进来时当场拒绝。
  // 不拦的话 settings.json 会被写成一行路径，下次启动 createWindowOptions 直接崩。
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`settings 必须是对象，已拒绝写入 ${typeof value}`)
  }
  return withSettingsLock(async () => {
    try {
      const previous = await readJsonFile(settingsPath)
      await writeJsonAtomic(`${settingsPath}.bak`, previous)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        log('[settings] 旧设置无法解析，保留现有备份：', error?.message ?? error)
      }
    }
    await writeJsonAtomic(settingsPath, value)
    /* 本地改动稍后推回 DSH；DSH 没装时这一步静默跳过 */
    scheduleSettingsPush()
  })
}

/* ---------------- 双端设置同步 ----------------
   桌宠与 DSH 各存一份 settings，结构不一样，这里只搬运语义相同的字段：
   读改写 DSH 的 pet-plugin-state.json，保留它自己的 rev 与其他状态；
   每 5 秒拉一次，靠 settingsStamp 判断谁更新。字段表必须与插件
   lib/settings-sync.mjs 保持一致，改一边就要改另一边。 */

const SETTINGS_SYNC_THEME_TO_PET = { pink: 'SakuraPink', blue: 'OceanBlue', ink: 'Paper' }
const SETTINGS_SYNC_THEME_TO_DSH = { SakuraPink: 'pink', OceanBlue: 'blue', Paper: 'ink' }
const SETTINGS_SYNC_RENDER_TO_PET = { sprite: 'embedded', live2d: 'live2d' }
const SETTINGS_SYNC_RENDER_TO_DSH = { embedded: 'sprite', live2d: 'live2d' }

const SETTINGS_SYNC_FIELDS = [
  { dsh: 'nickname', pet: 'nickname', type: 'string', maxLength: 24 },
  { dsh: 'ui', pet: 'uiMode', type: 'enum', values: ['pet', 'card'] },
  { dsh: 'theme', pet: 'theme.preset', type: 'enum', values: ['pink', 'blue', 'ink'],
    toPet: (v) => SETTINGS_SYNC_THEME_TO_PET[v] ?? 'SakuraPink',
    toDsh: (v) => SETTINGS_SYNC_THEME_TO_DSH[v] ?? 'pink' },
  { dsh: 'renderer', pet: 'renderMode', type: 'enum', values: ['sprite', 'live2d'],
    toPet: (v) => SETTINGS_SYNC_RENDER_TO_PET[v] ?? 'embedded',
    toDsh: (v) => SETTINGS_SYNC_RENDER_TO_DSH[v] ?? 'sprite' },
  { dsh: 'scale', pet: 'window.scale', type: 'number', min: 0.6, max: 1.8 },
  { dsh: 'bubbleMode', pet: 'bubble.mode', type: 'enum', values: ['rotate', 'info', 'talk', 'today'] },
  { dsh: 'bubbleFont', pet: 'bubble.fontSize', type: 'number', min: 11, max: 20 },
  { dsh: 'bubbleWidth', pet: 'bubble.width', type: 'number', min: 0, max: 600 },
  { dsh: 'bubbleStickerSize', pet: 'bubble.stickerSize', type: 'number', min: 24, max: 160 },
  { dsh: 'bubbleRadius', pet: 'bubble.radius', type: 'number', min: 0, max: 28 },
  { dsh: 'bubbleAlpha', pet: 'bubble.alpha', type: 'number', min: 0.5, max: 1 },
  { dsh: 'showHud', pet: 'showHud', type: 'bool' },
  { dsh: 'hudDetail', pet: 'hudDetail', type: 'enum', values: ['full', 'simple', 'simple2'] },
  { dsh: 'hudAlpha', pet: 'hudAlpha', type: 'number', min: 0.4, max: 1 },
  { dsh: 'speechEnabled', pet: 'voice.enabled', type: 'bool' },
  { dsh: 'speechProvider', pet: 'voice.provider', type: 'enum', values: ['system', 'local'] },
  { dsh: 'ttsEndpoint', pet: 'voice.localUrl', type: 'string', maxLength: 300 },
  { dsh: 'soundVolume', pet: 'voice.volume', type: 'number', min: 0, max: 1 },
  { dsh: 'outline', pet: 'presence.outline', type: 'enum', values: ['light', 'dark', 'auto', 'none'] },
  { dsh: 'poseSeconds', pet: 'poseEverySeconds', type: 'number', min: 0, max: 600 },
  { dsh: 'askEveryMinutes', pet: 'askEveryMinutes', type: 'number', min: 0, max: 480 },
  { dsh: 'askHandling', pet: 'askHandling', type: 'enum', values: ['pet-all', 'pet-single', 'both', 'web'] },
  { dsh: 'memoryEnabled', pet: 'companion.memory.enabled', type: 'bool' },
  { dsh: 'qq.enabled', pet: 'channels.qq.enabled', type: 'bool' },
  { dsh: 'qq.appId', pet: 'channels.qq.appId', type: 'string', maxLength: 64 }
]

const dshStatePath = () => path.join(app.getPath('userData'), 'pet-plugin-state.json')

function syncReadPath(source, pathText) {
  if (source === null || typeof source !== 'object') return undefined
  let cursor = source
  for (const part of String(pathText).split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = cursor[part]
  }
  return cursor
}

function syncWritePath(target, pathText, value) {
  const parts = String(pathText).split('.')
  const last = parts.pop()
  let cursor = target
  for (const part of parts) {
    if (cursor[part] === null || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      cursor[part] = {}
    }
    cursor = cursor[part]
  }
  cursor[last] = value
  return target
}

function syncSameValue(a, b) {
  if (typeof a === 'object' && a !== null) return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}

function syncNormalize(field, raw) {
  if (raw === undefined || raw === null) return undefined
  if (field.type === 'bool') return raw === true || raw === 'true'
  if (field.type === 'number') {
    const n = Number(raw)
    if (!Number.isFinite(n)) return undefined
    if (field.min !== undefined && n < field.min) return field.min
    if (field.max !== undefined && n > field.max) return field.max
    return n
  }
  if (field.type === 'enum') return field.values.includes(raw) ? raw : undefined
  return String(raw).slice(0, field.maxLength ?? 400)
}

/**
 * 按当前 settings 重设主窗口尺寸：保留左上角坐标，新尺寸夹回工作区。
 * 设置页的缩放滑杆和 DSH 同步过来的 scale 都走这里，避免两套逻辑。
 */
function reapplyMainWindowSize() {
  if (win === null || win.isDestroyed()) return false
  const next = createWindowOptions(settings, path.join(__dirname, 'preload.cjs'))
  const [x, y] = win.getPosition()
  const bounds = { x, y, width: next.width, height: next.height }
  win.setBounds(clampBoundsToWorkArea(bounds, screen.getDisplayMatching(bounds).workArea))
  void saveWindowState()
  return true
}

let settingsSyncTimer = null
let settingsPushTimer = null
let settingsSyncBusy = false
let lastAppliedSettingsStamp = 0

/** 从 DSH 拉一次：只覆盖映射字段，其余设置保持桌宠自己的。 */
async function pullSettingsFromDsh(force = false) {
  if (settingsSyncBusy) return false
  let remote = null
  try {
    remote = await readJsonFile(dshStatePath())
  } catch {
    return false
  }
  if (remote === null || typeof remote !== 'object') return false
  if (remote.settingsSync === false) return false
  const stamp = Number(remote.settingsStamp ?? 0)
  if (!Number.isFinite(stamp)) return false
  if (!force && stamp <= lastAppliedSettingsStamp) return false
  settingsSyncBusy = true
  try {
    let changed = false
    for (const field of SETTINGS_SYNC_FIELDS) {
      const value = syncNormalize(field, syncReadPath(remote, field.dsh))
      if (value === undefined) continue
      const converted = field.toPet ? field.toPet(value) : value
      if (converted === undefined) continue
      if (syncSameValue(syncReadPath(settings, field.pet), converted)) continue
      syncWritePath(settings, field.pet, converted)
      changed = true
    }
    lastAppliedSettingsStamp = stamp
    if (changed) {
      await writeSettings(settings)
      broadcastSettings(settings)
      /* 尺寸类字段（scale / profile）必须当场重设窗口，否则 DSH 里拖缩放只会写盘，
         立绘看起来完全没反应。 */
      reapplyMainWindowSize()
      log('[settings-sync] 已从 DSH 取到更新的设置')
    }
    return changed
  } finally {
    settingsSyncBusy = false
  }
}

/** 把桌宠这边改过的字段写回 DSH；写前留一份 .sync.bak，失败只记日志。 */
async function pushSettingsToDsh() {
  const target = dshStatePath()
  let remote = null
  try {
    remote = await readJsonFile(target)
  } catch {
    /* DSH 没装或状态还没建，等下一轮 */
    return false
  }
  if (remote === null || typeof remote !== 'object') return false
  if (remote.settingsSync === false) return false
  let changed = false
  for (const field of SETTINGS_SYNC_FIELDS) {
    const value = syncNormalize(field, syncReadPath(settings, field.pet))
    if (value === undefined) continue
    const converted = field.toDsh ? field.toDsh(value) : value
    if (converted === undefined) continue
    if (syncSameValue(syncReadPath(remote, field.dsh), converted)) continue
    syncWritePath(remote, field.dsh, converted)
    changed = true
  }
  if (!changed) return false
  remote.settingsStamp = Math.max(Date.now(), Number(remote.settingsStamp ?? 0) + 1)
  lastAppliedSettingsStamp = remote.settingsStamp
  try {
    await writeJsonAtomic(`${target}.sync.bak`, await readJsonFile(target).catch(() => null))
    await writeJsonAtomic(target, remote)
    log('[settings-sync] 已把本地改动写回 DSH')
    return true
  } catch (error) {
    log('[settings-sync] 写回 DSH 失败：', error?.message ?? error)
    return false
  }
}

/** 设置刚写完，稍等一下再推：一次拖动会连续写很多次。 */
function scheduleSettingsPush() {
  if (settingsPushTimer !== null) clearTimeout(settingsPushTimer)
  settingsPushTimer = setTimeout(() => {
    settingsPushTimer = null
    void pushSettingsToDsh()
  }, 800)
  settingsPushTimer.unref?.()
}

function startSettingsSync() {
  if (settingsSyncTimer !== null) return
  void pullSettingsFromDsh(true)
  settingsSyncTimer = setInterval(() => {
    void pullSettingsFromDsh()
  }, 5000)
  settingsSyncTimer.unref?.()
}

async function writeJson(file, value) {
  await writeJsonAtomic(file, value)
}

/** 账本读取要区分「文件不存在」与「读坏了」：前者是新装，后者必须让迁移失败可见。 */
async function readJsonStrict(file, fallback) {
  try {
    return await readJsonFile(file)
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

/** 临时文件替换，断电不会留下半截 JSON；序号避免并发写互相覆盖。 */
async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  tempFileSeq += 1
  const temp = `${file}.${process.pid}.${tempFileSeq}.tmp`
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8')
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

// localDateKey 统一从 daily-review.mjs 引入：两套实现会让账本和日报各算各的日期。

/** 余额账本单例；迁移与裁剪由 store 负责，宿主只提供读写路径。 */
let balanceLedgerStore = null
/** 轮询器；设置变更时 updateInterval，退出时 stop。 */
let balanceMonitor = null
/** 最近一次抓到的余额；心情与提醒用它判断「是不是真的低」，不把「设过阈值」当低。 */
let lastFetchedBalance = null

/** 此刻余额是不是真的低于阈值；没抓过、没设阈值、余额模块没开都按否。 */
function balanceLowNow() {
  const enabled = settings?.modules?.['builtin.balance']?.enabled === true
  if (!enabled) return false
  const threshold = Number(settings?.balance?.threshold)
  if (!Number.isFinite(threshold) || threshold <= 0) return false
  if (lastFetchedBalance === null || !Number.isFinite(lastFetchedBalance)) return false
  return lastFetchedBalance <= threshold
}

function ensureBalanceStore() {
  if (balanceLedgerStore === null) {
    balanceLedgerStore = createLedgerStore({
      read: () => readJsonStrict(balanceLedgerPath, null),
      write: (value) => writeJsonAtomic(balanceLedgerPath, value),
      timeZone: () => systemTimeZone()
    })
  }
  return balanceLedgerStore
}

/**
 * 抓一次余额，失败抛带 code 的 Error。
 *
 * monitor 的 `fetchBalance` 靠 reject 拿原因；这里不把 HTTP 状态伪装成成功。
 * Key 只在这里读一次，用完即弃，不回传、不写日志。
 */
async function fetchBalanceSnapshot() {
  let apiKey = null
  try {
    apiKey = await requireSecretStore().get(BALANCE_SERVICE, BALANCE_FIELD)
  } catch (error) {
    const failure = new Error('vault unavailable')
    failure.code = 'vault-unavailable'
    failure.cause = error
    throw failure
  }
  if (apiKey === null) {
    const failure = new Error('no key')
    failure.code = 'no-key'
    throw failure
  }

  let payload = null
  try {
    const response = await net.fetch(BALANCE_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
    })
    if (!response.ok) {
      const failure = new Error(`HTTP ${response.status}`)
      failure.code = 'request-failed'
      throw failure
    }
    payload = await response.json()
  } catch (error) {
    if (error?.code === 'request-failed') throw error
    const failure = new Error(String(error?.message ?? error))
    failure.code = 'request-failed'
    failure.cause = error
    throw failure
  }

  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
  const cny = infos.find((item) => item?.currency === 'CNY') ?? infos[0] ?? null
  const asNumber = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const balance = asNumber(cny?.total_balance)
  if (balance === null) {
    const failure = new Error('balance missing')
    failure.code = 'balance-missing'
    throw failure
  }
  lastFetchedBalance = balance

  return {
    balance,
    // 老配置可能没有 balance 段：读取用可选链，缺字段只影响提醒阈值，不影响抓取。
    threshold: Number(settings?.balance?.threshold),
    fetchedAt: Date.now(),
    isAvailable: payload?.is_available === true,
    currency: typeof cny?.currency === 'string' ? cny.currency : 'CNY',
    grantedBalance: asNumber(cny?.granted_balance),
    toppedUpBalance: asNumber(cny?.topped_up_balance)
  }
}

/** 按当前设置启动 / 调整 / 停掉轮询；在 settings 广播后调用，所以改配置不重启。 */
function syncBalanceMonitor() {
  const enabled = settings?.modules?.['builtin.balance']?.enabled === true
  if (!enabled) {
    balanceMonitor?.stop()
    return
  }

  const minutes = Number(settings?.balance?.intervalMinutes)
  const intervalMs = Math.max(1, Math.min(1440, Number.isFinite(minutes) ? minutes : 30)) * 60_000

  if (balanceMonitor === null) {
    balanceMonitor = createBalanceMonitor({
      store: ensureBalanceStore(),
      fetchBalance: fetchBalanceSnapshot,
      intervalMs,
      onAlert: (alert) =>
        speakOut({
          text: `余额只剩 ${alert.balance.toFixed(2)} 元，低于 ${alert.threshold} 元啦。`,
          ackSegment: alert.segment,
          origin: 'notice'
        }),
      onError: (error) => log('[balance]', error?.code ?? error)
    })
    balanceMonitor.start()
    return
  }

  balanceMonitor.updateInterval(intervalMs)
  if (!balanceMonitor.isRunning()) balanceMonitor.start()
}

function stopBalanceMonitor() {
  balanceMonitor?.stop()
  balanceMonitor = null
}

/** 游戏日常单例：只读写排班与检测，不启动真实执行器。 */
let gameDailyService = null

function ensureGameDailyService() {
  if (gameDailyService === null) {
    gameDailyService = createGameDailyService({
      filePath: path.join(userData, 'game-daily.json'),
      writeConfig: (target, config) => writeJsonAtomic(target, config)
    })
  }
  return gameDailyService
}

/**
 * 多游戏日常宿主：state.json + 计划任务 + 运行记录。
 * runner 的路径跟着安装目录走，工作目录留给 app 根，方便 runner 解析 @pet/core。
 */
let gameDailyStore = null

function ensureGameDailyStore() {
  if (gameDailyStore === null) {
    gameDailyStore = createGameDailyStore({
      stateDir: path.join(userData, 'game-daily'),
      runnerPath: path.join(__dirname, 'game-daily-runner.mjs'),
      projectRoot: app.getAppPath()
    })
  }
  return gameDailyStore
}

/** 游戏助手单例：风险门、周常账本、任务目录。默认关闭。 */
let gameAssistantService = null

function ensureGameAssistantService() {
  if (gameAssistantService === null) {
    gameAssistantService = createGameAssistantService({
      filePath: path.join(userData, 'game-assistant.json')
    })
  }
  return gameAssistantService
}

function sendDecision(outcome) {
  if (win === null || win.isDestroyed()) return
  win.webContents.send('pet:decision', outcome)
}

let gatewayFingerprint = ''
let gatewaySyncTimer = null
/** 设置页写入 AppSecret 时使用的 Vault 服务名，与 renderer 保持一致。 */
const QQ_SECRET_SERVICE = 'qq-token'

/** 凭据引用：`vault:<service>` 或 `vault:<service>:<field>`。 */
function readQqCredentialRef(ref) {
  const match = /^vault:([A-Za-z][A-Za-z0-9_-]{0,63})(?::([A-Za-z][A-Za-z0-9_-]{0,63}))?$/.exec(
    typeof ref === 'string' ? ref.trim() : ''
  )
  if (match === null) return null
  return { service: match[1], field: match[2] ?? 'value' }
}

async function readQqClientSecret(ref) {
  if (secretStore === null) return ''
  const parsed = readQqCredentialRef(ref)
  if (parsed === null) return ''
  try {
    return (await secretStore.get(parsed.service, parsed.field)) ?? ''
  } catch (error) {
    log('[qq] 读取 Vault 凭据失败：', error instanceof Error ? error.message : String(error))
    return ''
  }
}

/** QQ 配置指纹：只有真正相关的字段变化才重建连接。 */
function qqFingerprint() {
  return JSON.stringify({
    channels: settings.channels?.qq ?? null,
    appId: devEnv('QQ_BOT_APP_ID'),
    owner: devEnv('QQ_BOT_OWNER_OPENID'),
    target: devEnv('QQ_BOT_OPENID'),
    publicKey: devEnv('QQ_BOT_PUBLIC_KEY'),
    port: devEnv('QQ_WEBHOOK_PORT')
  })
}

/**
 * 设备标识：首次启动生成一次，落在 userData/device-id.json。
 *
 * 原来固定写 'desktop-local'，同一台机器多份数据目录、或两台机器同时上报时
 * 会在远端合并成同一个节点，统计与去重都失真。开发期仍可用 PET_DEVICE_ID 覆盖。
 */
let deviceIdCache = null
async function resolveDeviceId() {
  if (deviceIdCache !== null) return deviceIdCache

  const override = devEnv('PET_DEVICE_ID')
  if (override !== '') {
    deviceIdCache = override
    return deviceIdCache
  }

  const file = path.join(userData, 'device-id.json')
  try {
    const saved = await readJsonFile(file)
    if (typeof saved?.deviceId === 'string' && saved.deviceId.length >= 8) {
      deviceIdCache = saved.deviceId
      return deviceIdCache
    }
  } catch {
    // 不存在或损坏都重新生成；下面会覆盖写回
  }

  deviceIdCache = randomUUID()
  await writeJsonAtomic(file, { deviceId: deviceIdCache }).catch((error) =>
    log('[device-id] 写入失败，本次运行使用临时 ID：', error?.message ?? error)
  )
  return deviceIdCache
}

async function createGateway() {
  const local = new LocalLoopbackChannel()

  const qqSettings = settings.channels?.qq ?? DEFAULT_SETTINGS.channels.qq
  const envAppId = devEnv('QQ_BOT_APP_ID')
  const envSecret = devEnv('QQ_BOT_SECRET')
  const appId = envAppId.length > 0 ? envAppId : qqSettings.appId
  const envOwners = parseOwnerAllowlist(devEnv('QQ_BOT_OWNER_OPENID'))
  const ownerOpenIds =
    envOwners.length > 0 ? envOwners : [...(qqSettings.ownerOpenIds ?? [])]
  const targetOpenId = devEnv('QQ_BOT_OPENID') || qqSettings.targetOpenId || ''
  const publicKey = devEnv('QQ_BOT_PUBLIC_KEY') || qqSettings.publicKey || ''
  const transport = qqSettings.transport === 'webhook' ? 'webhook' : 'gateway'
  // 环境变量配置齐全时视为显式启用，保持旧版本行为；否则看设置开关。
  const enabled =
    (envAppId.length > 0 && envSecret.length > 0) || qqSettings.enabled === true
  // 网关模式允许「先连上、再绑定」：主人名单为空时只记录来源，不接受拍板。
  const observeOnly = enabled && transport === 'gateway' && ownerOpenIds.length === 0
  setQqRuntime({
    enabled,
    transport,
    observeOnly,
    state: enabled ? 'starting' : 'off',
    reason: enabled ? '' : 'QQ 通道未启用',
    webhookListening: false,
    webhookPort: 0,
    webhookError: ''
  })

  const ownerPolicy = new OwnerPolicy(ownerOpenIds)
  const permissionBroker = new PermissionBroker()
  const sessionGate = new SessionModeGate({ broker: permissionBroker })
  sessionGate.onChange((entry) => {
    log(`[session] ${entry.from ?? '-'} → ${entry.to}（${entry.reason}）`)
  })
  // 提权后长时间没动静要自己收回；不在 SessionModeGate 内部起定时器，由宿主驱动。
  if (sessionIdleTimer !== null) clearInterval(sessionIdleTimer)
  sessionIdleTimer = setInterval(() => {
    if (sessionGate.tick()) log('[session] 空闲降回 chat')
  }, 60_000)
  sessionIdleTimer.unref?.()

  qq = null
  if (enabled) {
    const clientSecret = envSecret.length > 0 ? envSecret : await readQqClientSecret(qqSettings.credentialRef)
    if (appId.length === 0) {
      setQqRuntime({ state: 'error', reason: '缺少 AppID' })
      log('[qq] 未启用：缺少 AppID')
    } else if (clientSecret.length === 0) {
      setQqRuntime({ state: 'error', reason: '缺少 AppSecret（Vault 里没有对应条目）' })
      log('[qq] 未启用：缺少 AppSecret（Vault 里没有对应条目）')
    } else if (transport === 'gateway') {
      // 主人名单为空时不再直接放弃：先连上记录来源，用户在设置页绑定后自动转正。
      if (observeOnly) {
        setQqRuntime({
          observeOnly: true,
          reason: '观察模式：还没有主人 openid，先在 QQ 里发一条消息，再回设置页绑定'
        })
        log('[qq] 观察模式：未设置主人 openid，仅记录入站来源，不接受拍板')
      }
      const channel = new QqGatewayChannel({
        appId,
        clientSecret,
        ownerOpenIds,
        ...(targetOpenId.length === 0 ? {} : { targetOpenId }),
        onLog: (message) => log(message),
        // 只记录来源；能不能拍板仍由 owners 集合决定，这里不放宽任何权限。
        onInbound: (info) => {
          setQqRuntime({ lastInboundOpenId: info.senderOpenId, lastInboundAt: Date.now() })
          log(`[qq] 入站来源 openid=${info.senderOpenId}（${info.chatType}）`)
          // 群里的分寸从入站就开始记：热不热闹、同一条有没有重复推，
          // 都要靠每一条消息，而不只是最后决定要回的那几条。
          if (info.chatType === 'group') {
            const groupScope = `qq:group:${info.openId}`
            if (groupManners.duplicate(groupScope, info.msgId)) {
              log('[qq] 跳过重复推送的群消息')
              return
            }
            groupManners.observe({
              scope: groupScope,
              senderOpenId: info.senderOpenId,
              msgId: info.msgId
            })
            // 群友的群消息（含 @ 她的那几条）：入站就写进群记忆，不接话也留上下文。
            // 被叫到的那几句不再缺档——她回复与否，群里连续对话的脉络都在。
            if (info.isOwner !== true && typeof info.content === 'string' && info.content !== '' && memoryEnabled()) {
              const inboundSource = {
                channel: 'qq',
                chatType: 'group',
                openId: info.openId,
                senderOpenId: info.senderOpenId,
                msgId: info.msgId,
                isOwner: false
              }
              const inboundWho = describeSpeaker(inboundSource) || '群友'
              memoryStore.appendTurn('user', `［QQ 群聊｜${inboundWho}］${info.content}`, Date.now(), inboundSource, groupScope)
            }
          }
          // 主人自己的话走正常回复，不再抢一次主动开口；
          // 被 @ 的消息已经走回复通道，同样跳过；
          // 观察模式（还没绑定主人）也不主动对陌生人说话。
          if (info.mentioned === true) return
          if (!observeOnly && !ownerOpenIds.includes(info.senderOpenId)) {
            void maybeSpeakInGroup(info)
          }
        },
        // 主人的普通消息，以及群里任何人对她的 @，都进聊天链路；
        // 观察模式与没被 @ 的陌生人消息不会触发这里。
        onMessage: (info) => {
          void handleQqChat(info)
        },
        // 进群 / 退群决定了之后还有没有群消息可收。
        // 群里突然安静时，先看日志里有没有这一条，能直接排除「人已经不在群里」。
        onSystemEvent: (event) => {
          const label = event.type === 'GROUP_ADD_ROBOT' ? '进群' : '被移出群'
          log(`[qq] 机器人${label} group=${event.groupOpenId}`)
        },
        onError: (error) => {
          setQqRuntime({ state: 'error', reason: `网关错误：${error.message}` })
        }
      })
      channel.onReadyChange?.((ready) => {
        setQqRuntime({
          state: ready ? 'ready' : 'error',
          reason: ready
            ? observeOnly
              ? '已连接（观察模式）：在 QQ 里发一条消息，再回设置页绑定主人'
              : ''
            : '网关连接已断开，正在重连'
        })
      })
      try {
        await channel.start()
        qq = channel
        // start() 只负责建连，不等握手；错误回调可能已经先写入 error，不能覆盖。
        if (channel.isReady === true) {
          setQqRuntime({
            state: 'ready',
            reason: observeOnly ? '已连接（观察模式）：在 QQ 里发一条消息，再回设置页绑定主人' : ''
          })
        } else if (qqRuntime.state !== 'error') {
          setQqRuntime({ state: 'starting', reason: '正在连接 QQ 网关' })
        }
        log('[qq] 网关通道已启动')
      } catch (error) {
        await channel.stop().catch(() => undefined)
        const message = error instanceof Error ? error.message : String(error)
        setQqRuntime({ state: 'error', reason: `网关启动失败：${message}` })
        log('[qq] 网关启动失败：', message)
      }
    } else if (ownerOpenIds.length === 0) {
      // webhook 拿不到来源回传，做不了「先连后绑」，仍要求先填主人。
      setQqRuntime({ state: 'error', reason: '缺少主人 openid，webhook 模式需要先填写' })
      log('[qq] 未启用：webhook 模式缺少主人 openid')
    } else if (publicKey.length === 0) {
      // 没有公钥就无法验签，webhook 等于对任何能连上端口的人敞开。
      setQqRuntime({ state: 'error', reason: '缺少 QQ 公钥，webhook 无法验签' })
      log('[qq] 未启用：缺少 QQ 公钥，webhook 无法验签')
    } else {
      qq = new QqOfficialChannel({
        appId,
        clientSecret,
        publicKey,
        ownerOpenIds,
        ...(targetOpenId.length === 0 ? {} : { target: { kind: 'c2c', openId: targetOpenId } })
      })
    }
  }

  gateway = new DecisionGateway({
    deviceId: await resolveDeviceId(),
    channels: qq === null ? [local] : [local, qq],
    timeoutMs: 300_000,
    timeoutPolicy: 'fallback-local',
    // 远程回复必须带 spoof-resistant 身份，并且只在主人私聊里才放行。
    authorizeReply: (reply, _envelope, channelId) => {
      const sender = reply.sender
      if (sender === undefined) return false
      if (sender.chatType === undefined) {
        log(`[decision] 拒绝无会话类型的回复：channel=${channelId}`)
        return false
      }
      const message = { userId: sender.id, chatType: sender.chatType }
      if (!ownerPolicy.isOwner(message)) {
        log(`[decision] 拒绝非主人回复：channel=${channelId} chat=${sender.chatType}`)
        return false
      }
      applyIncomingMessage(sessionGate, ownerPolicy, message)
      return true
    }
  })

  if (qq !== null && transport === 'webhook') {
    const envPort = devEnv('QQ_WEBHOOK_PORT')
    const rawPort = Number(
      envPort !== '' ? envPort : (qqSettings.webhookPort ?? DEFAULT_SETTINGS.channels.qq.webhookPort)
    )
    const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 8787
    const server = http.createServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/qq/webhook') {
        response.writeHead(404).end()
        return
      }
      // 用 Buffer.concat 收齐再解码：一个多字节汉字跨 chunk 时，
      // 逐个 toString 会把它切成替换字符，验签或 JSON 解析偶发失败。
      const chunks = []
      let total = 0
      for await (const chunk of request) {
        chunks.push(chunk)
        total += chunk.length
        if (total > 64 * 1024) {
          response.writeHead(413).end()
          return
        }
      }
      const body = Buffer.concat(chunks, total).toString('utf8')
      try {
        const result = await qq.handleWebhook(body, request.headers)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(result))
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN'
        const status = code === 'SIGNATURE_INVALID'
          ? 401
          : code === 'CHANNEL_NOT_CONFIGURED'
            ? 503
            : 400
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: String(code) }))
      }
    })
    webhookServer = server
    setQqRuntime({ webhookPort: port })
    server.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error)
      setQqRuntime({
        state: 'error',
        reason: `webhook 监听失败：${message}`,
        webhookListening: false,
        webhookError: message
      })
      log('[qq] webhook 监听失败：', message)
      try {
        server.close()
      } catch {
        // 监听失败时 close 可能同步抛错，端口没有真正占上。
      }
      if (webhookServer === server) webhookServer = null
    })
    server.listen(port, '127.0.0.1', () => {
      setQqRuntime({
        state: 'ready',
        reason: '',
        webhookListening: true,
        webhookError: ''
      })
      log(`QQ webhook 监听 127.0.0.1:${port}/qq/webhook`)
    })
  }

  gatewayFingerprint = qqFingerprint()
}

/** 设置变更后按指纹重建；配置没变时不动现有连接。 */
function scheduleGatewaySync() {
  if (gatewaySyncTimer !== null) clearTimeout(gatewaySyncTimer)
  gatewaySyncTimer = setTimeout(() => {
    gatewaySyncTimer = null
    void syncGatewayIfNeeded().catch((error) =>
      log('[qq] 重建通道失败：', error instanceof Error ? error.message : String(error))
    )
  }, 400)
  gatewaySyncTimer.unref?.()
}

async function syncGatewayIfNeeded(force = false) {
  // 凭据写入磁盘不会改变 settings 指纹，必须由调用方显式强制重建。
  if (!force && gateway !== null && qqFingerprint() === gatewayFingerprint) return
  gateway?.dispose()
  gateway = null
  if (webhookServer !== null) {
    webhookServer.close()
    webhookServer = null
  }
  const previous = qq
  qq = null
  if (previous !== null) await previous.stop?.().catch(() => undefined)
  await createGateway()
}

/**
 * 旧版把 LLM Key 明文写在 settings.json。启动时迁进 Vault 的 service store，
 * 擦掉明文再写回。迁移失败不影响启动，只记原因，不记 Key 本身。
 */

/** 备份与导入只碰这三个本机数据文件；模型和素材不进备份。 */
const BACKUP_FILES = ['secrets.bin', 'memory.bin', 'vault-state.json']

/** 旧数据文件是否还在：用来区分「首次安装」和「密钥丢了但旧数据还在」。 */
async function hasVaultDataFiles() {
  for (const name of BACKUP_FILES) {
    try {
      await fs.access(path.join(userData, name))
      return true
    } catch {
      // 继续看下一个文件。
    }
  }
  return false
}

async function readBackupFiles() {
  const files = []
  for (const name of BACKUP_FILES) {
    try {
      files.push({ name, data: new Uint8Array(await fs.readFile(path.join(userData, name))) })
    } catch {
      // 没写过的文件不放进备份，导入时也不会凭空造一个空文件。
    }
  }
  return files
}

// describeError 已迁到 src/main/error.ts。

async function migrateLegacySettingsKey(store) {
  const raw = await readSettings()
  const legacy = typeof raw === 'object' && raw !== null ? raw : {}
  const adapter = {
    getApiKey: () => store.get(BALANCE_SERVICE, BALANCE_FIELD),
    setApiKey: (key) => store.set(BALANCE_SERVICE, key, BALANCE_FIELD),
    clearApiKey: () => store.clear(BALANCE_SERVICE, BALANCE_FIELD)
  }

  try {
    const result = await migrateLegacyLlmKey(legacy, adapter)
    legacyKeyMigrationWarning = null
    if (!result.migrated) return
    const scrubbed = scrubLegacyLlmKey(legacy)
    await writeSettings(scrubbed)
    settings = mergeLayer(DEFAULT_SETTINGS, scrubbed)
    log('[secrets] 旧版明文 LLM Key 已迁入 Vault，并从 settings.json 擦除')
  } catch (error) {
    // 不吞掉：迁移失败意味着明文可能还在盘上，设置页与诊断都要能看到。
    const message = describeError(error)
    legacyKeyMigrationWarning = {
      code: 'LEGACY_KEY_NOT_MIGRATED',
      message,
      at: new Date().toISOString()
    }
    log('[secrets] 旧密钥迁移失败，settings.json 保持原样：', message)
  }
}

/**
 * 装配加密仓库。
 *
 * 必须在 app.whenReady() 之后：safeStorage 在此之前调用会抛错。
 * 装配失败不阻断启动 —— 桌宠本身还能用，密钥相关 IPC 会明确报错，
 * 不静默退回明文，也不假装成功。
 */
async function initVault() {
  try {
    vault = await createVault({
      keyFilePath: vaultKeysPath,
      safeStorage: {
        isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
        getSelectedStorageBackend: () =>
          typeof safeStorage.getSelectedStorageBackend === 'function'
            ? safeStorage.getSelectedStorageBackend()
            : 'unknown',
        encryptString: (plain) => safeStorage.encryptString(plain),
        decryptString: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted))
      },
      stateFilePath: vaultStatePath,
      appVersion: app.getVersion()
    })

    const client = new VaultClient(new MemoryVaultStorage(), new AesGcmProvider(), vault.ring)
    vaultClient = client
    const store = new KeyRingVaultStore({
      client,
      storage: {
        read: async () => {
          try {
            return await fs.readFile(secretsPath, 'utf8')
          } catch {
            return null
          }
        },
        write: async (text) => {
          await fs.writeFile(secretsPath, text, 'utf8')
          await restrictPermissions(secretsPath)
        },
        // 先写临时文件再替换，断电不会留下半截密文。
        writeAtomic: async (text) => {
          const temp = `${secretsPath}.tmp`
          await fs.writeFile(temp, text, 'utf8')
          await restrictPermissions(temp)
          await fs.rename(temp, secretsPath)
          await restrictPermissions(secretsPath)
        }
      }
    })

    secretStore = new VaultServiceSecretStore(store)
    await migrateLegacySettingsKey(secretStore)
    // SMTP 密码同样不留在明文设置里：迁移进加密仓库，设置只留空位。
    // 迁移失败也不致命：发送时始终优先读加密仓库，明文只作兜底。
    try {
      const smtpPass = settings?.mail?.smtp?.pass
      if (typeof smtpPass === 'string' && smtpPass !== '') {
        await secretStore.set('mail', 'smtp.pass', smtpPass)
        const next = structuredClone(settings)
        if (next.mail?.smtp !== null && typeof next.mail?.smtp === 'object') {
          next.mail.smtp.pass = ''
        }
        await writeSettings(next)
        log('[mail] SMTP 密码已迁移进加密仓库')
      }
    } catch (error) {
      log('[mail] SMTP 密码迁移失败，保留明文兜底', String(error?.message ?? error))
    }
    const diagnostic = await vault.diagnose()
    log(
      'vault 已装配：',
      `backend=${diagnostic.backend}`,
      `secure=${String(diagnostic.secure)}`,
      `permission=${diagnostic.permission}`,
      `keyRing=${diagnostic.keyRingState}`,
      `signer=${diagnostic.signerState}`
    )

    // 首次安装也会 rebuilt，只有「旧数据文件还在」才值得提醒；否则只是新生成密钥。
    if (diagnostic.keyRingState === 'quarantined') {
      vaultStartupNotice = {
        kind: 'quarantined',
        message: '加密密钥文件损坏，已隔离并重新生成。旧记忆可能打不开，可到「设置 → 运行状态 → 加密备份」用备份恢复。'
      }
      log('[vault] 密钥文件已隔离重建', diagnostic.recoveredFrom ?? '')
    } else if (diagnostic.keyRingState === 'rebuilt' && (await hasVaultDataFiles())) {
      vaultStartupNotice = {
        kind: 'rebuilt',
        message: '加密密钥缺失，已重新生成。旧记忆可能打不开，可到「设置 → 运行状态 → 加密备份」用备份恢复。'
      }
      log('[vault] 密钥环重建，且本机仍有旧数据文件')
    }

    const memoryLoaded = await memoryStore.load()
    log('记忆已加载：', JSON.stringify(memoryLoaded))

    // 说话习惯的旧明文不等人来聊天：启动时读一次、换成密文、再删掉旧的。
    // vault 这会儿已经装配好，seal 可用；失败就保留旧文件，下次启动再试。
    try {
      await speechHabits.load()
      const habitSaved = await speechHabits.flush()
      if (habitSaved.ok !== true) log('[habits] 启动迁移未完成：', habitSaved.error ?? '')
    } catch (error) {
      log('[habits] 启动迁移失败：', String(error?.message ?? error))
    }
    // 记忆整理：启动时先扫一次，之后每天一次。只归档久未想起的原文，
    // 事实和经验不动，归档内容仍留在磁盘上、管理页可查。
    if (memoryLoaded.ok) {
      const swept = memoryStore.sweep()
      if (swept.archived > 0) log('记忆整理：归档', swept.archived, '条')
      const sweepTimer = setInterval(() => {
        const result = memoryStore.sweep()
        if (result.archived > 0) log('记忆整理：归档', result.archived, '条')
      }, 24 * 60 * 60 * 1000)
      sweepTimer.unref?.()
    }

    const historyLoaded = await chatHistoryStore.load()
    const restored = chatService.hydrate(chatHistoryStore.recent(200))
    log('聊天历史已加载：', JSON.stringify({ ...historyLoaded, restored }))
    // 旧聊天里明确的自我陈述整理成记忆线索：标成「被问到再说」，不急着端出来。
    // 已经记过的条目会跳过，所以每次启动跑一遍也不会把强度刷高。
    try {
      const factLoaded = await factStore.load()
      if (factLoaded.ok === true) {
        await importHistoryCandidates({
          messages: chatHistoryStore.recent(200),
          factStore,
          scope: 'desktop',
          log: (message) => log(`[history] ${message}`)
        })
      }
    } catch (error) {
      log('历史聊天整理失败', error)
    }
  } catch (error) {
    vault = null
    vaultClient = null
    secretStore = null
    // 加密不可用时不保留任何明文副本，统计里也会如实显示「不可用」。
    memoryStore.disable()
    chatHistoryStore.disable()
    log('vault 装配失败：', error instanceof Error ? error.message : String(error))
  }
}

function requireSecretStore() {
  if (secretStore === null) {
    throw new Error('VAULT_UNAVAILABLE：加密仓库没有装配成功，拒绝以明文替代')
  }
  return secretStore
}

/**
 * 状态条采样开关。
 *
 * 采样器每 6 秒拉一次 PowerShell 读网速 / 电量，还要试 nvidia-smi。
 * 状态条默认关闭，就不该让这套子进程常驻；打开或关掉时即时生效。
 */
function syncHudSampler() {
  const enabled = settings?.showHud === true && settings?.hudDetail !== 'off'
  if (enabled) void systemStats.start()
  else systemStats.stop()
}

/**
 * 把桌宠设置里插件认识的字段同步过去。
 *
 * 插件那边是另一份 state，桌宠改了设置它不会自己知道。走 pet-command.json 的
 * state 动作写回，插件按 patch 浅合并，没提交的字段保留原值。
 */
async function syncPluginSettings(next) {
  if (next === null || typeof next !== 'object') return
  const patch = {}
  if (typeof next.nickname === 'string') patch.nickname = next.nickname
  if (Number.isFinite(next.window?.scale)) patch.scale = next.window.scale
  if (typeof next.bubble?.mode === 'string') patch.bubbleMode = next.bubble.mode
  if (Number.isFinite(next.bubble?.radius)) patch.bubbleRadius = next.bubble.radius
  if (Number.isFinite(next.bubble?.alpha)) patch.bubbleAlpha = next.bubble.alpha
  if (typeof next.bubble?.fontFamily === 'string') patch.bubbleFont = next.bubble.fontFamily
  if (typeof next.askHandling === 'string') patch.askHandling = next.askHandling
  if (Number.isFinite(next.askEveryMinutes)) patch.askEveryMinutes = next.askEveryMinutes
  if (Number.isFinite(next.poseEverySeconds)) patch.poseSeconds = next.poseEverySeconds
  if (Number.isFinite(next.soundLevel)) patch.soundVolume = next.soundLevel
  if (typeof next.voice?.enabled === 'boolean') patch.speechEnabled = next.voice.enabled
  if (typeof next.voice?.provider === 'string') patch.speechProvider = next.voice.provider
  if (Object.keys(patch).length === 0) return

  const target = path.join(app.getPath('userData'), 'pet-command.json')
  const temp = `${target}.tmp`
  await fs.writeFile(temp, JSON.stringify({ action: 'state', patch }), 'utf8')
  await fs.rename(temp, target)
}

/**
 * 设置变更广播给所有窗口；主界面靠它即时更新气泡 / HUD，不必重启。
 */
function broadcastSettings(next) {
  // 设置一变就跟着启停 DSH 念出监听，省得让用户重启。
  syncDshSpeech(next?.voice)
  // 插件在跑时顺手把设置送过去；不在跑时这个文件没人读，写了也不留痕。
  void syncPluginSettings(next).catch((error) => {
    log('[plugin] 设置同步失败', error instanceof Error ? error.message : String(error))
  })
  for (const target of [win, settingsWin, chatWin]) {
    if (target !== null && !target.isDestroyed()) {
      target.webContents.send('pet:settings:changed', next)
    }
  }
  // 开关与间隔都从这里即时生效；settings 已经是合并后的新值。
  syncBalanceMonitor()
  syncHudSampler()
  scheduleGatewaySync()
}

/** 读同步偏好；文件不存在或损坏时回一份空配置，不抛错中断启动。 */
async function getSyncPrefs() {
  if (syncPrefsCache !== null) return syncPrefsCache
  try {
    const parsed = JSON.parse(await fs.readFile(syncPrefsFile, 'utf8'))
    syncPrefsCache = {
      dir: typeof parsed?.dir === 'string' ? parsed.dir : '',
      lastExportAt: typeof parsed?.lastExportAt === 'string' ? parsed.lastExportAt : '',
      lastPullAt: typeof parsed?.lastPullAt === 'string' ? parsed.lastPullAt : ''
    }
  } catch {
    syncPrefsCache = { dir: '', lastExportAt: '', lastPullAt: '' }
  }
  return syncPrefsCache
}

async function saveSyncPrefs(next) {
  const current = await getSyncPrefs()
  syncPrefsCache = { ...current, ...next }
  await fs.writeFile(syncPrefsFile, JSON.stringify(syncPrefsCache), 'utf8')
  await restrictPermissions(syncPrefsFile)
}

/**
 * 建 / 重建同步实例。目录优先级：设置页选过的 > PET_SYNC_DIR > userData/sync。
 * 换目录只换实例，不改 settings，也不动已导出的旧包。
 */
async function initSettingsSync() {
  const prefs = await getSyncPrefs()
  const dir =
    prefs.dir !== '' ? prefs.dir : (devEnv('PET_SYNC_DIR') || path.join(userData, 'sync'))
  settingsSync = createSettingsSync({
    dir,
    node: devEnv('PET_SYNC_NODE', 'desktop-local'),
    readSettings: () => settings,
    // 惰性读取：建 sync 时 vault 还没装好，真正 publish/pull 时才会走到这里。
    getPassphrase: async () => {
      if (secretStore === null) return null
      return await secretStore.get(SYNC_SECRET_SERVICE, SYNC_SECRET_FIELD)
    },
    applySettings: async (patch) => {
      settings = mergeLayer(settings, patch)
      await writeSettings(settings)
      broadcastSettings(settings)
    },
    log
  })
  return settingsSync
}

/**
 * pet-media://<host>/<相对路径> → 对应根目录下的真实文件。
 * 五个 host：
 *   model → mediaRoot（userData/models，Live2D 模型）
 *   asset → assetsRoot（随包表情与立绘）
 *   pack  → packsRoot（用户导入）或内置包根（builtin- 前缀）
 *   inbox → packsRoot/.inbox（QQ 偷图待审核，单层文件名）
 *   background → userData/backgrounds（DSH 背景库，插件上传的那一份）
 * 解析后必须仍在对应根内 —— 挡住 ../ 穿越读别处的文件。
 */
function registerMediaProtocol() {
  // backgrounds 跟着 userData 走：桌宠用 --user-data-dir 指到插件状态目录，
  // 所以这里读到的正好是插件存背景的同一份文件。
  const roots = {
    model: mediaRoot,
    asset: assetsRoot,
    pack: packsRoot,
    background: path.join(app.getPath('userData'), 'backgrounds'),
  }

  protocol.handle('pet-media', async (request) => {
    let target
    let root
    let viaPackStore = false
    try {
      const url = new URL(request.url)
      // 照片目录是运行期才定的，跟着拍照模块走。
      root = url.host === 'photo' ? photoRootDir : roots[url.host]
      // inbox 不在 roots 表里：它的根是 packsRoot/.inbox，由 stickerInbox 自己管。
      // photo 的根在拍照模块创建后才有值，没值就当不存在，不拿空串去拼路径。
      if ((root === undefined || root === '') && url.host !== 'inbox') {
        log('[media] 拒绝未知前缀请求', request.url)
        return new Response('not found', { status: 404 })
      }
      const relative = decodeURIComponent(url.pathname).replace(/^[/\\]+/, '')
      if (relative === '' || relative.includes('\0')) {
        return new Response('not found', { status: 404 })
      }
      if (url.host === 'inbox') {
        const resolved = await stickerInbox.resolvePath(relative)
        if (resolved === null) {
          log('[media] 拒绝越界待审核请求', request.url)
          return new Response('forbidden', { status: 403 })
        }
        target = resolved
        viaPackStore = true
      } else if (url.host === 'pack') {
        const slash = relative.indexOf('/')
        if (slash <= 0) return new Response('not found', { status: 404 })
        const packId = relative.slice(0, slash)
        const resolved = packStore.resolvePackPath(packId, relative.slice(slash + 1))
        if (resolved === null) {
          log('[media] 拒绝越界包请求', request.url)
          return new Response('forbidden', { status: 403 })
        }
        target = resolved
        viaPackStore = true
      } else {
        target = path.resolve(root, relative)
      }
    } catch {
      return new Response('bad request', { status: 400 })
    }

    if (!viaPackStore) {
      const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
      if (target !== root && !target.startsWith(rootWithSep)) {
        log('[media] 拒绝越界请求', request.url)
        return new Response('forbidden', { status: 403 })
      }
      // 词法检查挡不住 junction / symlink：Windows 上 mklink /J 建的目录，
      // path.resolve 完全看不出它指向哪里。解析真实路径后再比一次。
      try {
        const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)])
        const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep
        if (realTarget !== realRoot && !realTarget.startsWith(realRootWithSep)) {
          log('[media] 拒绝软链接越界请求', request.url)
          return new Response('forbidden', { status: 403 })
        }
        target = realTarget
      } catch (error) {
        log('[media] 路径解析失败', request.url, String(error))
        return new Response('not found', { status: 404 })
      }
    }

    try {
      return await net.fetch(pathToFileURL(target).toString())
    } catch (error) {
      log('[media] 读取失败', target, String(error))
      return new Response('not found', { status: 404 })
    }
  })

  log('[media] pet-media://model →', mediaRoot)
  log('[media] pet-media://asset →', assetsRoot)
  log('[media] pet-media://pack →', packsRoot)
  log('[media] pet-media://background →', roots.background)
}

/**
 * 所有已注册通道。诊断用 registered 报告真实注册面，门禁脚本拿它和白名单比对。
 * 未登记的通道在这里直接抛错，避免「能调但不在清单里」的灰通道。
 */
const registeredChannels = new Set()
/** 注册失败的通道单独记账；一条拼错不该让整条装配链断掉、让桌宠白屏。 */
const channelErrors = []

function registerChannel(channel, listener) {
  try {
    assertChannel(channel)
    if (registeredChannels.has(channel)) {
      throw new Error(`IPC 通道重复注册：${channel}`)
    }
    // 先注册成功再记账：handle 抛错时不把名字留在 Set 里，重试不会被自己挡住。
    ipcMain.handle(channel, listener)
    registeredChannels.add(channel)
  } catch (error) {
    const message = error?.message ?? String(error)
    channelErrors.push({ channel, message })
    log(`[ipc] 通道注册失败 ${channel}：${message}`)
  }
}

function registerIpc() {
  /*
   * 人格问卷：题库与计分只在 lib/companion/persona/persona-assessment.mjs 里维护一份。
   * 渲染进程拿 schema 渲题、把答案交回来算；主进程不重复实现量表。
   */
  registerChannel('pet:assessment:schema', () => assessmentSchema())
  registerChannel('pet:assessment:score', (_event, answers) => scoreAssessment(answers))
  registerChannel('pet:assessment:save', async (_event, payload) => {
    const answers =
      payload !== null &&
      typeof payload === 'object' &&
      payload.answers !== null &&
      typeof payload.answers === 'object'
        ? payload.answers
        : {}

    const result = scoreAssessment(answers)
    const previous = settings?.persona?.assessment ?? null
    const record = {
      version: 1,
      answers,
      result,
      previousResult: previous?.result ?? null,
      comparison:
        previous?.result === undefined || previous?.result === null
          ? null
          : compareAssessments(previous.result, result),
      updatedAt: new Date().toISOString()
    }

    // 整个 settings 原样写回：只多一个 persona.assessment 字段，其他配置不动。
    settings = {
      ...settings,
      persona: { ...(settings?.persona ?? {}), assessment: record }
    }
    await writeSettings(settings)
    return { ok: true, assessment: record }
  })

  // 无副作用查询通道集中注册；写操作仍留在下方，阶段二再迁 ipc/mutations.ts。
  registerQueryChannels({
    registerChannel,
    getSettings: () => settings,
    getLastRenderInfo: () => lastRenderInfo,
    modelStore,
    packStore,
    stickerInbox,
    assetLibrary,
    systemStats,
    presenceService,
    chatService,
    chatHistoryStore,
    memoryStore,
    memoryEnabled,
    collectMemoryAll,
    requireSecretStore,
    getSecretStore: () => secretStore,
    getVault: () => vault,
    buildPersonaPrompt,
    getBackupPrefs,
    fs,
    path,
    app,
    userData,
    reportsDir,
    balanceService: BALANCE_SERVICE,
    balanceField: BALANCE_FIELD,
    syncSecretService: SYNC_SECRET_SERVICE,
    syncSecretField: SYNC_SECRET_FIELD,
    defaultSettings: DEFAULT_SETTINGS,
    probeTtsEndpoint,
    toTtsEndpoint,
    isLoopbackEndpoint,
    now: Date.now,
    log
  })

  // 资产与备份域的写操作；其余写通道仍在下方，按域继续迁。
  const mutationDeps = {
    registerChannel,
    dialog,
    getDialogParent: () =>
      settingsWin !== null && !settingsWin.isDestroyed()
        ? settingsWin
        : win !== null && !win.isDestroyed()
          ? win
          : undefined,
    packStore,
    stickerInbox,
    stickerLibrary,
    openStickerWindow,
    sendQqSticker,
    getSettings: () => settings,
    setSettings: (next) => {
      settings = next
    },
    settingsPath,
    sanitizeSettingsPatch,
    mergeLayer,
    settingsTopKeys: SETTINGS_TOP_KEYS,
    // 设置写盘走 writeSettings：原子替换 + 保留上一份 .bak。
    // 调用方按 (file, value) 传参；设置只有一个目标文件，忽略 file、只取 value。
    writeJson: (_file, value) => writeSettings(value),
    applyIconSettings,
    broadcastSettings,
    getBackupPrefs,
    saveBackupPrefs,
    getAppPath: (name) => app.getPath(name),
    getVault: () => vault,
    createVaultBackup,
    readBackupFiles,
    restrictPermissions,
    fs,
    path,
    log
  }
  registerMutationChannels(mutationDeps)

  /** 最近一次因用户动作查到的余额；只用于日报，不主动发起请求。 */
  let lastKnownBalance = null
  // ---- 语音 ----
  // 合成与参考音频选择；软持有生命周期在 voice.ts 内按 sender 维护。
  registerVoiceChannels({
    registerChannel,
    getSettings: () => settings,
    planSpeak,
    createLocalTtsProvider,
    dialog,
    log
  })

  // 设置同步：导出 / 应用 / 目录 / 口令，实现已迁到 ipc/sync.ts。
  registerSyncChannels({
    registerChannel,
    dialog,
    getSettingsSync: () => settingsSync,
    initSettingsSync,
    getSyncPrefs,
    saveSyncPrefs,
    requireSecretStore: () => requireSecretStore(),
    syncSecretService: SYNC_SECRET_SERVICE,
    syncSecretField: SYNC_SECRET_FIELD,
    // 与渲染侧 backup-policy.js 的 PASSPHRASE_MIN_LENGTH 对齐。
    minPassphraseLength: 8,
    log
  })


  // ---- Live2D 模型库 ----  //
  // 模型文件不随包分发，全部由使用者自己从作者处下载后导入，放在 userData/models。
  // 渲染侧只拿 pet-media:// 相对地址，拿不到真实路径。






  // 模型库写操作已迁到 ipc/models.ts。
  registerModelChannels({
    registerChannel,
    dialog,
    getDialogParent: () =>
      settingsWin !== null && !settingsWin.isDestroyed()
        ? settingsWin
        : win !== null && !win.isDestroyed()
          ? win
          : undefined,
    modelStore,
    mediaRoot,
    openPath: (target) => shell.openPath(target),
    getSettings: () => settings,
    setSettings: (next) => {
      settings = next
    },
    settingsPath,
    // 设置写盘走 writeSettings：原子替换 + 保留上一份 .bak。
    // 调用方按 (file, value) 传参；设置只有一个目标文件，忽略 file、只取 value。
    writeJson: (_file, value) => writeSettings(value),
    broadcastSettings,
    log
  })

  // ---- 素材包：用户导入的字体 / 图标 / 气泡 / 表情 ----
  // 只列 userData/packs，不碰 assets/；失败原因原样回渲染侧，界面不猜。


  // 素材包写操作已迁到 ipc/mutations.ts。

  // 查 DeepSeek 账户余额。Key 只在这里读一次，用完即弃，不回传、不写日志。
  // 端点写死在文件顶部，渲染侧没法指定别的地址。
  registerChannel('pet:balance:query', async () => {
    let snapshot = null
    try {
      snapshot = await fetchBalanceSnapshot()
    } catch (error) {
      return {
        ok: false,
        reason: error?.code ?? 'request-failed',
        message: String(error?.message ?? error)
      }
    }

    try {
      const ledger = await ensureBalanceStore().recordBalance(snapshot)
      lastKnownBalance = snapshot.balance
      return {
        ok: true,
        isAvailable: snapshot.isAvailable,
        currency: snapshot.currency,
        totalBalance: snapshot.balance,
        grantedBalance: snapshot.grantedBalance,
        toppedUpBalance: snapshot.toppedUpBalance,
        // v1 切片只保留最新余额；今日消费估算等 c 刀把 opening 并入切片后再恢复。
        todaySpent: null,
        slices: readSlices(ledger)
      }
    } catch (error) {
      return {
        ok: false,
        reason: error?.code ?? 'ledger-write-failed',
        message: String(error?.message ?? error)
      }
    }
  })

  // 余额气泡的「知道了」。只认 v1 segment，避免渲染侧往 acks 里写任意键。
  // 将来系统通知的 tap 也走这条通道，不另建 ack 键。
  registerChannel('pet:balance:ack', async (_event, segment) => {
    if (typeof segment !== 'string' || !/^v1@\d{4}-\d{2}-\d{2}@-?\d+(?:\.\d+)?$/.test(segment)) {
      return { ok: false, reason: 'invalid-segment' }
    }
    try {
      await ensureBalanceStore().markAck(segment, 'confirmed')
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error?.code ?? 'ack-failed' }
    }
  })

  // ---- 聊天 ----
  // 历史只存在内存里；密钥现取现用，不回传渲染侧。
  // 失败原因用 reason 表达，界面按它写清楚，不把错误吞成「出错了」。
  // 写通道已迁到 ipc/chat.ts，通道层只透传；落盘由 chatService 内部负责。
  registerChatChannels({
    registerChannel,
    getChatService: () => chatService,
    // 聊天里被要照片时先真拍一张；不是要照片就返回 null，一句话都不改。
    takePhotoIfAsked: async (text) => {
      if (!wantsSelfie(text)) return null
      const shot = await photoStudio.take()
      if (shot.ok !== true) return { ok: false, reason: shot.reason }
      return {
        ok: true,
        photo: {
          url: photoMediaUrl(shot.photo.path, photoStudio.folder()),
          path: shot.photo.path,
          at: shot.photo.at
        }
      }
    },
    openChatWindow,
    showSaveDialog: (options) => dialog.showSaveDialog(options),
    getDocumentsPath: () => app.getPath('documents'),
    pathJoin: path.join,
    fs: {
      writeFile: (file, data, encoding) =>
        encoding === undefined ? fs.writeFile(file, data) : fs.writeFile(file, data, encoding),
      restrictPermissions
    },
    log
  })

  registerChannel('pet:chat:close', () => {
    if (chatWin !== null && !chatWin.isDestroyed()) chatWin.close()
    return true
  })


  /** 搜索与导出要跨页取全量；单页 500，最多 40 轮，避免异常数据把循环拖住。 */
  function collectMemoryAll() {
    const all = []
    let offset = 0
    for (let round = 0; round < 40; round += 1) {
      const page = memoryStore.list({ offset, limit: 500 })
      const items = Array.isArray(page?.items) ? page.items : []
      all.push(...items)
      offset += items.length
      if (items.length === 0 || offset >= (Number(page?.total) || 0)) break
    }
    return all
  }

  /** 分页读取记忆内容已迁到 ipc/queries.ts，这里保留写导出共用的全量收集。 */

  // 记忆域写通道已迁到 ipc/memory.ts。
  registerMemoryChannels({
    registerChannel,
    memoryStore,
    collectMemoryAll,
    sanitizeReflectionText,
    // 结构化事实只读展示：设置页「她记住的事」用，不参与原文分页。
    factStore,
    dialog,
    documentsDir: app.getPath('documents'),
    pathJoin: (...parts) => path.join(...parts),
    writeFile: (file, data, encoding) => fs.writeFile(file, data, encoding),
    // 导入备份要读整份文件；回调式 fs 包一层，通道层只关心结果。
    readFile: (file, encoding) =>
      new Promise((resolve, reject) => {
        fs.readFile(file, encoding, (error, data) => {
          if (error !== null && error !== undefined) reject(error)
          else resolve(String(data))
        })
      }),
    log
  })

  // 陪伴日程：只读今天这份单，以及手动把后续安排顺延。
  registerCompanionAgendaChannels({
    registerChannel,
    companionService,
    log
  })

  // 观察台：只读快照与三个单会话动作，窗口只开一个。
  registerInsightChannels({
    registerChannel,
    openWindow: openInsightWindow,
    insight,
    affinity,
    memory: memoryStore,
    log
  })

  // ---- 每日巡视与反思 ----
  // 日报只汇总当天已有的数据；反思在日报之上压成三条印象。
  // 定时器受 companion.care.dailyReview 控制；手动触发不受开关限制。
  async function currentMemoryBaseline() {
    const today = localDateKey()
    const state = await readJson(dailyStatePath, null)
    if (state !== null && state?.date === today && Number.isFinite(state?.memoryStart)) {
      return Math.max(0, Math.floor(state.memoryStart))
    }
    const start = memoryStore.stats().count
    await writeJson(dailyStatePath, { date: today, memoryStart: start })
    return start
  }

  async function runDailyReviewOnce() {
    const memoryBefore = await currentMemoryBaseline()
    const review = buildDailyReview({
      turns: chatService.history(),
      memoryBefore,
      memoryAfter: memoryStore.stats().count,
      balance: lastKnownBalance
    })
    const summary = renderSummary(review)
    try {
      const reportPath = await writeDailyReview({ fs, path, dir: reportsDir, review })
      return { ok: true, review, summary, reportPath }
    } catch (error) {
      log('[daily] 报告写入失败：', String(error))
      return { ok: false, reason: 'write-failed', review, summary }
    }
  }

  // 定时器只拿执行入口，不直接持有 IPC 闭包。
  dailyReviewRunner = runDailyReviewOnce

  registerChannel('pet:daily:run', async () => {
    const result = await runDailyReviewOnce()
    if (result.ok) speakOut({ text: result.summary, scene: 'moments', origin: 'notice' })
    return result
  })

  // 点亮一下：优先让模型结合此刻说一句，没密钥 / 调不通时返回本地短句。
  registerChannel('pet:presence:speak', async (_event, reason) => {
    if (settings?.presence?.aiEnabled !== true) return { ok: false, reason: 'disabled' }
    presenceService.noteContact()
    // 模型超时、密钥缺失都会转成结构化结果；任何异常都不能让 IPC 裸奔成 rejected。
    try {
      const result = await presenceService.nextLine(typeof reason === 'string' ? reason : 'manual')
      if (typeof result.line === 'string' && result.line !== '') {
        // scene 仍走 autonomous：dshScenes 是白名单，换成没登记的 'manual'
        // 会让 speechFor 拿不到开关直接返回 null，单击说话就静默失去语音了。
        // origin='onDemand'：记冷却与去重池、写记忆，但不占每日额度、不进未回应队列，
        // 用户正在互动，不该被记成「说了没人理」而触发收场。
        speakOut({
          text: result.line,
          motion: result.motion,
          emojiId: result.emojiId,
          scene: 'autonomous',
          origin: 'onDemand',
          reason: 'manual'
        })
      }
      return result
    } catch (error) {
      log('[presence] 点击说话异常：', error instanceof Error ? error.message : String(error))
      return { ok: false, reason: 'error', message: error?.message ?? String(error) }
    }
  })


  registerChannel('pet:reflection:run', async () => {
    const result = await runDailyReviewOnce()
    // 印象要落在真实断言上：读不到结构化记忆就当没有，不编造。
    let facts = []
    try {
      await factStore.load()
      facts = factStore.snapshot('desktop').facts
    } catch (error) {
      log('[reflection] 读取结构化记忆失败，按空记忆继续：', String(error))
    }
    const impressions = buildReflection({ review: result.review, facts })
    const markdown = renderReflectionMarkdown({
      date: result.review.date,
      impressions,
      summary: result.summary
    })
    try {
      const filePath = await writeReflection({
        fs,
        path,
        dir: reflectionDir,
        date: result.review.date,
        markdown
      })
      return { ok: true, date: result.review.date, impressions, filePath }
    } catch (error) {
      log('[reflection] 写入失败：', String(error))
      return { ok: false, reason: 'write-failed' }
    }
  })


  // 设置保存写通道已迁到 ipc/mutations.ts。

  /**
   * 鼠标穿透：默认关，只在调试口 / 将来的托盘开关里调用。
   * 本轮不设设置页 UI —— 开了以后点不到桌宠，必须先想清楚怎么关回来。
   * 只认严格布尔：渲染层传字符串 "false" 绝不能变成 true。
   */
  registerChannel('pet:window:setClickThrough', (_event, enabled) => {
    const value = enabled === true
    win?.setIgnoreMouseEvents(value, { forward: true })
    return value
  })

  // 像素级穿透：渲染层 elementFromPoint 命中气泡/立绘时传 true，落在透明区传 false。
  // 主进程只做 setIgnoreMouseEvents 切换，不判断命中；forward 基线保证 mousemove 始终进得来。
  registerChannel('pet:window:setPixelHit', (_event, interactive) => {
    const on = Boolean(interactive)
    win?.setIgnoreMouseEvents(!on, { forward: true })
    return on
  })

  registerChannel('pet:window:setAlwaysOnTop', (_event, enabled) => {
    const value = Boolean(enabled)
    win?.setAlwaysOnTop(value)
    return value
  })

  registerChannel('pet:settings:open', (_event, payload) => {
    openSettingsWindow(payload?.panel)
    return true
  })

  // 观察台的贴近时刻开关：只接受 QQ 私聊会话，桌面与群聊不由外部改写。
  // 关掉只是不再触发，不影响已经说过的话；开着也要过次数、冷却与红线。
  registerChannel('pet:insight:set-intimacy', async (_event, payload = {}) => {
    const target = typeof payload.scope === 'string' ? payload.scope.trim() : ''
    if (!target.startsWith('qq:private:')) return { ok: false, reason: 'scope' }
    const peers = { ...(settings?.companion?.intimacy?.peers ?? {}) }
    peers[target] = payload.enabled === true
    settings = mergeLayer(settings, { companion: { intimacy: { peers } } })
    await writeSettings(settings)
    return { ok: true, scope: target, enabled: payload.enabled === true }
  })

  /* 观察台读的是她写出的快照，改不了她加密的状态。
     所以这里只投递一条意图，等她下一轮开口前自己落进状态里。 */
  registerChannel('pet:insight:set-friction', async (_event, payload = {}) => {
    const scope = typeof payload.scope === 'string' ? payload.scope.trim() : ''
    const allowed =
      scope === 'desktop' || scope.startsWith('qq:private:') || scope.startsWith('qq:group:')
    if (!allowed) return { ok: false, reason: 'scope' }
    const value = Number(payload.value)
    if (!Number.isFinite(value)) return { ok: false, reason: 'value' }
    const file = path.join(app.getPath('home'), '.cyrene-pet', 'friction-intent.json')
    const intent = {
      scope,
      value: Math.round(Math.min(100, Math.max(0, value))),
      at: Date.now()
    }
    try {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, JSON.stringify(intent), 'utf8')
      return { ok: true, scope, value: intent.value, pending: true }
    } catch {
      return { ok: false, reason: 'write-failed' }
    }
  })

  registerChannel('pet:qq:status', () => {
    return {
      enabled: qqRuntime.enabled,
      transport: qqRuntime.transport,
      state: qqRuntime.state,
      reason: qqRuntime.reason,
      queued:
        qq !== null && typeof qq.pendingCount === 'function' ? qq.pendingCount() : 0,
      webhook: {
        listening: qqRuntime.webhookListening,
        port: qqRuntime.webhookPort,
        error: qqRuntime.webhookError
      },
      observeOnly: qqRuntime.observeOnly,
      lastInboundOpenId: qqRuntime.lastInboundOpenId,
      lastInboundAt: qqRuntime.lastInboundAt
    }
  })

  /*
   * 会话页的 QQ 部分：只给主人相关会话的最近消息，不做全量导出。
   * qq 未建起来时返回空列表，页面自己显示「通道未连接」。
   */
  registerChannel('pet:qq:conversations', () => {
    const owners = Array.isArray(settings?.channels?.qq?.ownerOpenIds)
      ? settings.channels.qq.ownerOpenIds
      : []
    const conversations = []
    for (const owner of owners) {
      const id = String(owner ?? '').trim()
      if (id === '') continue
      let messages = []
      if (qq !== null && typeof qq.recentMessages === 'function') {
        try {
          const recent = qq.recentMessages(id, 60)
          if (Array.isArray(recent)) messages = recent.slice(-60)
        } catch {
          messages = []
        }
      }
      conversations.push({ id, messages })
    }
    return {
      ok: true,
      enabled: qqRuntime.enabled,
      state: qqRuntime.state,
      reason: qqRuntime.reason,
      observeOnly: qqRuntime.observeOnly,
      lastInboundAt: qqRuntime.lastInboundAt,
      conversations
    }
  })

  registerChannel('pet:sessions:open', (payload) => {
    openSessionsWindow(typeof payload?.tab === 'string' ? payload.tab : undefined)
    return { ok: true }
  })

  // 运行状态四张卡片一次取齐：QQ / 记忆 / 今天主动 / 上次反思。
  // 只读，不触发重连、不发起模型请求。
  registerChannel('pet:status:summary', async () => {
    const pacing =
      typeof companionService?.openingPacing === 'function'
        ? await companionService.openingPacing().catch(() => null)
        : null
    const memoryStats = memoryStore.stats()
    let lastReflectionAt = null
    try {
      const dir = path.join(userData, 'notes', 'reflection')
      const files = (await fs.readdir(dir)).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      files.sort()
      if (files.length > 0) {
        const stat = await fs.stat(path.join(dir, files[files.length - 1]))
        lastReflectionAt = stat.mtime.toISOString()
      }
    } catch {
      // 还没写过反思时目录不存在，保持 null，不补一个假时间。
    }
    return {
      qq: {
        enabled: qqRuntime.enabled,
        state: qqRuntime.state,
        reason: qqRuntime.reason,
        observeOnly: qqRuntime.observeOnly
      },
      memory: memoryStats,
      proactive: pacing === null ? null : { spokenToday: pacing.spokenToday ?? 0 },
      reflection: { lastAt: lastReflectionAt },
      memoryGuard: memoryGuard.status()
    }
  })

  // 只验证凭据与网关可达性：不发送消息，也不把 token 回传给渲染侧。
  registerChannel('pet:qq:test', async () => {
    const qqSettings = settings.channels?.qq ?? DEFAULT_SETTINGS.channels.qq
    const appId = devEnv('QQ_BOT_APP_ID').trim() || qqSettings.appId
    if (appId.length === 0) return { ok: false, reason: 'missing-app-id' }
    const envSecret = devEnv('QQ_BOT_SECRET').trim()
    const clientSecret =
      envSecret.length > 0 ? envSecret : await readQqClientSecret(qqSettings.credentialRef)
    if (clientSecret.length === 0) return { ok: false, reason: 'missing-secret' }
    try {
      const client = new QqBotApiClient({ appId, clientSecret })
      const gateway = await client.getGatewayUrl()
      let host = ''
      try {
        host = new URL(gateway).host
      } catch {
        host = ''
      }
      return { ok: true, gatewayHost: host, transport: qqSettings.transport }
    } catch (error) {
      return {
        ok: false,
        reason: 'request-failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 一键绑定：把最近一条入站消息的发送者写进主人名单，并立刻重建网关。
  // 没有入站记录时明确回 no-inbound，让界面提示「先去 QQ 发一条」。
  registerChannel('pet:qq:bind-owner', async () => {
    // 网关还没收到过任何入站消息时该字段是 undefined：先兜住，再报 no-inbound。
    const lastInbound = typeof qqRuntime?.lastInboundOpenId === 'string' ? qqRuntime.lastInboundOpenId.trim() : ''
    if (lastInbound === '') return { ok: false, reason: 'no-inbound' }
    const openId = lastInbound
    if (openId === '') return { ok: false, reason: 'no-inbound' }
    const qqSettings = settings.channels?.qq ?? DEFAULT_SETTINGS.channels.qq
    const owners = [...(qqSettings.ownerOpenIds ?? [])]
    if (owners.includes(openId)) {
      return { ok: true, openId, alreadyBound: true, ownerOpenIds: owners }
    }
    owners.push(openId)
    settings = mergeLayer(settings, { channels: { qq: { ownerOpenIds: owners } } })
    try {
      await writeSettings(settings)
    } catch (error) {
      return { ok: false, reason: 'write-failed', message: describeError(error) }
    }
    broadcastSettings(settings)
    await syncGatewayIfNeeded(true).catch((error) =>
      log('[qq] 绑定后重建通道失败：', describeError(error))
    )
    log(`[qq] 已将 ${openId} 绑定为主人 openid`)
    return { ok: true, openId, alreadyBound: false, ownerOpenIds: owners }
  })

  // 能力中心：独立窗口。窗口本身只读状态与触发动作，不持有额外权限。
  registerChannel('pet:ability:open', () => {
    openAbilityWindow()
    return true
  })

  // B 站浏览：搜索 / 详情 / 打开 / 写操作 / 读文章。写操作默认全关，危险动作二次确认。
  registerChannel('pet:bili:search', async (_event, payload) => {
    try {
      return { ok: true, result: await biliSearch(String(payload?.keyword ?? '')) }
    } catch (error) {
      return { ok: false, message: error?.message ?? String(error) }
    }
  })
  registerChannel('pet:bili:videoInfo', async (_event, payload) => {
    try {
      return { ok: true, result: await biliVideoInfo(String(payload?.bvid ?? '')) }
    } catch (error) {
      return { ok: false, message: error?.message ?? String(error) }
    }
  })
  registerChannel('pet:bili:open', (_event, payload) => {
    openBiliWindow(String(payload?.url ?? ''))
    return true
  })
  registerChannel('pet:bili:write', async (_event, payload) => {
    try {
      return await biliWrite(
        String(payload?.action ?? ''),
        payload?.params ?? {},
        payload?.confirmed === true,
        payload?.confirmNonce,
        true
      )
    } catch (error) {
      return { ok: false, message: error?.message ?? String(error) }
    }
  })
  registerChannel('pet:bili:article', async (_event, payload) => {
    try {
      return { ok: true, result: await biliArticle(String(payload?.url ?? '')) }
    } catch (error) {
      return { ok: false, message: error?.message ?? String(error) }
    }
  })
  registerChannel('pet:bili:subtitleList', async (_event, payload) => {
    try {
      const bvid = String(payload?.bvid ?? '')
      const cid = Number(payload?.cid ?? 0)
      if (cid <= 0) return { ok: false, message: '需要有效的 cid' }
      return { ok: true, result: await biliSubtitleList(bvid, cid) }
    } catch (error) {
      return { ok: false, message: error?.message ?? String(error) }
    }
  })
  registerChannel('pet:bili:transcript', async (_event, payload) => {
    try {
      const url = String(payload?.url ?? '')
      if (url === '') return { ok: false, message: '需要字幕地址' }
      return { ok: true, result: await biliTranscript(url) }
    } catch (error) {
      return { ok: false, message: error?.message ?? String(error) }
    }
  })
  registerChannel('pet:bili:loginStatus', async () => {
    try {
      return { ok: true, result: await biliLoginStatus() }
    } catch (error) {
      return { ok: false, message: error?.message ?? String(error) }
    }
  })
  // 学习闭环的落库口：把提炼好的知识（kind=knowledge）写进结构化记忆。
  // kind 白名单交给 factStore 自己校验，这里只负责透传；默认 scope=shared，跨渠道都能检索到。
  registerChannel('pet:memory:addFacts', async (_event, payload) => {
    try {
      const list = Array.isArray(payload?.facts) ? payload.facts : []
      const scope =
        typeof payload?.scope === 'string' && payload.scope !== '' ? payload.scope : 'shared'
      const incoming = list
        .filter((item) => item !== null && typeof item === 'object')
        .map((item) => ({
          kind: typeof item.kind === 'string' && item.kind !== '' ? item.kind : 'knowledge',
          text: String(item.text ?? '').trim(),
          source: typeof item.source === 'string' ? item.source.slice(0, 80) : '',
          confidence: item.confidence
        }))
        .filter((item) => item.text !== '')
      if (incoming.length === 0) return { ok: false, message: '没有可写入的记忆' }
      await factStore.load()
      const result = factStore.upsert(incoming, Date.now(), scope)
      return { ok: true, result }
    } catch (error) {
      return { ok: false, message: error?.message ?? String(error) }
    }
  })
  registerChannel('pet:mail:send', async (_event, payload) => {
    // 渲染层传来的字段全部经过 sendMail 内部校验（收件人格式、头部注入）；
    // 这里先做长度上限，防止异常大 payload 直接进 SMTP。
    const subject = String(payload?.subject ?? '').slice(0, 200)
    const body = String(payload?.body ?? '').slice(0, 20_000)
    const to = String(payload?.to ?? '').slice(0, 200)
    return sendMail({ to, subject, body })
  })

  // 游戏页：设置窗里只留入口，逐项配置和记录都在这个独立窗口。
  registerChannel('pet:game:open', () => {
    openGameWindow()
    return true
  })

  // 猜拳：出拳 / 查战绩 / 重置共用一条通道，非法输入明确回 bad-choice。
  registerChannel('pet:game:rps', async (_event, payload) => {
    const action = payload?.action
    if (action === 'reset') {
      rpsGame.reset()
      await saveRpsStats()
      return { ok: true, action: 'reset', stats: rpsGame.stats }
    }
    if (action === 'stats') return { ok: true, action: 'stats', stats: rpsGame.stats }
    if (action !== 'play') return { ok: false, reason: 'bad-action' }

    const choice = payload?.choice
    if (choice !== 'rock' && choice !== 'paper' && choice !== 'scissors') {
      return { ok: false, reason: 'bad-choice' }
    }
    const round = rpsGame.play(choice)
    await saveRpsStats()
    return { ok: true, action: 'play', round, stats: rpsGame.stats }
  })

  // 游戏日常：检测 + 排班 + dry-run。内测只到预览，不启动 BetterGI 或计划任务。
  registerChannel('pet:game:detect', () => ensureGameDailyService().detect())
  registerChannel('pet:game:schedule:get', () => ensureGameDailyService().load())
  registerChannel('pet:game:schedule:save', async (_event, config) =>
    ensureGameDailyService().save(config)
  )

  // 多游戏日常：一行一个游戏，真实执行交给 runner + Windows 计划任务。
  // 注册/删除任务会走 UAC，注册结果一律用 query 回读，不认退出码。
  registerChannel('pet:game:daily:state', () => ensureGameDailyStore().load())
  registerChannel('pet:game:daily:update', (_event, input) => ensureGameDailyStore().update(input))
  registerChannel('pet:game:daily:plan', () => ensureGameDailyStore().plan())
  registerChannel('pet:game:daily:apply', () => ensureGameDailyStore().apply())
  registerChannel('pet:game:daily:query', () => ensureGameDailyStore().query())
  registerChannel('pet:game:daily:disable', (_event, games) => ensureGameDailyStore().disable(games))
  registerChannel('pet:game:daily:runs', (_event, input) =>
    ensureGameDailyStore().runs(input?.game, input?.limit)
  )
  registerChannel('pet:game:dry-run', (_event, config) =>
    ensureGameDailyService().dryRun(config)
  )

  // 游戏助手：默认关闭，必须连续两次确认风险才能生成任务计划。
  registerChannel('pet:game:assistant:status', () => ensureGameAssistantService().status())
  registerChannel('pet:game:assistant:confirm', (_event, input) =>
    ensureGameAssistantService().confirm(input)
  )
  registerChannel('pet:game:assistant:disable', () => ensureGameAssistantService().disable())
  registerChannel('pet:game:assistant:record', (_event, entry) =>
    ensureGameAssistantService().recordRun(entry)
  )
  registerChannel('pet:game:assistant:claim', (_event, id) =>
    ensureGameAssistantService().claim(id)
  )
  registerChannel('pet:game:assistant:rank', (_event, rank) =>
    ensureGameAssistantService().setRank(rank)
  )
  registerChannel('pet:game:assistant:plan', (_event, taskId) =>
    ensureGameAssistantService().plan(taskId)
  )

  /*
   * 聊天页背景：与 DSH 插件共用同一个 backgrounds 目录。
   * 插件侧只按 id 取字节，所以这里写进去的文件它立刻就能用；
   * 桌宠自己的 settings.json 只记「现在用哪一张」。
   */
  const BACKGROUND_DIR = path.join(userData, 'backgrounds')
  /* 随包七张：只在 assets 里，不复制进用户目录，删不掉也不占空间。 */
  const BUILTIN_BACKGROUND_DIR = path.join(assetsRoot, 'backgrounds')
  const BUILTIN_PREFIX = 'builtin:'
  const BACKGROUND_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'])
  const BACKGROUND_LIMIT = 12 * 1024 * 1024

  /*
   * 背景相关通道一律走外层的 broadcastSettings(settings)：
   * 之前这里有个同名内层函数遮蔽了外层，改背景时语音/余额/HUD/网关的联动
   * 全部静默失效。删掉内层定义，调用点统一传最新 settings。
   */

  /* 背景槽位：同一张图可以分别指定给不同窗口，各槽互不影响。
     petChat=桌宠聊天窗  petSettings=桌宠设置页  petPanels=桌宠独立页面
     dshPage=DSH 页面    dshCard=DSH 设置卡片 */
  const BACKGROUND_SLOT_KEYS = ['petChat', 'petSettings', 'petPanels', 'dshPage', 'dshCard']

  const clampUnit = (value, fallback) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.min(1, Math.max(0, n))
  }

  const clampBlur = (value, fallback) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.min(20, Math.max(0, Math.round(n)))
  }

  /**
   * 把 background 归一化成五个槽。
   * 老版本只有一张 background.id：槽全空时迁进聊天窗，只跑这一次；
   * 迁移后写盘会把 id 清空，所以不会每次都重迁。
   */
  function normalizeBackgroundSlots(background) {
    const raw = background ?? {}
    const source = raw.slots ?? {}
    const slots = {}
    let filled = false
    for (const key of BACKGROUND_SLOT_KEYS) {
      const entry = source[key]
      const id = typeof entry?.id === 'string' ? entry.id : ''
      if (id !== '') filled = true
      slots[key] = {
        id,
        dim: clampUnit(entry?.dim, clampUnit(raw.dim, 0.35)),
        blur: clampBlur(entry?.blur, 0)
      }
    }
    if (!filled && typeof raw.id === 'string' && raw.id !== '') {
      slots.petChat = { id: raw.id, dim: clampUnit(raw.dim, 0.35), blur: 0 }
    }
    return slots
  }

  /* 写回时统一成 slots 结构，id 置空表示已完成迁移。 */
  function backgroundWithSlots(slots) {
    return { ...(settings.background ?? {}), id: '', slots }
  }

  registerChannel('pet:background:list', async () => {
    let names = []
    try {
      names = await fs.readdir(BACKGROUND_DIR)
    } catch {
      names = []
    }
    const items = []
    for (const name of names) {
      if (!BACKGROUND_EXTS.has(path.extname(name).toLowerCase())) continue
      try {
        const info = await fs.stat(path.join(BACKGROUND_DIR, name))
        if (info.isFile()) {
          items.push({ id: name, size: info.size, addedAt: Math.round(info.mtimeMs) })
        }
      } catch {
        /* 单张读不到就跳过，不影响整份清单 */
      }
    }
    items.sort((a, b) => b.addedAt - a.addedAt)
    const slots = normalizeBackgroundSlots(settings.background)
    return { ok: true, items, slots, active: { id: slots.petChat.id, dim: slots.petChat.dim } }
  })

  registerChannel('pet:background:pick', async () => {
    const parent = settingsWin !== null && !settingsWin.isDestroyed() ? settingsWin : win
    const picked = await dialog.showOpenDialog(parent, {
      title: '选一张聊天背景',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, reason: 'canceled' }

    const file = picked.filePaths[0]
    const ext = path.extname(file).toLowerCase()
    if (!BACKGROUND_EXTS.has(ext)) return { ok: false, reason: 'unsupported' }

    let bytes
    try {
      bytes = await fs.readFile(file)
    } catch {
      return { ok: false, reason: 'read-failed' }
    }
    if (bytes.length === 0) return { ok: false, reason: 'empty' }
    if (bytes.length > BACKGROUND_LIMIT) return { ok: false, reason: 'too-large' }

    await fs.mkdir(BACKGROUND_DIR, { recursive: true })
    const id = `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`
    await fs.writeFile(path.join(BACKGROUND_DIR, id), bytes)

    const slots = normalizeBackgroundSlots(settings.background)
    slots.petChat = { ...slots.petChat, id }
    settings = { ...settings, background: backgroundWithSlots(slots) }
    await writeSettings(settings)
    broadcastSettings(settings)
    return { ok: true, id, bytes: bytes.length }
  })

  registerChannel('pet:background:clear', async () => {
    // 只取消选用，不删文件：同一张图可能还想换回来。
    settings = { ...settings, background: backgroundWithSlots({}) }
    await writeSettings(settings)
    broadcastSettings(settings)
    return { ok: true }
  })

  /* 背景库页：按 id 选用已导入的图，不重新弹文件框。 */
  registerChannel('pet:background:apply', async (id, targetSlots) => {
    const name = String(id ?? '')
    if (name === '' || name.includes('/') || name.includes('\\') || name.includes('..')) {
      return { ok: false, reason: 'invalid-id' }
    }
    /* 内置图在 assets 里，不在用户目录，校验路径也要换一处。 */
    const builtin = name.startsWith(BUILTIN_PREFIX)
    const fileName = builtin ? name.slice(BUILTIN_PREFIX.length) : name
    if (builtin) {
      if (fileName === '' || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
        return { ok: false, reason: 'invalid-id' }
      }
      if (!BACKGROUND_EXTS.has(path.extname(fileName).toLowerCase())) {
        return { ok: false, reason: 'unsupported' }
      }
      try {
        const info = await fs.stat(path.join(BUILTIN_BACKGROUND_DIR, fileName))
        if (!info.isFile()) return { ok: false, reason: 'not-found' }
      } catch {
        return { ok: false, reason: 'not-found' }
      }
    } else {
      if (!BACKGROUND_EXTS.has(path.extname(name).toLowerCase())) {
        return { ok: false, reason: 'unsupported' }
      }
      try {
        const info = await fs.stat(path.join(BACKGROUND_DIR, name))
        if (!info.isFile()) return { ok: false, reason: 'not-found' }
      } catch {
        return { ok: false, reason: 'not-found' }
      }
    }
    /* 只传 id 时沿用旧语义：设到聊天窗。 */
    const keys = Array.isArray(targetSlots)
      ? targetSlots.filter((key) => BACKGROUND_SLOT_KEYS.includes(key))
      : [BACKGROUND_SLOT_KEYS.includes(targetSlots) ? targetSlots : 'petChat']
    // 全是非法槽名时如实报错，不返回「成功但什么都没做」。
    if (keys.length === 0) return { ok: false, reason: 'bad-slots' }
    const slots = normalizeBackgroundSlots(settings.background)
    for (const key of keys) slots[key] = { ...slots[key], id: name }
    settings = { ...settings, background: backgroundWithSlots(slots) }
    await writeSettings(settings)
    broadcastSettings(settings)
    return { ok: true, id: name, slots: keys }
  })

  /* 删除文件；如果删的正是当前那张，顺手清掉选用。 */
  registerChannel('pet:background:remove', async (id) => {
    const name = String(id ?? '')
    if (name === '' || name.includes('/') || name.includes('\\') || name.includes('..')) {
      return { ok: false, reason: 'invalid-id' }
    }
    /* 内置图是随包素材，删了下次更新还会回来，直接拒绝。 */
    if (name.startsWith(BUILTIN_PREFIX)) return { ok: false, reason: 'builtin-readonly' }
    try {
      await fs.rm(path.join(BACKGROUND_DIR, name), { force: true })
    } catch {
      return { ok: false, reason: 'remove-failed' }
    }
    const slots = normalizeBackgroundSlots(settings.background)
    let cleared = false
    for (const key of BACKGROUND_SLOT_KEYS) {
      if (slots[key].id === name) {
        slots[key] = { ...slots[key], id: '' }
        cleared = true
      }
    }
    if (cleared) {
      settings = { ...settings, background: backgroundWithSlots(slots) }
      await writeSettings(settings)
      broadcastSettings(settings)
    }
    return { ok: true }
  })

  /* 读五个槽当前各自用的图。 */
  registerChannel('pet:background:slots', async () => {
    return { ok: true, slots: normalizeBackgroundSlots(settings.background) }
  })

  /* 设定某个槽：id 传空字符串表示这个槽不用背景。内置图（builtin:）同样支持。 */
  registerChannel('pet:background:slot:set', async (slot, patch) => {
    if (!BACKGROUND_SLOT_KEYS.includes(slot)) return { ok: false, reason: 'bad-slot' }
    const slots = normalizeBackgroundSlots(settings.background)
    const next = { ...slots[slot] }
    if (patch !== null && typeof patch === 'object') {
      if (typeof patch.id === 'string') {
        const name = patch.id
        if (name !== '') {
          if (name.includes('/') || name.includes('\\') || name.includes('..')) {
            return { ok: false, reason: 'invalid-id' }
          }
          if (!BACKGROUND_EXTS.has(path.extname(name).toLowerCase())) {
            return { ok: false, reason: 'unsupported' }
          }
          const builtin = name.startsWith(BUILTIN_PREFIX)
          const filePath = builtin
            ? path.join(BUILTIN_BACKGROUND_DIR, name.slice(BUILTIN_PREFIX.length))
            : path.join(BACKGROUND_DIR, name)
          try {
            const info = await fs.stat(filePath)
            if (!info.isFile()) return { ok: false, reason: 'not-found' }
          } catch {
            return { ok: false, reason: 'not-found' }
          }
        }
        next.id = name
      }
      next.dim = clampUnit(patch.dim, next.dim)
      next.blur = clampBlur(patch.blur, next.blur)
    }
    slots[slot] = next
    settings = { ...settings, background: backgroundWithSlots(slots) }
    await writeSettings(settings)
    broadcastSettings(settings)
    return { ok: true, slot, value: next, slots }
  })

  registerChannel('pet:background:open', () => {
    openBackgroundsWindow()
    return { ok: true }
  })

  registerChannel('pet:settings:close', () => {
    if (settingsWin !== null && !settingsWin.isDestroyed()) settingsWin.close()
    return true
  })

  // 设置窗自绘顶栏：关闭之外，最小化与最大化也由渲染侧按钮触发。
  registerChannel('pet:settings:minimize', () => {
    if (settingsWin !== null && !settingsWin.isDestroyed()) settingsWin.minimize()
    return true
  })

  registerChannel('pet:settings:toggleMaximize', () => {
    if (settingsWin === null || settingsWin.isDestroyed()) return false
    if (settingsWin.isMaximized()) settingsWin.unmaximize()
    else settingsWin.maximize()
    return true
  })

  // 语感学习：设置页要看得见「她学到了什么」，也要能逐条点头或丢掉。
  // 列表只回短语本身和出现次数，不带原句、不带完整发送者。
  registerChannel('pet:speech:list', async (_event, scope) => {
    await speechHabits.load()
    return speechHabits.list(typeof scope === 'string' ? scope : '')
  })

  registerChannel('pet:speech:resolve', async (_event, payload) => {
    await speechHabits.load()
    const result = speechHabits.resolve(
      typeof payload?.scope === 'string' ? payload.scope : '',
      typeof payload?.text === 'string' ? payload.text : '',
      payload?.keep === true
    )
    if (result.ok === true) await speechHabits.flush()
    return result
  })

  registerChannel('pet:speech:learning', async (_event, enabled) => {
    await speechHabits.load()
    const result = speechHabits.setLearning(enabled === true)
    await speechHabits.flush()
    return result
  })

  // 右键桌宠：原生菜单。
  // 透明无边框窗口里自绘浮层要自己处理层级、越界和失焦关闭，交给系统菜单最省事，
  // 位置也会自动贴着光标。
  //
  // 只留「聊天 / 设置 / 退出」。换模型、打开模型目录都已经在设置窗里，
  // 菜单里再放一份就是两个入口指向同一件事。
  /** 一键回城：拖丢、甩出屏幕后都能把桌宠放回右下角并显示出来。 */
  const dockPetToBottomRight = () => {
    if (win === null || win.isDestroyed()) return false
    const [width, height] = win.getSize()
    win.setBounds(
      dockBoundsToBottomRight({ width, height }, screen.getPrimaryDisplay().workArea)
    )
    win.show()
    win.focus()
    void saveWindowState()
    return true
  }

  /**
   * 拍照：她此刻的样子直接截自桌宠窗口，不需要另找图源。
   * 目录默认放 D 盘；拍完在资源管理器里选中，用户能立刻看见成品。
   * 截不到就返回失败，不拿占位图冒充。
   */
  const photoFolderDir = resolvePhotoFolder({
    preferred: process.env.DSH_PET_PHOTO_DIR ?? '',
    fallback: path.join('D:\\', 'DSH Pet', 'photos')
  })
  // 媒体协议按这个根读图：渲染层只拿到 pet-media://photo/<文件名>。
  photoRootDir = photoFolderDir
  const photoStudio = createPhotoStudio({
    folder: photoFolderDir,
    capture: async () => {
      if (win === null || win.isDestroyed()) return null
      const image = await win.webContents.capturePage()
      if (image === null || image.isEmpty()) return null
      return image.toPNG()
    },
    log
  })

  registerChannel('pet:photo:take', async () => await photoStudio.take())

  registerChannel('pet:menu:context', () => {
    const menu = Menu.buildFromTemplate([
      { label: '聊天…', click: () => openChatWindow() },
      // 拍的是她自己：窗口里那块立绘原样落成一张 PNG。
      {
        label: '拍一张照',
        click: async () => {
          const result = await photoStudio.take()
          if (result.ok === true) {
            shell.showItemInFolder(result.photo.path)
            return
          }
          const why =
            {
              'no-capture': '现在没有可截的画面',
              'no-folder': '还没定照片存在哪儿',
              'empty-frame': '这一帧是空的，窗口可能被盖住了',
              'capture-failed': '截屏时出错了',
              'write-failed': '写文件失败了，可能磁盘满了或没有权限'
            }[result.reason] ?? '这次没拍成'
          dialog.showErrorBox('没能拍下来', why)
        }
      },
      { label: '把桌宠找回来', click: () => dockPetToBottomRight() },
      {
        // B 站入口：陪看窗走独立分区 persist:cyrene-bili，登录态只存在那里；
        // passport.bilibili.com 也在 isBiliUrl 的 bilibili.com 后缀白名单内。
        label: '哔哩哔哩',
        submenu: [
          { label: '打开 B 站首页', click: () => openBiliWindow('https://www.bilibili.com') },
          { label: '扫码登录…', click: () => openBiliWindow('https://passport.bilibili.com/login') }
        ]
      },
      { label: '设置…', click: () => openSettingsWindow('general') },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
    if (win !== null && !win.isDestroyed()) menu.popup({ window: win })
    else menu.popup()
    return true
  })

  // 按当前设置重设主窗口尺寸。保留左上角坐标，否则改缩放时窗口会跳走。
  // 新尺寸仍要夹回工作区：放大后右下角可能顶出屏幕。
  registerChannel('pet:window:applySize', () => reapplyMainWindowSize())

  registerChannel('pet:window:getSize', () => {
    if (win === null || win.isDestroyed()) return null
    const [width, height] = win.getSize()
    return { width, height }
  })

  // 渲染侧状态上报：只在内存里留一份，不落盘，供设置窗诊断读取。
  registerChannel('pet:render:report', (_event, info) => {
    if (typeof info !== 'object' || info === null) return false
    lastRenderInfo = info
    return true
  })


  registerChannel('pet:window:move', (_event, position) => {
    if (win === null || win.isDestroyed()) return false
    if (typeof position !== 'object' || position === null) return false
    // { dock: 'bottom-right' } = 一键归位，渲染侧与托盘「找回窗口」走这里。
    if (position.dock === 'bottom-right') {
      const [w, h] = win.getSize()
      win.setBounds(
        dockBoundsToBottomRight({ width: w, height: h }, screen.getPrimaryDisplay().workArea)
      )
      void saveWindowState()
      return true
    }
    const { x, y } = position
    if (typeof x !== 'number' || typeof y !== 'number') return false
    win.setPosition(Math.round(x), Math.round(y))
    scheduleSaveWindowState()
    return true
  })

  // 拖拽由主进程主导：渲染侧只发「开始 / 结束」。
  // 用增量会让窗口跟手失败 —— 窗口跟着鼠标走时，鼠标相对窗口的位置不变，
  // screenX 也不变，算出 dx=0 就不动了。所以改为按住时记住光标与窗口的偏移，
  // 再由定时器读 getCursorScreenPoint() 反推窗口位置。
  let dragTimer = null
  // 拖动开始时记下窗口尺寸：Windows 在移动过程中会按 DPI 重新算一次非客户区，
  // 每帧给窗口加 2px；只改位置的话，这点增量会一路累积成「越拖越大」。
  let dragBounds = null
  let sizeGuardTimer = null

  /**
   * 窗口尺寸的唯一真值：由设置里的比例预设算出。
   * 拖动结束和周期守卫都按它对，不去读可能已经被系统改过的当前尺寸。
   */
  const petWindowSize = () => {
    const next = createWindowOptions(settings, path.join(__dirname, 'preload.cjs'))
    return { width: next.width, height: next.height }
  }

  registerChannel('pet:window:dragStart', () => {
    if (win === null || win.isDestroyed()) return false
    if (dragTimer !== null) return true
    const cursor = screen.getCursorScreenPoint()
    const [wx, wy] = win.getPosition()
    const { width: ww, height: wh } = petWindowSize()
    const offsetX = cursor.x - wx
    const offsetY = cursor.y - wy
    // 拖动期间连尺寸一起写回。transparent + frame:false 的窗口在 Windows 上
    // 每执行一次 SetWindowPos 都会重算一遍非客户区，宽高各涨一点；只写位置时
    // 这点增量会留在下次拖动里，表现就是「越拖越大，还往右下漂」。
    // 这里把开始时的尺寸锁进每一帧的 setBounds，松手后再兜一次。
    dragBounds = { width: ww, height: wh }
    dragTimer = setInterval(() => {
      if (win === null || win.isDestroyed()) return
      const point = screen.getCursorScreenPoint()
      win.setBounds(
        {
          x: Math.round(point.x - offsetX),
          y: Math.round(point.y - offsetY),
          width: dragBounds.width,
          height: dragBounds.height
        },
        false
      )
    }, 16)
    return true
  })

  registerChannel('pet:window:dragEnd', () => {
    if (dragTimer !== null) {
      clearInterval(dragTimer)
      dragTimer = null
    }
    if (win === null || win.isDestroyed()) return false

    // 松手再校一次尺寸。拖动期间可能被系统改过一两像素，
    // 这里按拖动开始时记下的值写回，避免下一次拖动从更大的尺寸起步。
    if (dragBounds !== null) {
      const [x, y] = win.getPosition()
      win.setBounds({ x, y, width: dragBounds.width, height: dragBounds.height }, false)
      dragBounds = null
    }
    // 松手就停在原地：不做惯性滑行，也不自动贴边。
    return true
  })

  // 尺寸兜底：无边框透明窗口偶尔会被系统改掉一两像素。
  // 每分钟对一次设置里的目标值，差值超过 2px 才写回，避免无谓重绘。
  if (sizeGuardTimer === null) {
    sizeGuardTimer = setInterval(() => {
      if (win === null || win.isDestroyed() || dragTimer !== null) return
      const target = petWindowSize()
      const [w, h] = win.getSize()
      if (Math.abs(w - target.width) <= 2 && Math.abs(h - target.height) <= 2) return
      const [x, y] = win.getPosition()
      win.setBounds({ x, y, width: target.width, height: target.height }, false)
      log('[window] 尺寸回弹', `${w}x${h}`, '->', `${target.width}x${target.height}`)
    }, 60000)
  }

  registerChannel('pet:ask', async (_event, request) => {
    if (typeof request !== 'object' || request === null) {
      throw new Error('决策请求必须是对象')
    }
    const envelope = await gateway.prepare({
      kind: request.kind ?? 'approval',
      summary: String(request.summary ?? ''),
      payload: request.payload,
      ttlMs: typeof request.ttlMs === 'number' ? request.ttlMs : undefined
    })
    void gateway
      .wait(envelope.id)
      .then((outcome) => sendDecision(outcome))
      .catch((error) => sendDecision({ status: 'timeout', envelope, usedFallback: true, error: String(error) }))
    return envelope
  })

  registerChannel('pet:approve', async (_event, request) => {
    if (typeof request !== 'object' || request === null) {
      throw new Error('审批请求必须是对象')
    }
    return gateway.resolve(String(request.id ?? ''), request.action ?? 'dismiss', request.answer)
  })

  // —— 插件联动：DSH 插件把待办写进 live.json，桌宠把选择写回 pet-command.json ——
  // 插件用 --user-data-dir 指向自己的状态目录，所以 userData 就是插件的 STATE_DIR。
  // 两边都只碰这两个文件，桌宠不读插件内部状态，插件也不碰桌宠的设置。
  const pluginStatePath = (name) => path.join(app.getPath('userData'), name)

  registerChannel('pet:plugin:live', async () => {
    try {
      const raw = await fs.readFile(pluginStatePath('live.json'), 'utf8')
      const parsed = JSON.parse(raw)
      return parsed !== null && typeof parsed === 'object' ? parsed : null
    } catch {
      // 插件没跑、文件还没生成都走这里，不是异常状态。
      return null
    }
  })

  registerChannel('pet:plugin:command', async (_event, command) => {
    if (command === null || typeof command !== 'object') {
      throw new Error('命令必须是对象')
    }
    const target = pluginStatePath('pet-command.json')
    const temp = `${target}.tmp`
    // 先写临时文件再改名：插件按 mtime 轮询，直接覆写可能让它读到半截 JSON。
    await fs.writeFile(temp, JSON.stringify(command), 'utf8')
    await fs.rename(temp, target)
    return { ok: true }
  })

  // 单条限 8 KiB，整份日志超 2 MiB 轮转为 .1。没有上限时，异常上报能把磁盘写满。
  const MAX_TASK_BYTES = 8 * 1024
  const MAX_TASK_LOG_BYTES = 2 * 1024 * 1024

  registerChannel('pet:reportTask', async (_event, task) => {
    const payloadText = JSON.stringify(task) ?? 'null'
    if (Buffer.byteLength(payloadText, 'utf8') > MAX_TASK_BYTES) {
      return { ok: false, reason: 'task-too-large', limitBytes: MAX_TASK_BYTES }
    }

    try {
      const stat = await fs.stat(taskLogPath)
      if (stat.size >= MAX_TASK_LOG_BYTES) {
        await fs.rm(`${taskLogPath}.1`, { force: true })
        await fs.rename(taskLogPath, `${taskLogPath}.1`)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') log('[tasks] 检查日志大小失败：', String(error))
    }

    await fs.appendFile(taskLogPath, `${new Date().toISOString()} ${payloadText}\n`, 'utf8')
    return { ok: true }
  })

  // 外部服务密钥的 set / clear 已迁到 ipc/secrets.ts。
  registerSecretChannels({
    registerChannel,
    requireSecretStore,
    onSecretChanged: (serviceId) => {
      // QQ 通道持有解密后的旧 AppSecret；写入/清除后强制重建一次。
      if (serviceId !== QQ_SECRET_SERVICE) return
      void syncGatewayIfNeeded(true).catch((error) =>
        log('[qq] 凭据变更后重建通道失败：', error instanceof Error ? error.message : String(error))
      )
    }
  })

  // ---- 一键备份：目录、保留份数、自动备份节奏存独立小配置 ----
  // 手动备份的口令只在这次调用里出现；自动备份需要用户输入一次，之后用系统密钥
  // 加密保存到 backup-secret.bin，仅当前系统用户可以解开，删掉文件即失效。
  const backupPrefsFile = path.join(userData, 'backup-prefs.json')
  const backupSecretFile = path.join(userData, 'backup-secret.bin')
  let backupPrefsCache = null

  async function getBackupPrefs() {
    if (backupPrefsCache !== null) return backupPrefsCache
    try {
      const parsed = JSON.parse(await fs.readFile(backupPrefsFile, 'utf8'))
      backupPrefsCache = {
        dir: typeof parsed?.dir === 'string' ? parsed.dir : '',
        keep:
          Number.isInteger(parsed?.keep) && parsed.keep >= 1 && parsed.keep <= 100
            ? parsed.keep
            : 5,
        lastRunAt: typeof parsed?.lastRunAt === 'string' ? parsed.lastRunAt : '',
        autoIntervalDays:
          Number.isInteger(parsed?.autoIntervalDays) &&
          parsed.autoIntervalDays >= 0 &&
          parsed.autoIntervalDays <= 365
            ? parsed.autoIntervalDays
            : 0,
        autoLastError: typeof parsed?.autoLastError === 'string' ? parsed.autoLastError : '',
        autoStored: parsed?.autoStored === true
      }
    } catch {
      backupPrefsCache = {
        dir: '',
        keep: 5,
        lastRunAt: '',
        autoIntervalDays: 0,
        autoLastError: '',
        autoStored: false
      }
    }
    return backupPrefsCache
  }

  async function saveBackupPrefs(next) {
    const current = await getBackupPrefs()
    backupPrefsCache = { ...current, ...next }
    await fs.writeFile(backupPrefsFile, JSON.stringify(backupPrefsCache), 'utf8')
    await restrictPermissions(backupPrefsFile)
  }

  async function readAutoPassword() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return ''
      return safeStorage.decryptString(await fs.readFile(backupSecretFile))
    } catch {
      return ''
    }
  }

  async function writeAutoPassword(password) {
    if (!safeStorage.isEncryptionAvailable()) return false
    await fs.writeFile(backupSecretFile, safeStorage.encryptString(password))
    await restrictPermissions(backupSecretFile)
    return true
  }

  registerBackupChannels({
    registerChannel,
    getBackupPrefs,
    getDocumentsPath: () => app.getPath('documents'),
    pathJoin: (...parts) => path.join(...parts),
    pathBasename: (file) => path.basename(file),
    saveBackupPrefs,
    readAutoPassword,
    writeAutoPassword,
    removeAutoSecret: () => fs.rm(backupSecretFile, { force: true }).catch(() => undefined),
    fs: {
      readdir: (dir, options) => fs.readdir(dir, options),
      stat: (file) => fs.stat(file)
    }
  })

  /**
   * 恢复出厂设置：设置写回默认、清空记忆与聊天记录、移除所有外部服务密钥，
   * 然后重启回到首次引导。备份文件、素材包、模型与日志都不在清理范围内。
   */
  registerChannel('pet:factory:reset', async () => {
    log('[factory] 开始恢复出厂设置')

    // 先写默认设置：后面哪一步失败，下次启动也仍然停在引导页。
    settings = structuredClone(DEFAULT_SETTINGS)
    await writeSettings(settings)

    // 内存与磁盘一起清；放在退出落盘之前，避免旧内容被 before-quit 的 flush 写回来。
    // 每一路的结果都看：清理失败要如实报，不能假装「恢复出厂成功」。
    const clearResults = await Promise.allSettled([
      memoryStore.clear(),
      chatHistoryStore.clear(),
      factStore.reset(),
      speechHabits.clear(),
      companionService.reset()
    ])
    const clearFailed = clearResults
      .filter((entry) => entry.status === 'rejected' || entry.value === false || entry.value?.ok === false)
      .map((entry) => (entry.status === 'rejected' ? String(entry.reason?.message ?? entry.reason) : JSON.stringify(entry.value)))
    if (clearFailed.length > 0) {
      log('[factory] 部分记忆清理失败：', clearFailed.join('；'))
    }
    await Promise.allSettled([
      memoryStore.flush(),
      chatHistoryStore.flush(),
      factStore.flush(),
      speechHabits.flush(),
      companionService.flush()
    ])

    // 外部服务密钥逐个清空；密钥环本身保留，避免其它已加密文件全部解不开。
    if (secretStore !== null) {
      try {
        for (const serviceId of await secretStore.listConfigured()) {
          await secretStore.clearService(serviceId)
        }
      } catch (error) {
        log('[factory] 清理服务密钥失败：', error?.message ?? error)
      }
    }

    // 自动备份口令只删口令文件；已导出的 .petbackup 与同步口令由上面统一清掉。
    await fs.rm(backupSecretFile, { force: true }).catch(() => undefined)
    await saveBackupPrefs({ lastRunAt: '' }).catch(() => undefined)

    // 剩下的陪伴状态、日记与好感仍各自落在独立文件里；恢复出厂一并清掉。
    // 备份目录、同步目录、素材包与模型目录都不在这里，用户导出的东西保持原样。
    const residualFiles = [
      `${settingsPath}.bak`,
      statePath,
      path.join(userData, 'affinity.json'),
      path.join(userData, 'affinity.json.bak'),
      path.join(userData, 'thoughts.json'),
      path.join(userData, 'thoughts.json.bak'),
      path.join(userData, 'agenda-runtime.json'),
      path.join(userData, 'agenda-runtime.json.bak'),
      path.join(userData, 'body.json'),
      path.join(userData, 'social-profile.json'),
      path.join(userData, 'meme-dictionary.json'),
      path.join(userData, 'daily-state.json'),
      rpsStatePath,
      balanceLedgerPath,
      path.join(userData, 'game-daily.json'),
      path.join(userData, 'game-assistant.json'),
      presenceStateFile
    ]
    for (const file of residualFiles) {
      await fs.rm(file, { force: true }).catch(() => undefined)
    }
    await fs.rm(reflectionDir, { recursive: true, force: true }).catch(() => undefined)
    await fs.rm(reportsDir, { recursive: true, force: true }).catch(() => undefined)

    // 先让渲染侧收到返回，再重启进首次引导。
    // 用 exit 而不是 quit：跳过 before-quit 的 flush，避免刚删掉的状态又被写回来。
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 400)
    return { ok: true }
  })

  let autoBackupRunning = false
  async function maybeRunAutoBackup() {
    if (autoBackupRunning) return
    const prefs = await getBackupPrefs()
    if (prefs.autoIntervalDays <= 0 || prefs.autoStored !== true) return
    if (vault === null) return
    const password = await readAutoPassword()
    if (password.length < 8) return
    const last = prefs.lastRunAt === '' ? 0 : Date.parse(prefs.lastRunAt)
    const base = Number.isFinite(last) ? last : 0
    if (Date.now() - base < prefs.autoIntervalDays * 86400000) return

    autoBackupRunning = true
    try {
      const result = await runBackup(mutationDeps, { password })
      if (result?.ok === true) {
        await saveBackupPrefs({ autoLastError: '' })
        log('[backup] 自动备份完成', `file=${result.fileName}`)
      } else {
        const message = result?.message ?? result?.reason ?? '备份失败'
        await saveBackupPrefs({ autoLastError: message })
        log('[backup] 自动备份失败：', message)
      }
    } catch (error) {
      const message = describeError(error)
      await saveBackupPrefs({ autoLastError: message }).catch(() => undefined)
      log('[backup] 自动备份异常：', message)
    } finally {
      autoBackupRunning = false
    }
  }

  // 启动后给一分钟缓冲，之后每六小时看一次；是否到期由 lastRunAt 与间隔决定。
  const autoBackupTimer = setInterval(() => void maybeRunAutoBackup(), 6 * 60 * 60 * 1000)
  autoBackupTimer.unref?.()
  const autoBackupKickoff = setTimeout(() => void maybeRunAutoBackup(), 60 * 1000)
  autoBackupKickoff.unref?.()

  // 备份目录轮换与命名已随写通道迁到 ipc/mutations.ts。


  // 备份选择目录、保留份数与执行通道已迁到 ipc/mutations.ts。

  // ---- 备份：口令封装，换机可恢复。口令丢了就真丢了，渲染侧必须二次确认 ----
  // 密钥轮换、备份导出与导入已迁到 ipc/vault.ts。
  registerVaultChannels({
    registerChannel,
    getVault: () => vault,
    getVaultClient: () => vaultClient,
    getVaultBackend: () => vault?.backend ?? null,
    getLegacyKeyMigrationWarning: () => legacyKeyMigrationWarning,
    cryptoSuite: new AesGcmProvider().suite,
    showOpenDialog: (options) => dialog.showOpenDialog(options),
    showSaveDialog: (options) => dialog.showSaveDialog(options),
    getDocumentsPath: () => app.getPath('documents'),
    pathBasename: (file) => path.basename(file),
    createVaultBackup,
    readBackupFiles,
    fs: {
      readFile: (file, encoding) => fs.readFile(file, encoding),
      writeFile: (file, data) => fs.writeFile(file, data),
      mkdir: (dir, options) => fs.mkdir(dir, options),
      copyFile: (from, to) => fs.copyFile(from, to)
    },
    pathJoin: (...parts) => path.join(...parts),
    userData,
    vaultKeysPath,
    backupFiles: BACKUP_FILES,
    writeRestoredKeyRing,
    openVaultBackup,
    restrictPermissions,
    disableMemory: () => memoryStore.disable(),
    disableChatHistory: () => chatHistoryStore.disable(),
    markMemoryFlushed: () => {
      memoryFlushed = true
    },
    scheduleRestart: () => {
      setTimeout(() => {
        app.relaunch()
        app.quit()
      }, 800)
    },
    describeError,
    log
  })

  // ---- 内存自检：每分钟读一次 rss，800 MB 记日志，1.2 GB 落盘并清缓存 ----
  const memoryGuard = createMemoryGuard({
    log,
    onRelease: async (snapshot) => {
      // 先把内存里的待写数据落盘，再清缓存；顺序反了会丢最近的记忆。
      await Promise.allSettled([
        memoryStore.flush(),
        chatHistoryStore.flush(),
        companionService.flush(),
        affinity.flush(),
        factStore.flush(),
        speechHabits.flush(),
        socialProfileStore.flush(),
        thoughtPool.flush(),
        agendaRuntime.flush(),
        memeDictionary.flush()
      ])
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) await win.webContents.session.clearCache().catch(() => {})
      }
      log(`[memory] 已释放缓存（释放前 ${snapshot.rssMb} MB），建议重启应用`)
    },
    notify: (snapshot) => {
      if (!Notification.isSupported()) return
      new Notification({
        title: '昔涟占用的内存有点多',
        body: `当前 ${Math.round(snapshot.rssMb)} MB，已自动释放缓存。重启一次会更轻松。`
      }).show()
    }
  })
  memoryGuard.start()
  app.on('before-quit', () => memoryGuard.stop())

  registerDiagnosticsChannels({
    registerChannel,
    getAppVersion: () => app.getVersion(),
    listIpcChannels: () => IPC_CHANNELS,
    getRegisteredChannels: () => [...registeredChannels],
    getPendingDecisionIds: () => gateway.pendingIds,
    getSettings: () => settings,
    getMediaRoot: () => mediaRoot,
    modelStore,
    getQq: () => qq,
    getVault: () => vault,
    getLegacyKeyMigrationWarning: () => legacyKeyMigrationWarning,
    // 打包时由 scripts/after-pack.cjs 写入；开发态没有这个文件就明确返回 null。
    getBuildInfo: () => {
      try {
        const raw = fsSync.readFileSync(path.join(app.getAppPath(), 'BUILD-INFO.json'), 'utf8')
        const info = JSON.parse(raw)
        return {
          sha: typeof info.sha === 'string' ? info.sha : null,
          builtAt: typeof info.builtAt === 'string' ? info.builtAt : null,
          dirty: info.dirty === true
        }
      } catch {
        return null
      }
    },
    getMemoryGuard: () => memoryGuard.status()
  })

  // ---- 语音唤醒：运行时按需下载；不随包发布，装不装由用户决定 ----
  // 清单地址只从环境变量读，渲染侧无法把下载指向任意位置。
  wakeVoice = registerWakeVoiceChannels({
    registerChannel,
    userData,
    manifestUrl: (process.env.PET_WAKE_MANIFEST_URL ?? '').trim() || null,
    fetchJson: async (url) => {
      const response = await fetch(url, { redirect: 'error' })
      if (!response.ok) throw new Error(`清单下载失败：HTTP ${response.status}`)
      return response.json()
    },
    downloadBytes: async (url) => {
      const response = await fetch(url, { redirect: 'error' })
      if (!response.ok) throw new Error(`文件下载失败：HTTP ${response.status}`)
      const length = Number(response.headers.get('content-length') ?? '0')
      // 先看响应头，避免一次性拉一个超大文件进内存。
      if (length > 600 * 1024 * 1024) throw new Error('文件超过体积上限')
      return new Uint8Array(await response.arrayBuffer())
    },
    sha256: (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
    fs,
    pathJoin: (...parts) => path.join(...parts),
    log,
    describeError: (error) => (error instanceof Error ? error.message : String(error))
  })
  void wakeVoice.init()

  // ---- 语音输入：本地 faster-whisper 优先，云端兜底；麦克风窗口跟着开关走 ----
  // 采集在隐藏窗口里做（renderer/mic.html），主进程只收成品 WAV 并判定唤醒词。
  asr = createAsrBackend({
    userData,
    getSecret: async () => {
      if (secretStore === null) return ''
      try {
        return (await secretStore.get('asr', 'apiKey')) ?? ''
      } catch {
        return ''
      }
    },
    log,
    describeError: (error) => (error instanceof Error ? error.message : String(error))
  })

  const wakeWordsForVoice = async () => {
    const config = await asr.readConfig()
    if (config.wakeWords.length > 0) return config.wakeWords
    const configured = Array.isArray(settings?.voice?.voiceWakeWords)
      ? settings.voice.voiceWakeWords.filter((item) => typeof item === 'string' && item.trim() !== '')
      : []
    return configured.length > 0 ? configured : BUILTIN_VOICE_WAKE_WORDS
  }

  const closeMicWindow = () => {
    if (micWin !== null && !micWin.isDestroyed()) micWin.destroy()
    micWin = null
  }

  const openMicWindow = async () => {
    if (micWin !== null && !micWin.isDestroyed()) return
    const window = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.on('closed', () => {
      if (micWin === window) micWin = null
    })
    micWin = window
    await window.loadFile(path.join(__dirname, 'renderer', 'mic.html'))
  }

  const syncMicWindow = async () => {
    const config = await asr.readConfig()
    asrMicEnabled = config.enabled
    if (config.enabled) await openMicWindow()
    else closeMicWindow()
    return config
  }

  registerChannel('pet:asr:status', async () => asr.status())
  registerChannel('pet:asr:config', async () => ({ ok: true, config: await asr.readConfig() }))
  registerChannel('pet:asr:save', async (_event, patch) => {
    await asr.saveConfig(patch)
    const config = await syncMicWindow()
    return { ok: true, config }
  })
  registerChannel('pet:asr:mic', async (_event, action) => {
    if (action === 'stop') {
      closeMicWindow()
      return { ok: true, running: false }
    }
    await syncMicWindow()
    return { ok: true, running: asrMicEnabled }
  })
  registerChannel('pet:asr:transcribe', async (_event, payload) => {
    const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? [])
    const result = await asr.transcribe(buffer)
    if (!result.ok || result.text === '') return { ...result, wakeWord: null }
    const wakeWord = asr.matchWakeWord(result.text, await wakeWordsForVoice())
    if (wakeWord !== null) {
      speakOut({ text: '嗯？人家在呢♪', scene: 'wakeWord', origin: 'reply' })
      if (win !== null && !win.isDestroyed()) {
        win.webContents.send('pet:asr:woke', {
          text: result.text,
          wakeWord,
          backend: result.backend
        })
      }
    }
    return { ...result, wakeWord }
  })

  // 本机识别的一次性配置：查路径 / 装依赖与模型 / 起服务。
  // 用户想手动跑脚本时也能从面板看到确切位置，不用猜。
  const asrToolsDir = path.join(__dirname, 'tools', 'asr')
  const asrModelDir = path.join(
    typeof process.env.LOCALAPPDATA === 'string' && process.env.LOCALAPPDATA !== ''
      ? process.env.LOCALAPPDATA
      : app.getPath('userData'),
    'cyrene-asr',
    'models'
  )
  const runPowerShell = (script, args = [], options = {}) =>
    new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
        { cwd: path.dirname(script), windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 900000, ...options },
        (error, stdout, stderr) => resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      )
    })

  registerChannel('pet:asr:local', async (_event, action) => {
    const installScript = path.join(asrToolsDir, 'install.ps1')
    const startScript = path.join(asrToolsDir, 'start.ps1')
    if (action === 'install') {
      if (!fsSync.existsSync(installScript)) return { ok: false, error: 'installer_missing', path: installScript }
      const { error, stdout, stderr } = await runPowerShell(installScript, ['-Model', 'small'])
      const log = (stdout + '\n' + stderr).trim().split(/\r?\n/).slice(-15).join('\n')
      return {
        ok: error === null,
        error: error === null ? null : 'install_failed',
        log,
        modelDir: asrModelDir,
        installer: installScript
      }
    }
    if (action === 'start') {
      if (!fsSync.existsSync(startScript)) return { ok: false, error: 'starter_missing', path: startScript }
      const child = execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', startScript],
        { cwd: asrToolsDir, windowsHide: true, detached: true }
      )
      child.unref()
      return { ok: true, modelDir: asrModelDir, starter: startScript }
    }
    const venvPython = path.join(asrToolsDir, '.venv', 'Scripts', 'python.exe')
    const modelSnapshots = path.join(asrModelDir, 'models--Systran--faster-whisper-small')
    return {
      ok: true,
      modelDir: asrModelDir,
      installer: installScript,
      starter: startScript,
      venvReady: fsSync.existsSync(venvPython),
      modelReady: fsSync.existsSync(modelSnapshots)
    }
  })

  // 启动时按配置复原一次。失败不拦启动：麦克风本来就是可选项。
  void syncMicWindow().catch((error) => {
    log('[asr] 启动同步失败：', error instanceof Error ? error.message : String(error))
  })
}

/**
 * 独立设置窗：单例，复用同一个 preload。
 * frame:false 让顶栏自绘，和主窗口观感一致。
 */
function openSettingsWindow(panel) {
  const target = typeof panel === 'string' && panel !== '' ? panel : undefined

  if (settingsWin !== null && !settingsWin.isDestroyed()) {
    // 已经开着就直接切到目标面板，不再叠一个窗口。
    if (target !== undefined) settingsWin.webContents.send('pet:settings:panel', target)
    settingsWin.show()
    settingsWin.focus()
    return
  }

  settingsWin = new BrowserWindow({
    width: 600,
    height: 740,
    icon: appIconPath,
    minWidth: 520,
    minHeight: 560,
    resizable: true,
    frame: false,
    backgroundColor: '#fffafc',
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  settingsWin.once('ready-to-show', () => {
    if (settingsWin !== null && !settingsWin.isDestroyed()) settingsWin.show()
  })

  settingsWin.on('closed', () => {
    settingsWin = null
  })

  // 设置窗不允许自行开新窗口或跳外链。
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), {
    ...(target === undefined ? {} : { hash: target }),
    query: { theme: resolveThemePreset('petSettings') }
  })
}

/**
 * 游戏页：单例。
 *
 * 排班、检测、周常记录、运行记录原本都塞在设置窗里，越加越长。
 * 这里把它们收进一个独立窗口，设置窗只留总开关和入口。
 */
function openGameWindow() {
  if (gameWin !== null && !gameWin.isDestroyed()) {
    gameWin.show()
    gameWin.focus()
    return
  }

  gameWin = new BrowserWindow({
    width: 640,
    height: 780,
    icon: appIconPath,
    minWidth: 520,
    minHeight: 560,
    resizable: true,
    frame: false,
    backgroundColor: '#fffafc',
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  gameWin.once('ready-to-show', () => {
    if (gameWin !== null && !gameWin.isDestroyed()) gameWin.show()
  })

  gameWin.on('closed', () => {
    gameWin = null
  })

  gameWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void gameWin.loadFile(path.join(__dirname, 'renderer', 'game.html'), {
    query: { theme: resolveThemePreset('petPanels') }
  })
}

/* ---------------- 弹幕层与陪看窗 ----------------
   弹幕层是一块全屏透明窗，永远不吃鼠标；文字只从主进程推，渲染层不读文件。
   陪看窗只允许停在 B 站域名里，站外链接既不新开窗也不在当前窗里走。 */

const BILI_HOSTS = ['bilibili.com', 'b23.tv']

/* 弹幕层是懒创建的：没弹幕就不存在，安静一阵就自己收掉。
   观感（字号 / 不透明度 / 时长 / 轨道 / 静默）由插件设置页下发，这里只做兜底。 */
const DANMAKU_STYLE_DEFAULT = { fontSize: 22, opacity: 0.95, seconds: 12, tracks: 7, idleMinutes: 5 }
let danmakuStyle = { ...DANMAKU_STYLE_DEFAULT }
let danmakuEnabled = true
let danmakuIdleTimer = null

/* 把插件下发的值收进安全区间，任何一项坏了都不影响弹幕继续走。 */
function normalizeDanmakuStyle(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const pick = (value, min, max, fallback) => {
    const num = Number(value)
    if (!Number.isFinite(num)) return fallback
    return Math.min(max, Math.max(min, num))
  }
  return {
    fontSize: Math.round(pick(source.fontSize, 14, 40, DANMAKU_STYLE_DEFAULT.fontSize)),
    opacity: pick(source.opacity, 0.3, 1, DANMAKU_STYLE_DEFAULT.opacity),
    seconds: Math.round(pick(source.seconds, 6, 30, DANMAKU_STYLE_DEFAULT.seconds)),
    tracks: Math.round(pick(source.tracks, 3, 12, DANMAKU_STYLE_DEFAULT.tracks)),
    idleMinutes: Math.round(pick(source.idleMinutes, 1, 60, DANMAKU_STYLE_DEFAULT.idleMinutes))
  }
}

/* 参数变了就重载一次页面：弹幕层本身是空的，重载没有观感代价。 */
function applyDanmakuStyle(raw) {
  const next = normalizeDanmakuStyle(raw)
  const changed = next.fontSize !== danmakuStyle.fontSize
    || next.opacity !== danmakuStyle.opacity
    || next.seconds !== danmakuStyle.seconds
    || next.tracks !== danmakuStyle.tracks
  danmakuStyle = next
  if (changed && danmakuWin !== null && !danmakuWin.isDestroyed()) {
    void danmakuWin.loadFile(path.join(__dirname, 'renderer', 'danmaku.html'), {
      query: {
        font: String(next.fontSize),
        opacity: String(next.opacity),
        seconds: String(next.seconds),
        tracks: String(next.tracks)
      }
    })
  }
}

function isBiliUrl(raw) {
  try {
    const host = new URL(String(raw)).hostname.toLowerCase()
    return BILI_HOSTS.some((item) => host === item || host.endsWith(`.${item}`))
  } catch {
    return false
  }
}

function openDanmakuWindow() {
  if (danmakuWin !== null && !danmakuWin.isDestroyed()) return danmakuWin
  const area = screen.getPrimaryDisplay().workArea
  danmakuWin = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // screen-saver 是 Electron 允许的最高常驻层级，全屏游戏上也压得住。
  danmakuWin.setAlwaysOnTop(true, 'screen-saver')
  // 永远穿透：弹幕飘过去的时候，底下该怎么点还怎么点。
  danmakuWin.setIgnoreMouseEvents(true, { forward: true })

  danmakuWin.once('ready-to-show', () => {
    if (danmakuWin !== null && !danmakuWin.isDestroyed()) danmakuWin.showInactive()
  })

  danmakuWin.on('closed', () => {
    danmakuWin = null
  })

  void danmakuWin.loadFile(path.join(__dirname, 'renderer', 'danmaku.html'), {
    query: {
      font: String(danmakuStyle.fontSize),
      opacity: String(danmakuStyle.opacity),
      seconds: String(danmakuStyle.seconds),
      tracks: String(danmakuStyle.tracks)
    }
  })
  return danmakuWin
}

function closeDanmakuWindow() {
  if (danmakuIdleTimer !== null) {
    clearTimeout(danmakuIdleTimer)
    danmakuIdleTimer = null
  }
  if (danmakuWin !== null && !danmakuWin.isDestroyed()) danmakuWin.destroy()
  danmakuWin = null
}

/* 弹幕层只在有话说的时候存在：连着几分钟没新弹幕就自己收起来，
   下次再有弹幕时重建，不必常驻一层全屏合成。 */
function scheduleDanmakuIdleClose() {
  if (danmakuIdleTimer !== null) clearTimeout(danmakuIdleTimer)
  danmakuIdleTimer = setTimeout(() => {
    danmakuIdleTimer = null
    closeDanmakuWindow()
  }, Math.max(1, danmakuStyle.idleMinutes) * 60 * 1000)
  if (typeof danmakuIdleTimer.unref === 'function') danmakuIdleTimer.unref()
}

function pushDanmaku(item) {
  const text = typeof item?.text === 'string' ? item.text.slice(0, 200) : ''
  if (text === '' || danmakuEnabled !== true) return
  const target = openDanmakuWindow()
  const payload = {
    id: Number(item?.id) || 0,
    text,
    tone: item?.tone === 'user' ? 'user' : 'pet'
  }
  const send = () => {
    if (danmakuWin === null || danmakuWin.isDestroyed()) return
    danmakuWin.webContents.send('pet:danmaku:item', payload)
  }
  // 页面还没加载完就发，事件会丢掉；等 did-finish-load 再补一次。
  if (target.webContents.isLoading()) target.webContents.once('did-finish-load', send)
  else send()
  scheduleDanmakuIdleClose()
}

function openBiliWindow(rawUrl) {
  const target = isBiliUrl(rawUrl) ? String(rawUrl) : 'https://www.bilibili.com'

  if (biliWin !== null && !biliWin.isDestroyed()) {
    biliWin.show()
    biliWin.focus()
    void biliWin.loadURL(target)
    return biliWin
  }

  biliWin = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    icon: appIconPath,
    title: '哔哩哔哩',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      // 独立分区：B 站登录态单独存，不和桌宠自己的会话混在一起。
      partition: 'persist:cyrene-bili',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  })

  biliWin.once('ready-to-show', () => {
    if (biliWin !== null && !biliWin.isDestroyed()) biliWin.show()
  })

  biliWin.on('closed', () => {
    biliWin = null
  })

  biliWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isBiliUrl(url) && biliWin !== null && !biliWin.isDestroyed()) void biliWin.loadURL(url)
    return { action: 'deny' }
  })

  biliWin.webContents.on('will-navigate', (event, url) => {
    if (!isBiliUrl(url)) event.preventDefault()
  })

  void biliWin.loadURL(target)
  return biliWin
}

// ---------- B 站浏览与邮件 ----------

/** B 站 API 会话：陪看窗的独立分区，登录态只在这里。 */
function biliSession() {
  return session.fromPartition('persist:cyrene-bili')
}

/** 读 B 站登录 Cookie，拼成 header 值。没有登录态就返回空串，只读接口照常用。 */
async function biliCookieHeader() {
  try {
    const cookies = await biliSession().cookies.get({ url: 'https://www.bilibili.com' })
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  } catch (error) {
    log('[bili] 读 Cookie 失败：', error?.message ?? error)
    return ''
  }
}

/** 只读：B 站登录态。有 SESSDATA 就算登录，不把 cookie 明文吐出去。 */
async function biliLoginStatus() {
  const cookie = await biliCookieHeader()
  const loggedIn = /(?:^|;\s*)SESSDATA=/.test(cookie)
  return { loggedIn }
}

const BILI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

// WBI 密钥缓存：img_key / sub_key 从 nav 接口拿，B 站会定期轮换。
let wbiKeyCache = { imgKey: '', subKey: '', at: 0 }
const WBI_KEY_TTL_MS = 12 * 60 * 60 * 1000

/** 拿 WBI 密钥对（img_key + sub_key），带 12 小时缓存，失败回退旧值。 */
async function biliWbiKeys() {
  const now = Date.now()
  if (wbiKeyCache.imgKey && now - wbiKeyCache.at < WBI_KEY_TTL_MS) {
    return { imgKey: wbiKeyCache.imgKey, subKey: wbiKeyCache.subKey }
  }
  try {
    const response = await net.fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/' }
    })
    if (response.ok) {
      const json = await response.json()
      const imgUrl = String(json?.data?.wbi_img?.img_url ?? '')
      const subUrl = String(json?.data?.wbi_img?.sub_url ?? '')
      const imgKey = imgUrl.split('/').pop()?.split('.')[0] ?? ''
      const subKey = subUrl.split('/').pop()?.split('.')[0] ?? ''
      if (imgKey && subKey) {
        wbiKeyCache = { imgKey, subKey, at: now }
        return { imgKey, subKey }
      }
    }
  } catch (error) {
    log('[bili] 获取 WBI 密钥失败：', error?.message ?? error)
  }
  return { imgKey: wbiKeyCache.imgKey, subKey: wbiKeyCache.subKey }
}

/** 给只读接口 URL 补 WBI 签名；拿不到 key 时原样返回。 */
async function biliSignedUrl(url) {
  const { imgKey, subKey } = await biliWbiKeys()
  if (!imgKey || !subKey) return url
  return signWbiUrl(url, imgKey, subKey)
}

/** B 站 API 统一出口：带登录态、UA、Referer，走 net.fetch。 */
async function biliFetch(url, init = {}) {
  const cookie = await biliCookieHeader()
  const headers = {
    'User-Agent': BILI_UA,
    Referer: 'https://www.bilibili.com/',
    ...(init.headers ?? {}),
    ...(cookie ? { Cookie: cookie } : {})
  }
  const response = await net.fetch(url, { ...init, headers })
  if (!response.ok) throw new Error(`B 站请求失败：HTTP ${response.status}`)
  return response.json()
}

/** 只读：搜索视频。 */
async function biliSearch(keyword) {
  return parseSearch(await biliFetch(await biliSignedUrl(searchUrl(keyword))))
}

/** 只读：视频详情（含分 P 列表）。 */
async function biliVideoInfo(bvid) {
  return parseVideoInfo(await biliFetch(await biliSignedUrl(videoInfoUrl(bvid))))
}

/** 只读：拿视频的字幕轨列表（需要登录态才有 AI 字幕）。 */
async function biliSubtitleList(bvid, cid) {
  const url = await biliSignedUrl(playerUrl(bvid, cid))
  return parseSubtitleList(await biliFetch(url))
}

/** 只读：下载某条字幕并拼成全文。subtitleUrl 来自 biliSubtitleList。 */
async function biliTranscript(subtitleUrl) {
  const response = await net.fetch(subtitleUrl, { headers: { 'User-Agent': BILI_UA } })
  if (!response.ok) throw new Error(`字幕下载失败：HTTP ${response.status}`)
  return parseTranscript(await response.json())
}

/** 只读：抓网页正文。 */
async function biliArticle(url) {
  const response = await net.fetch(url, { headers: { 'User-Agent': BILI_UA } })
  if (!response.ok) throw new Error(`抓取失败：HTTP ${response.status}`)
  return extractArticle(await response.text())
}

/** B 站写操作策略：默认全关，逐项在设置里开启。 */
function biliPolicy() {
  const browse = settings?.browse ?? {}
  return {
    enabledWrites: Array.isArray(browse.enabledWrites) ? browse.enabledWrites : [],
    maxCoinsPerAction: Number.isInteger(browse.maxCoinsPerAction)
      ? browse.maxCoinsPerAction
      : 1
  }
}

/** 写操作是否需要二次确认（不可撤回 / 消耗资产 / 公开，任一条命中）。 */
function biliNeedsConfirm(action) {
  try {
    return needsConfirmation(action)
  } catch {
    return false
  }
}

/**
 * 二次确认的一次性令牌。
 *
 * 危险写操作弹确认框时由主进程发一个 nonce，确认后的调用必须原样带回；
 * nonce 绑定动作与参数、单次有效、两分钟过期。任何页面光传 confirmed: true
 * 都过不去——没有见过确认框就拿不到令牌。
 */
const BILI_CONFIRM_TTL_MS = 2 * 60 * 1000
const biliConfirmNonces = new Map()

function issueBiliConfirmNonce(action, params) {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  biliConfirmNonces.set(nonce, {
    action,
    params: JSON.stringify(params ?? {}),
    expiresAt: Date.now() + BILI_CONFIRM_TTL_MS
  })
  return nonce
}

function consumeBiliConfirmNonce(nonce, action, params) {
  if (typeof nonce !== 'string' || nonce === '') return false
  const record = biliConfirmNonces.get(nonce)
  if (record === undefined) return false
  biliConfirmNonces.delete(nonce)
  if (Date.now() > record.expiresAt) return false
  if (record.action !== action) return false
  if (record.params !== JSON.stringify(params ?? {})) return false
  return true
}

/** B 站写操作：策略校验 → 拼表单 → 发请求 → 读响应。
 *  enforceNonce=true 时（能力中心 IPC 入口）确认必须带一次性令牌；
 *  模型工具路径的确认经过聊天窗交互，走 trusted 分支，不要求令牌。 */
async function biliWrite(action, params, confirmed, nonce = null, enforceNonce = false) {
  const policy = biliPolicy()
  assertActionAllowed(action, policy)
  if (action === 'coin') assertCoinCount(params?.coinCount ?? 1, policy)

  // 危险动作必须带 confirmed，且 confirmed 必须对得上主进程发的一次性令牌；
  // 二次确认的弹框留在 UI 层，令牌由主进程在返回 needsConfirm 时签发。
  if (biliNeedsConfirm(action)) {
    if (confirmed !== true) {
      const token = issueBiliConfirmNonce(action, params)
      return { ok: false, needsConfirm: true, confirmNonce: token, message: '这个动作需要再确认一次' }
    }
    if (enforceNonce && !consumeBiliConfirmNonce(nonce, action, params)) {
      return { ok: false, message: '确认令牌无效或已过期，请重新确认' }
    }
  }

  const request = buildActionRequest(action, params)
  const cookie = await biliCookieHeader()
  const csrf = biliCsrfFrom(cookie)
  if (request.requiresCsrf && !csrf) {
    return { ok: false, message: 'B 站还没登录，写操作做不了' }
  }

  const form = request.requiresCsrf && csrf ? { ...request.form, csrf } : request.form
  const body = new URLSearchParams(form)
  const response = await biliFetch(request.url, {
    method: request.method,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {})
    },
    body: body.toString()
  })
  return parseActionResponse(response)
}

/** 从 Cookie 串里取 bili_jct（csrf）。 */
function biliCsrfFrom(cookie) {
  const m = /(?:^|;\s*)bili_jct=([^;]+)/.exec(cookie)
  return m?.[1] ?? ''
}

// ---------- 邮件 ----------

/** 把 UTF-8 发件人/主题按 RFC2047 编码，避免中文乱码。 */
function mimeHeader(text) {
  const value = String(text ?? '')
  if (value === '') return ''
  // 头部注入防线：任何换行都说明输入有问题，直接整体拒绝，
  // 绝不让主题或发件人名字拼出额外的邮件头（Bcc 等）。
  if (/[\r\n]/.test(value)) {
    throw new Error('邮件主题或发件人名称含非法换行')
  }
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

/** 最小 SMTP 客户端：465 走 TLS 直连，587 走 STARTTLS，AUTH LOGIN 认证。 */
function smtpSend({ host, port, user, pass, fromName, to, subject, body }) {
  return new Promise((resolve, reject) => {
    const portNum = Number(port)
    const directTls = portNum === 465
    let socket
    let buffer = ''
    let stage = directTls ? 'ehlo' : 'greet'
    let settled = false

    const finish = (err) => {
      if (settled) return
      settled = true
      if (socket) {
        try { socket.destroy() } catch { /* noop */ }
      }
      if (err) reject(err)
      else resolve(true)
    }

    const send = (line) => socket.write(line + '\r\n')

    function handle(line) {
      const code = Number.parseInt(line.slice(0, 3), 10)
      if (line[3] === '-') return
      if (code >= 500 && stage !== 'done') {
        return finish(new Error(`SMTP 拒绝：${line.slice(4) || line}`))
      }

      if (stage === 'greet') {
        send('EHLO localhost')
        stage = 'ehlo'
      } else if (stage === 'ehlo') {
        if (!directTls && line.includes('STARTTLS')) {
          send('STARTTLS')
          stage = 'starttls'
        } else {
          send('AUTH LOGIN')
          stage = 'auth-user'
        }
      } else if (stage === 'starttls') {
        if (code !== 220) return finish(new Error('SMTP 不支持 STARTTLS'))
        const raw = socket
        raw.removeAllListeners('data')
        buffer = ''
        // 证书校验保持 Node 默认开启：AUTH LOGIN 的凭据就在这条链路上，
        // 关掉校验等于把用户名密码交给任何能中间人劫持 587 端口的人。
        const secure = tls.connect({ socket: raw })
        socket = secure
        secure.on('data', onData)
        secure.on('error', (e) => finish(e))
        secure.on('secureConnect', () => {
          send('EHLO localhost')
          stage = 'tls-ehlo'
        })
      } else if (stage === 'tls-ehlo') {
        send('AUTH LOGIN')
        stage = 'auth-user'
      } else if (stage === 'auth-user') {
        send(Buffer.from(user, 'utf8').toString('base64'))
        stage = 'auth-pass'
      } else if (stage === 'auth-pass') {
        send(Buffer.from(pass, 'utf8').toString('base64'))
        stage = 'mail-from'
      } else if (stage === 'mail-from') {
        send(`MAIL FROM:<${user}>`)
        stage = 'rcpt'
      } else if (stage === 'rcpt') {
        send(`RCPT TO:<${to}>`)
        stage = 'data'
      } else if (stage === 'data') {
        send('DATA')
        stage = 'data-body'
      } else if (stage === 'data-body') {
        if (code !== 354) return finish(new Error('SMTP 拒绝接收正文'))
        const headers = [
          `From: ${mimeHeader(fromName)} <${user}>`,
          `To: <${to}>`,
          `Subject: ${mimeHeader(subject)}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: base64'
        ].join('\r\n')
        const b64 = Buffer.from(String(body ?? ''), 'utf8').toString('base64').replace(/(.{1,76})/g, '$1\r\n')
        send(headers + '\r\n\r\n' + b64)
        send('.')
        stage = 'done'
      } else if (stage === 'done') {
        if (code !== 250) return finish(new Error(`SMTP 发送被拒：${line.slice(4) || line}`))
        send('QUIT')
        finish(null)
      }
    }

    function onData(chunk) {
      buffer += chunk.toString('utf8')
      let idx
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        if (line.trim() !== '') handle(line)
      }
    }

    const connectOpts = { host, port: portNum }
    socket = directTls ? tls.connect(connectOpts) : tcpConnect(connectOpts)
    socket.on('data', onData)
    socket.on('error', (e) => finish(e))
    socket.setTimeout(30000, () => finish(new Error('SMTP 连接超时')))
  })
}

/** 真发信：走桌宠自带 SMTP，独立于 Cyrene 本体，不再依赖 send_mail.ps1。 */
async function sendMail({ to, subject, body }) {
  const recipient = String(to ?? settings?.mail?.defaultRecipient ?? '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return { ok: false, reason: 'bad-recipient', message: '收件人邮箱格式不对' }
  }
  const smtp = settings?.mail?.smtp ?? {}
  const host = String(smtp.host ?? '').trim()
  const port = Number(smtp.port ?? 465)
  const user = String(smtp.user ?? '').trim()
  // 密码优先读加密仓库；设置里那份是迁移前的明文兜底。
  let pass = ''
  if (secretStore !== null) {
    try {
      pass = (await secretStore.get('mail', 'smtp.pass')) ?? ''
    } catch (error) {
      log('[mail] 读加密密码失败，退回设置明文', String(error?.message ?? error))
    }
  }
  if (pass === '') pass = String(smtp.pass ?? '')
  if (host === '' || user === '') {
    return { ok: false, reason: 'smtp-not-configured', message: '还没配置 SMTP（发件邮箱），请先在能力中心填好' }
  }
  const fromName = String(settings?.mail?.fromName ?? '').trim() || '昔涟'

  try {
    await smtpSend({ host, port, user, pass, fromName, to: recipient, subject: subject ?? '', body })
    return { ok: true, message: `已发送到 ${recipient}` }
  } catch (error) {
    return { ok: false, message: error?.message ?? String(error) }
  }
}

/** 已入库表情的扩展名 → MIME；腾讯富媒体只按图片类型处理。 */
const STICKER_MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}
/** 腾讯单张图片上限 5MB。 */
const QQ_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/**
 * 渲染层传 pet-media://pack/<packId>/<相对路径> 或 <packId>/<相对路径>。
 * 两种写法都交给 packStore.resolvePackPath 再校验一次，渲染层拿不到真实磁盘路径。
 */
function resolveStickerFile(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return null

  if (text.startsWith('pet-media://')) {
    try {
      const url = new URL(text)
      if (url.host !== 'pack') return null
      const relative = decodeURIComponent(url.pathname).replace(/^[/\\]+/, '')
      const slash = relative.indexOf('/')
      if (slash <= 0) return null
      return packStore.resolvePackPath(relative.slice(0, slash), relative.slice(slash + 1))
    } catch {
      return null
    }
  }

  const normalized = text.replace(/\\/g, '/')
  const slash = normalized.indexOf('/')
  if (slash <= 0) return null
  return packStore.resolvePackPath(normalized.slice(0, slash), normalized.slice(slash + 1))
}

/**
 * 把一张已入库的表情发到最近一次 QQ 会话。
 * 只走被动回复窗口，不排队、不主动推送；窗口过期就明确回失败。
 */
async function sendQqSticker(file) {
  if (qq === null || typeof qq.replyImage !== 'function') {
    return { ok: false, reason: 'qq-offline', message: 'QQ 还没连上，先等网关就绪' }
  }

  // 先按表情库 id 找（builtin:… / pack:…），找不到再按素材包相对路径找。
  // 两条路都不接受任意路径；任何一条抛错都当作「没有这个文件」，不把异常甩给渲染层。
  const fromLibrary = await stickerLibrary.resolve(file).catch(() => null)
  let resolved = fromLibrary === null ? null : fromLibrary.abs
  if (resolved === null) {
    try {
      resolved = resolveStickerFile(file)
    } catch {
      resolved = null
    }
  }
  if (resolved === null) {
    return { ok: false, reason: 'bad-file', message: '表情文件路径不合法' }
  }

  const stat = await fs.stat(resolved).catch(() => null)
  if (stat === null || !stat.isFile()) {
    return { ok: false, reason: 'missing', message: '表情文件不存在，可能已被移走' }
  }
  if (stat.size > QQ_IMAGE_MAX_BYTES) {
    return { ok: false, reason: 'too-large', message: '腾讯接口单张图片上限 5MB' }
  }

  const contentType = STICKER_MEDIA_TYPES[path.extname(resolved).toLowerCase()]
  if (contentType === undefined) {
    return { ok: false, reason: 'bad-type', message: '这个格式不能发到 QQ' }
  }

  const bytes = await fs.readFile(resolved)
  const sent = await qq.replyImage(contentType, bytes)
  if (!sent) {
    return { ok: false, reason: 'window-closed', message: '不在被动回复窗口，稍后发条消息再试' }
  }
  return { ok: true }
}

/**
 * 表情包预览页：网格浏览 + 待审核区，单例。
 * 和设置窗同一套窗口参数；页面只调已登记通道。
 */
function openStickerWindow() {
  if (stickerWin !== null && !stickerWin.isDestroyed()) {
    stickerWin.show()
    stickerWin.focus()
    return
  }

  stickerWin = new BrowserWindow({
    width: 760,
    height: 760,
    icon: appIconPath,
    minWidth: 620,
    minHeight: 560,
    resizable: true,
    frame: false,
    backgroundColor: '#fffafc',
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  stickerWin.once('ready-to-show', () => {
    if (stickerWin !== null && !stickerWin.isDestroyed()) stickerWin.show()
  })

  stickerWin.on('closed', () => {
    stickerWin = null
  })

  stickerWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void stickerWin.loadFile(path.join(__dirname, 'renderer', 'stickers.html'), {
    query: { theme: resolveThemePreset('petPanels') }
  })
}

/**
 * 某个位置该用哪套配色：勾了跟随就用 theme.preset，
 * 取消勾选就用它自己固定下来的那套。缺省一律跟随。
 */
function resolveThemePreset(slot) {
  const preset = settings.theme?.preset ?? 'SakuraPink'
  const entry = settings.theme?.slots?.[slot]
  if (entry && entry.follow === false) {
    if (typeof entry.preset === 'string' && entry.preset !== '') return entry.preset
  }
  return preset
}

/**
 * 背景库：网格浏览 userData/backgrounds，选用与删除都走已登记通道。
 * 这一页只做展示与选择，图片本体仍由主进程搬。
 */
function openBackgroundsWindow() {
  if (backgroundsWin !== null && !backgroundsWin.isDestroyed()) {
    backgroundsWin.show()
    backgroundsWin.focus()
    return
  }

  backgroundsWin = new BrowserWindow({
    width: 880,
    height: 720,
    icon: appIconPath,
    minWidth: 680,
    minHeight: 540,
    resizable: true,
    frame: false,
    backgroundColor: '#fffafc',
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  backgroundsWin.once('ready-to-show', () => {
    if (backgroundsWin !== null && !backgroundsWin.isDestroyed()) backgroundsWin.show()
  })

  backgroundsWin.on('closed', () => {
    backgroundsWin = null
  })

  backgroundsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void backgroundsWin.loadFile(path.join(__dirname, 'renderer', 'backgrounds.html'), {
    query: { theme: resolveThemePreset('petPanels') }
  })
}

/**
 * 会话页：聊天历史与 QQ 会话两个页签。
 * 聊天历史走 pet:chat:history，QQ 只读主人相关会话的最近消息。
 */
function openSessionsWindow(tab) {
  if (sessionsWin !== null && !sessionsWin.isDestroyed()) {
    sessionsWin.show()
    sessionsWin.focus()
    return
  }

  sessionsWin = new BrowserWindow({
    width: 900,
    height: 740,
    icon: appIconPath,
    minWidth: 700,
    minHeight: 560,
    resizable: true,
    frame: false,
    backgroundColor: '#fffafc',
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  sessionsWin.once('ready-to-show', () => {
    if (sessionsWin !== null && !sessionsWin.isDestroyed()) sessionsWin.show()
  })

  sessionsWin.on('closed', () => {
    sessionsWin = null
  })

  sessionsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void sessionsWin.loadFile(path.join(__dirname, 'renderer', 'sessions.html'), {
    query:
      typeof tab === 'string' && tab !== ''
        ? { theme: settings.theme?.preset ?? 'SakuraPink', tab }
        : { theme: settings.theme?.preset ?? 'SakuraPink' }
  })
}

/**
 * 能力中心：九宫格入口，单例。
 *
 * 和设置窗同一套窗口参数：contextIsolation + sandbox，preload 白名单不变。
 * 页面只调用已登记通道，不开放任何新的宿主能力。
 */
function openAbilityWindow() {
  if (abilityWin !== null && !abilityWin.isDestroyed()) {
    abilityWin.show()
    abilityWin.focus()
    return
  }

  abilityWin = new BrowserWindow({
    width: 680,
    height: 720,
    icon: appIconPath,
    minWidth: 560,
    minHeight: 560,
    resizable: true,
    frame: false,
    backgroundColor: '#fffafc',
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  abilityWin.once('ready-to-show', () => {
    if (abilityWin !== null && !abilityWin.isDestroyed()) abilityWin.show()
  })

  abilityWin.on('closed', () => {
    abilityWin = null
  })

  abilityWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void abilityWin.loadFile(path.join(__dirname, 'renderer', 'ability.html'), {
    query: { theme: resolveThemePreset('petPanels') }
  })
}

/**
 * 观察台：看她在想什么、跟谁熟、记得什么，单例。
 *
 * 页面只读快照，写动作都走已登记通道；窗口本身不持有额外权限。
 */
function openInsightWindow(tab) {
  if (insightWin !== null && !insightWin.isDestroyed()) {
    insightWin.show()
    insightWin.focus()
    if (typeof tab === 'string' && tab !== '') {
      insightWin.webContents.send('pet:insight:select-tab', tab)
    }
    return
  }

  insightWin = new BrowserWindow({
    width: 940,
    height: 720,
    icon: appIconPath,
    minWidth: 760,
    minHeight: 560,
    resizable: true,
    frame: false,
    backgroundColor: '#fffafc',
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  insightWin.once('ready-to-show', () => {
    if (insightWin !== null && !insightWin.isDestroyed()) insightWin.show()
  })

  insightWin.on('closed', () => {
    insightWin = null
  })

  insightWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void insightWin.loadFile(path.join(__dirname, 'renderer', 'insight.html'), {
    query:
      typeof tab === 'string' && tab !== ''
        ? { theme: settings.theme?.preset ?? 'SakuraPink', tab }
        : { theme: settings.theme?.preset ?? 'SakuraPink' }
  })
}

/* 记忆页作用域列表：读插件进程写出的 memory-snapshot.json，观察台只读不写。 */
registerChannel('pet:memory-console:load', async () => {
  const file = path.join(app.getPath('home'), '.cyrene-pet', 'memory-snapshot.json')
  try {
    const text = await fs.readFile(file, 'utf8')
    const data = JSON.parse(text)
    // 外部文件内容放进 data 字段，不展开到返回值：文件里的 ok/其他字段
    // 不允许覆盖主进程给出的状态。
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, reason: 'bad-snapshot', file }
    }
    return { ok: true, data }
  } catch (error) {
    const code = error?.code === 'ENOENT' ? 'not-ready' : 'read-failed'
    return { ok: false, reason: code, file }
  }
})

/**
 * 聊天窗：单例，和设置窗同一套 preload。
 *
 * 默认贴在桌宠旁边；右边放不下就翻到左边，再不行就贴工作区边缘，
 * 免得在多屏或窄屏上开在看不见的地方。
 */
function openChatWindow() {
  if (chatWin !== null && !chatWin.isDestroyed()) {
    chatWin.show()
    chatWin.focus()
    return
  }

  const width = 380
  const height = 520
  const bounds = win === null || win.isDestroyed() ? null : win.getBounds()
  const area = (bounds === null ? screen.getPrimaryDisplay() : screen.getDisplayMatching(bounds)).workArea

  const right = bounds === null ? area.x + area.width - width - 24 : bounds.x + bounds.width + 8
  const left = bounds === null ? area.x + 24 : bounds.x - width - 8
  const x = right + width <= area.x + area.width ? right : Math.max(area.x + 8, left)
  const y = Math.min(
    Math.max(bounds === null ? area.y + 80 : bounds.y, area.y + 8),
    Math.max(area.y + 8, area.y + area.height - height - 8)
  )

  chatWin = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 320,
    minHeight: 400,
    icon: appIconPath,
    resizable: true,
    frame: false,
    backgroundColor: '#fffafc',
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  chatWin.once('ready-to-show', () => {
    if (chatWin !== null && !chatWin.isDestroyed()) chatWin.show()
  })

  chatWin.on('closed', () => {
    chatWin = null
  })

  // 聊天内容全是文本，没有外链需求；一律拒绝新窗口。
  chatWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void chatWin.loadFile(path.join(__dirname, 'renderer', 'chat.html'), {
    query: { theme: resolveThemePreset('petPanels') }
  })
}

/**
 * 首次引导窗：只在 onboarded 为 false 时出现。
 * 中途关掉不算走完，下次启动还会问；三步都过一遍才写 onboarded: true。
 */
function openOnboardingWindow() {
  if (onboardingWin !== null && !onboardingWin.isDestroyed()) {
    onboardingWin.show()
    onboardingWin.focus()
    return
  }

  onboardingWin = new BrowserWindow({
    width: 460,
    height: 520,
    icon: appIconPath,
    resizable: false,
    frame: false,
    backgroundColor: '#fffafc',
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  onboardingWin.once('ready-to-show', () => {
    if (onboardingWin !== null && !onboardingWin.isDestroyed()) onboardingWin.show()
  })

  onboardingWin.on('closed', () => {
    onboardingWin = null
  })

  onboardingWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void onboardingWin.loadFile(path.join(__dirname, 'renderer', 'onboarding.html'), {
    query: { theme: resolveThemePreset('petPanels') }
  })
}

/**
 * 托盘静音开关：写的是 settings.voice.enabled，和设置页同一个字段。
 * 保存失败时要能看出来，所以只记录不吞掉。
 */
async function setVoiceMuted(muted) {
  settings = mergeLayer(settings, { voice: { enabled: !muted } })
  try {
    await writeSettings(settings)
    broadcastSettings(settings)
  } catch (error) {
    log('[tray] 静音设置保存失败：', error?.message ?? error)
  }
}

/**
 * 托盘边缘吸附开关：写 settings.window.edgeSnap，和设置页同一个字段。
 * 吸附在拖动结束时判断，保存后下一次拖动即生效。
 */
async function setEdgeSnap(enabled) {
  const prev = settings
  settings = mergeLayer(settings, { window: { edgeSnap: enabled } })
  try {
    await writeSettings(settings)
    broadcastSettings(settings)
    flashTrayTip(enabled ? '已开启边缘吸附' : '已关闭边缘吸附')
  } catch (error) {
    // 写盘失败就回滚，菜单勾选保持原样。
    settings = prev
    log('[tray] 边缘吸附设置保存失败：', error?.message ?? error)
    flashTrayTip('边缘吸附设置保存失败')
  }
}

/**
 * 临时安静：只存在于本次运行，不写设置。
 * 到点自动恢复；重启进程也会恢复，和「临时」的语义一致。
 */
let quietUntil = 0
let quietTimer = null
let quietTickTimer = null
// 托盘菜单构建器由 createTray 注入：startQuiet 在模块顶层，不能直接引用 createTray 的局部函数。
let trayMenuBuilder = null

function quietMinutesLeft() {
  if (quietUntil === 0) return 0
  return Math.max(0, Math.ceil((quietUntil - Date.now()) / 60_000))
}

function quietTipText() {
  return `安静中 · 还剩 ${quietMinutesLeft()} 分钟`
}

/** 安静状态变化后统一刷新托盘：菜单标签与 tooltip 都跟着走。 */
function refreshTrayQuietUi() {
  if (tray === null || tray.isDestroyed()) return
  if (trayMenuBuilder !== null) tray.setContextMenu(trayMenuBuilder())
  tray.setToolTip(isTemporarilyQuiet() ? quietTipText() : '桌宠')
}

function isTemporarilyQuiet() {
  if (quietUntil === 0) return false
  if (Date.now() >= quietUntil) {
    quietUntil = 0
    return false
  }
  return true
}

function stopQuiet() {
  quietUntil = 0
  if (quietTimer !== null) {
    clearTimeout(quietTimer)
    quietTimer = null
  }
  if (quietTickTimer !== null) {
    clearInterval(quietTickTimer)
    quietTickTimer = null
  }
}

function startQuiet(minutes) {
  stopQuiet()
  const duration = Math.max(1, Math.round(minutes)) * 60_000
  quietUntil = Date.now() + duration
  quietTimer = setTimeout(() => {
    quietUntil = 0
    quietTimer = null
    if (quietTickTimer !== null) {
      clearInterval(quietTickTimer)
      quietTickTimer = null
    }
    refreshTrayQuietUi()
    flashTrayTip('安静时间结束了')
  }, duration)
  quietTimer.unref?.()
  // 菜单打开时不会自己重算，安静期间每 30 秒重建一次，倒计时才跟得上。
  quietTickTimer = setInterval(refreshTrayQuietUi, 30_000)
  quietTickTimer.unref?.()
  refreshTrayQuietUi()
  flashTrayTip(`安静 ${minutes} 分钟`)
}

/**
 * 托盘是当前唯一的可见退出入口：窗口 frame:false 且 skipTaskbar:true，
 * 没有托盘就只能靠任务管理器结束进程。
 */
function flashTrayTip(text) {
  if (tray === null || tray.isDestroyed()) return
  tray.setToolTip(text)
  setTimeout(() => {
    if (tray === null || tray.isDestroyed()) return
    tray.setToolTip(isTemporarilyQuiet() ? quietTipText() : '桌宠')
  }, 4000)
}

/**
 * 把 settings 里的 pack:<id>:<相对路径> 解析成真实文件。
 * 只认这个格式，其它写法（含绝对路径）一律当空值处理。
 */
function resolvePackAssetRef(ref) {
  if (typeof ref !== 'string') return null
  if (!ref.startsWith('pack:')) return null
  const rest = ref.slice('pack:'.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) return null
  const packId = rest.slice(0, sep)
  const relative = rest.slice(sep + 1)
  if (relative === '') return null
  return packStore.resolvePackPath(packId, relative)
}

/**
 * 托盘图标候选顺序：素材包选中项 → Cyrene 自绘 ico → 旧的 tray.png。
 * ico 在个别 Windows 环境下解不出来，回退一次比直接留空托盘更好。
 */
function loadTrayIcon() {
  const candidates = []
  const picked = resolvePackAssetRef(settings.icon?.tray)
  if (picked !== null) candidates.push(picked)
  candidates.push(
    path.join(assetsRoot, 'cyrene', 'icons', 'tray.ico'),
    path.join(__dirname, 'assets', 'tray.png')
  )
  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate)
    if (!image.isEmpty()) return image
    log('托盘图标不可用：', candidate)
  }
  return null
}

/** 窗口与任务栏图标：素材包选中项优先，回退内置 app-cyrene.png。 */
function resolveAppIcon() {
  const picked = resolvePackAssetRef(settings.icon?.app)
  if (picked !== null) {
    const image = nativeImage.createFromPath(picked)
    if (!image.isEmpty()) return image
    log('素材包窗口图标不可用：', picked)
  }
  const fallback = nativeImage.createFromPath(appIconPath)
  return fallback.isEmpty() ? null : fallback
}

/**
 * 图标设置变更后调用：换托盘图 + 给所有存活窗口重设图标。
 * 托盘读取失败时保留旧图标，不能让它凭空消失。
 * 没换图标引用时直接返回，避免每次保存设置都读一遍图片。
 */
let lastIconSignature = null
function applyIconSettings(force = false) {
  const signature = `${settings.icon?.tray ?? ''}|${settings.icon?.app ?? ''}`
  if (!force && signature === lastIconSignature) return
  lastIconSignature = signature

  if (tray !== null && !tray.isDestroyed()) {
    const image = loadTrayIcon()
    if (image !== null) tray.setImage(image)
  }

  const icon = resolveAppIcon()
  if (icon === null) return
  for (const target of [win, settingsWin, chatWin, abilityWin, insightWin, onboardingWin]) {
    if (target === null || target === undefined || target.isDestroyed()) continue
    try {
      target.setIcon(icon)
    } catch (error) {
      log('窗口图标更新失败：', String(error))
    }
  }
}

function createTray() {
  const icon = loadTrayIcon()
  if (icon === null) {
    log('托盘图标全部读取失败，跳过托盘创建')
    return
  }

  tray = new Tray(icon)
  tray.setToolTip('桌宠')

  // 每次重建菜单：勾选状态必须来自当前 settings，不能只改文案。
  trayMenuBuilder = () =>
    Menu.buildFromTemplate([
      {
        label: '显示窗口',
        click: () => {
          if (win === null || win.isDestroyed()) return
          win.show()
          win.focus()
        }
      },
      {
        // 窗口落到屏幕外时的回城入口；正常只要显示窗口就够了。
        label: '找回窗口',
        click: () => recoverWindow()
      },
      {
        label: '开机自启',
        type: 'checkbox',
        checked: loginItemEnabled(),
        click: () => {
          setLoginItem(!loginItemEnabled())
          tray?.setContextMenu(trayMenuBuilder())
        }
      },
      {
        label: '聊天',
        click: () => {
          openChatWindow()
        }
      },
      {
        label: '能力中心',
        click: () => {
          openAbilityWindow()
        }
      },
      {
        label: '每日巡视',
        click: () => {
          void runDailyReviewOnce()
        }
      },
      {
        label: '静音',
        type: 'checkbox',
        checked: settings.voice?.enabled === false,
        click: () => {
          const nextMuted = settings.voice?.enabled !== false
          void setVoiceMuted(nextMuted).finally(() => {
            tray?.setContextMenu(trayMenuBuilder())
          })
        }
      },
      {
        // 临时安静覆盖主动台词与提醒；声音的常驻静音是另一项，互不替代。
        label: isTemporarilyQuiet() ? quietTipText() : '安静一会儿',
        submenu: [
          { label: '15 分钟', click: () => startQuiet(15) },
          { label: '30 分钟', click: () => startQuiet(30) },
          { label: '1 小时', click: () => startQuiet(60) },
          { type: 'separator' },
          {
            label: '取消安静',
            enabled: isTemporarilyQuiet(),
            click: () => {
              stopQuiet()
              refreshTrayQuietUi()
              flashTrayTip('已恢复')
            }
          }
        ]
      },
      {
        label: '边缘吸附',
        type: 'checkbox',
        checked: settings.window?.edgeSnap === true,
        click: () => {
          void setEdgeSnap(settings.window?.edgeSnap !== true).finally(() => {
            tray?.setContextMenu(trayMenuBuilder())
          })
        }
      },
      {
        label: '状态栏',
        type: 'checkbox',
        // 勾选态每次重建时从 settings 现读，避免菜单和实际显示不一致。
        checked: settings.showHud === true && settings.hudDetail !== 'off',
        click: async () => {
          const prev = settings
          const nextOn = !(settings.showHud === true && settings.hudDetail !== 'off')
          const patch = nextOn
            ? {
                showHud: true,
                // 老配置里的 off 语义是「关闭」，重新打开时归一到紧凑档。
                hudDetail: settings.hudDetail === 'off' ? 'compact' : settings.hudDetail
              }
            : { showHud: false }
          settings = mergeLayer(settings, patch)
          try {
            await writeSettings(settings)
            broadcastSettings(settings)
          } catch (error) {
            // 写盘失败就回滚，菜单勾选保持原样，不让界面和磁盘各说各话。
            settings = prev
            log('[tray] 状态栏设置保存失败：', error?.message ?? error)
            flashTrayTip('状态栏设置保存失败')
          }
          tray?.setContextMenu(trayMenuBuilder())
        }
      },
      {
        label: '导出同步包',
        enabled: settingsSync !== null,
        click: async () => {
          if (settingsSync === null) return
          try {
            const result = await settingsSync.publish()
            flashTrayTip(`已导出 ${result.count} 项设置`)
          } catch (error) {
            log('[sync] 导出失败：', error instanceof Error ? error.message : error)
            flashTrayTip('导出失败，详见日志')
          }
        }
      },
      {
        label: '应用对端变更',
        enabled: settingsSync !== null,
        click: async () => {
          if (settingsSync === null) return
          try {
            const result = await settingsSync.pull()
            flashTrayTip(
              result.applied > 0 ? `已应用 ${result.applied} 项设置` : '没有可应用的变更'
            )
          } catch (error) {
            log('[sync] 合并失败：', error instanceof Error ? error.message : error)
            flashTrayTip('合并失败，详见日志')
          }
        }
      },
      {
        label: '设置…',
        click: () => openSettingsWindow('general')
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.quit()
        }
      }
    ])

  tray.setContextMenu(trayMenuBuilder())

  tray.on('click', () => {
    if (win === null || win.isDestroyed()) return
    if (win.isVisible()) win.hide()
    else win.show()
  })
}

// clampBoundsToWorkArea / dockBoundsToBottomRight 已迁到 src/main/window-bounds.ts，
// workArea 由调用方从 screen 取好再注入。

/**
 * 找回窗口：挪回主屏右下角并显示。
 * 拔掉副屏、改分辨率之后窗口可能落在看不见的区域，托盘要有一个回城入口。
 */
function recoverWindow() {
  if (win === null || win.isDestroyed()) return
  const [width, height] = win.getSize()
  // 与 dockPetToBottomRight / pet:window:move 同一口径：workArea 由调用方注入。
  win.setBounds(dockBoundsToBottomRight({ width, height }, screen.getPrimaryDisplay().workArea))
  win.show()
  win.focus()
  void saveWindowState()
  flashTrayTip('已回到桌面右下角')
}

/**
 * 开机自启：真源是系统登录项，不另存一份设置，避免两处说法不一致。
 * 开发态 execPath 指向 electron.exe，写进去只会开机弹个空壳，所以只在打包后开放。
 */
function loginItemEnabled() {
  if (!app.isPackaged) return false
  try {
    return app.getLoginItemSettings().openAtLogin === true
  } catch (error) {
    log('[login-item] 读取失败：', error?.message ?? error)
    return false
  }
}

function setLoginItem(enabled) {
  if (!app.isPackaged) {
    flashTrayTip('打包后可用')
    return
  }
  try {
    app.setLoginItemSettings({ openAtLogin: enabled })
    // 写后读回，注册表被策略挡住时能立刻看出来，不留一个假勾选。
    const actual = app.getLoginItemSettings().openAtLogin === true
    if (actual !== enabled) {
      log('[login-item] 写入后读回不一致：', enabled, actual)
      flashTrayTip('开机自启没有生效，详见日志')
      return
    }
    flashTrayTip(enabled ? '下次登录会自动启动' : '已关闭开机自启')
  } catch (error) {
    log('[login-item] 写入失败：', error?.message ?? error)
    flashTrayTip('开机自启设置失败，详见日志')
  }
}

let saveStateTimer = null

/** 位置落盘；宽高仍写入留作诊断，启动恢复不采用。 */
async function saveWindowState() {
  if (win === null || win.isDestroyed()) return
  const bounds = win.getBounds()
  await writeJson(statePath, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  })
}

/** 拖动 / 缩放会连续触发，攒 400ms 再写，避免频繁落盘。 */
function scheduleSaveWindowState() {
  if (saveStateTimer !== null) clearTimeout(saveStateTimer)
  saveStateTimer = setTimeout(() => {
    saveStateTimer = null
    void saveWindowState()
  }, 400)
}

/**
 * 渲染进程崩溃后的自愈。
 *
 * 之前这里只写一行日志：进程还在、托盘还在，窗口却停在最后一帧或者全透明，
 * 用户只能去任务管理器结束进程。现在按「10 分钟内最多 3 次」自动 reload，
 * 超过上限就明确告诉用户去托盘退出重开，不再假装没事。
 */
let reviveCount = 0
let reviveWindowStart = 0
let fallbackShown = false

function reviveRenderer(reason) {
  const now = Date.now()
  if (now - reviveWindowStart > 10 * 60_000) {
    reviveWindowStart = now
    reviveCount = 0
  }
  if (reviveCount >= 3) {
    log('[renderer] 连续崩溃，停止自动恢复：', reason)
    flashTrayTip('画面一直起不来，可以从托盘退出后重开')
    return
  }
  reviveCount += 1
  setTimeout(() => {
    if (win === null || win.isDestroyed()) return
    if (!win.isVisible()) win.show()
    win.webContents.reload()
    log('[renderer] 已尝试自动恢复，第', reviveCount, '次')
  }, 800)
}

/** 主页面都加载不出来时切到静态兜底页，至少让用户知道发生了什么。 */
function showFallbackPage(reason) {
  if (win === null || win.isDestroyed() || fallbackShown) return
  fallbackShown = true
  log('[renderer] 加载兜底页：', reason)
  void win
    .loadFile(path.join(__dirname, 'renderer', 'fallback.html'), { query: { reason } })
    .catch((error) => log('[renderer] 兜底页也失败：', error?.message ?? error))
}

async function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs')
  const options = createWindowOptions(settings, preloadPath)
  win = new BrowserWindow({
    ...options,
    icon: appIconPath,
    show: false,
    backgroundColor: '#00000000',
    title: '桌宠'
  })

  // 渲染层的报错只出现在页面里，主进程默认看不到。转发出来，
  // 否则「立绘没出来」只能靠猜。
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    log(`[renderer:${level}]`, message, `(${sourceId}:${line})`)
  })

  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    log('[renderer] did-fail-load', code, description, url)
    // -3 是 ERR_ABORTED：reload 打断上一次加载，不算真失败。
    if (isMainFrame !== true || code === -3) return
    showFallbackPage(description || `code ${code}`)
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('render-process-gone', (_event, details) => {
    log('renderer 退出：', details.reason)
    if (details.reason === 'clean-exit') return
    reviveRenderer(details.reason)
  })
  win.webContents.on('did-finish-load', async () => {
    // 只有主页面真正加载成功才关掉兜底开关；兜底页自身的 did-finish-load 不算恢复，
    // 否则「兜底页加载成功 → 开关重置 → 再失败 → 再切兜底」会无限循环。
    const currentUrl = win?.webContents?.getURL?.() ?? ''
    if (!currentUrl.includes('fallback.html')) {
      fallbackShown = false
    }
    // 密钥重建/隔离只提醒一次：reload 不该重复打扰。
    if (vaultStartupNotice !== null && !vaultNoticeDelivered) {
      vaultNoticeDelivered = true
      win.webContents.send('pet:vault:notice', vaultStartupNotice)
    }
    try {
      const status = await win.webContents.executeJavaScript(
        'document.getElementById("module-status")?.textContent ?? ""'
      )
      log('renderer 已加载，模块状态：', status)
      if (process.env.PET_SELFTEST === '1') {
        const result = await win.webContents.executeJavaScript('window.__petSelfTest?.() ?? null')
        log('四媒体自检：', JSON.stringify(result))
      }
    } catch (error) {
      log('renderer 状态检查失败：', error)
    }
  })

  // 桌宠窗口无边框、不聚焦，DOM 侧拿不到 blur / visibilitychange（实测 hidden 恒 false）。
  // 生命周期由主进程广播，渲染侧据此暂停 / 续播；每次广播都落日志，便于断言。
  const emitLifecycle = (state) => {
    if (win === null || win.isDestroyed()) return
    win.webContents.send('pet:lifecycle', state)
    log('lifecycle:', state)
  }
  win.on('blur', () => emitLifecycle('paused'))
  win.on('focus', () => emitLifecycle('resumed'))
  win.on('minimize', () => emitLifecycle('paused'))
  win.on('restore', () => emitLifecycle('resumed'))
  win.on('hide', () => emitLifecycle('paused'))
  win.on('show', () => emitLifecycle('resumed'))

  // 恢复上次位置；宽高不跟随 state，固定取当前 profile + scale 的结果。
  // 旧 state.json 里可能还留着历史宽高，但固定窗口不接受它们。
  const state = await readJson(statePath, {})
  if (typeof state.x === 'number' && typeof state.y === 'number') {
    const bounds = {
      x: state.x,
      y: state.y,
      width: options.width,
      height: options.height
    }
    win.setBounds(clampBoundsToWorkArea(bounds, screen.getDisplayMatching(bounds).workArea))
  }

  // 位置变化后自动记下；固定窗口不会再触发 resized，保留监听只作尺寸变更兜底。
  win.on('moved', scheduleSaveWindowState)
  win.on('resized', scheduleSaveWindowState)

  // ready-to-show 可能在 loadFile 期间就触发，必须先注册再加载，
  // 否则等 await 返回时事件已经错过，show() 永远不会被调用。
  win.once('ready-to-show', () => win.show())

  // 探针目标走 URL query：页面禁了 eval，executeJavaScript 在 CSP 下会直接失败，
  // 这条路径不依赖任何注入，纯读 location.search。
  const probe = process.env.PET_LIVE2D_PROBE ?? ''
  await win.loadFile(
    path.join(__dirname, 'renderer', 'index.html'),
    probe === '' ? {} : { query: { probe } }
  )

  // 兜底：极少数情况下 ready-to-show 不触发，显式补一次 show。
  if (!win.isVisible()) win.show()

  win.on('close', (event) => {
    if (win === null || win.isDestroyed()) return
    void saveWindowState()
    // 关闭窗口只是收起；真正退出走托盘菜单。
    // 窗口无边框且不进任务栏，直接关掉会让人找不到回来的路。
    if (app.isQuitting !== true) {
      event.preventDefault()
      win.hide()
    }
  })
}

let screenConsentAskedThisRun = false

/**
 * 识屏首次授权。
 *
 * 只在第一次问一次：允许就打开，拒绝就永久关着（设置页仍可手动再开）。
 * 文案必须写清楚会读屏幕内容摘要，不能只说「为了更好的体验」。
 */
async function maybeAskScreenConsent() {
  if (screenConsentAskedThisRun) return
  if (settings?.presence?.screen?.consentAsked === true) return
  // 引导还没走完时先不叠第二个弹窗，等下次启动再问。
  if (settings?.onboarded !== true) return
  screenConsentAskedThisRun = true

  const options = {
    type: 'question',
    buttons: ['先不用', '允许读屏'],
    defaultId: 0,
    cancelId: 0,
    title: '要不要让我看见屏幕上的字？',
    message: '我可以读一读你屏幕上的文字，说话时偶尔接上一句。',
    detail:
      '会读取当前屏幕内容的文字摘要（大约每十分钟一次）。只看字，不保存截图，也不上传。\n' +
      '这个开关随时能在设置里改。'
  }

  try {
    const result =
      win === null || win.isDestroyed()
        ? await dialog.showMessageBox(options)
        : await dialog.showMessageBox(win, options)
    const allowed = result.response === 1
    settings = mergeLayer(settings, {
      presence: { screen: { enabled: allowed, consentAsked: true } }
    })
    await writeSettings(settings)
    log('[screen] 识屏授权：', allowed ? '允许' : '不允许')
  } catch (error) {
    log('[screen] 询问识屏授权失败：', error?.message ?? error)
  }
}

/* ---------------- 游戏模式（由 DSH 插件驱动） ----------------
   插件把 live.json 的 game 段写成 { active, hideBubble, dimPet, openRequest }。
   这里只做两件窗口侧的事：整窗不透明度、按请求打开游戏页；
   气泡收不收由渲染层看同一份 live 自己决定，主进程不重复管。 */
const pluginLivePath = () => path.join(userData, 'live.json')
let gameModeTimer = null
let appliedGameOpacity = 1
let appliedOpenRequest = 0

async function readPluginLive() {
  try {
    const raw = await fs.readFile(pluginLivePath(), 'utf8')
    const live = JSON.parse(raw)
    return live !== null && typeof live === 'object' ? live : null
  } catch {
    // 插件没在跑、文件还没写出来，都算「没有插件状态」
    return null
  }
}

function applyGameVisual(game) {
  if (win === null || win.isDestroyed()) return
  const active = game !== null && game.active === true
  const raw = active && Number.isFinite(Number(game?.dimPet)) ? Number(game.dimPet) : 1
  // dimPet 的语义就是「压到多暗」：0 = 完全隐藏，允许到 0，不再抬到 0.2。
  const next = Math.min(1, Math.max(0, raw))
  if (Math.abs(next - appliedGameOpacity) < 0.01) return
  appliedGameOpacity = next
  try {
    win.setOpacity(next)
  } catch (error) {
    log('[game] 窗口不透明度设置失败：', error instanceof Error ? error.message : String(error))
  }
}

let appliedDanmakuId = 0
let appliedWatchOpen = 0
let watchOpen = false

async function syncGameMode() {
  const live = await readPluginLive()
  const game = live?.game ?? null
  applyGameVisual(game)

  /* 弹幕开关与观感：每轮读一次；设置页改完，下一次推送就按新值走。 */
  danmakuEnabled = live?.danmaku?.enabled !== false
  applyDanmakuStyle(live?.watch?.style)

  const requested = Number(game?.openRequest) || 0
  if (requested > appliedOpenRequest) {
    appliedOpenRequest = requested
    log('[game] 插件请求打开游戏页')
    openGameWindow()
  }

  // 陪看：先按请求开窗，再按 active 收窗。插件重启后 openRequest 归零，也不会误开。
  const watch = live?.watch ?? null
  const ask = Number(watch?.openRequest) || 0
  if (ask > appliedWatchOpen) {
    appliedWatchOpen = ask
    watchOpen = true
    log('[watch] 插件请求打开陪看窗：', String(watch?.url ?? ''))
    openBiliWindow(watch?.url)
  } else if (watchOpen === true && (watch === null || watch?.active !== true)) {
    // 只有「插件明确说不再陪看」才收窗；openRequest 归零只是插件重启，
    // 不该顺手把用户正在看的窗口关掉。
    watchOpen = false
    if (biliWin !== null && !biliWin.isDestroyed()) biliWin.close()
  }

  // 弹幕：只推比上次新的那几条；没有新的就不动窗口。
  const items = Array.isArray(live?.danmaku?.items) ? live.danmaku.items : []
  const newest = items.reduce((max, item) => Math.max(max, Number(item?.id) || 0), 0)
  // 插件重启后 seq 从 1 重新数；比上次小就说明换了一轮，重新跟上。
  if (newest > 0 && newest < appliedDanmakuId) appliedDanmakuId = 0
  const fresh = items.filter((item) => (Number(item?.id) || 0) > appliedDanmakuId)
  if (fresh.length === 0) return
  fresh.sort((a, b) => (Number(a?.id) || 0) - (Number(b?.id) || 0))
  for (const item of fresh) pushDanmaku(item)
  appliedDanmakuId = Number(fresh[fresh.length - 1]?.id) || appliedDanmakuId
}

function startGameModeSync() {
  if (gameModeTimer !== null) return
  // 3 秒一次只读一个本地 JSON，开销可以忽略；插件不在时读失败就静默跳过。
  gameModeTimer = setInterval(() => {
    void syncGameMode()
  }, 3000)
  gameModeTimer.unref?.()
  void syncGameMode()
}

/* 桌宠由 DSH 以 detached 方式拉起，DSH 被强杀时没人收尸，任务栏里会留下一个独立图标。
   带上 --parent-pid 之后自己盯着父进程，它消失就跟着退出。 */
function watchParentProcess() {
  const arg = process.argv.find((item) => item.startsWith('--parent-pid='))
  if (arg === undefined) return
  const parentPid = Number(arg.slice('--parent-pid='.length))
  if (!Number.isInteger(parentPid) || parentPid <= 0) return

  // Windows 上 PID 会被复用：kill(pid, 0) 成功不等于父进程还活着。
  // 启动时记一次父进程的创建时间，每 30 秒复核一次；对不上就说明原进程已退出、
  // 这个 PID 是别人——按「父进程消失」处理，跟着退出。
  let parentStartedAt = null
  const captureParentStart = () => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue).StartTime.ToFileTimeUtc()`
      ],
      { timeout: 3000, windowsHide: true },
      (_error, stdout) => {
        const value = Number(String(stdout ?? '').trim())
        parentStartedAt = Number.isFinite(value) && value > 0 ? value : null
      }
    )
  }
  captureParentStart()
  let tickCount = 0
  const timer = setInterval(() => {
    tickCount += 1
    let alive = true
    try {
      process.kill(parentPid, 0)
    } catch (error) {
      /* EPERM 说明进程还在，只是没权限发信号。 */
      alive = error?.code === 'EPERM'
    }
    if (alive && parentStartedAt !== null && tickCount % 15 === 0) {
      const before = parentStartedAt
      captureParentStart()
      alive = parentStartedAt !== null && parentStartedAt === before
    }
    if (!alive) {
      clearInterval(timer)
      app.quit()
    }
  }, 2000)
  timer.unref?.()
}

app.whenReady().then(async () => {
  watchParentProcess()
  // 第二个实例只负责把第一只叫出来，自己不装配任何东西。
  if (!singleInstanceLock) return

  // 权限默认拒绝：只在语音唤醒开着的时候放行麦克风，关掉立刻回到拒绝。
  // 剪贴板写入留给诊断面板「复制报告」。
  const allowedPermissions = new Set(['clipboard-sanitized-write'])
  const isPermissionAllowed = (permission) => {
    if (allowedPermissions.has(permission)) return true
    // 只放 media（含麦克风）；摄像头、通知等仍一律拒绝。
    // 两条语音链路任一开着就放行：专用唤醒引擎，或 ASR 唤醒词。
    return permission === 'media' && (wakeVoice?.isEnabled() === true || asrMicEnabled === true)
  }
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = isPermissionAllowed(permission)
    if (!allowed) log('[permission] 已拒绝：', permission)
    callback(allowed)
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    isPermissionAllowed(permission)
  )
  session.defaultSession.setDevicePermissionHandler((details) => {
    // 只有语音链路开着时才允许音频输入设备；其余设备类型保持拒绝。
    return (wakeVoice?.isEnabled() === true || asrMicEnabled === true) && details.deviceType === 'audioinput'
  })

  // 锁屏、休眠期间不主动搭话；唤醒后把计时起点推到现在，避免攒着一条立刻补发。
  powerMonitor.on('suspend', () => {
    systemAsleep = true
  })
  powerMonitor.on('lock-screen', () => {
    systemAsleep = true
  })
  const wakeUp = () => {
    systemAsleep = false
    lastSpokenAt = Date.now()
  }
  powerMonitor.on('resume', wakeUp)
  powerMonitor.on('unlock-screen', wakeUp)

  if (process.env.PET_VAULT_SMOKE === '1') {
    let code = 0
    try {
      const { runVaultSmoke } = await import('./vaultSmoke.mjs')
      await runVaultSmoke()
    } catch (error) {
      code = 1
      console.error('[vault-smoke] FAILED', error)
    }
    setTimeout(() => app.exit(code), 100)
    return
  }

  if (process.env.PET_VAULT_INIT_SMOKE === '1') {
    await initVault()
    if (vault !== null) {
      // 真机往返一次：确认 safeStorage 包裹的密钥确实能加解密。
      const probeClient = new VaultClient(new MemoryVaultStorage(), new AesGcmProvider(), vault.ring)
      const sealed = await probeClient.seal({ probe: 'vault-roundtrip' }, { kind: 'envelope' })
      const plain = await probeClient.open(sealed)
      console.log('[vault-roundtrip]', new TextDecoder().decode(plain))
    }
    const result = vault === null ? { ok: false } : await vault.diagnose()
    console.log('[vault-init]', JSON.stringify(result))
    setTimeout(() => app.exit(vault === null ? 1 : 0), 100)
    return
  }

  // 设置走 readSettings：主文件坏了先用 .bak，两份都坏就隔离留证，不静默清空。
  settings = mergeLayer(DEFAULT_SETTINGS, await readSettings())

  if (process.env.PET_BALANCE_SMOKE === '1') {
    let code = 0
    try {
      const { runBalanceSmoke } = await import('./balanceSmoke.mjs')
      const result = await runBalanceSmoke()
      console.log('[balance-smoke]', JSON.stringify(result))
      if (result.ok !== true) code = 1
    } catch (error) {
      code = 1
      console.error('[balance-smoke] FAILED', error)
    }
    setTimeout(() => app.exit(code), 100)
    return
  }

  await initSettingsSync()
  await initVault()
  // 通道依赖 Vault 里的凭据；初始化失败也要保住本地回环通道，不让桌宠失去响应路径。
  await createGateway().catch((error) =>
    log('[qq] 通道初始化失败：', error instanceof Error ? error.message : String(error))
  )
  registerMediaProtocol()
  await loadRpsStats()
  registerIpc()
  syncBalanceMonitor()
  await createWindow()
  /* 设置已在手，再对一次 DSH 那份；之后每 5 秒看一次 stamp。 */
  startSettingsSync()
  // 游戏模式跟着插件走：窗口在位后才开始读 live.json。
  startGameModeSync()
  // DSH 回复念出：窗口在位了再启动，第一条回复就有地方显示。
  syncDshSpeech()
  // 识屏单独问一次；不挡启动，窗口起来之后再问。
  void maybeAskScreenConsent()
  createTray()
  // 指标采样只为状态条服务：关着就不启动，省掉每 6 秒一次 PowerShell。
  syncHudSampler()
  startDailyReviewTimer()
  // 主动开口的定时器一直挂着，开关在 setInterval 里判断，改设置即时生效。
  startPresenceTimer()
  // 收场单独一条时间线：它要跑在桌宠隐藏、专注模式中也照常检查。
  startClosingTimer()
  // 主人位置 IP 定位：尽力而为，不挡启动；已填过或关了自动定位就不动。
  void locateOwnerByIpOnce()
  if (settings.onboarded !== true) openOnboardingWindow()
  log('ready')
}).catch((error) => {
  // 启动链任一环抛错都不该留下「有进程没窗口」的幽灵：报出来，然后干净退出。
  log('[boot] 启动失败：', error)
  dialog.showErrorBox(
    '桌宠没能启动',
    `${error?.message ?? String(error)}\n\n数据目录：${userData}`
  )
  app.exit(1)
})

/** 主人位置 IP 定位：尽力而为，只做一次，失败静默，绝不阻塞启动。 */
async function locateOwnerByIpOnce() {
  try {
    const presence = settings?.presence ?? {}
    // 用户已手动填过主人位置，或明确关了自动定位，就不动。
    if (presence.ownerAutoLocate === false) return
    if (typeof presence.ownerCity === 'string' && presence.ownerCity.trim() !== '') return
    const { locateOwnerByIp } = await import('./ip-locate.mjs')
    const located = await locateOwnerByIp({ fetchImpl: globalThis.fetch })
    if (located.ok !== true) {
      log('[owner] IP 定位未取得结果', located?.reason ?? 'unknown')
      return
    }
    const ownerCity = located.city || located.region || ''
    if (ownerCity === '') return
    settings = mergeLayer(settings, {
      presence: { ownerCity, ownerIp: located.ip ?? '', ownerAutoLocate: true }
    })
    await writeSettings(settings)
    log('[owner] 主人位置已定位', ownerCity)
  } catch (error) {
    log('[owner] 主人位置定位失败', error?.message ?? String(error))
  }
}

app.on('window-all-closed', () => {
  // 桌宠是常驻托盘应用：主窗口关闭只是 hide，窗口全销毁也不等于用户想退出。
  // 只有托盘没能建起来（比如图标缺失）时才跟着退出，避免变成关不掉的后台幽灵。
  if (tray === null) app.quit()
})

/** 退出前给记忆一次落盘机会；只用一次，避免 quit 递归。 */
let memoryFlushed = false

app.on('before-quit', (event) => {
  app.isQuitting = true
  if (gatewaySyncTimer !== null) {
    clearTimeout(gatewaySyncTimer)
    gatewaySyncTimer = null
  }
  gateway?.dispose()
  void qq?.stop?.().catch(() => undefined)
  qq = null
  webhookServer?.close()
  if (sessionIdleTimer !== null) {
    clearInterval(sessionIdleTimer)
    sessionIdleTimer = null
  }
  stopBalanceMonitor()
  if (memoryFlushed) return
  memoryFlushed = true
  event.preventDefault()
  // 防抖窗口里的作息同步落盘，不等 5 秒定时器。
  flushRhythmNow()
  // 落盘最多等 3 秒：加密仓库卡住时也得让用户关得掉，不能只留任务管理器。
  const flushed = Promise.allSettled([
    memoryStore.flush(),
    chatHistoryStore.flush(),
    companionService.flush(),
    affinity.flush(),
    factStore.flush(),
    speechHabits.flush(),
    socialProfileStore.flush(),
    thoughtPool.flush(),
    agendaRuntime.flush(),
    memeDictionary.flush()
  ])
  const timeout = new Promise((resolve) => setTimeout(resolve, 3000))
  Promise.race([flushed, timeout]).finally(() => app.quit())
})

/**
 * 未捕获异常：主进程继续跑下去，只会带着半损坏的状态接受 IPC、写设置、跑定时器，
 * 用户看到的是「某些功能莫名其妙不工作」。宁可干净退出让外壳重开，
 * 也不留一个假活的进程。启动链还没完成（没有窗口）时尤其要立刻退出。
 */
process.on('uncaughtException', (error) => {
  log('uncaughtException，进程退出以避免半损坏状态继续运行', error)
  try {
    dialog.showErrorBox('桌宠遇到错误', `发生未处理的错误，桌宠将退出。\n\n${error?.message ?? String(error)}`)
  } catch {
    /* 弹不出框也照样退出。 */
  }
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  // rejection 多数发生在可恢复的异步支线（网络、落盘），只记日志不退出；
  // 若它发生在启动链，外层 catch 会各自兜住。
  log('unhandledRejection', reason)
})
