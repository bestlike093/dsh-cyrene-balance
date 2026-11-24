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
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { cpus, freemem, homedir, hostname, totalmem } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createSessionBridge, resolveSessionId, sessionRunning, sessionTitle } from './session-bridge.js'
import { buildPersonaPrompt, buildNowPrompt, buildPersonaCoreText } from './persona.mjs'
import { personaScopeOf } from './companion/persona/persona-scope.mjs'
import { buildCompanionSnapshot } from './companion/state/snapshot.mjs'
import { writeCapFor } from './companion/state/salience.mjs'
import { memoryLinePrefix, rankMemoryEntries } from './companion/memory/memory-lines.mjs'
import { planMemoryRecall, scaleRecallPlan } from './companion/memory/memory-intent.mjs'
/* 全局分寸表：注入条数、单条长度、事实摘要都在这里，模块只按轴灵敏度做确定性微调。 */
import { EMOTION, FILTER, MEMORY, REFLECTION, THREAD, TIME } from './companion/standard.mjs'
/* 反思回读：只取最近的日记印象，作为主人这一路的人格背景。 */
import { readRecentReflections, reflectionsForPrompt } from './companion/time/reflection.mjs'
/* 脉络只做分层和排序；真正的取舍仍然交给人格提示词。 */
import { buildThreads, renderThreadPrompt } from './companion/threads.mjs'
import { filterMemoryItemsForSource, ownerBridgeAllowsFor } from './companion/memory/memory-scope.mjs'
import { buildMemoryConsole } from './companion/memory/memory-console.mjs'
import { requireOwnerConsole } from './companion/memory/owner-guard.mjs'
import { memoryDedupeKey } from './companion/memory/memory-candidates.mjs'
/* B2-003：会话记忆摄取的落库与游标推进拆成可注入单元，判据才量得到「失败不推游标」。 */
import { commitApprovedCandidates } from './companion/memory/ingest-session.mjs'
import { DSH_BACKGROUND_SLOT_NAMES as BACKGROUND_SLOT_NAMES, PET_SLOT_FOR_DSH } from './companion/background-slots.mjs'
/* A2-10：presence 段的组装挪到闸门侧那个纯函数里，好让「改了设置要随动」这条能被单测罩住。 */
import { hostPresenceView } from './companion/speak/presence-gate.mjs'
/* 13 槽声明表：分类词表、中文名、启用态唯一事实源 */
import {
  ALL_SLOT_IDS,
  ENABLED_SLOT_IDS,
  MEMORY_SLOTS,
  effectiveSlotIds,
  migrateSlotId
} from './companion/memory/memory-slots.mjs'
import { detectModelSource, sanitizeModelId } from '../pet/model-pack.mjs'
import { createCompanionRuntime } from './companion-runtime.mjs'
import { isSealed, sealText, unsealText } from './companion/state/sealed-store.mjs'
import { FIELDS as SYNC_FIELDS, normalizeValue as normalizeSyncValue, readPath as readSyncPath, sameValue as sameSyncValue, writePath as writeSyncPath } from './settings-sync.mjs'
/* 设置页渲染元数据：导航与控件的唯一事实源，经公开快照下发给设置页 */
import { DISCLAIMER, FIELDS as SCHEMA_FIELDS, GROUPS as SCHEMA_GROUPS } from './settings-schema.mjs'
import { adaptHostCtx } from './host-compat.mjs'
import { createQqHost } from './qq-host.mjs'
import { collectGameState, KNOWN_GAMES } from './game-sense.mjs'
import {
  createStickerFallback,
  createStickerInbox,
  createStickerPickup,
  createStickerLibrary,
  createStickerUsage,
  createStickerVision
} from './companion/index.mjs'
import {
  createBackupBundle,
  createChatService,
  createMemoryStore,
  createPlainBackup,
  decryptBackup,
  deriveTraits,
  describeTraits,
  encryptBackup,
  extractMemoryCandidates,
  PER_ROUND_LIMIT,
  importHistoryFromBackup,
  sensitivityScaleOf,
  GATE_MAX,
  GATE_MIN,
  INK_LEVELS,
  INTIMACY_DEFAULTS,
  inspectBackup,
  IS_PUBLIC_EDITION,
  mergeTraitSources,
  normalizeMemory,
  normalizeDshEnvelope,
  parsePlainBackup,
  planSpeak,
  resolveTraits,
  TRAITS_VERSION,
  WORDSET_ID,
  synthesizeSpeech,
  AXIS_KEYS,
  SENSITIVITY_LEVELS,
  TRAIT_DEFS,
} from './companion/index.mjs'
/* QQ 只收 silk，这里只借一个转码函数，不把它塞进 companion/index 的公共面。 */
import { wavToSilk } from './companion/deliver/voice-codec.mjs'
import { normalizeAbility, playRound, summarizeAbility } from './ability.mjs'
import { createSyncBridge, createSyncEndpoint } from './sync-bridge.mjs'
import { expandDotPaths, isStaleRev, mergeStatePatch, nextRev } from './state-merge.mjs'
import { defaultFor, RESET_NOT_FOUND } from './settings-schema.mjs'
import { migrateSettings, fillMissing, SETTINGS_VERSION } from './settings-migrate.mjs'
import { createChangeLog } from './settings-history.mjs'

/**
 * 把 a.b.c=value 变成「只带这一条子树」的补丁。
 *
 * mergeStatePatch 只对 background / appearance / intimacy / persona / vision
 * 做一层深合并，其余嵌套对象是整块替换。所以父对象必须整份复制，
 * 否则重置 companionAxes.relation.enabled 会把另外四轴一起冲掉。
 */
function patchFromPath(current, path, value) {
  const parts = String(path).split('.').filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { [parts[0]]: value }
  const build = (object, index) => {
    const base = object && typeof object === 'object' && !Array.isArray(object) ? { ...object } : {}
    const key = parts[index]
    if (index === parts.length - 1) {
      base[key] = value
      return base
    }
    base[key] = build(base[key], index + 1)
    return base
  }
  return { [parts[0]]: build(current === null || current === undefined ? undefined : current[parts[0]], 1) }
}

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
/* DSH_HOME —— 宿主数据根的唯一来源（ISSUE-002 / t322）。
 *
 * 修前的样子：:144 与 :1436 各写了一遍内联的 `process.env.DSH_HOME ?? join(homedir(), '.dsh')`，
 * 而 :3478 那句凭据回退直接引用裸标识符 `DSH_HOME`，全仓没有任何声明。
 * 结果每次执行到那行必抛 ReferenceError，又被底下的空 `catch {}` 囫囵吞掉，
 * 最后对外只剩一句「还没有设置 DeepSeek API Key」——
 * 代码坏了，伪装成用户没配置。
 *
 * 现在三处一律读这一个常量。测试可用环境变量 DSH_HOME 把整套指向别处；
 * 断言见 scripts\check-host-paths.mjs（一阴一阳两条，钉住解析与联动）。
 */
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
/* 只读探针，给 scripts\check-host-paths.mjs 用（ISSUE-002 / t322）。
 * 存在的意义只有一条：让「这几处到底是不是同一个根派生的」变成能跑断言的事实，
 * 而不是靠人肉 grep 数一遍有几处内联写法。别在这里加业务逻辑。 */
export function hostPathsForTest () {
  return {
    dshHome: DSH_HOME,
    stateDir: STATE_DIR,
    sessionRoot: SESSION_ROOT,
    credentialsFile: join(DSH_HOME, '.credentials.yaml'),
    envOverridden: typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '',
  }
}
/* CYRENE_PET_HOME 用于把整套存储指到临时目录，便于隔离测试；默认仍在 DSH_HOME 下 */
const STATE_DIR = process.env.CYRENE_PET_HOME
  ? resolve(process.env.CYRENE_PET_HOME)
  : join(DSH_HOME, 'storages', 'cyrene-pet')
/* 桌宠窗口进程也会在同一个目录写 state.json（只放 x/y/宽高），
   插件以前与它同名同路径，两边互相覆盖，设置就会不断被打回默认。
   这里换成插件专用文件名，旧文件仅在确实像插件状态时才迁移一次。 */
const STATE_PATH = join(STATE_DIR, 'pet-plugin-state.json')
/* 最近 10 次设置写入，给设置页的单条回退用；只记总表里登记过的字段。 */
const SETTINGS_HISTORY_PATH = join(STATE_DIR, 'settings-history.json')
const settingsHistory = createChangeLog({ filePath: SETTINGS_HISTORY_PATH })
const LEGACY_STATE_PATH = join(STATE_DIR, 'state.json')
const VAULT_PATH = join(STATE_DIR, 'secret.vault.json')
const MEMORY_VAULT_PATH = join(STATE_DIR, 'memory.vault.json')
const LEGACY_MEMORY_PATH = join(STATE_DIR, 'memory.json')
const LEDGER_PATH = join(STATE_DIR, 'ledger.json')
const ABILITY_PATH = join(STATE_DIR, 'ability.json')
const MODELS_DIR = join(STATE_DIR, 'models')
const SPEECH_DIR = join(STATE_DIR, 'speech')
/* 背景图存在数据目录里，不跟发行物走：换版本、重装插件都不丢 */
const BACKGROUND_DIR = join(STATE_DIR, 'backgrounds')

/*
 * 桌宠设置窗把「当前用哪张背景」写在自己的 settings.json 里。
 * 插件这边读它作回落，两边就共用同一张图，不必各存一份状态。
 * 插件自己的 state.background 仍然优先，旧数据不会被顶掉。
 */
const PET_SETTINGS_PATH = join(STATE_DIR, 'settings.json')

/*
 * 设置窗与插件是两个进程，都会整份重写 settings.json。
 * 各自「读-改-写」时先后顺序一错就互相覆盖，所以两边共用同一个锁文件；
 * 插件侧这段临界区很短，用同步等待，最多等 2 秒就放弃并记一条警告。
 */
const SETTINGS_LOCK_PATH = `${PET_SETTINGS_PATH}.lock`

function withSettingsLock(run) {
  const deadline = Date.now() + 2000
  /* Atomics.wait 比忙等省 CPU；这里只用于极短的同步临界区 */
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  for (;;) {
    try {
      mkdirSync(STATE_DIR, { recursive: true })
    } catch {
      /* 目录已存在或无法创建，下一步的 open 会给出真实原因 */
    }
    let fd = null
    try {
      fd = openSync(SETTINGS_LOCK_PATH, 'wx')
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      if (Date.now() >= deadline) throw new Error('等待 settings.lock 超时')
      Atomics.wait(sleeper, 0, 0, 20)
      continue
    }
    try {
      return run()
    } finally {
      try {
        closeSync(fd)
      } catch {
        /* 句柄已关也不影响解锁 */
      }
      try {
        unlinkSync(SETTINGS_LOCK_PATH)
      } catch {
        /* 锁已被清掉，等同解锁 */
      }
    }
  }
}

/*
 * 背景、配色、贴近时刻都读同一份文件。按 mtime 缓存，
 * 设置没变就不重复解析，getSettings 每次被调用时不再同步打盘。
 */
let petSettingsCache = { mtimeMs: -1, data: null }

function readPetSettingsFile() {
  try {
    const info = statSync(PET_SETTINGS_PATH)
    if (info.mtimeMs === petSettingsCache.mtimeMs) return petSettingsCache.data
    const data = JSON.parse(readFileSync(PET_SETTINGS_PATH, 'utf8'))
    petSettingsCache = { mtimeMs: info.mtimeMs, data }
    return data
  } catch {
    petSettingsCache = { mtimeMs: -1, data: null }
    return null
  }
}

/*
 * 人格问卷的结果也在这份 settings.json 里（persona.assessment.result.traits）。
 * 只认已经算好的 traits：缺字段就当没做过，绝不拿半份答案去改人格。
 */
function readPetAssessmentTraits() {
  try {
    const parsed = readPetSettingsFile()
    const traits = parsed?.persona?.assessment?.result?.traits
    if (traits === null || typeof traits !== 'object') return null
    let usable = false
    for (const def of TRAIT_DEFS) {
      if (Number.isFinite(Number(traits[def.key]))) usable = true
    }
    return usable ? traits : null
  } catch {
    return null
  }
}

/*
 * DSH 的四个位置分别对应桌宠设置里的哪个槽：
 * 映射表见 companion/background-slots.mjs（两端共用一份，petChat 只在桌宠内部用）。
 */

/**
 * 读桌宠 settings.json 里某一处背景。
 * 新结构优先读 background.slots，旧结构只有 background.id，仍然只当 page 用。
 */
function readPetBackgroundSlot(name) {
  try {
    const parsed = readPetSettingsFile()
    const petKey = PET_SLOT_FOR_DSH[name]
    const entry = petKey ? parsed?.background?.slots?.[petKey] : null
    const id = typeof entry?.id === 'string' ? entry.id : ''
    if (id !== '' && safeBackgroundId(id) !== '') {
      const dim = Number(entry?.dim)
      const blur = Number(entry?.blur)
      return {
        id,
        dim: Number.isFinite(dim) ? Math.min(Math.max(dim, 0), 0.85) : 0.35,
        blur: Number.isFinite(blur) ? Math.min(Math.max(blur, 0), 24) : 0
      }
    }
    if (name !== 'page') return null
    const legacyId = typeof parsed?.background?.id === 'string' ? parsed.background.id : ''
    if (legacyId === '' || safeBackgroundId(legacyId) === '') return null
    const legacyDim = Number(parsed?.background?.dim)
    return {
      id: legacyId,
      dim: Number.isFinite(legacyDim) ? Math.min(Math.max(legacyDim, 0), 0.85) : 0.35,
      blur: 0
    }
  } catch {
    return null
  }
}

/* 槽名从共享声明表来（companion/background-slots.mjs）。 */

/* 一个槽位就是一处背景：用哪张图、多暗、取景停在哪、放多大。脏值逐项夹紧，别让一个坏字段透到界面上。 */
function readBackgroundSlot(source, name) {
  const raw = source !== null && typeof source === 'object' ? source[name] : null
  const item = raw !== null && typeof raw === 'object' ? raw : {}
  const num = (value, fallback, min, max, round) => {
    const found = Number(value)
    if (!Number.isFinite(found)) return fallback
    const clamped = Math.min(max, Math.max(min, found))
    return round ? Math.round(clamped) : clamped
  }
  return {
    id: typeof item.id === 'string' ? item.id : '',
    dim: num(item.dim, 0.35, 0, 0.85, false),
    posX: num(item.posX, 50, 0, 100, true),
    posY: num(item.posY, 50, 0, 100, true),
    zoom: num(item.zoom, 1, 1, 3, false),
    blur: num(item.blur, 0, 0, 24, true)
  }
}

function effectiveBackground() {
  const own = state?.background
  const base = own !== null && typeof own === 'object' && typeof own.id === 'string'
    ? own
    : { id: '', dim: 0.35 }
  const rawSlots = base?.slots !== null && typeof base?.slots === 'object' ? base.slots : {}
  /* 老数据只有 background.id：把它当成 page 槽的图，升级后背景不会凭空消失。 */
  const page = readBackgroundSlot(rawSlots, 'page')
  const legacyId = typeof base?.id === 'string' ? base.id : ''
  if (page.id === '' && legacyId !== '') {
    page.id = legacyId
    page.dim = Math.min(0.85, Math.max(0, Number(base?.dim) || 0.35))
    page.posX = Number.isFinite(Number(base?.posX)) ? Math.min(100, Math.max(0, Number(base.posX))) : 50
    page.posY = Number.isFinite(Number(base?.posY)) ? Math.min(100, Math.max(0, Number(base.posY))) : 50
  }
  /* 老数据没有 targets / windowBlur：按默认「页面 + 窗口都铺」补齐，不让字段缺失透到界面。 */
  const slots = {
    page,
    window: readBackgroundSlot(rawSlots, 'window'),
    settingsCard: readBackgroundSlot(rawSlots, 'settingsCard'),
    settingsWindow: readBackgroundSlot(rawSlots, 'settingsWindow'),
  }
  /* DSH 自己没设的位置，回落到桌宠设置里对应的槽：桌宠里设一次，两边一起变。 */
  for (const name of BACKGROUND_SLOT_NAMES) {
    if (slots[name].id !== '') continue
    const petSide = readPetBackgroundSlot(name)
    if (petSide === null) continue
    slots[name] = { ...slots[name], id: petSide.id, dim: petSide.dim, blur: petSide.blur }
  }
  return {
    ...base,
    targets: {
      page: base?.targets?.page !== false,
      window: base?.targets?.window !== false,
    },
    windowBlur: Math.min(24, Math.max(0, Math.round(Number(base?.windowBlur) || 0))),
    slots,
  }
}

/*
 * 配色同理：用户在桌宠设置窗点的「天青 / 樱粉 / 素纸」是唯一入口，
 * 插件这边把它换算成聊天页的三套 token，不再各记一份。
 */
const PET_THEME_TO_PALETTE = {
  OceanBlue: 'celadon',
  SakuraPink: 'sakura',
  Paper: 'plainpaper'
}

/*
 * 贴近时刻只留一个开关：桌宠设置窗写的那份 settings.json。
 * 插件不再在 state 里另记一份，免得两边各开各的。
 */
function readPetIntimacy() {
  try {
    const parsed = readPetSettingsFile()
    const source = parsed?.companion?.intimacy
    if (source === null || typeof source !== 'object') return null
    return {
      enabled: source.enabled === true,
      perDay: clampNumber(source.perDay, 1, 8, INTIMACY_DEFAULTS.perDay),
      cooldownHours: clampNumber(source.cooldownHours, 1, 24, INTIMACY_DEFAULTS.cooldownHours),
      idleHours: clampNumber(source.idleHours, 1, 24, INTIMACY_DEFAULTS.idleHours),
      aftercareMinutes: clampNumber(source.aftercareMinutes, 5, 240, INTIMACY_DEFAULTS.aftercareMinutes),
      /*
       * 下面三个口子只对主人有效，第三人那边的限制写在 intimacy.mjs，
       * 不读这份设置，改配置也绕不过去。
       *   gate        —— 手填亲近门槛；留空就按人格推
       *   gateEnabled —— 整项跳过门槛（关掉仍受安全闸约束）
       *   style       —— 笔触档位，auto 表示跟着好感走
       */
      gate: clampNumber(source.gate, GATE_MIN, GATE_MAX, null),
      gateEnabled: source.gateEnabled !== false,
      style: INK_LEVELS.includes(source.style) ? source.style : 'auto',
    }
  } catch {
    return null
  }
}

/* 插件侧改了开关或节奏，回写同一份文件；只动 companion.intimacy，别碰其他字段。 */
function writePetIntimacy(patchValue) {
  if (patchValue === null || typeof patchValue !== 'object') return false
  try {
    const applied = withSettingsLock(() => {
      /*
       * 文件不存在（首次安装）可以按空对象起步；
       * 存在但解析失败时直接放弃，绝不拿空对象把用户整份设置覆盖掉。
       */
      let parsed = {}
      let raw = null
      try {
        raw = readFileSync(PET_SETTINGS_PATH, 'utf8')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      if (raw !== null) {
        const decoded = JSON.parse(raw)
        if (decoded === null || typeof decoded !== 'object') return false
        parsed = decoded
      }
      const companion =
        parsed.companion !== null && typeof parsed.companion === 'object' ? parsed.companion : {}
      const current =
        companion.intimacy !== null && typeof companion.intimacy === 'object' ? companion.intimacy : {}
      parsed.companion = { ...companion, intimacy: { ...current, ...patchValue } }
      const temp = `${PET_SETTINGS_PATH}.tmp`
      writeFileSync(temp, JSON.stringify(parsed, null, 2), 'utf8')
      renameSync(temp, PET_SETTINGS_PATH)
      return true
    })
    /* 刚写过，别让 mtime 精度或缓存挡住下一次读 */
    if (applied) petSettingsCache = { mtimeMs: -1, data: null }
    return applied
  } catch (error) {
    hostCtx?.logger?.warn?.(`${PACKAGE_ID}: 贴近时刻设置回写失败`, error)
    return false
  }
}

/*
 * 四条轴也只剩一个来源：桌宠设置窗写的 settings.json（companion.axes）。
 * state.companionAxes 只留给旧版本兜底，两边同时存在时以文件为准。
 */
function readPetAxes() {
  try {
    const parsed = readPetSettingsFile()
    const source = parsed?.companion?.axes
    if (source === null || typeof source !== 'object') return null
    const out = {}
    for (const key of AXIS_KEYS) {
      const raw = source[key]
      if (raw === null || typeof raw !== 'object') continue
      out[key] = {
        enabled: raw.enabled !== false,
        sensitivity: SENSITIVITY_LEVELS.includes(raw.sensitivity) ? raw.sensitivity : 'normal',
      }
    }
    return out
  } catch {
    return null
  }
}

/* 生效中的四轴：文件里写了的轴覆盖 state，没写的继续沿用旧值。 */
function axesNow() {
  const base = state.companionAxes ?? {}
  const fromPet = readPetAxes()
  if (fromPet === null) return base
  const out = { ...base }
  for (const key of AXIS_KEYS) {
    const patch = fromPet[key]
    if (patch === undefined) continue
    out[key] = { ...(base[key] ?? {}), ...patch }
  }
  return out
}

/* 某条轴是否开着。没配过按打开算。 */
function axisOn(key) {
  return axesNow()[key]?.enabled !== false
}

/* 某条轴的灵敏度换算：与 runtime 的 sensitivityOf 同一张表。 */
function axisSensitivity(key) {
  return sensitivityScaleOf(axesNow()[key]?.sensitivity)
}

/* 念旧倾向只影响「谁先被想起」，不参与删不删记忆；越界收口到 [-1, 1]。 */
function recallBiasNow() {
  const raw = Number(state.companionTraits?.recallBias)
  return Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0
}

/* 身体层有两个开关：旧的身体分组与四条轴里的 body，任一关掉都算关。 */
function bodyLayerOn() {
  if (axisOn('body') === false) return false
  try {
    return readPetSettingsFile()?.companion?.body?.enabled !== false
  } catch {
    return true
  }
}

/* 插件侧改了轴，回写同一份文件；只动 companion.axes。 */
function writePetAxes(patchValue) {
  if (patchValue === null || typeof patchValue !== 'object') return false
  try {
    const applied = withSettingsLock(() => {
      let parsed = {}
      let raw = null
      try {
        raw = readFileSync(PET_SETTINGS_PATH, 'utf8')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      if (raw !== null) {
        const decoded = JSON.parse(raw)
        if (decoded === null || typeof decoded !== 'object') return false
        parsed = decoded
      }
      const companion =
        parsed.companion !== null && typeof parsed.companion === 'object' ? parsed.companion : {}
      const current =
        companion.axes !== null && typeof companion.axes === 'object' ? companion.axes : {}
      const next = { ...current }
      for (const key of AXIS_KEYS) {
        const patch = patchValue[key]
        if (patch === null || typeof patch !== 'object') continue
        next[key] = { ...(current[key] ?? {}), ...patch }
      }
      parsed.companion = { ...companion, axes: next }
      const temp = `${PET_SETTINGS_PATH}.tmp`
      writeFileSync(temp, JSON.stringify(parsed, null, 2), 'utf8')
      renameSync(temp, PET_SETTINGS_PATH)
      return true
    })
    if (applied) petSettingsCache = { mtimeMs: -1, data: null }
    return applied
  } catch (error) {
    hostCtx?.logger?.warn?.(`${PACKAGE_ID}: 四轴设置回写失败`, error)
    return false
  }
}

function readPetPalette() {
  try {
    const parsed = readPetSettingsFile()
    return PET_THEME_TO_PALETTE[parsed?.theme?.preset] ?? null
  } catch {
    return null
  }
}

function effectivePalette() {
  const fromPet = readPetPalette()
  if (fromPet !== null) return fromPet
  const own = state?.appearance?.palette
  return APPEARANCE_PALETTES.includes(own) ? own : 'sakura'
}
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

/*
 * 这些文件在盘上是密文。备份和同步只该看见明文，
 * 所以在出入口做一次翻译，别让密文信封漏进业务逻辑。
 */
const SEALED_STATE_NAMES = new Set([
  'bond.json',
  'opening.json',
  'bonds-peers.json',
  'body.json',
  'thoughts.json',
  'intimacy.json',
])

/* 同步桥写文件时先落 .sync.tmp 再改名；临时名要还原成最终名，密钥才对得上。 */
function sealedStateNameOf(filePath) {
  return basename(filePath).replace(/\.(sync\.)?tmp$/, '')
}

function readSealedText(filePath, text) {
  if (!isSealed(text)) return text
  try {
    return unsealText(sealedStateNameOf(filePath), text)
  } catch {
    /* 解不开就当没读到，交给上层走默认值 */
    return text
  }
}

function isSealedStateFile(filePath) {
  return SEALED_STATE_NAMES.has(sealedStateNameOf(filePath))
}

/* 同步桥只认 fs 的形状：读出来是明文，写下去按本机口令重新加密。 */
const syncFs = {
  mkdirSync,
  renameSync,
  statSync,
  readFileSync(file, encoding) {
    return readSealedText(file, readFileSync(file, encoding))
  },
  writeFileSync(file, text) {
    mkdirSync(dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    const body = isSealedStateFile(file) ? sealText(sealedStateNameOf(file), String(text)) : String(text)
    writeFileSync(temp, body, 'utf8')
    renameSync(temp, file)
  },
}

/* 多端同步只碰陪伴数据目录；节点名取主机名，避免两台机器落到同一个 HLC 节点 */
const syncBridge = createSyncBridge({ dir: STATE_DIR, node: hostname() || 'local', fs: syncFs })

/* 会话桥只读：发送能力未开放，send 固定返回 send-unavailable */
const sessionBridge = createSessionBridge()
let boundSessionId = null

/* 换机器就解不开：口令 = SHA256(MachineGuid | 用户名 | 版本标签) */
const VAULT_SALT_LABEL = 'cyrene-pet-vault-v1'

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const BALANCE_TTL = 30 * TIME.SECOND
const HUD_TTL = 6 * TIME.SECOND
const MAX_BODY_BYTES = 32 * 1024

/* 对话提问桥：单题的基础等待时长，多题按题数加时；超时就把请求交还网页卡片 */
const CONVERSATION_ASK_TIMEOUT = 45 * TIME.SECOND
const CONVERSATION_ASK_STEP_TIMEOUT = 25 * TIME.SECOND
/* 风险审批：决定只影响这一次，超时同样交还网页卡片 */
const APPROVAL_TIMEOUT = TIME.MINUTE

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
/* 视觉标签用的 key，同样先留在这里，persist 之后再进加密仓库 */
let pendingVisionKey

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
  await flushPendingVisionKey()
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

/* ---------------- 记忆观察台：给桌宠窗口的只读快照 ---------------- */

/*
 * 桌宠是另一个进程，拿不到这里的加密记忆。
 * 记忆或好感一变，就把「能看的那部分」压成明文快照放回主目录；
 * 桌宠只读这个文件，不碰密钥，也不反向写。
 */
/* B2-007：快照落盘权限收进 snapshot-writer；io 在调用处注入，判据才量得到传给 fs 的 opts。 */
import { writeSnapshot } from './companion/system/snapshot-writer.mjs'

const MEMORY_SNAPSHOT_DIR = join(homedir(), '.cyrene-pet')
const MEMORY_SNAPSHOT_PATH = join(MEMORY_SNAPSHOT_DIR, 'memory-snapshot.json')
let memorySnapshotAt = 0
let memorySnapshotBusy = false

async function writeMemorySnapshot(force = false) {
  const at = Date.now()
  if (force !== true && at - memorySnapshotAt < 3000) return
  if (memorySnapshotBusy) return
  memorySnapshotBusy = true
  memorySnapshotAt = at
  const owners = Array.isArray(state?.qq?.ownerOpenIds) ? state.qq.ownerOpenIds : []
  const peers =
    typeof companionRuntime.peerStateList === 'function' ? companionRuntime.peerStateList() : []
  let payload
  try {
    const memory = await memoryStore.load()
    const scopes = await memoryStore.listScopes()
    /*
     * 空表要能自己解释自己：仓库是空的、还是解不开，
     * 观察台看到的是两种完全不同的状况，不能都显示成「0 条」。
     */
    payload = {
      ok: true,
      version: 2,
      at,
      source: 'plugin',
      itemCount: Array.isArray(memory?.items) ? memory.items.length : 0,
      vaultError: memoryVaultError,
      ownerOpenIds: owners,
      scopes,
      peers,
    }
  } catch (error) {
    payload = {
      ok: false,
      version: 2,
      at,
      source: 'plugin',
      reason: String(error?.message ?? error),
      vaultError: memoryVaultError,
      itemCount: 0,
      ownerOpenIds: owners,
      scopes: { owners: [], privates: [], groups: [] },
      peers,
    }
  }
  try {
    await writeSnapshot({
      io: { mkdir, writeFile },
      dir: MEMORY_SNAPSHOT_DIR,
      file: MEMORY_SNAPSHOT_PATH,
      payload,
    })
  } catch (error) {
    void bootLog(`[memory] 快照写入失败：${String(error?.message ?? error)}`)
  } finally {
    memorySnapshotBusy = false
  }
}

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

/* 视觉标签的 key 也放这个本机加密仓库，state.json 里只留「有没有填过」。 */
async function loadVisionSecret() {
  const vault = await getQqVault()
  const data = await vault.load()
  return typeof data?.visionApiKey === 'string' ? data.visionApiKey : ''
}

async function saveVisionSecret(apiKey) {
  const vault = await getQqVault()
  const data = (await vault.load()) ?? {}
  await vault.save({ ...data, visionApiKey: String(apiKey ?? '') })
}

async function flushPendingVisionKey() {
  if (pendingVisionKey === undefined) return
  const value = pendingVisionKey
  pendingVisionKey = undefined
  visionCache = null
  try {
    await withTimeout(saveVisionSecret(value), 6000, null)
  } catch (error) {
    void bootLog(`[sticker] 视觉密钥没写进去：${String(error?.message ?? error)}`)
  }
}

/* 视觉的 key：先用单独存的；没填就复用桌宠主 Key，免得同一把钥匙存两遍。 */
async function resolveVisionKey() {
  try {
    const own = await loadVisionSecret()
    if (own !== '') return own
  } catch {
    /* 仓库没解锁，继续回落主 Key。 */
  }
  if (hasVaultKey) {
    try {
      const store = await withTimeout(getSecretStore().then((s) => s.getApiKey()), 4000, null)
      if (typeof store === 'string' && store !== '') return store
    } catch {
      /* 下面还有环境变量。 */
    }
  }
  return String(process.env.DEEPSEEK_API_KEY ?? '')
}

/* 视觉实例按配置缓存：配置没变就不重复解锁加密仓库。 */
let visionCache = null
async function getStickerVision() {
  const settings = state?.vision ?? DEFAULTS.vision
  if (settings.enabled !== true) return null
  const apiKey = await resolveVisionKey()
  const cacheKey = `${settings.baseUrl}|${settings.model}|${apiKey}`
  if (visionCache !== null && visionCache.key === cacheKey) return visionCache.instance
  const instance = createStickerVision({
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey,
    enabled: true
  })
  visionCache = { key: cacheKey, instance }
  return instance
}

/**
 * 自动收下的图没有名字，让视觉模型给一两个短词当标签。
 * 未配置、超时、报错都静默跳过，绝不影响聊天和收图。
 */
async function labelAutoSticker(item, context) {
  if (item?.packId !== 'qq-auto' || item?.duplicate === true) return
  const fileName = String(item?.file ?? '')
  if (fileName === '') return
  const vision = await getStickerVision()
  if (vision === null) return
  const verdict = await vision.describe({
    buffer: context?.buffer,
    contentType: context?.contentType ?? item?.contentType
  })
  if (verdict.ok !== true) {
    void bootLog(`[sticker] 视觉标签跳过：${verdict.reason}`)
    return
  }
  const written = await stickerInbox.writeLabel(fileName, verdict.labels)
  if (written.ok === true) {
    stickerLibrary.invalidate()
    void bootLog(`[sticker] 视觉标签 ${verdict.labels.join('/')} → ${fileName}`)
  }
}

/* 表情包小偷：QQ 里收到的图先落到 packs/.inbox，像表情包的自动进 qq-auto。 */
const STICKER_ROOT = join(STATE_DIR, 'packs')
const stickerInbox = createStickerInbox({
  root: STICKER_ROOT,
  log: (message, ...rest) => {
    void bootLog(`[sticker] ${message} ${rest.join(' ')}`.trim())
  }
})
const stickerPickup = createStickerPickup({
  inbox: stickerInbox,
  onSaved: (item, context) => labelAutoSticker(item, context),
  log: (message, ...rest) => {
    void bootLog(`[sticker] ${message} ${rest.join(' ')}`.trim())
  }
})
/* 挑表情：内置素材给聊天用，偷来的只参与挑图、不进素材面板。 */
const STANDALONE_ASSET_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'pet',
  'standalone',
  'assets'
)
/* 聊天气泡里也补一张：模型没点标签时按情绪兜底，10 分钟冷却。 */
const stickerFallback = createStickerFallback()
/* 偷来的图没有标签，靠账本记住哪张发过，避免总挑到同一张。 */
const stickerUsage = createStickerUsage({ filePath: join(STATE_DIR, 'sticker-usage.json') })
void stickerUsage.load()
const stickerLibrary = createStickerLibrary({
  usage: stickerUsage,
  roots: [
    {
      id: 'builtin',
      source: 'builtin',
      packId: 'cyrene-sticker',
      packName: 'Cyrene 小贴纸',
      dir: join(STANDALONE_ASSET_DIR, 'cyrene', 'sticker'),
      prefix: 'cyrene/sticker'
    },
    {
      id: 'builtin',
      source: 'builtin',
      packId: 'cyrene-agent',
      packName: 'Cyrene 表情包',
      dir: join(STANDALONE_ASSET_DIR, 'sticker-packs', 'cyrene-agent'),
      prefix: 'sticker-packs/cyrene-agent'
    },
    {
      id: 'pack',
      source: 'pack',
      packId: 'qq-auto',
      packName: 'QQ 偷来的',
      dir: join(STICKER_ROOT, 'qq-auto'),
      prefix: 'qq-auto',
      /* 视觉模型起的标签按文件名记在这里，读不到就回落到文件名。 */
      labelsPath: stickerInbox.labelsPath,
      listed: false,
      chat: true
    },
    {
      /* 用户自己收的表情：设置页上传、文件夹批量导入都落这儿，和内置共用一份清单。 */
      id: 'custom',
      source: 'pack',
      packId: 'custom',
      packName: '我收的表情',
      dir: join(STICKER_ROOT, 'custom'),
      prefix: 'custom',
      listed: true,
      chat: true,
      /* 同一张图存两次只留一份，文件名不同也算同一张。 */
      dedupe: true
    }
  ]
})

const qqHost = createQqHost({
  getState: () => state,
  filterText: filterOutboundText,
  loadSecret: loadQqSecret,
  saveSecret: saveQqSecret,
  onImages: async (event) => {
    /* 收图失败不该把这条消息后面的聊天一起带走。 */
    let result
    try {
      result = await stickerPickup.pickFromEvent(event)
    } catch (error) {
      void bootLog(`[sticker] 收图抛错：${String(error?.message ?? error)}`)
      return { ok: false, reason: 'pickup-failed' }
    }
    /* 新图落盘后立刻刷新表情库，不然要等缓存过期才轮得到它们。 */
    if (result?.ok === true && Array.isArray(result.saved) && result.saved.length > 0) {
      stickerLibrary.invalidate()
      void bootLog(`[sticker] 收下 ${result.saved.length} 张，表情库已刷新`)
    }
    return result
  },
  onChat: (event) => replyToQqChat(event),
  /* 所有到达的消息都进记忆；回不回复仍由 onChat 与网关决定。 */
  onObserve: (event) => observeQqMessage(event),
  onStickerError: (reason) => {
    void bootLog(`[sticker] 没收成：${reason}`)
  },
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
  nickname: '旅者',
  apiKey: '',
  balanceThreshold: 20,
  dailyLimit: 0,
  bubbleMode: 'rotate',
  ui: 'pet',
  /* 自定义素材包：空 = 内置立绘；否则对应 models/<id>/ */
  modelId: '',
  modelNotice: '',
  hudDetail: 'full',
  showHud: true,
  scale: 1,
  bubbleFont: 14.5,
  /* 气泡宽度与小表情尺寸：口径跟桌宠设置页一致，0 宽度表示跟随窗口。 */
  bubbleWidth: 300,
  bubbleStickerSize: 64,
  bubbleRadius: 0,
  outline: 'light',
  /* 人格七段：留空回落默认，填了整段替换，额外说明追加 */
  persona: { enabled: true, sections: {}, extraPrompt: '' },
  bubbleAlpha: 0.97,
  hudAlpha: 0.93,
  askEveryMinutes: 45,
  /* 提问卡每题的作答时间（秒），桌宠气泡倒计时按它走，设置里可调 */
  askPerQuestionSeconds: 30,
  askHandling: 'pet-all',
  asks: [],
  refreshSeconds: 30,
  poseSeconds: 60,
  soundVolume: 0.5,
  /* 换肤：三套配色，只换界面，不动素材 */
  theme: 'pink',
  /* 背景图：id 指向数据目录 backgrounds/ 里的文件，dim 是遮罩浓度 0~0.85；rotateMinutes 为 0 表示不轮换。
     库里只有一份素材，四个位置各自选图、各自记住取景，互不覆盖：
     page=DSH 页面，window=桌宠独立窗口，settingsCard=DSH 设置卡片，settingsWindow=桌宠设置窗。
     zoom 是取景缩放，1 表示刚好铺满；blur 只有窗口类位置用得上。 */
  background: {
    /* 兼容旧数据：旧 background.id 读作 slots.page.id，写入时按新结构落盘 */
    id: '',
    dim: 0.35,
    rotateMinutes: 0,
    posX: 50,
    posY: 50,
    targets: { page: true, window: true },
    windowBlur: 0,
    slots: {
      page: { id: '', dim: 0.35, posX: 50, posY: 50, zoom: 1 },
      window: { id: '', dim: 0.35, posX: 50, posY: 50, zoom: 1, blur: 0 },
      settingsCard: { id: '', dim: 0.35, posX: 50, posY: 50, zoom: 1 },
      settingsWindow: { id: '', dim: 0.35, posX: 50, posY: 50, zoom: 1, blur: 0 }
    }
  },
  /* DSH 聊天页外观：skin=off 时不接管 token，只留本插件卡片样式 */
  appearance: { skin: 'on', palette: 'sakura', bgBlur: 0, paletteStrength: 0.55 },
  /* 聊天里能不能贴表情包：关掉后人格附录整段不注入 */
  stickersEnabled: true,
  /* 首次启动的单张向导卡；老用户迁移时视为已看过 */
  onboarded: false,
  /* 念出声：默认系统语音；配好本地 TTS 后走本机合成 */
  speechEnabled: false,
  speechProvider: 'system',
  ttsEndpoint: 'http://127.0.0.1:9880',
  ttsRefAudio: '',
  /* QQ 里也发语音：默认关着，别让人忽然收到一条会说话的回复 */
  qqVoiceEnabled: false,
  qqVoiceMode: 'wakeWord',
  /* 「发句语音」这类动作词，和叫她名字的唤醒词分开——叫名字只是让她听见 */
  qqVoiceWakeWord: '发句语音',
  /* 陪伴层：好感随相处变化；主动开口按由头账本限流，两个都能单独关 */
  bondEnabled: true,
  openingEnabled: true,
  /*
   * 两处位置分开设：city 是「她那边」，ownerCity 是「主人所在」。
   * ownerCity 留空表示未设置，不输出关心那一行，绝不回落默认城市——
   * 拿默认城市当主人位置，说出来的关心是假的。
   * autoLocate 默认关：勾选前不做任何网络探测。
   * autoLocatedCity 只存探测结果，不写回 city：来源才能实时分清是谁给的。
   * locatedAt 由外壳写入，core 只负责存与归一化，从不自己探测。
   * 这组是「她所在城市」的外壳探测预留，当前没有任何外壳写入；
   * 桌宠外壳的 IP 定位是主人位置那组（ownerAutoLocate / ownerCity / ownerIp），两组互不相干。
   */
  presence: { city: '', ownerCity: '', autoLocate: false, autoLocatedCity: '', locatedAt: 0 },
  /* 气泡句末温度的落点开关；关掉后整条后处理不生效。 */
  companion: { bubbleTone: true },
  /* 关系名单：主人点名的重要/次重要用户，按 QQ 号认。 */
  companionPeers: { owner: [], important: [], secondary: [] },
  /* 性格速度：auto 从人格文本推，overrides 是用户逐项改的值。
     recallBias 单独存一份：念旧倾向，[-1,1]，0 表示不抬不压。 */
  companionTraits: {
    auto: {},
    overrides: {},
    source: 'default',
    hits: {},
    recallBias: 0,
    /* null = 从没推演过；0 = 旧版 state 写的，没有版本标记。 */
    recallDetail: null,
    traitsVersion: 0,
    wordsId: '',
  },
  /*
   * 四轴：每轴一个开关加一档灵敏度。
   * 灵敏度只乘事件权重（低 0.65 / 正常 1 / 高 1.4），不改结构，也不改上限。
   */
  companionAxes: {
    relation: { enabled: true, sensitivity: 'normal' },
    friction: { enabled: true, sensitivity: 'normal' },
    body: { enabled: true, sensitivity: 'normal' },
    memory: { enabled: true, sensitivity: 'normal' },
    proactive: { enabled: true, sensitivity: 'normal' },
  },
  /* 亲密层：完整版默认关，用户显式打开才生效；公开版永远不生效 */
  intimacy: {
    enabled: false,
    perDay: INTIMACY_DEFAULTS.perDay,
    cooldownHours: INTIMACY_DEFAULTS.cooldownHours,
    idleHours: INTIMACY_DEFAULTS.idleHours,
    aftercareMinutes: INTIMACY_DEFAULTS.aftercareMinutes,
    /* 主人专属：门槛手填 / 是否启用门槛 / 笔触档位 */
    gate: null,
    gateEnabled: true,
    style: 'auto',
  },
  /* 自动记忆：默认开；首次写入时在设置页留一条可见提示 */
  memoryEnabled: true,
  memoryFirstWriteAt: 0,
  memoryNoticeDismissed: false,
  /* 13 槽开关：null = 未自定义，按槽表默认（启用 7 开、备用 6 关） */
  memorySlots: null,
  /* 记忆台视图：owner 只看主人线；all 才把私聊和群聊摊开，仅主人可用 */
  memoryViewMode: 'owner',
  /* 主人手动打开的受控互通；默认两边都关，私聊与群聊各看各的 */
  memoryBridgePrivate: false,
  memoryBridgeGroup: false,
  /* 绑定会话：null = 跟随当前活动会话；选择器做好后只改这个字段 */
  boundSessionId: null,
  /* 视觉标签：只给自动收下的图起短名字，默认关；key 存加密仓库，这里只记有没有填过 */
  /* DeepSeek 的视觉模型走同一个 /chat/completions，图片格式支持 JPEG/PNG/GIF/WebP */
  vision: {
    enabled: false,
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash-vision-exp',
    hasApiKey: false,
  },
  /* 多端同步：空令牌 = 端点关闭；配对令牌由用户自己填，不自动公开 */
  syncToken: '',
  /*
   * 本机双端设置同步：桌宠设置窗与 DSH 设置页共用一组可映射字段。
   * 关掉后两边各写各的文件，互不覆盖。
   */
  settingsSync: true,
  /* 最近一次设置写入时间戳；桌宠回写时抬高，用来判断谁更新 */
  settingsStamp: 0,
  /* QQ 官方通道：只存非敏感配置；AppSecret 在 qq.vault.json，进不了 state.json */
  qq: {
    enabled: false,
    /* 隐私模式默认开着：群聊与陌生私聊的记忆不上桌面、也不跨会话串味 */
    privacyMode: true,
    appId: '',
    ownerOpenIds: [],
    targetKind: 'c2c',
    targetId: '',
    webhookPort: 17321,
    webhookPath: '/qq/webhook',
  },
  /*
   * 游戏感知：只读进程名判断有没有游戏在跑，顺带读外部工具的状态。
   * 不启动游戏、不注入、不改档案，也不替你清体力——那些交给专门的工具。
   */
  game: {
    enabled: true,
    /* 检测到游戏时自动进游戏模式：收起气泡、降低存在感，不挡游戏画面 */
    autoMode: true,
    hideBubble: true,
    dimPet: 0.65,
    /* dsh-launcher 的地址；空 = 不读。只读它的 /state，不向它下指令。 */
    launcherUrl: '',
    /* 三月七小助手；空 = 不读。只跑 --status，不代跑任务。 */
    m7aPath: '',
  },
  /* 陪看：插件只写请求位，窗口由桌宠开；这里只存开关与常看的地址。 */
  watch: {
    enabled: true,
    defaultUrl: '',
  },
  /* 弹幕层：字号、速度、轨道这些观感参数都从这一份走，桌宠不再写死。 */
  danmaku: {
    enabled: true,
    fontSize: 22,
    opacity: 0.95,
    seconds: 12,
    tracks: 7,
    idleMinutes: 5,
  },
})

const BUBBLE_MODES = ['rotate', 'info', 'talk', 'today']
/* 立绘描边：白边（默认）/ 深边 / 按亮度自动 / 不加 */
/* 界面模式：完整立绘 / 只显示审批卡片 */
const UI_MODES = ['pet', 'card']
/* 换肤：粉（默认）/ 蓝 / 墨 */
const THEMES = ['pink', 'blue', 'ink']
/* 语音引擎：系统语音 / 本机 TTS */
const SPEECH_PROVIDERS = ['system', 'local']
/* QQ 语音什么时候发：每条都配 / 只有叫了名字才配 */
const QQ_VOICE_MODES = ['always', 'wakeWord']
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
/* 左侧配色：樱粉是基准，另两套只换底色，不动版式 */
const APPEARANCE_PALETTES = ['sakura', 'plainpaper', 'celadon']

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

const SESSION_ROOT = join(DSH_HOME, 'sessions')

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

/* 取材会话近况：有正在做的事就先问那件事，问不到才回落固定题库 */
function pickQuestion(now = Date.now()) {
  const topic =
    typeof activeSessionView?.title === 'string' ? activeSessionView.title.trim() : ''
  if (topic !== '' && Math.random() < 0.6) {
    const short = topic.length > 16 ? `${topic.slice(0, 16)}…` : topic
    return {
      id: now,
      index: -1,
      text: `还在忙「${short}」吗？要不要人家搭把手？`,
      choices:
        activeSessionView?.busy === true
          ? ['你先看着就好', '帮我理一下', '换个话题']
          : ['帮我看看', '先不用啦', '换个话题'],
    }
  }
  if (QUESTION_BANK.length === 0) return null
  let index = Math.floor(Math.random() * QUESTION_BANK.length)
  if (QUESTION_BANK.length > 1 && index === askIndex) index = (index + 1) % QUESTION_BANK.length
  askIndex = index
  const item = QUESTION_BANK[index]
  return { id: now, index, text: item.text, choices: [...item.choices] }
}

function askGapMs() {
  return Math.max(5, Number(state.askEveryMinutes) || 45) * TIME.MINUTE
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

/* 每题作答秒数：设置里可调，默认 30 秒。
   原先是 45 秒基础 + 每多一题 25 秒，题目一多就要等很久，且不能调。 */
function askPerQuestionMs() {
  const raw = Number(state.askPerQuestionSeconds)
  const seconds = Number.isFinite(raw) && raw >= 1 ? raw : DEFAULTS.askPerQuestionSeconds
  return Math.round(seconds * 1000)
}

/* 多题逐题问，等待时间 = 题数 × 每题秒数 */
function askWaitMs(questions) {
  return Math.max(1, questions.length) * askPerQuestionMs()
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

/* 把桌宠回传的逐题选项对齐成 ask 期望的答案批次，未答的题按空选项处理
 *
 * 双键对齐：id 是主键，index 是兜底。
 * 老版本桌宠只交 index（键会全变成 "undefined"），新版本交 id，
 * 两边都认才不会出现「插件和桌宠版本错配 → 答案整批丢空 → DSH 显示已跳过」。
 */
function buildAnswerBatch(questions, answers) {
  const byId = new Map()
  const byIndex = new Map()
  const list = Array.isArray(answers) ? answers : []
  list.forEach((item, position) => {
    if (item === null || typeof item !== 'object') return
    const selected = Array.isArray(item.selected)
      ? item.selected.map((label) => clampText(label, 40)).filter((label) => label !== '')
      : []
    if (item.id !== undefined && item.id !== null && String(item.id) !== '') {
      byId.set(String(item.id), selected)
    }
    const raw = Number(item.index)
    byIndex.set(Number.isFinite(raw) ? raw : position, selected)
  })
  return questions.map((question, position) => {
    const raw = Number(question.index)
    const fallback = byIndex.get(Number.isFinite(raw) ? raw : position)
    return {
      id: question.id,
      selected: byId.get(String(question.id)) ?? fallback ?? [],
    }
  })
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
  const enabled = state.enabled === true
  /* 桌宠可能不是这个进程拉起的（DSH 重启后句柄就丢了），按实际存活判断 */
  const petsAlive = enabled && mode !== 'web' ? await petAliveNow() : false
  /* 诊断：桥有没有被调用、被哪个条件挡下，都落进 pet-boot.log */
  void bootLog(
    `ask in mode=${mode} enabled=${enabled} pet=${petChild !== null} alive=${petsAlive} ` +
    `agent=${request?.agent !== undefined && request?.agent !== null} busy=${conversationAsk !== null} ` +
    `n=${Array.isArray(request?.questions) ? request.questions.length : -1}`,
  )
  if (mode === 'web') return next()
  if (enabled !== true || petsAlive !== true) return next()
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

/*
 * 桌宠进程还活着吗。
 *
 * petChild 只代表「这个进程自己拉起过桌宠」：DSH 重启后这份句柄就没了，
 * 而桌宠是 detached + unref 的，旧实例还好好待在桌面上。以前审批只看
 * petChild，于是重启之后桥一路 next()，审批卡片永远进不了气泡。
 * 句柄不在就按命令行捞一次 PID 名单，结论缓存 PET_ALIVE_TTL 秒。
 */
async function petAliveNow(force = false) {
  if (petChild !== null) return true
  const at = Date.now()
  if (force !== true && at - petAliveCheckedAt < PET_ALIVE_TTL) return petAliveCached
  petAliveCheckedAt = at
  try {
    petAliveCached = await existingPetAlive()
  } catch {
    /* 查不动就当没有活着的实例：审批回网页卡片，总比让她空等一场好 */
    petAliveCached = false
  }
  return petAliveCached
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
  const enabled = state.enabled === true
  /* 桌宠可能不是这个进程拉起的（DSH 重启后句柄就丢了），按实际存活判断 */
  const petsAlive = enabled && mode !== 'web' ? await petAliveNow() : false
  void bootLog(
    `approval in mode=${mode} enabled=${enabled} pet=${petChild !== null} alive=${petsAlive} ` +
    `agent=${request?.agent !== undefined && request?.agent !== null} busy=${approvalAsk !== null} ` +
    `tool=${request?.toolName ?? ''}`,
  )
  if (mode === 'web') return next()
  if (enabled !== true || petsAlive !== true) return next()
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

/* 主人记忆按账号分桶；DSH 里没有绑定关系时落在第一位主人名下。 */
function resolveOwnerScopeId() {
  const owners = Array.isArray(state?.qq?.ownerOpenIds) ? state.qq.ownerOpenIds : []
  return String(owners[0] ?? '').trim() || 'owner-1'
}

/*
 * 记忆台只对主人开放；守卫本身在 companion/memory/owner-guard.mjs，
 * 这里只保留调用，方便单独测试同源与主人标记。
 */

/*
 * 从最近的用户发言里挑出值得记住的事，先过候选箱，再决定哪些能直接生效。
 * 只认明确的自述、偏好、近期事件和「记住……」，不把代码和闲话塞进去。
 */
const AUTO_APPROVE_SLOTS = new Set(FILTER.autoApproveSlots)

/*
 * 自动提取的分流线：
 * - 姓名、明确偏好、「记住……」、正在做的项目，原文本身就是确认，直接通过；
 * - 学到的事、当天发生的事这类低置信候选只进候选箱，不无条件进提示词。
 */
function shouldAutoApproveMemoryCandidate(item) {
  if (item === null || typeof item !== 'object') return false
  const slot = String(item.slot ?? '')
  if (slot === 'identity' || slot === 'promise') return true
  if (!AUTO_APPROVE_SLOTS.has(slot)) return false
  return Number(item.confidence) >= FILTER.autoApproveConfidence
}

async function ingestActiveSessionMemory(view) {
  if (state.memoryEnabled === false || axisOn('memory') === false) return
  if (memoryIngestPending || view === null || !Array.isArray(view.messages)) return
  if (view.id === memoryIngestSession && view.total === memoryIngestTotal) return
  memoryIngestPending = true
  try {
    /* 存储层卡住时只放弃这一轮，别让 pending 把后面的轮次全锁死。 */
    await withTimeout(memoryStore.load(), 3000, null)
    const ownerScopeId = resolveOwnerScopeId()
    const existing = new Set(
      memoryStore
        .snapshot()
        .items.filter((item) => item.scope === 'owner' && item.scopeId === ownerScopeId)
        .map((item) => memoryDedupeKey({ ...item, scope: 'owner' })),
    )
    const candidates = []
    /* 新的发言先抽：每次刷新都会重读最近 8 条，旧候选不能把新候选挤出名额。 */
    let latestUserText = ''
    for (const message of [...view.messages].reverse()) {
      if (message?.role !== 'user' || message?.kind !== 'message') continue
      if (latestUserText === '') latestUserText = String(message.text ?? '')
      candidates.push(...extractMemoryCandidates(message.text))
    }

    let changed = false
    /* 自动提取落库也跟 13 槽开关走：关掉的槽不自动写入（注入/展示/手动落盘已跟随开关）。 */
    const onSlots = activeMemorySlotIds()
    /*
     * 先滤掉已存在的条目，再按置信度取名额。
     * 顺序反过来会让「上一轮已经记过的 4 条」占满切片，新发言永远轮不到。
     */
    const fresh = candidates.filter(
      (item) =>
        onSlots.includes(item.slot) &&
        !existing.has(memoryDedupeKey({ ...item, scope: 'owner' })),
    )
    fresh.sort((left, right) => Number(right.confidence) - Number(left.confidence))
    /*
     * P1-b 断言④接线（2026-11-24 §8.68）：显著性预算联动。
     * SALIENCE_ENABLED=false（默认）时 writeCapFor 原样透传 baseCap——卫兵等价，
     * 老路径逐字节不变；翻开后 budgetRatio 收紧 → 每轮抽取名额随之降（floor 1）。
     * attentionBudgetRatio 现为诚实桩（TODO M1：接注入侧 turn 预算实际占用）；
     * 开关翻真那天，:3351 memoryPerRoundLimit 的下发值须同步换成生效名额，面板即真相。
     */
    const SALIENCE_ENABLED = false
    /** TODO(M1) 接线前恒 1.0：预算无压力占位，别把它当成「已联动」的证据。 */
    function attentionBudgetRatio() { return 1 /* TODO(M1)：接注入侧 turn 预算实际占用；恒 1.0 是占位，不是「已联动」的证据 */ }
    const baseCap = Math.min(
      PER_ROUND_LIMIT,
      Math.max(1, Math.round(PER_ROUND_LIMIT * axisSensitivity('memory'))),
    )
    const ingestCap = writeCapFor({ limit: baseCap, budgetRatio: attentionBudgetRatio(), enabled: SALIENCE_ENABLED })
    const batch = fresh.slice(0, ingestCap)
    const at = Date.now()
    for (const item of batch) existing.add(memoryDedupeKey({ ...item, scope: 'owner' }))

    /*
     * 先全部进候选箱，再由候选箱统一决定 active。
     * 候选箱不可用时只放行本就能自动通过的高置信条目，低置信不绕过四态。
     */
    let approved = []
    const box = companionRuntime.candidateBox
    if (box && typeof box.ingest === 'function') {
      await withTimeout(box.load(), 2000, null)
      const routed = box.ingest(batch, {
        source: 'session',
        scope: 'owner',
        at,
        autoApprove: shouldAutoApproveMemoryCandidate,
      })
      approved = routed.approved
    } else {
      approved = batch
        .filter(shouldAutoApproveMemoryCandidate)
        .map((item) => ({ ...item, status: 'active' }))
    }

    const outcome = await commitApprovedCandidates(approved, {
      /* DSH 这条线上她只是信使：内容作为主人事件记下，不参与人设语境。 */
      remember: (item) =>
        withTimeout(
          memoryStore.remember({
            ...item,
            source: 'session',
            scope: 'owner',
            scopeId: ownerScopeId,
            channel: 'dsh',
          }),
          3000,
          null,
        ),
      /* 同时落结构化事实，DSH 人格拼装时会走 selectAuthorized 读回来。
       * 事实失败不挡原话记忆：这里的异常由 commitApprovedCandidates 内部吞掉，不算没落稳。 */
      upsertFact: async (item) => {
        const factStore = companionRuntime.factStore
        if (!factStore || typeof factStore.upsert !== 'function') return
        await factStore.load?.()
        factStore.upsert(
          [{
            kind: item.slot,
            text: item.text,
            confidence: item.confidence,
            evidence: item.evidence,
            source: 'dsh:session',
            mentionPolicy: 'free',
            validFrom: at,
          }],
          at,
          'desktop',
        )
      },
      onSaved: () => {
        changed = true
      },
    })
    /*
     * B2-003：只有这一轮一条都没漏，才推进游标。
     * 有没落库的就保持旧值，下一轮整轮重来；已写进去的会被上面的 existing 集合滤掉，
     * 重来不会把同一条堆成两条。改动前这两行是无条件的，remember 超时/失败的那几条
     * 因为 :2042 的幂等门而永久跳过——「已通过但未落库」于是静默丢失。
     */
    if (outcome.advanceCursor) {
      memoryIngestSession = view.id
      memoryIngestTotal = view.total
    }
    if (changed) {
      /* 第一次自动写入时留一条可见记录，设置页会提示一次，可手动关掉 */
      if (!(Number(state.memoryFirstWriteAt) > 0)) {
        state.memoryFirstWriteAt = Date.now()
        await persist()
      }
    }
    /* 不管这轮有没有新记忆，都按最新这句话重排一次；同一句话不会重复重挂。 */
    syncPromptMemory(latestUserText)
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

/*
 * 念旧明细落盘前的清洗。
 *
 * 缺字段返回 null，不补 0：补 0 会让「没推演过」长得像「推演过且中性」，
 * 面板就分不出来。推没推过看 companionTraits.traitsVersion，不看字段有没有值。
 */
function normalizeRecallDetail(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null
  const pos = Number(raw.pos)
  const neg = Number(raw.neg)
  const halfLifeDays = Number(raw.halfLifeDays)
  const hits = Array.isArray(raw.hits)
    ? raw.hits
        .filter((hit) => hit !== null && typeof hit === 'object' && typeof hit.word === 'string')
        .map((hit) => ({
          word: hit.word,
          count: Math.max(0, Math.trunc(Number(hit.count) || 0)),
          side: hit.side === 'neg' ? 'neg' : 'pos',
        }))
    : []
  /* 旧格式只存字符串，没有 side；缺的按正向算，反正旧 state 本来也没这一格。 */
  const zeroHitWords = Array.isArray(raw.zeroHitWords)
    ? raw.zeroHitWords
        .map((entry) => {
          if (typeof entry === 'string') return { word: entry, side: 'pos' }
          if (entry !== null && typeof entry === 'object' && typeof entry.word === 'string') {
            return { word: entry.word, side: entry.side === 'neg' ? 'neg' : 'pos' }
          }
          return null
        })
        .filter((entry) => entry !== null)
    : []
  return {
    pos: Number.isFinite(pos) ? Math.max(0, pos) : 0,
    neg: Number.isFinite(neg) ? Math.max(0, neg) : 0,
    halfLifeDays: Number.isFinite(halfLifeDays) ? halfLifeDays : 0,
    hits,
    zeroHitWords,
  }
}

function normalize(input) {
  const next = { ...state }
  /* 老 state.json 没有这一段，补一份默认的，免得设置页读到 undefined */
  if (next.vision === undefined) next.vision = { ...DEFAULTS.vision }
  if (next.game === undefined) next.game = { ...DEFAULTS.game }
  if (next.presence === undefined) next.presence = { ...DEFAULTS.presence }
  if (next.companion === undefined) next.companion = { ...DEFAULTS.companion }
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
  if (input?.bubbleWidth !== undefined) {
    next.bubbleWidth = clampNumber(input.bubbleWidth, 0, 600, DEFAULTS.bubbleWidth)
  }
  if (input?.bubbleStickerSize !== undefined) {
    next.bubbleStickerSize = clampNumber(input.bubbleStickerSize, 24, 160, DEFAULTS.bubbleStickerSize)
  }
  if (input?.bubbleRadius !== undefined) {
    /* 上限 28：原先是 18，而桌宠设置页滑杆给到 24，两边不一致会让
       用户拉过 18 之后被静默压回来，看着像滑杆坏了。统一放宽到 28。 */
    next.bubbleRadius = clampNumber(input.bubbleRadius, 0, 28, DEFAULTS.bubbleRadius)
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
  if (input?.askPerQuestionSeconds !== undefined) {
    next.askPerQuestionSeconds = clampNumber(
      input.askPerQuestionSeconds, 10, 180, DEFAULTS.askPerQuestionSeconds,
    )
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
    const posX = Number(input.background.posX)
    const posY = Number(input.background.posY)
    const prevPos = next.background !== null && typeof next.background === 'object' ? next.background : {}
    /* targets / windowBlur 也用「缺省沿用」：老调用只写 id，不该把窗口开关冲回默认。 */
    const prevTargets = prevPos.targets !== null && typeof prevPos.targets === 'object' ? prevPos.targets : {}
    const askedTargets = input.background.targets !== null && typeof input.background.targets === 'object'
      ? input.background.targets
      : {}
    const windowBlur = Number(input.background.windowBlur)
    /* slots 是四槽新结构：旧数据没有它，page 槽回落到旧的 id/posX/posY，读起来和以前一样。
       逐槽兜住脏值，一个槽写坏不会连累另外三个。 */
    const prevSlots = prevPos.slots !== null && typeof prevPos.slots === 'object' ? prevPos.slots : {}
    const askedSlots = input.background.slots !== null && typeof input.background.slots === 'object'
      ? input.background.slots
      : null
    const legacyKeep = {
      id: typeof prevPos.id === 'string' ? prevPos.id : '',
      dim: prevPos.dim,
      posX: prevPos.posX,
      posY: prevPos.posY
    }
    const validId = (value) => (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value) ? value : '')
    const pickId = (ask, keep) => {
      if (typeof ask?.id === 'string') return validId(ask.id.trim())
      return validId(typeof keep?.id === 'string' ? keep.id.trim() : '')
    }
    const pickNum = (ask, keep, fallback, min, max, round) => {
      const asked = Number(ask)
      const found = Number.isFinite(asked) ? asked : Number(keep)
      if (!Number.isFinite(found)) return fallback
      const clamped = Math.min(max, Math.max(min, found))
      return round ? Math.round(clamped) : clamped
    }
    const buildSlot = (name, withBlur) => {
      const ask = askedSlots !== null && askedSlots[name] !== null && typeof askedSlots[name] === 'object'
        ? askedSlots[name]
        : {}
      const rawKeep = prevSlots[name] !== null && typeof prevSlots[name] === 'object' ? prevSlots[name] : null
      /* 没有新结构、只有旧字段时，让 page 槽接住旧取值，避免升级后背景凭空消失 */
      const keep = rawKeep ?? (name === 'page' ? legacyKeep : {})
      const out = {
        id: pickId(ask, keep),
        dim: pickNum(ask.dim, keep.dim, 0.35, 0, 0.85, false),
        posX: pickNum(ask.posX, keep.posX, 50, 0, 100, true),
        posY: pickNum(ask.posY, keep.posY, 50, 0, 100, true),
        zoom: pickNum(ask.zoom, keep.zoom, 1, 1, 3, false)
      }
      if (withBlur) out.blur = pickNum(ask.blur, keep.blur, 0, 0, 24, true)
      return out
    }
    /* posX / posY 是「照片取景」的百分比锚点：0=贴左/上，100=贴右/下。
       只写 id 的旧调用不该把已经调好的取景冲回中央，所以缺省沿用上一次的值。 */
    next.background = {
      id: /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id) ? id : '',
      dim: Number.isFinite(dim) ? Math.min(0.85, Math.max(0, dim)) : DEFAULTS.background.dim,
      rotateMinutes: Number.isFinite(rotate) ? Math.min(240, Math.max(0, Math.round(rotate))) : 0,
      posX: Number.isFinite(posX)
        ? Math.min(100, Math.max(0, Math.round(posX)))
        : (Number.isFinite(Number(prevPos.posX)) ? Math.min(100, Math.max(0, Math.round(Number(prevPos.posX)))) : 50),
      posY: Number.isFinite(posY)
        ? Math.min(100, Math.max(0, Math.round(posY)))
        : (Number.isFinite(Number(prevPos.posY)) ? Math.min(100, Math.max(0, Math.round(Number(prevPos.posY)))) : 50),
      targets: {
        page: askedTargets.page !== undefined ? askedTargets.page !== false : prevTargets.page !== false,
        window: askedTargets.window !== undefined ? askedTargets.window !== false : prevTargets.window !== false,
      },
      windowBlur: Number.isFinite(windowBlur)
        ? Math.min(24, Math.max(0, Math.round(windowBlur)))
        : Math.min(24, Math.max(0, Math.round(Number(prevPos.windowBlur) || 0))),
      slots: {
        page: buildSlot('page', false),
        window: buildSlot('window', true),
        settingsCard: buildSlot('settingsCard', false),
        settingsWindow: buildSlot('settingsWindow', true)
      }
    }
  }
  /* 聊天页外观：skin 只认 on / off；palette 与 bgBlur 必须一起保留——
     任何一次 state 写回都从 input.appearance 取，漏掉就会把桌面挑好的配色冲回默认。 */
  if (input?.appearance !== undefined && input.appearance !== null && typeof input.appearance === 'object') {
    const palette = input.appearance.palette
    const bgBlur = Number(input.appearance.bgBlur)
    const strengthIn = Number(input.appearance.paletteStrength)
    const keep = next.appearance !== null && typeof next.appearance === 'object' ? next.appearance : {}
    const keepStrength = Number(keep.paletteStrength)
    next.appearance = {
      skin: input.appearance.skin === 'off' ? 'off' : 'on',
      palette: APPEARANCE_PALETTES.includes(palette)
        ? palette
        : (APPEARANCE_PALETTES.includes(keep.palette) ? keep.palette : 'sakura'),
      bgBlur: Number.isFinite(bgBlur)
        ? Math.min(24, Math.max(0, bgBlur))
        : (Number.isFinite(Number(keep.bgBlur)) ? Math.min(24, Math.max(0, Number(keep.bgBlur))) : 0),
      /* 配色纱强度：外观写入组的一员，必须和 skin/palette 同批落盘。
         单独改一次皮肤就把强度冲回默认，用户会以为滑杆失灵。 */
      paletteStrength: Number.isFinite(strengthIn)
        ? Math.min(0.85, Math.max(0, strengthIn))
        : (Number.isFinite(keepStrength) ? Math.min(0.85, Math.max(0, keepStrength)) : 0.55),
    }
  }
  if (typeof input?.stickersEnabled === 'boolean') next.stickersEnabled = input.stickersEnabled
  if (input?.intimacy !== undefined && input.intimacy !== null && typeof input.intimacy === 'object') {
    const source = input.intimacy
    next.intimacy = {
      enabled: IS_PUBLIC_EDITION ? false : source.enabled === true,
      perDay: clampNumber(source.perDay, 1, 8, DEFAULTS.intimacy.perDay),
      cooldownHours: clampNumber(source.cooldownHours, 1, 24, DEFAULTS.intimacy.cooldownHours),
      idleHours: clampNumber(source.idleHours, 1, 24, DEFAULTS.intimacy.idleHours),
      aftercareMinutes: clampNumber(source.aftercareMinutes, 5, 240, DEFAULTS.intimacy.aftercareMinutes),
    }
    /* 回写同一份 settings.json：桌宠设置窗与插件看到的始终是同一个开关。 */
    writePetIntimacy(next.intimacy)
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
  if (typeof input?.qqVoiceEnabled === 'boolean') next.qqVoiceEnabled = input.qqVoiceEnabled
  if (QQ_VOICE_MODES.includes(input?.qqVoiceMode)) next.qqVoiceMode = input.qqVoiceMode
  if (typeof input?.qqVoiceWakeWord === 'string') {
    next.qqVoiceWakeWord = clampText(input.qqVoiceWakeWord, 32)
  }
  if (typeof input?.bondEnabled === 'boolean') next.bondEnabled = input.bondEnabled
  if (input?.companionPeers !== undefined && input.companionPeers !== null && typeof input.companionPeers === 'object') {
    const pick = (list) =>
      (Array.isArray(list) ? list : [])
        .map((item) => (typeof item === 'string' ? item.trim().slice(0, 64) : ''))
        .filter((item) => item !== '')
        .slice(0, 200)
    next.companionPeers = {
      owner: pick(input.companionPeers.owner),
      important: pick(input.companionPeers.important),
      secondary: pick(input.companionPeers.secondary),
    }
  }
  if (input?.companionTraits !== undefined && input.companionTraits !== null && typeof input.companionTraits === 'object') {
    const numeric = (raw) => {
      const out = {}
      if (raw === null || typeof raw !== 'object') return out
      for (const [key, value] of Object.entries(raw)) {
        const num = Number(value)
        if (Number.isFinite(num)) out[key] = num
      }
      return out
    }
    next.companionTraits = {
      auto: numeric(input.companionTraits.auto),
      overrides: numeric(input.companionTraits.overrides),
      source: typeof input.companionTraits.source === 'string' ? input.companionTraits.source : 'default',
      hits: input.companionTraits.hits !== null && typeof input.companionTraits.hits === 'object' ? input.companionTraits.hits : {},
      /* 念旧倾向：缺省 0，越界收口到 [-1, 1]。 */
      recallBias: Number.isFinite(Number(input.companionTraits.recallBias))
        ? Math.max(-1, Math.min(1, Number(input.companionTraits.recallBias)))
        : 0,
      /*
       * 念旧倾向的账：pos / neg / 逐词命中 / 零命中词。
       * 面板只投影这一份，不再调词表；缺省留空账，不冒充「算过」。
       */
      recallDetail: normalizeRecallDetail(input.companionTraits.recallDetail),
      /* 没有这一格就是旧版 state：从没推演过，面板要如实说。 */
      traitsVersion: Number.isFinite(Number(input.companionTraits.traitsVersion))
        ? Math.max(0, Math.trunc(Number(input.companionTraits.traitsVersion)))
        : 0,
      /* 词表指纹：对不上当前 WORDSET_ID 时，面板标 stale，提醒这条是旧词表推的。 */
      wordsId: typeof input.companionTraits.wordsId === 'string' ? input.companionTraits.wordsId : '',
    }
  }
  if (input?.companionAxes !== undefined && input.companionAxes !== null && typeof input.companionAxes === 'object') {
    const axes = { ...next.companionAxes }
    for (const key of AXIS_KEYS) {
      const raw = input.companionAxes[key]
      if (raw === null || typeof raw !== 'object') continue
      axes[key] = {
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : axes[key].enabled,
        sensitivity: SENSITIVITY_LEVELS.includes(raw.sensitivity) ? raw.sensitivity : axes[key].sensitivity,
      }
    }
    next.companionAxes = axes
  }
  if (input?.vision !== undefined && input.vision !== null && typeof input.vision === 'object') {
    const source = input.vision
    next.vision = {
      enabled: source.enabled === true,
      baseUrl: clampText(String(source.baseUrl ?? ''), 300).trim(),
      model: clampText(String(source.model ?? ''), 100).trim(),
      hasApiKey: next.vision?.hasApiKey === true,
    }
    /* 空字符串表示「这次没填」，不能拿它清掉已存的 key。 */
    const incoming = typeof source.apiKey === 'string' ? source.apiKey.trim().slice(0, 300) : ''
    if (incoming !== '') {
      pendingVisionKey = incoming
      next.vision.hasApiKey = true
    }
    if (source.clearApiKey === true) {
      pendingVisionKey = ''
      next.vision.hasApiKey = false
    }
    visionCache = null
  }
  /*
   * 游戏感知：只收这七个字段，地址只认 http/https。
   * launcherUrl 指向别家插件的 HTTP 口子，允许空（不读），但不允许 file: 之类的协议。
   */
  if (input?.game !== undefined && input.game !== null && typeof input.game === 'object') {
    const source = input.game
    const keep = next.game !== null && typeof next.game === 'object' ? next.game : DEFAULTS.game
    const launcherUrl = typeof source.launcherUrl === 'string'
      ? clampText(source.launcherUrl, 300).trim()
      : keep.launcherUrl
    next.game = {
      enabled: typeof source.enabled === 'boolean' ? source.enabled : keep.enabled,
      autoMode: typeof source.autoMode === 'boolean' ? source.autoMode : keep.autoMode,
      hideBubble: typeof source.hideBubble === 'boolean' ? source.hideBubble : keep.hideBubble,
      dimPet: clampNumber(source.dimPet, 0.2, 1, keep.dimPet),
      launcherUrl: /^https?:\/\//i.test(launcherUrl) ? launcherUrl.replace(/\/+$/, '') : '',
      m7aPath: typeof source.m7aPath === 'string' ? clampText(source.m7aPath, 500).trim() : keep.m7aPath,
    }
  }
  /* 陪看：只存开关与常看的地址；地址在真正开窗时才做 B 站校验。 */
  if (input?.watch !== undefined && input.watch !== null && typeof input.watch === 'object') {
    const source = input.watch
    const keep = next.watch !== null && typeof next.watch === 'object' ? next.watch : DEFAULTS.watch
    next.watch = {
      enabled: typeof source.enabled === 'boolean' ? source.enabled : keep.enabled,
      defaultUrl: typeof source.defaultUrl === 'string'
        ? clampText(source.defaultUrl, 300).trim()
        : keep.defaultUrl,
    }
  }
  /* 弹幕观感：全部落到区间里，桌宠不用再做一次防御。 */
  if (input?.danmaku !== undefined && input.danmaku !== null && typeof input.danmaku === 'object') {
    const source = input.danmaku
    const keep = next.danmaku !== null && typeof next.danmaku === 'object' ? next.danmaku : DEFAULTS.danmaku
    next.danmaku = {
      enabled: typeof source.enabled === 'boolean' ? source.enabled : keep.enabled,
      fontSize: clampNumber(source.fontSize, 14, 40, keep.fontSize),
      opacity: clampNumber(source.opacity, 0.3, 1, keep.opacity),
      seconds: clampNumber(source.seconds, 6, 30, keep.seconds),
      tracks: Math.round(clampNumber(source.tracks, 3, 12, keep.tracks)),
      idleMinutes: clampNumber(source.idleMinutes, 1, 60, keep.idleMinutes),
    }
  }
  if (typeof input?.openingEnabled === 'boolean') next.openingEnabled = input.openingEnabled
  /*
   * 两处位置各存各的，两个空串语义不同，别合并：
   *   city = ""        → 她那边回落默认城市（虚拟身份，成立）；
   *   ownerCity = ""   → 未设置，跳过关心整行、不 fetch（关心不能假）。
   * 归一化放在这里，调试面板读到的就是生效值。
   */
  if (input?.presence !== undefined && input.presence !== null && typeof input.presence === 'object') {
    const presence = input.presence
    next.presence = {
      city: typeof presence.city === 'string' ? clampText(presence.city, 20) : next.presence.city,
      ownerCity: typeof presence.ownerCity === 'string'
        ? clampText(presence.ownerCity, 20)
        : next.presence.ownerCity,
      /* 默认关：勾选之前不做任何网络探测。 */
      autoLocate: presence.autoLocate === true,
      /* 探测结果只落这一格；失败或双源不一致时外壳留空，不写默认城市。 */
      autoLocatedCity: typeof presence.autoLocatedCity === 'string'
        ? clampText(presence.autoLocatedCity, 20)
        : next.presence.autoLocatedCity,
      /* 探测时间：外壳按 TTL 决定要不要重探；0 表示从没探过。 */
      locatedAt: Number.isFinite(Number(presence.locatedAt))
        ? Math.max(0, Number(presence.locatedAt))
        : next.presence.locatedAt,
    }
  }
  if (typeof input?.companion?.bubbleTone === 'boolean') {
    next.companion = { ...next.companion, bubbleTone: input.companion.bubbleTone }
  }
  if (typeof input?.memoryEnabled === 'boolean') next.memoryEnabled = input.memoryEnabled
  if (input?.memoryViewMode === 'owner' || input?.memoryViewMode === 'all') {
    next.memoryViewMode = input.memoryViewMode
  }
  if (typeof input?.memoryBridgePrivate === 'boolean') {
    next.memoryBridgePrivate = input.memoryBridgePrivate
  }
  if (typeof input?.memoryBridgeGroup === 'boolean') {
    next.memoryBridgeGroup = input.memoryBridgeGroup
  }
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
  if (typeof input?.settingsSync === 'boolean') {
    next.settingsSync = input.settingsSync
  }
  {
    const stamp = Number(input?.settingsStamp)
    if (Number.isFinite(stamp) && stamp > 0) next.settingsStamp = stamp
  }
  if (input?.qq !== undefined && input.qq !== null && typeof input.qq === 'object') {
    const source = input.qq
    const owners = Array.isArray(source.ownerOpenIds) ? source.ownerOpenIds : []
    next.qq = {
      enabled: source.enabled === true,
      privacyMode: source.privacyMode !== false,
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
  /* schema 版本戳：内存态始终带上，落盘时 persist 再确认一次。 */
  next.schemaVersion = SETTINGS_VERSION
  return next
}

async function readStateFile(filePath) {
  const raw = await readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw)
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
}

/* 只认带插件字段的对象；{ x, y, width, height } 那种窗口坐标不进迁移。 */
function looksLikePluginState(parsed) {
  if (parsed === null) return false
  return (
    typeof parsed.rev === 'number' ||
    parsed.qq !== undefined ||
    parsed.channels !== undefined ||
    parsed.enabled !== undefined ||
    parsed.chatEnabled !== undefined ||
    parsed.bondEnabled !== undefined ||
    typeof parsed.nickname === 'string'
  )
}

async function ensureLoaded() {
  if (loaded) return
  loaded = true
  await settingsHistory.load()
  let parsed = null
  let migratedFromLegacy = false
  try {
    parsed = await readStateFile(STATE_PATH)
  } catch {
    parsed = null
  }
  if (parsed === null) {
    try {
      const legacy = await readStateFile(LEGACY_STATE_PATH)
      if (looksLikePluginState(legacy)) {
        parsed = legacy
        migratedFromLegacy = true
      }
    } catch {
      /* 旧文件不存在，或里面只是窗口坐标，都不当配置读 */
    }
  }
  try {
    const legacyKey = typeof parsed?.apiKey === 'string' ? parsed.apiKey.trim() : ''
    /* 迁移层：转换旧开关、清废弃键、补缺字段、打版本戳（幂等，见 settings-migrate.mjs） */
    const migrated = migrateSettings(parsed ?? {}, DEFAULTS)
    state = normalize({ ...DEFAULTS, ...migrated.settings })
    /* normalize 是写白名单：它不写的键（intimacy.gate 等）再补一次默认，不丢任何字段 */
    const filled = fillMissing(state, DEFAULTS)
    if (filled.filled > 0) state = filled.value
    boundSessionId = state.boundSessionId ?? null
    if (legacyKey !== '') {
      /* 旧版明文：搬进密钥仓库，随后覆写状态文件把明文抹掉 */
      pendingApiKey = legacyKey
      await flushPendingApiKey()
      await persist()
    } else {
      await refreshVaultFlag()
      /* 迁移有实际变化（或从旧文件迁过来）就落盘一次，让磁盘与内存一致 */
      if (migrated.changed || filled.filled > 0 || migratedFromLegacy) await persist()
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
  /* 启动完成就把旧记忆摊开一次，观察台不必等第一条新消息 */
  lastSettingsStamp = Number(state.settingsStamp ?? 0)
  void writeMemorySnapshot(true)
}

/* 单调递增的写入时间戳：同一毫秒内连续保存也不会撞车 */
let lastSettingsStamp = 0
function nextSettingsStamp() {
  const now = Date.now()
  lastSettingsStamp = now > lastSettingsStamp ? now : lastSettingsStamp + 1
  return lastSettingsStamp
}

async function persist() {
  /* 抬高 stamp：桌宠侧据此判断「DSH 这边刚改过」，不会把旧值写回来 */
  state = { ...state, rev: nextRev(state.rev), settingsStamp: nextSettingsStamp(), schemaVersion: SETTINGS_VERSION }
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

/* ---------------------------- 双端设置同步 ---------------------------- */

/**
 * 桌宠保存设置时只改映射字段并抬高 settingsStamp。
 * 这里只覆盖登记过的字段，其余内容继续以 DSH 内存为准，
 * 避免桌宠的一次写回把本端未同步的设置冲掉。
 * 返回 true 表示这次确实从磁盘取到了更新的值。
 */
async function syncSettingsFromDisk() {
  if (!loaded) return false
  if (state.settingsSync === false) return false
  let parsed = null
  try {
    parsed = await readStateFile(STATE_PATH)
  } catch {
    return false
  }
  if (parsed === null || typeof parsed !== 'object') return false
  const incoming = Number(parsed.settingsStamp ?? 0)
  if (!Number.isFinite(incoming) || incoming <= Number(state.settingsStamp ?? 0)) return false
  let changed = false
  for (const field of SYNC_FIELDS) {
    const value = normalizeSyncValue(field, readSyncPath(parsed, field.dsh))
    if (value === undefined) continue
    if (sameSyncValue(readSyncPath(state, field.dsh), value)) continue
    writeSyncPath(state, field.dsh, value)
    changed = true
  }
  state = { ...state, settingsStamp: incoming }
  lastSettingsStamp = incoming
  if (changed) {
    boundSessionId = state.boundSessionId ?? null
    remountPersona(hostCtx?.systemPrompt)
  }
  return changed
}

/* ---------------------------- 整库备份 ---------------------------- */

async function readBackupJson(filePath) {
  try {
    const raw = readSealedText(filePath, await readFile(filePath, 'utf8'))
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function writeBackupJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true })
  const text = `${JSON.stringify(value, null, 2)}\n`
  const temp = `${filePath}.tmp`
  await writeFile(temp, isSealedStateFile(filePath) ? sealText(basename(filePath), text) : text, 'utf8')
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

  /* 备份里带着聊天历史时，顺手把「对方说过自己」的句子挑进结构化记忆。
     挑不出来、或者这一层没起来，都不影响整份恢复的结果。 */
  let historyImport = null
  try {
    if (typeof companionRuntime.factStore?.upsert === 'function') {
      historyImport = await importHistoryFromBackup({
        bundle,
        factStore: companionRuntime.factStore,
        scope: 'desktop',
      })
    }
  } catch (error) {
    bootLog(`[backup] 历史导入没跑成：${String(error?.message ?? error)}`)
  }
  return {
    memoryCount: memoryStore.snapshot().items.length,
    hasSettings: settings !== null,
    historyImport,
  }
}

/*
 * 人格 section：与主题插件的 cyrene:persona 互斥。
 * 主题已注册人格时只记一条日志，不重复注入，省得两套人设打架。
 */
let disposePersonaSection = null

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
  /*
   * 全局 section 会被所有会话共用，分不清桌面向谁开口。
   * 这里只放不随对象变化的七段人格；昵称、记忆、事实、脉络一律留到每轮按来源注入。
   */
  const { text } = buildPersonaPrompt(
    {
      nickname: '',
      companion: { persona: state.persona },
    },
    { scope: 'guest' },
  )
  /*
   * 人格里写着她是怎样的人，那「多容易被点着、多久消气、精力掉多快」
   * 就该跟着这段文字走。每次重挂人格顺带重算自动值；用户的手动覆盖不动。
   * 推导只吃人格本体（七段 + 三个补充维度）：记忆、额外说明、「此刻」里的
   * 性情词都不参与——「今天毒舌一点」是临时要求，不能永久改她的消气时间。
   */
  try {
    const coreText = buildPersonaCoreText({
      nickname: state.nickname,
      companion: { persona: state.persona },
    })
    const derived = deriveTraits(coreText)
    /*
     * 问卷排在关键词前面：自评比「人格里有没有出现某个词」可靠。
     * 手动覆盖仍然单独存、最后压上去，所以这里只合成 auto，不动 overrides。
     */
    const assessmentTraits = readPetAssessmentTraits()
    const merged = mergeTraitSources({
      persona: derived.traits,
      assessment: assessmentTraits ?? {},
    })
    const auto = merged.traits
    const source = assessmentTraits === null ? derived.source : 'assessment'
    /* 念旧倾向只从人格文本推；问卷不产这一项。 */
    const recallBias = Number.isFinite(Number(derived.recallBias))
      ? Math.max(-1, Math.min(1, Number(derived.recallBias)))
      : 0
    const current = state.companionTraits ?? {}
    const sameAuto = JSON.stringify(current.auto ?? {}) === JSON.stringify(auto)
    const sameSource = current.source === source
    const sameBias = Number(current.recallBias ?? 0) === recallBias
    /* 明细一起比：措辞或词表变了但数值恰好没动时，面板也要跟着更新。 */
    const nextDetail = normalizeRecallDetail(derived.recallDetail)
    const sameDetail = JSON.stringify(current.recallDetail ?? null) === JSON.stringify(nextDetail)
    if (sameAuto !== true || sameSource !== true || sameBias !== true || sameDetail !== true) {
      state = {
        ...state,
        companionTraits: {
          auto,
          overrides: current.overrides ?? {},
          source,
          hits: derived.hits,
          recallBias,
          recallDetail: nextDetail,
          traitsVersion: TRAITS_VERSION,
          wordsId: WORDSET_ID,
        },
      }
      /* 自动值变了才落盘：persist 会再挂一次人格，那时值已一致，不会来回递归。 */
      void persist().catch(() => {})
    }
  } catch {
    /* 推导失败就沿用旧参数，不能因为这一步让人格挂不上 */
  }
  /*
   * 主题插件在场时我们也照样注入：陪伴层是本体，主题只负责外观与情境。
   * 两套人设同时出现时，用一句明确声明把优先级放在本段。
   */
  const priorityNote = Number.isFinite(themeOrder)
    ? '以上是此刻的本体人设；与其他来源的人设或设定冲突时，一律以本段为准。'
    : ''
  /*
   * 贴近时刻不挂在这里：systemPrompt 是全局段落，分不清桌面向谁开口，
   * 一挂就会跟着进群聊和陌生人私聊。它只走每轮按 scope 判断的那条通道。
   */
  const parts = [text]
  if (priorityNote !== '') parts.push(priorityNote)
  const fullText = parts.join('\n\n')
  try {
    disposePersonaSection = prompt.section({ name: PERSONA_SECTION, order: PERSONA_ORDER, text: fullText })
  } catch (error) {
    runtimeError = `人格注入失败：${error?.message ?? String(error)}`
  }
}

/*
 * 表情包 section：独立挂载，不挂在 cyrene:companion 上。
 * 主题插件在场时 cyrene:companion 会跳过，附录得自己站住。
 * 地址走宿主的 /cyrene-pet/sticker/<id>，模型原样照抄即可。
 */
const STICKER_SECTION = 'cyrene:stickers'
const STICKER_ORDER = 160
/* 一次最多列多少张：太多会把上下文撑满，也容易让她乱贴 */
const STICKER_APPENDIX_LIMIT = 24
let disposeStickerSection = null

async function buildStickerAppendix() {
  if (state.stickersEnabled === false) return ''
  let items = []
  try {
    items = await stickerLibrary.list()
  } catch (error) {
    hostCtx?.logger?.warn?.(`${PACKAGE_ID}: 读取表情清单失败`, error)
    return ''
  }
  const seen = new Set()
  const picked = []
  for (const item of items) {
    if (item.chat === false) continue
    const label = String(item.label ?? '').trim()
    if (label === '' || seen.has(label)) continue
    seen.add(label)
    picked.push({ label, id: String(item.id ?? '') })
    if (picked.length >= STICKER_APPENDIX_LIMIT) break
  }
  if (picked.length === 0) {
    void bootLog(`[sticker] 清单 ${items.length} 张，但没有可用标签`)
    return ''
  }
  const lines = [
    '【表情包】你有一整套自己的表情图，可以像真人聊天那样，在回复末尾顺手贴一张。',
    '写法：在回复最后单独占一行，写 Markdown 图片，**路径连尖括号一起原样复制**，不要改写、不要自己拼：',
  ]
  /* 走本地绝对路径：DSH 的图片渲染认它，插件的 HTTP 路由不认（会显示「图片无法预览」） */
  let listed = 0
  for (const item of picked) {
    const detail = await stickerLibrary.resolve(item.id).catch(() => null)
    const abs = typeof detail?.abs === 'string' ? detail.abs.replace(/\\/g, '/') : ''
    if (abs === '') continue
    lines.push(`- ${item.label} → ![昔涟·${item.label}](<${abs}>)`)
    listed += 1
  }
  if (listed === 0) {
    void bootLog('[sticker] 清单有图，但一张绝对路径都拿不到')
    return ''
  }
  lines.push('一次最多贴一张；普通闲聊不用硬塞，被逗笑、撒娇、道晚安、被夸、想安慰人的时候比较合适。')
  void bootLog(`[sticker] 附录 ${listed} 条，示例 ${lines[2].slice(0, 140)}`)
  return lines.join('\n')
}

async function mountStickerSection(prompt) {
  if (disposeStickerSection !== null) {
    try {
      disposeStickerSection()
    } catch {
      /* 旧 section 跟着插件 fiber 一起没了 */
    }
    disposeStickerSection = null
  }
  if (!prompt || typeof prompt.section !== 'function') {
    void bootLog('[sticker] 宿主没有 systemPrompt.section，附录无处挂')
    return
  }
  const text = await buildStickerAppendix()
  if (text === '') {
    void bootLog('[sticker] 附录算出来是空的，跳过')
    return
  }
  try {
    disposeStickerSection = prompt.section({ name: STICKER_SECTION, order: STICKER_ORDER, text })
    void bootLog(`[sticker] 附录已挂载 name=${STICKER_SECTION} order=${STICKER_ORDER} bytes=${text.length}`)
  } catch (error) {
    void bootLog(`[sticker] 附录挂载失败：${error?.message ?? String(error)}`)
    hostCtx?.logger?.warn?.(`${PACKAGE_ID}: 表情包 section 注入失败`, error)
  }
}

/* 体检四灯：她回话吗 / 她出声吗 / 她出现吗 / QQ 通吗。
   只回答事实和修法，不替用户改任何设置。红灯点进去直达对应分组。 */
function healthReport() {
  const keyOk = hasVaultKey || credentialAvailable || Boolean(process.env.DEEPSEEK_API_KEY)
  const running = petChild !== null
  const speechOn = state.speechEnabled === true
  const endpoint = String(state.ttsEndpoint ?? '').trim()
  const localTts = state.speechProvider !== 'system'
  const speechOk = speechOn && (localTts ? endpoint !== '' : true)
  const qqView = qqHost.describe()
  const qqReady = state.qq?.enabled === true && String(state.qq?.appId ?? '').trim() !== ''
  const qqConnected = qqView?.connected === true || qqView?.online === true || qqView?.bound === true
  const ui = state.ui === 'card' ? 'card' : 'pet'
  return {
    at: new Date().toISOString(),
    items: [
      {
        id: 'reply',
        label: '她回话吗',
        ok: keyOk && runtimeError === '',
        group: 'system',
        detail: keyOk
          ? (runtimeError === '' ? '模型 key 在，宿主能调用' : `最近一次启动失败：${runtimeError}`)
          : '还没有模型 key',
        fix: keyOk
          ? '看概览里「启动」是否成功；失败原因会写在这一行'
          : '到「系统」填 DeepSeek key，或者让宿主带自己的 key',
      },
      {
        id: 'voice',
        label: '她出声吗',
        ok: speechOk,
        group: 'talk',
        detail: !speechOn
          ? '念出声是关着的'
          : speechOk
            ? (localTts ? `走本机 TTS：${endpoint}` : '走系统语音')
            : '念出声开着，但本机 TTS 地址是空的',
        fix: !speechOn
          ? '到「她怎么说话」把「念出声」打开；TTS 地址可以留空，那就用系统语音'
          : speechOk
            ? '开关和地址都在；没声音就查系统输出设备'
            : '填一个 TTS 地址，例如 http://127.0.0.1:9880',
      },
      {
        id: 'appear',
        label: '她出现吗',
        ok: running,
        group: 'look',
        detail: running
          ? `桌宠在跑，${ui === 'card' ? '卡片形态' : '立绘形态'}`
          : '桌宠没有在运行',
        fix: running
          ? '窗口没看到就点概览里的「重启」'
          : '点概览里的「启动」；素材包不在会自动退成卡片形态，不会白屏',
      },
      {
        id: 'qq',
        label: 'QQ 通吗',
        ok: qqReady && qqConnected,
        group: 'outside',
        detail: qqReady
          ? (qqConnected ? '已连上' : '填了 AppID，但连接没建立')
          : 'QQ 通道没开，或者没填 AppID',
        fix: qqReady
          ? '到「她和外面」检查监听端口和 AppSecret'
          : '到「她和外面」打开 QQ 通道并填 AppID / Secret',
      },
    ],
  }
}

function publicState() {
  return {
    rev: state.rev ?? 0,    version: PLUGIN_VERSION,
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
    theme: state.theme,
    background: effectiveBackground(),
    /* 聊天页外观：皮肤是否接管 token；背景图跟着 background 走 */
    appearance: {
      skin: state.appearance?.skin === 'off' ? 'off' : 'on',
      palette: effectivePalette(),
      /* 模糊只给背景那一层用，0 到 24 像素 */
      bgBlur: Math.min(Math.max(Number(state.appearance?.bgBlur ?? 0) || 0, 0), 24),
    },
    /* 表情包附录开关：默认开，关掉就整段不注入 */
    stickers: { enabled: state.stickersEnabled !== false },
    onboarded: state.onboarded,
    speechProvider: state.speechProvider,
    ttsEndpoint: state.ttsEndpoint,
    ttsRefAudio: state.ttsRefAudio,
    qqVoiceEnabled: state.qqVoiceEnabled === true,
    qqVoiceMode: state.qqVoiceMode,
    qqVoiceWakeWord: state.qqVoiceWakeWord,
    modelId: state.modelId,
    modelNotice: state.modelNotice,
    hudDetail: state.hudDetail,
    showHud: state.showHud,
    scale: state.scale,
    askEveryMinutes: state.askEveryMinutes,
    askHandling: state.askHandling,
    asks: Array.isArray(state.asks) ? state.asks.slice(-30) : [],
    bondEnabled: state.bondEnabled,
    companionPeers: state.companionPeers,
    companionTraits: describeTraits(
      resolveTraits({
        auto: state.companionTraits?.auto,
        overrides: state.companionTraits?.overrides,
      }).detail
    ),
    companionAxes: state.companionAxes,
    openingEnabled: state.openingEnabled,
    intimacy: state.intimacy,
    intimacyEdition: IS_PUBLIC_EDITION ? 'public' : 'qiqi',
    memoryEnabled: state.memoryEnabled,
    /* 条数真值下发：面板「每轮最多收 N 条」读这里，禁字面量（check-memory-ownership R5/R6） */
    memoryPerRoundLimit: PER_ROUND_LIMIT,
    /* 记忆台当前视图；all 只有主人能开，非主人会在前端回落到 owner */
    memoryViewMode: state.memoryViewMode === 'all' ? 'all' : 'owner',
    memoryBridgePrivate: state.memoryBridgePrivate === true,
    memoryBridgeGroup: state.memoryBridgeGroup === true,
    memoryFirstWriteAt: state.memoryFirstWriteAt,
    memoryNoticeDismissed: state.memoryNoticeDismissed,
    /* 13 槽：元数据 + 当前开关，设置页与记忆台都从这里取词表 */
    memorySlots: MEMORY_SLOTS.map((slot) => ({
      id: slot.id,
      name: slot.name,
      description: slot.description,
      reserved: slot.reserved === true,
      on: activeMemorySlotIds().includes(slot.id),
    })),
    memoryVaulted: true,
    memoryVaultError,
    boundSessionId: state.boundSessionId,
    /* C 阶段：设置页导航与控件元数据（schema 单一事实源，设置页只消费不重复登记） */
    settingsGroups: SCHEMA_GROUPS,
    settingsFields: SCHEMA_FIELDS.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      group: field.group,
      section: field.section,
      hint: field.hint ?? '',
      effect: field.effect ?? 'live',
      deps: Array.isArray(field.deps) ? field.deps : [],
      options: Array.isArray(field.options) ? field.options : undefined,
      min: field.min,
      max: field.max,
      step: field.step,
      maxLength: field.maxLength,
      danger: field.danger === true,
      writeGroup: Array.isArray(field.writeGroup) ? field.writeGroup : [],
      default: field.default,
      i18n: field.i18n ?? '',
    })),
    settingsDisclaimer: DISCLAIMER,
    /* 视觉标签：hasApiKey 只是「有没有填过」，key 本身不出加密仓库 */
    vision: {
      enabled: state.vision?.enabled === true,
      baseUrl: state.vision?.baseUrl ?? '',
      model: state.vision?.model ?? '',
      hasApiKey: state.vision?.hasApiKey === true,
    },
    syncEnabled: state.syncToken !== '',
    /* 非敏感配置回给本机设置页；AppSecret 不在里面 */
    qq: state.qq,
    qqView: qqHost.describe(),
    statePath: STATE_PATH,
  }
}

/* ------------------------------ 余额与记账 ------------------------------ */

function beijingDayKey(now = new Date()) {
  const bj = new Date(now.getTime() + 8 * TIME.HOUR)
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

/* DSH 凭据回退（ISSUE-002 / t322）。
 *
 * 抽成独立函数有两个理由，都不 cosmetic：
 * 1. 这段以前埋在 resolveApiKey 里，只要面板填过 key 就永远走不到 ——
 *    本机测一百遍都是绿的，照不到外部用户那条「没填 key」的路。
 *    抽出来才能被 check-host-paths.mjs 单独调用，按「先造出那条路，
 *    再看它红不红、修完转不转绿」的方式验收。
 * 2. 以前底下是个空 catch，把 ReferenceError 和「真的没有凭据文件」
 *    揉成同一个「还没有设置 API Key」。现在按结果分类返回，坏在代码
 *    就走 error 分支上报，不再冒充配置问题。
 *
 * 返回形状：{ ok, key?, reason, detail? }
 *   hit        拿到 key
 *   no-file    .credentials.yaml 不存在（正常情况，静默可接受）
 *   no-key     文件在，但 refs 段里没有 DEEPSEEK_API_KEY（配置不全）
 *   unreadable 文件读不出来（权限／损坏 —— 要告诉用户）
 *   error      其它异常，含代码自己的 bug —— 必须上报，不许吞
 */
export function resolveApiKeyFromDshCredentials (home = DSH_HOME) {
  const file = join(home, '.credentials.yaml')
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ok: false, reason: 'no-file', file }
    }
    return { ok: false, reason: 'unreadable', file, detail: error?.message ?? String(error) }
  }

  try {
    const match = text.match(/DEEPSEEK_API_KEY:\s*(\S+)/)
    if (match !== null && match[1]) {
      return { ok: true, key: match[1].trim(), reason: 'hit', file }
    }
    return { ok: false, reason: 'no-key', file }
  } catch (error) {
    // 走到这里说明代码本身坏了（以前就是这个位置被空 catch 吞掉的）。
    // 记一笔再返回，让它在 boot.log 里看得见，不再伪装成用户没配置。
    void bootLog(`credentials 解析异常 reason=${error?.message ?? String(error)}`)
    return { ok: false, reason: 'error', file, detail: error?.message ?? String(error) }
  }
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

  const fromCreds = resolveApiKeyFromDshCredentials()
  if (fromCreds.ok === true && typeof fromCreds.key === 'string' && fromCreds.key !== '') {
    credentialAvailable = true
    return fromCreds.key
  }
  /* 只有真的存在凭据文件却读不出 key 的情况才值得吵一句；
     「本机压根没有 .credentials.yaml」是正常状态，不必打扰。 */
  if (fromCreds.reason === 'error' || fromCreds.reason === 'unreadable') {
    void bootLog(`凭据回退失败 reason=${fromCreds.reason} file=${fromCreds.file} detail=${fromCreds.detail ?? ''}`)
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
  const ttl = Math.max(15 * TIME.SECOND, Math.min(5 * TIME.MINUTE, (Number(state.refreshSeconds) || 30) * TIME.SECOND))
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
const BACKGROUND_MAX_BYTES = 12 * 1024 * 1024
/* 内置壁纸跟着发行物走，换版本会一起更新；用户上传的留在数据目录。 */
const BUILTIN_BACKGROUND_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'backgrounds'
)
const BUILTIN_BACKGROUND_PREFIX = 'builtin-'

function safeBackgroundId(name) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name) ? name : ''
}

/* 数据目录的自定义图 + 发行物里的内置图；名字重复时以数据目录为准 */
async function listBackgrounds() {
  const items = []
  const seen = new Set()
  const scanDir = async (dir, builtin) => {
    let names = []
    try {
      names = await readdir(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (safeBackgroundId(name) === '' || seen.has(name)) continue
      const type = BACKGROUND_TYPES[extname(name).toLowerCase()]
      if (type === undefined) continue
      try {
        const info = await stat(join(dir, name))
        if (!info.isFile()) continue
        seen.add(name)
        items.push({
          id: name,
          size: info.size,
          type,
          builtin,
          addedAt: Math.round(info.mtimeMs)
        })
      } catch {
        /* 单张读不到就跳过，不影响整份清单 */
      }
    }
  }
  await scanDir(BACKGROUND_DIR, false)
  await scanDir(BUILTIN_BACKGROUND_DIR, true)
  items.sort((a, b) => a.addedAt - b.addedAt)
  return items
}

async function saveBackground(body) {
  const raw = typeof body?.dataUrl === 'string' ? body.dataUrl : ''
  const match = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(raw)
  if (match === null) throw new Error('图片格式不对，请重新选择')
  const ext = Object.keys(BACKGROUND_TYPES).find((key) => BACKGROUND_TYPES[key] === match[1].toLowerCase())
  if (ext === undefined) throw new Error('只支持 PNG / JPG / GIF / WebP / AVIF')
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length === 0) throw new Error('图片是空的')
  if (bytes.length > BACKGROUND_MAX_BYTES) throw new Error('图片超过 12MB，换一张小一点的吧')
  await mkdir(BACKGROUND_DIR, { recursive: true })
  const name = `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`
  await writeFile(join(BACKGROUND_DIR, name), bytes)
  return { id: name, size: bytes.length, type: BACKGROUND_TYPES[ext] }
}

async function removeBackground(id) {
  const name = safeBackgroundId(id)
  if (name === '') throw new Error('背景名不合法')
  if (name.startsWith(BUILTIN_BACKGROUND_PREFIX)) throw new Error('内置壁纸不能删除，换一张就好')
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
    /* 先找用户上传的，找不到再回落到内置壁纸 */
    let file = join(BACKGROUND_DIR, id)
    let info = await stat(file).catch(() => null)
    if (info === null) {
      file = join(BUILTIN_BACKGROUND_DIR, id)
      info = await stat(file).catch(() => null)
    }
    if (info === null || !info.isFile()) throw new Error('不是文件')
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

/* ---------------------------- 自定义表情包 ---------------------------- */

const CUSTOM_STICKER_DIR = join(STICKER_ROOT, 'custom')
const CUSTOM_STICKER_MAX_BYTES = 8 * 1024 * 1024
/** 一次导入最多收这么多张，超出的让用户分批来，别一口气把盘吃满。 */
const CUSTOM_STICKER_IMPORT_LIMIT = 200
const CUSTOM_STICKER_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

function stickerExtOf(name) {
  return String(name ?? '').slice(String(name ?? '').lastIndexOf('.')).toLowerCase()
}

/** 文件名只留安全字符：中文、字母、数字照留，路径分隔符和保留字符压成下划线。 */
function safeStickerStem(raw, fallback = 'sticker') {
  const text = String(raw ?? '')
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
  return text === '' ? fallback : text
}

/** 同目录不重名：foo.jpg 已存在就变 foo-2.jpg。 */
async function uniqueStickerPath(stem, ext) {
  for (let index = 0; index < 1000; index += 1) {
    const name = index === 0 ? `${stem}${ext}` : `${stem}-${index + 1}${ext}`
    const abs = join(CUSTOM_STICKER_DIR, name)
    const exists = await stat(abs).then(() => true).catch(() => false)
    if (!exists) return abs
  }
  throw new Error('同名文件太多，换个名字')
}

function decodeStickerDataUrl(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl ?? ''))
  if (match === null) return null
  const type = match[1].toLowerCase()
  const ext =
    type === 'image/png'
      ? '.png'
      : type === 'image/gif'
        ? '.gif'
        : type === 'image/webp'
          ? '.webp'
          : '.jpg'
  return { ext, buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64') }
}

/** 目录里已经有内容一样的图，就不再落第二份。 */
async function findCustomByDigest(digest) {
  const entries = await readdir(CUSTOM_STICKER_DIR, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!CUSTOM_STICKER_EXT.has(stickerExtOf(entry.name))) continue
    const bytes = await readFile(join(CUSTOM_STICKER_DIR, entry.name)).catch(() => null)
    if (bytes === null) continue
    if (createHash('sha1').update(bytes).digest('hex') === digest) {
      return join(CUSTOM_STICKER_DIR, entry.name)
    }
  }
  return null
}

/** 落一张自定义表情；内容重复直接返回已有的那张，不写第二次。 */
async function saveCustomSticker({ buffer, ext, name }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('这张图是空的')
  if (buffer.length > CUSTOM_STICKER_MAX_BYTES) throw new Error('单张不能超过 8MB')
  if (!CUSTOM_STICKER_EXT.has(ext)) throw new Error('只支持 png / jpg / gif / webp')

  await mkdir(CUSTOM_STICKER_DIR, { recursive: true })
  const digest = createHash('sha1').update(buffer).digest('hex')
  const duplicate = await findCustomByDigest(digest)
  if (duplicate !== null) {
    const relative = duplicate.slice(CUSTOM_STICKER_DIR.length + 1)
    return { id: `custom:${relative}`, duplicate: true }
  }
  const abs = await uniqueStickerPath(safeStickerStem(name), ext)
  await writeFile(abs, buffer)
  stickerLibrary.invalidate()
  return { id: `custom:${abs.slice(CUSTOM_STICKER_DIR.length + 1)}`, duplicate: false }
}

/** 从一个文件夹批量收图：只认图片，单次最多 200 张。 */
async function importCustomStickers(sourceDir) {
  const dir = String(sourceDir ?? '').trim()
  if (dir === '') throw new Error('要给一个文件夹路径')
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => {
    throw new Error('这个文件夹打不开')
  })
  const files = entries.filter(
    (entry) => entry.isFile() && CUSTOM_STICKER_EXT.has(stickerExtOf(entry.name))
  )
  const taken = files.slice(0, CUSTOM_STICKER_IMPORT_LIMIT)
  const saved = []
  let skipped = 0
  for (const entry of taken) {
    const bytes = await readFile(join(dir, entry.name)).catch(() => null)
    if (bytes === null || bytes.length > CUSTOM_STICKER_MAX_BYTES) {
      skipped += 1
      continue
    }
    const result = await saveCustomSticker({
      buffer: bytes,
      ext: stickerExtOf(entry.name),
      name: entry.name
    })
    if (result.duplicate === true) skipped += 1
    else saved.push(result.id)
  }
  return { saved, skipped, exceeded: files.length > taken.length }
}

/** 只动 custom 目录里的文件；内置素材不归这里管。 */
function customStickerPath(rawId) {
  const id = String(rawId ?? '').trim()
  if (!id.startsWith('custom:')) throw new Error('只能改自己收的表情')
  const relative = id.slice('custom:'.length)
  if (relative === '' || relative.includes('/') || relative.includes('\\')) {
    throw new Error('这张表情找不到')
  }
  return { id, abs: join(CUSTOM_STICKER_DIR, relative) }
}

async function renameCustomSticker(rawId, rawName) {
  const { id, abs } = customStickerPath(rawId)
  const info = await stat(abs).catch(() => null)
  if (info === null || !info.isFile()) throw new Error('这张表情已经不在了')
  const ext = stickerExtOf(abs)
  const stem = safeStickerStem(rawName)
  if (`${stem}${ext}` === abs.slice(CUSTOM_STICKER_DIR.length + 1)) return { id }
  const target = await uniqueStickerPath(stem, ext)
  await rename(abs, target)
  stickerLibrary.invalidate()
  return { id: `custom:${target.slice(CUSTOM_STICKER_DIR.length + 1)}` }
}

async function deleteCustomSticker(rawId) {
  const { id, abs } = customStickerPath(rawId)
  const info = await stat(abs).catch(() => null)
  if (info === null || !info.isFile()) throw new Error('这张表情已经不在了')
  await rm(abs, { force: true })
  stickerLibrary.invalidate()
  return { removed: id }
}

/** 设置页要能直接预览：给本地绝对路径，转成 file:// 给 <img> 用。 */
async function listCustomStickers() {
  const items = await stickerLibrary.list()
  const rows = []
  for (const item of items) {
    if (item.packId !== 'custom') continue
    const detail = await stickerLibrary.resolve(item.id).catch(() => null)
    const abs = typeof detail?.abs === 'string' ? detail.abs.replace(/\\/g, '/') : ''
    rows.push({ ...item, href: abs === '' ? '' : `file:///${abs}` })
  }
  return rows
}

/* 表情文件只按表情库里的 id 还原，不接受任意路径。 */
async function sendSticker(res, rawId) {
  const id = decodeURIComponent(String(rawId ?? ''))
  try {
    const item = await stickerLibrary.resolve(id)
    if (item === null) throw new Error('没有这张表情')
    const info = await stat(item.abs)
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error('表情不可用')
    const body = await readFile(item.abs)
    res.statusCode = 200
    res.setHeader('content-type', item.contentType)
    res.setHeader('cache-control', 'private, max-age=3600')
    res.setHeader('x-content-type-options', 'nosniff')
    res.end(body)
  } catch {
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '没有这张表情' } })
  }
}

/* 待审图原样给出去：路径由 inbox 自己校验，只认单层文件名。 */
async function sendInboxFile(res, rawName) {
  try {
    const target = await stickerInbox.resolvePath(rawName)
    if (target === null) throw new Error('不在待审目录')
    const info = await stat(target)
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error('待审图不可用')
    const ext = extname(target).toLowerCase()
    const type =
      ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    const body = await readFile(target)
    res.statusCode = 200
    res.setHeader('content-type', type)
    res.setHeader('cache-control', 'private, max-age=60')
    res.setHeader('x-content-type-options', 'nosniff')
    res.end(body)
  } catch {
    sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '没有这张待审图' } })
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
/* 「桌宠还活着」的短期缓存：DSH 重启后 petChild 句柄会丢，桌宠却是
   detached + unref 还活着的，只能按 PID 名单去捞。捞一次要跑 PowerShell，
   审批不会每秒来，缓存 15 秒够用，也不至于一直空转。 */
const PET_ALIVE_TTL = 15000
let petAliveCheckedAt = 0
let petAliveCached = false
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
    localTtsVetoUntil = Date.now() + TIME.MINUTE
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

/**
 * QQ 里补一条语音。
 *
 * 文字已经发出去了，这里只负责「再念一遍」。任何一步不成只记一笔，
 * 不回滚、不重发文字，也不会让语音失败把整轮回复拖垮。
 * 群聊不发：一条语音在群里能被所有人点开，私聊才合适。
 */
async function speakToQqChat(text, event, target) {
  if (state.qqVoiceEnabled !== true) return { ok: false, reason: 'disabled' }
  if (event?.kind === 'group') return { ok: false, reason: 'group-skip' }

  const spoken = filterOutboundText(text).replace(/\s+/g, ' ').trim()
  if (spoken === '') return { ok: false, reason: 'empty' }

  /* 触发词可以填一组：按顿号、逗号、空白拆开，任一说中就算。 */
  const wakeWords = String(state.qqVoiceWakeWord ?? '')
    .split(/[、,，;；\s]+/)
    .map((word) => word.trim())
    .filter((word) => word !== '')
  if (state.qqVoiceMode !== 'always' && wakeWords.length > 0) {
    const heard = String(event?.content ?? '')
    if (!wakeWords.some((word) => heard.includes(word))) {
      return { ok: false, reason: 'no-wake-word' }
    }
  }

  const endpoint = String(state.ttsEndpoint ?? '').trim()
  const refAudioPath = String(state.ttsRefAudio ?? '').trim()
  if (endpoint === '') return { ok: false, reason: 'no-endpoint' }
  /* 本地 TTS 要参考音频才能出她的声音；没配就不硬凑一个陌生的腔调。 */
  if (refAudioPath === '') return { ok: false, reason: 'no-ref-audio' }

  const result = await synthesizeSpeech({
    endpoint,
    text: spoken.slice(0, 200),
    refAudioPath,
    timeoutMs: 30000,
  })
  if (result.ok !== true) {
    void bootLog(`[qq] 语音没合成出来：${result.error ?? 'unknown'}`)
    return { ok: false, reason: result.error }
  }

  const silk = await wavToSilk(result.audio)
  if (silk.ok !== true) {
    void bootLog(`[qq] 语音转码失败：${silk.error ?? 'unknown'}`)
    return { ok: false, reason: silk.error }
  }

  const sent = await qqHost.sendVoice(silk.silk, target)
  if (sent.ok !== true) {
    void bootLog(`[qq] 语音没发出去：${sent.reason ?? 'unknown'}`)
    return { ok: false, reason: sent.reason }
  }
  return { ok: true, durationMs: silk.durationMs }
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

/* 宿主 exe 的定位（ISSUE-001 / t321）。
 *
 * 以前只猜三个固定位置：DSH_DESKTOP_EXE 环境变量、LOCALAPPDATA\Programs、
 * PROGRAMFILES。DSH 装在别处又没配环境变量就一律落空，用户只看到一句
 * 「没有找到 DeepSeek Harness 桌面端，桌宠暂时起不来」，却不知道我们
 * 到底找过哪儿 —— 公开库 issue #1 就是这么撞上的。
 *
 * 现在第一候选换成 process.execPath：插件本来就加载在 DSH 自己的
 * Electron 主进程里，实测 2026-11-23 15:45 宿主 pid=50576 的命令行
 * argv[0] 与 ExecutablePath 一致，都是那个 DeepSeek Harness.exe 全路径。
 * 用它兜底比猜安装目录准，也天然覆盖「装在非默认位置」这一整类。
 *
 * 两处防御写在这里，别等下次再补：
 *   1. execPath 若落在 runtime 副本目录内则不用 —— 那是我们自己复制的
 *      一份，拿它当源等于把副本喂给副本，ensureRuntime 会自我喂养。
 *   2. execPath 还必须 basename 就是 DeepSeek Harness.exe 才认。
 *      这条不是洁癖：execPath 之所以能当宿主 exe，前提是本插件跑在 DSH 的
 *      Electron 主进程里；同一段代码哪天在裸 node 下执行（自检脚本、CLI、
 *      将来拆分出的 domain），execPath 就变成 node.exe，不拦的话会把
 *      node 的安装目录当成 DSH 安装位整份复制进 runtime。
 *   3. 找过的每一处都留在 lastDesktopExeAttempts，抛错时一并带出去，
 *      让「起不来」这句话第一次能说清是自己没找到、还是真没装。
 *
 * 参数全部可注入，为的是「DSH 装在非默认位置」这个场景能被脚本造出来 ——
 * 本机 DSH 就装在默认位，真机怎么跑都照不到这一类。见 scripts\check-desktop-exe.mjs。
 */
const HOST_EXE_NAME = 'deepseek harness.exe'
let lastDesktopExeAttempts = []

export async function findDesktopExe (opts = {}) {
  const env = opts.env ?? process.env
  const execPath = typeof opts.execPath === 'string' ? opts.execPath : (process.execPath ?? '')
  const exists = opts.exists ?? existsSync
  const runtimeDir = opts.runtimeDir ?? RUNTIME_DIR

  const attempts = [
    ['env:DSH_DESKTOP_EXE', env.DSH_DESKTOP_EXE ?? ''],
    ['process.execPath', execPath],
    ['env:LOCALAPPDATA', env.LOCALAPPDATA
      ? join(env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe')
      : ''],
    ['env:PROGRAMFILES', env.PROGRAMFILES
      ? join(env.PROGRAMFILES, 'DeepSeek Harness', 'DeepSeek Harness.exe')
      : ''],
  ]

  lastDesktopExeAttempts = attempts.map(([label, value]) => `${label}=${value || '(空)'}`)

  const runtimePrefix = String(runtimeDir).toLowerCase()
  for (const [label, candidate] of attempts) {
    if (typeof candidate !== 'string' || candidate === '') continue
    if (candidate.toLowerCase().startsWith(runtimePrefix)) {
      void bootLog(`宿主 exe 跳过 ${label}：指向 runtime 副本自身，不能拿来当源`)
      continue
    }
    if (label === 'process.execPath'
      && basename(candidate).toLowerCase() !== HOST_EXE_NAME) {
      void bootLog(`宿主 exe 跳过 process.execPath：文件名是 ${basename(candidate)}，不是宿主`)
      continue
    }
    if (exists(candidate)) {
      void bootLog(`宿主 exe 命中 ${label} :: ${candidate}`)
      return candidate
    }
  }
  void bootLog(`宿主 exe 全部落空，找过 ${lastDesktopExeAttempts.join(' | ')}`)
  return ''
}

/* 只给自检脚本读，不参与业务 */
export function desktopExeAttemptsForTest () {
  return [...lastDesktopExeAttempts]
}

async function ensureRuntime() {
  if (existsSync(PET_EXE) && existsSync(PET_ENTRY)) return
  const source = await findDesktopExe()
  if (source === '') {
    throw new Error(
      '没有找到 DeepSeek Harness 桌面端，桌宠暂时起不来'
      + `（已找过：${lastDesktopExeAttempts.join(' / ') || '无候选路径'}）`,
    )
  }

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
  /* 归属标记：桌宠读到 plugin 就只做「从属实例」，退出时不会把设置写回去抢主控。
     独立双击启动时没有这个变量，它会退回只读模式并提示用户从 DSH 里开。 */
  env.DSH_PET_HOST = 'plugin'
  return env
}

/* 捞出所有活着的桌宠主进程 PID：只看 runtime 里的主进程，排除 --type= 的子进程。
   DSH 重启后 petChild 句柄会丢，桌宠却是 detached + unref 的还活着，
   只能靠命令行把它捞回来 —— stopPet 要靠这份名单才能真正杀掉旧实例。
   --dsh-pet-owner=dsh 是 DSH 拉起时写进命令行的独占标记：Cyrene 宿主拉起的
   实例没有这个参数，不能被 DSH 认领，更不能被 stopPet 误杀。
   查不到就返回空数组，不让检测本身挡住启动。 */
function findPetPids() {
  return new Promise((resolve) => {
    try {
      execFile(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | Where-Object { $_.CommandLine -like '*cyrene-pet*runtime*' -and $_.CommandLine -like '*--dsh-pet-owner=dsh*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $_.ProcessId }",
        ],
        { windowsHide: true, timeout: 5000 },
        (error, stdout) => {
          if (error) {
            resolve([])
            return
          }
          resolve(
            String(stdout ?? '')
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => /^\d+$/.test(line))
              .map((line) => Number(line)),
          )
        },
      )
    } catch {
      resolve([])
    }
  })
}

/* 同样指向 cyrene-pet/runtime、但没有 DSH 独占标记的桌宠实例。
   典型来源是 Cyrene 宿主拉起的实例。这里只识别，不接管、不终止：
   宿主实例不归 DSH 管，发现它时应提示用户先关闭，而不是静默 skip。 */
function findForeignPetPids() {
  return new Promise((resolve) => {
    try {
      execFile(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | Where-Object { $_.CommandLine -like '*cyrene-pet*runtime*' -and $_.CommandLine -notlike '*--dsh-pet-owner=dsh*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $_.ProcessId }",
        ],
        { windowsHide: true, timeout: 5000 },
        (error, stdout) => {
          if (error) {
            resolve([])
            return
          }
          resolve(
            String(stdout ?? '')
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => /^\d+$/.test(line))
              .map((line) => Number(line)),
          )
        },
      )
    } catch {
      resolve([])
    }
  })
}

async function existingPetAlive() {
  return (await findPetPids()).length > 0
}

/* 杀一整棵进程树。petChild.kill() 发的是 SIGTERM，Electron 主进程在 Windows 上
   常常不理，GPU / renderer / utility 子进程更不会跟着走；
   结果就是旧实例还占着单实例锁，startPet 只能 skip。taskkill /F /T 才是管用的那把。 */
function killPidTree(pid) {
  return new Promise((resolve) => {
    try {
      execFile(
        'taskkill',
        ['/F', '/T', '/PID', String(pid)],
        { windowsHide: true, timeout: 8000 },
        () => resolve(true),
      )
    } catch {
      resolve(false)
    }
  })
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function startPet() {
  if (petChild !== null || state.enabled !== true) {
    void bootLog(`startPet skip (petChild=${petChild !== null}, enabled=${state.enabled})`)
    return
  }
  void (async () => {
    try {
      await ensureRuntime()
      /* 桌宠是常驻的：DSH 重启后上一份可能还活着（detached + unref）。
         这时再 spawn 只会被单实例锁挡回去，插件却会以为桌宠没起来。
         先看一眼有没有活着的同目录主进程，有就当作已连接。 */
      if (await existingPetAlive()) {
        /* 这里已经捞过名单了，顺手把结论喂给缓存：
           DSH 重启后第一次审批不必再跑一次 PowerShell。 */
        petAliveCached = true
        petAliveCheckedAt = Date.now()
        void bootLog('startPet skip: 已有 DSH 自己的桌宠实例在跑，不再拉起第二份')
        runtimeError = ''
        return
      }
      /* 没有 DSH 自己的实例，但桌面上可能还挂着 Cyrene 宿主拉起的实例。
         两者共用同一个 userData 单实例锁，直接 spawn 会被挡回去，插件却会误报「启动失败」。
         宿主实例不归 DSH 管：只提示用户先关闭，不接管、不终止。 */
      const foreign = await findForeignPetPids()
      if (foreign.length > 0) {
        runtimeError = `检测到由 Cyrene 宿主拉起的桌宠实例（PID ${foreign.join(', ')}）。请先关闭它，再从 DSH 启动；DSH 不会接管或终止宿主实例。`
        void bootLog(`startPet blocked by foreign pet pids=${foreign.join(',')}`)
        hostCtx?.logger?.warn?.(`${PACKAGE_ID}: ${runtimeError}`)
        return
      }
      const fd = spawnLogFd()
      /* 带上自己的 pid：桌宠会盯着它，DSH 被强杀也能跟着退，不留孤儿进程。
         --dsh-pet-owner=dsh 是归属标记：findPetPids 只认带它的实例，
         Cyrene 宿主拉起的实例不会被 DSH 认领，也不会被 stopPet 误杀。 */
      petChild = spawn(PET_EXE, ['--no-sandbox', `--user-data-dir=${STATE_DIR}`, `--parent-pid=${process.pid}`, '--dsh-pet-owner=dsh'], {
        detached: true,
        stdio: ['ignore', fd, fd],
        windowsHide: true,
        env: petSpawnEnv(),
      })
      petAliveCached = true
      petAliveCheckedAt = Date.now()
      void bootLog(`startPet spawned pid=${petChild.pid}`)
      petChild.on('error', (error) => {
        void bootLog(`pet error: ${error?.message ?? String(error)}`)
      })
      petChild.on('exit', (code, signal) => {
        void bootLog(`pet exit code=${code} signal=${signal}`)
        petChild = null
        /* 自己拉起的这份退了，不代表桌面上没有别的实例（比如用户另开了一份），
           作废时间戳，下一轮按 PID 名单重新判一次。 */
        petAliveCheckedAt = 0
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

/* 重启的防抖世代：连着来两次 restart 时，只有最后一次真的拉起桌宠。
   原先靠 clearTimeout 取消上一个 600ms 定时器做到这件事；
   停进程改成异步之后，改用世代号对账。 */
let restartGeneration = 0

function restartPet() {
  clearTimeout(restartTimer)
  restartTimer = null
  restartGeneration += 1
  const generation = restartGeneration
  void (async () => {
    /* 不再猜固定延时：等进程树真的清空了再拉起。
       旧实例还占着单实例锁时，startPet 只会 skip，桌宠就再也起不来了。 */
    await stopPet()
    if (generation !== restartGeneration) return
    startPet()
  })()
}

/* 把桌宠彻底停下来。
   kill 句柄只是礼貌请求，真正管用的是按 PID 杀整棵树；杀完还要等进程确实退出，
   否则 startPet 会被 existingPetAlive 挡回去，表现就是「重启完桌宠没了」。
   petChild 为 null 时也要往下走 —— DSH 重启后句柄丢了，detached 的旧桌宠还活着，
   这种情况恰恰最需要按名单杀。 */
async function stopPet() {
  const childPid = typeof petChild?.pid === 'number' ? petChild.pid : null
  if (petChild !== null) {
    try {
      petChild.kill()
    } catch {
      /* 进程已退出 */
    }
    petChild = null
  }

  const found = await findPetPids()
  const targets = [...new Set(childPid === null ? found : [childPid, ...found])]
  for (const pid of targets) {
    await killPidTree(pid)
  }
  if (targets.length > 0) {
    void bootLog(`stopPet killed pids=${targets.join(',')}`)
  }

  /* 按总时长兜底，不按次数：findPetPids 每次要跑一趟 PowerShell + CIM 查询，
     耗时不稳定，写死次数最坏能拖到半分钟，把 HTTP stop 的响应一起卡住。 */
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    if ((await findPetPids()).length === 0) return true
    await sleepMs(250)
  }
  void bootLog('stopPet: 6 秒后进程仍在，startPet 会再判一次')
  return false
}

/* ---------------------------- 陪伴层 ---------------------------- */

/*
 * 好感 / 记忆 / 开口账本都落在 STATE_DIR 下的独立 JSON，不走 state.json。
 * 运行节奏本体在 companion-runtime.mjs，这里只把宿主状态注入进去。
 */
const companionRuntime = createCompanionRuntime({
  dir: STATE_DIR,
  memoryStore,
  isBondEnabled: () => state.bondEnabled !== false && axisOn('relation'),
  isOpeningEnabled: () =>
    state.openingEnabled !== false &&
    axisOn('proactive') &&
    state.enabled === true,
  isBodyEnabled: () => bodyLayerOn(),
  isPetRunning: () => petChild !== null,
  getSessionView: () => activeSessionView,
  getSettings: () => {
    /* 开关与节奏只认 settings.json 那一份；读不到才退回插件自己的旧值。 */
    const petIntimacy = readPetIntimacy()
    const intimacy = petIntimacy ?? state.intimacy ?? {}
    return {
      companion: {
        emotion: state.emotionSettings ?? {},
        body: state.bodySettings ?? {},
        /* 公开版无论文件里写了什么，运行时都不放行。 */
        intimacy: IS_PUBLIC_EDITION ? { ...intimacy, enabled: false } : intimacy,
        /* 气泡句末温度：只在这一处判，关掉后后处理整条不生效。 */
        bubbleTone: state.companion?.bubbleTone !== false,
      },
      /*
       * 两处位置原样交出，空字符串不在这里补默认城市：
       * 她那边回落到哪由运行时决定，主人侧留空就是不关心，不猜。
       *
       * A2-10：这一段以前只认 state.presence 那五个键，settings.json 里的 presence 段
       * 从来没被读过 —— 安静时段、每日上限、沉默天数、天气开关就是假旋钮。
       * intimacy 有 readPetIntimacy() 走文件这条路，presence 照着补一手；
       * 组装本身挪进 hostPresenceView()，那五是外壳独占字段仍以 state 为准，
       * 文件段只补它管不着的那四类，嵌套与 schema 展平两种写法都认（沿用闸门那一套识别）。
       */
      presence: hostPresenceView({
        statePresence: state.presence,
        fileSettings: readPetSettingsFile()
      }),
      /* 性格参数与四轴灵敏度不挂在 companion 下，运行时单独取。 */
      companionTraits: state.companionTraits,
      companionAxes: axesNow(),
      /* 同伴名单的真身在密封仓库；构造期还没赋值时退回 state 里的副本。 */
      companionPeers: (() => {
        try {
          return companionRuntime.getPeerTiers()
        } catch {
          return state.companionPeers ?? {}
        }
      })(),
    }
  },
  getPersonaText: () => {
    maybeRefreshPromptReflections()
    return buildPersonaPrompt({
      nickname: state.nickname,
      companion: { persona: state.persona },
      reflections: reflectionsForPrompt(promptReflectionGroups, { memoryOn: axisOn('memory') }),
    }).text
  },
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

/*
 * facts 是异步读盘的：启动时先把摘要补进人格，等 load 完成后再重挂一次。
 * 这里不阻塞挂载，读失败就按空的继续。
 */
const factsReady = companionRuntime.factStore?.load?.()
if (factsReady && typeof factsReady.catch === 'function') {
  void factsReady.catch(() => {})
}

/*
 * 反思日记由桌面端写入；DSH 这边只回读，不重写。
 * 只缓存最近几天的印象，主人这条线才注入，群里和访客拿不到。
 */
const REFLECTION_DIR = join(STATE_DIR, 'notes', 'reflection')
let promptReflectionGroups = []
let reflectionCheckedAt = Date.now()

async function refreshPromptReflections() {
  promptReflectionGroups = await readRecentReflections({
    fs: { readdir, readFile },
    path: { join },
    dir: REFLECTION_DIR,
    days: REFLECTION.readDays,
    linesPerDay: REFLECTION.readLinesPerDay,
    maxChars: REFLECTION.readMaxChars,
  })
  reflectionCheckedAt = Date.now()
}

/* 最多一小时回读一次：桌面端可能在插件运行期间写了新日记。 */
function maybeRefreshPromptReflections() {
  if (Date.now() - reflectionCheckedAt < REFLECTION.refreshMs) return
  reflectionCheckedAt = Date.now()
  void refreshPromptReflections().catch(() => {})
}

void refreshPromptReflections().catch(() => {})

/* 隐私模式：默认开着，只有主人取消勾选才关。 */
/* 13 槽当前生效开关：未自定义时按槽表默认（启用 7 开、备用 6 关） */
function activeMemorySlotIds() {
  return effectiveSlotIds(state?.memorySlots)
}

/* 注入侧只按来源隔离。隐私模式管的是「QQ 内容能不能落记忆」，管不到这里。 */
function memoryItemsFor(source) {
  let items = []
  try {
    items = companionRuntime.memory.snapshot().items
  } catch {
    items = []
  }
  return filterMemoryItemsForSource(items, source, activeMemorySlotIds(), {
    ownerPrivate: state.memoryBridgePrivate === true,
    ownerGroup: state.memoryBridgeGroup === true,
    ownerAll: state.memoryViewMode === 'all',
  })
}

/* 主人桶能不能在这一路出现：桌面始终可以，QQ 私聊与群聊分别由两个开关控制。 */
function ownerBridgeAllows(source) {
  return ownerBridgeAllowsFor(source, {
    ownerPrivate: state.memoryBridgePrivate === true,
    ownerGroup: state.memoryBridgeGroup === true,
  })
}

/* 心情只属于主人这一路；群聊与陌生人拿不到她的私人心绪。 */
function moodStateFor(source, scope) {
  if (personaScopeOf(scope, source) !== 'owner') return { mood: '', moodKey: '' }
  try {
    const snapshot = companionRuntime.snapshot()
    let mood = typeof snapshot?.mood?.label === 'string' ? snapshot.mood.label : ''
    let moodKey = typeof snapshot?.mood?.key === 'string' ? snapshot.mood.key : ''
    /*
     * 当前情绪比心情底色更具体：它只改这一轮的语气与小事排序，
     * 不反向改关系分，也不越权替人格决定大事。
     */
    const emotionKey = typeof snapshot?.emotion?.emotion === 'string' ? snapshot.emotion.emotion : ''
    const emotionMoodKey = EMOTION.moodFromEmotion[emotionKey]
    if (emotionMoodKey !== undefined) {
      moodKey = emotionMoodKey
      mood = EMOTION.moodBands[emotionMoodKey]?.label ?? ''
    }
    return { mood, moodKey }
  } catch {
    return { mood: '', moodKey: '' }
  }
}

/* 情绪标签 → 脉络可见度。只做档位投影，映射表取标准，避免三处各写一份。 */
/*
 * 脉络按当前来源现算：记忆、事实、心情、关系都只取这一路能看见的部分。
 * 群聊不继承主人关系分，避免一句日常被主人关系抬成「亲近」。
 */
function threadNoteFor(source, scope, query = '', ranked = null, plan = null) {
  if (axisOn('memory') === false) return ''
  /* 调用方传进来的是会话 scope（desktop / qq:...），这里换成看人的 owner / guest。 */
  const personaScope = personaScopeOf(scope, source)
  const recall = scaleRecallPlan(plan ?? planMemoryRecall(query), axisSensitivity('memory'))
  const entries = Array.isArray(ranked)
    ? ranked
    : rankMemoryEntries(memoryItemsFor(source), recall.memoryCount, query, recallBiasNow())

  const { mood, moodKey } = moodStateFor(source, scope)
  let relationScore = 0
  if (personaScope === 'owner') {
    try {
      const peer = companionRuntime.peerStateFor(source ?? 'desktop')
      relationScore = Number(peer?.affinity ?? 0) || 0
    } catch {
      relationScore = 0
    }
  }

  const currentText = String(query ?? '').replace(/\s+/g, ' ').trim()
  const memories = [
    ...(currentText === ''
      ? []
      : [{ text: currentText, slot: 'event', confidence: THREAD.currentTurnConfidence, lastAt: Date.now() }]),
    ...entries.map((entry) => ({
      text: entry.text,
      slot: entry.item?.slot ?? entry.item?.kind ?? '',
      confidence: entry.item?.confidence,
      pinned: entry.item?.pinned === true,
      lastAt: Number(entry.item?.lastAt ?? entry.item?.at ?? 0) || 0,
    })),
  ]

  let facts = []
  if (personaScope === 'owner' && ownerBridgeAllows(source)) {
    try {
      const store = companionRuntime.factStore
      if (store && typeof store.selectAuthorized === 'function') {
        const selected = store.selectAuthorized({
          query,
          count: Math.max(1, Math.min(MEMORY.factsLimit, recall.factCount)),
          scope: 'desktop',
          context: 'private',
          /* 关掉的记忆槽不注入人格，事实也走同一道闸。 */
          slots: activeMemorySlotIds(),
        })
        facts = (selected.ready ?? []).map((fact) => ({
          text: fact.text,
          slot: migrateSlotId(fact.kind),
          confidence: fact.confidence,
          pinned: fact.pinned === true,
          lastAt: Number(fact.lastSeenAt ?? fact.validFrom ?? 0) || 0,
          /* 不在这里整条滤掉：问起时它得能被答出来；只在脉络里标注「别主动提」。 */
          mentionPolicy: fact.mentionPolicy,
        }))
      }
    } catch {
      facts = []
    }
  }

  const threads = buildThreads({ memories, facts, mood, moodKey, relationScore })
  return renderThreadPrompt(threads, state.locale === 'en-US' ? 'en-US' : 'zh-CN')
}

/* 记忆与事实已改成每轮按来源现读，这里不再维护全局缓存。 */
function syncPromptMemory() {}

function addBond(type, amount) {
  return companionRuntime.addBond(type, amount)
}

async function noteCompanionActivity(sessionAt) {
  /* 贴近时刻已经不挂在 systemPrompt 上，这里不必再为它重挂人格段。 */
  await companionRuntime.noteActivity(sessionAt)
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

/* ---------------- 窗口聊天：和独立版共用一套聊天服务 ---------------- */

const CHAT_HISTORY_PATH = join(STATE_DIR, 'chat-history.json')
/** 一句话在气泡上停留多久。对话比余额播报重要，所以比默认 4.2 秒长一点。 */
const CHAT_BUBBLE_MS = 9000
/** 气泡只放一句话：再长就不像「她说了一句」，而像在念文档。 */
const CHAT_BUBBLE_CHARS = 56

let chatService = null
/* 正在说的话。窗口聊天、以后 QQ 通道都往这里投一句，buildLive 会优先显示它。 */
let chatSay = null
let chatHistoryCache = []
let chatWriteChain = Promise.resolve()

/** 气泡文案：压成一行，只取第一句；原句仍留在接口返回值里给窗口面板看。 */
function bubbleText(text) {
  const flat = String(text ?? '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat === '') return ''
  if (flat.length <= CHAT_BUBBLE_CHARS) return flat
  const lead = flat.split(/[。！？!?…]/).map((part) => part.trim()).find((part) => part !== '')
  const first = lead === undefined ? flat : lead
  return first.length <= CHAT_BUBBLE_CHARS ? first : `${first.slice(0, CHAT_BUBBLE_CHARS)}…`
}

/** 失败原因翻成人话：窗口上只显示这一行，不弹技术错误。 */
function chatReasonText(reason) {
  switch (reason) {
    case 'empty':
      return '想说什么呀？'
    case 'too-long':
      return '太长了，我一下子读不完呢…'
    case 'disabled':
      return '聊天还没打开，去设置里打开吧。'
    case 'no-key':
      return '还没有设置 API Key 呢。'
    case 'vault-unavailable':
    case 'secret-store-unavailable':
      return '密钥库打不开，这一句没能说出口。'
    case 'busy':
      return '上一句还在想呢，等我一下…'
    case 'rate-limited':
      return '说得太急了，歇一会儿再聊。'
    case 'insufficient-balance':
      return '账户余额不够了，这一句没能说出口。'
    case 'auth-failed':
      return 'API Key 好像不对，检查一下吧。'
    case 'budget-exhausted':
      return '今天的额度用完了，明天再聊好不好？'
    case 'timeout':
      return '等太久没接上话，等下再试一次？'
    case 'server-error':
      return '服务那边有点忙，等下再试一次？'
    case 'unsupported-provider':
      return '聊天服务商只支持 DeepSeek 呢。'
    default:
      return '刚才没连上，等下再试一次？'
  }
}

async function loadChatHistoryFile() {
  try {
    const raw = await readFile(CHAT_HISTORY_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 落盘串行化：一问一答两条记录几乎同时写，抢同一个临时文件会丢一条。 */
function queueChatWrite(task) {
  chatWriteChain = chatWriteChain.then(task, task).catch((error) => {
    hostCtx?.logger?.warn?.(`${PACKAGE_ID}: 聊天历史写入失败`, error)
  })
  return chatWriteChain
}

function saveChatTurn(turn) {
  const record = {
    role: turn?.role === 'assistant' ? 'assistant' : 'user',
    content: String(turn?.content ?? ''),
    at: typeof turn?.at === 'string' ? turn.at : new Date().toISOString(),
    scope: typeof turn?.scope === 'string' ? turn.scope : 'desktop',
  }
  if (turn?.source !== null && typeof turn?.source === 'object') record.source = turn.source
  /* 只有真的回复那一刻才记成就；导入历史、重放旧会话不应该刷需求。 */
  if (record.role === 'assistant') companionRuntime.noteAssistantReply()
  return queueChatWrite(async () => {
    chatHistoryCache.push(record)
    /* 磁盘只留最近 200 条；窗口要更长的历史就翻会话，不在气泡里囤。 */
    if (chatHistoryCache.length > 200) chatHistoryCache = chatHistoryCache.slice(-200)
    await mkdir(STATE_DIR, { recursive: true })
    const temp = `${CHAT_HISTORY_PATH}.tmp`
    await writeFile(temp, JSON.stringify(chatHistoryCache, null, 2), 'utf8')
    await rename(temp, CHAT_HISTORY_PATH)
  })
}

function clearChatHistoryFile() {
  return queueChatWrite(async () => {
    chatHistoryCache = []
    await mkdir(STATE_DIR, { recursive: true })
    const temp = `${CHAT_HISTORY_PATH}.tmp`
    await writeFile(temp, '[]', 'utf8')
    await rename(temp, CHAT_HISTORY_PATH)
  })
}

/* 模型给的是标签，这里替它挑一张真的图；挑不到就当这轮没表情。 */
async function resolveReplySticker(label) {
  const key = String(label ?? '').trim()
  if (key === '') return null
  try {
    const item = await stickerLibrary.pick(key)
    if (item === null) {
      /* 标签没匹配上：从「QQ 偷来的」里补一张，偷来的图本来就没有标签。 */
      const stolen = await resolveStolenSticker()
      if (stolen === null) return null
      /* 窗口只要显示地址；绝对路径留给 QQ 侧发本地文件用。 */
      return { id: stolen.id, label: stolen.label, url: stolen.url }
    }
    return {
      id: item.id,
      label: item.label,
      /* 前端直接拿这个地址显示，不接触磁盘路径。 */
      url: `${ROUTE_PREFIX}/sticker/${encodeURIComponent(item.id)}`,
    }
  } catch {
    return null
  }
}

/* 标签没匹配上时，从「QQ 偷来的」里随手拿一张；没有就当这轮没表情。 */
async function resolveStolenSticker() {
  try {
    const item = await stickerLibrary.pickStolen()
    if (item === null) return null
    return {
      id: item.id,
      label: item.label,
      url: `${ROUTE_PREFIX}/sticker/${encodeURIComponent(item.id)}`,
      abs: typeof item.abs === 'string' ? item.abs : ''
    }
  } catch {
    return null
  }
}

/* 群聊每攒够这么多条原话、且离上次压缩超过两小时，就压成一条摘要。 */
const QQ_DIGEST_EVERY = 50
const QQ_DIGEST_GAP = 2 * TIME.HOUR
const qqDigestAt = new Map()

async function maybeDigestGroup(groupId, at) {
  const last = Number(qqDigestAt.get(groupId) ?? 0)
  if (at - last < QQ_DIGEST_GAP) return
  const items = memoryStore.snapshot().items
  const rawCount = items.filter(
    (item) =>
      item.scope === 'group' && item.scopeId === groupId && item.kind === 'raw' && !item.pinned,
  ).length
  if (rawCount < QQ_DIGEST_EVERY) return
  const result = await memoryStore.digest('group', groupId)
  if (result.changed !== true) return
  qqDigestAt.set(groupId, at)
  void bootLog(`[memory] 群 ${groupId} 压了 ${result.removed} 条成摘要`)
}

/**
 * 所有到达 QQ 的消息先落进记忆，之后再谈要不要回。
 * 群聊进群桶并带发言人；主人在群里说话时，同时留一份进主人桶。
 */
/**
 * 这个 QQ 号跟她是什么关系：主人、重要的人、次重要的人，还是路过的。
 * 名单只认主人在设置里点过的号；没点过的一律按路人看前十句话。
 */
function peerTierOf(userId, isOwner) {
  if (isOwner === true) return 'owner'
  const id = String(userId ?? '').trim()
  if (id === '') return 'guest'
  const peers = state?.companionPeers ?? {}
  const important = Array.isArray(peers.important) ? peers.important : []
  const secondary = Array.isArray(peers.secondary) ? peers.secondary : []
  if (important.includes(id)) return 'important'
  if (secondary.includes(id)) return 'secondary'
  return 'guest'
}

async function observeQqMessage(event) {
  const envelope = normalizeDshEnvelope(event)
  const text = envelope.text
  if (text === '') return
  const userId = envelope.userId
  if (userId === '') return
  const at = Date.now()
  const owners = Array.isArray(state?.qq?.ownerOpenIds) ? state.qq.ownerOpenIds : []
  const isOwner = owners.includes(userId)
  const base = { slot: 'event', text, source: 'session', channel: 'qq', at }
  const observeSource = {
    channel: 'qq',
    chatType: envelope.chatType,
    openId: envelope.kind === 'group' ? envelope.targetId : userId,
    senderOpenId: userId,
    isOwner,
    tier: peerTierOf(userId, isOwner),
  }
  /* 群里和私聊里见到的人各记一份；前十句话会定一次第一印象。
     主人那条线由桌面 bond 单独管，这里不重复记。 */
  if (!isOwner) {
    companionRuntime.notePeerSeen(observeSource, 1, text)
    /* 同一句话顺手过一遍关系事件；命中才动，普通聊天不会被误加好感。 */
    companionRuntime.notePeerEvent(observeSource, text)
  }

  if (envelope.kind === 'group') {
    const groupId = envelope.targetId
    if (groupId === '') return
    await memoryStore.remember({ ...base, scope: 'group', scopeId: groupId, peer: userId })
    if (isOwner) {
      await memoryStore.remember({ ...base, scope: 'owner', scopeId: userId })
    }
    await maybeDigestGroup(groupId, at)
    void writeMemorySnapshot()
    return
  }

  if (isOwner) {
    await memoryStore.remember({ ...base, scope: 'owner', scopeId: userId })
    void writeMemorySnapshot()
    return
  }
  await memoryStore.remember({ ...base, scope: 'private', scopeId: userId })
  void writeMemorySnapshot()
}

/**
 * 主人在 QQ 里直接说话：走同一套聊天服务，回复回原会话，顺手带一张表情。
 * 审批卡片已经由网关处理完，这里只接「卡片之外的自由对话」。
 */
async function replyToQqChat(event) {
  const envelope = normalizeDshEnvelope(event)
  const text = envelope.text
  if (text === '') return { ok: false, reason: 'empty' }
  const { kind, targetId, target } = envelope

  const owners = Array.isArray(state?.qq?.ownerOpenIds) ? state.qq.ownerOpenIds : []
  const senderOpenId = envelope.userId
  const source = {
    channel: 'qq',
    chatType: kind,
    openId: targetId,
    senderOpenId,
    isOwner: owners.includes(senderOpenId),
    tier: peerTierOf(senderOpenId, owners.includes(senderOpenId)),
  }

  let result
  try {
    /* 绑了会话就先读一眼最新的几条，别拿十分钟前的桌面当上下文。 */
    await refreshActiveSession().catch(() => null)
    result = await getChatService().send({ text, source })
  } catch (error) {
    void bootLog(`[qq] 聊天服务出错：${String(error?.message ?? error)}`)
    return { ok: false, reason: 'chat-failed' }
  }

  if (result?.ok !== true) {
    const reason = String(result?.reason ?? 'request-failed')
    await qqHost.sendText(chatReasonText(reason), target)
    return { ok: false, reason }
  }

  const reply = filterOutboundText(String(result.reply ?? ''))
  if (reply.trim() === '') return { ok: true, silent: true }

  const sent = await qqHost.sendText(reply, target)

  /* 文字是主，语音是添头。语音慢，不挡这一轮返回。 */
  void speakToQqChat(reply, event, target).catch(() => null)

  /* 模型点了标签就用它的；没点就按情绪兜底，QQ 侧同样 10 分钟冷却。 */
  const modelLabel = typeof result.stickerLabel === 'string' ? result.stickerLabel.trim() : ''
  const fallbackLabel = modelLabel === '' ? stickerFallback.labelFor(reply, text, 'qq') : ''
  const label = modelLabel !== '' ? modelLabel : fallbackLabel
  if (label !== '') {
    /* 标签挑不到就用偷来的；偷来的图没有标签，只能这样上场。 */
    const item =
      (await stickerLibrary.pick(label).catch(() => null)) ??
      (await stickerLibrary.pickStolen().catch(() => null))
    if (item !== null && typeof item.abs === 'string' && item.abs !== '') {
      const image = await qqHost.sendSticker({
        filePath: item.abs,
        groupId: kind === 'group' ? targetId : '',
        userId: kind === 'group' ? '' : targetId
      })
      if (fallbackLabel !== '' && image?.ok === true) stickerFallback.markSent('qq')
    }
  }
  return { ok: true, sent }
}

/* 绑定的 DSH 会话近况：只读历史，当 QQ 这边的上下文用；群里和陌生人一律不给。 */
function sessionContextNote(scope, source) {
  if (scope !== 'owner') return ''
  if (source?.channel === 'qq' && ownerBridgeAllows(source) !== true) return ''
  const view = activeSessionView
  if (view === null || !Array.isArray(view.messages)) return ''
  const lines = []
  for (const item of view.messages) {
    const text = typeof item?.text === 'string' ? item.text.trim() : ''
    if (text === '') continue
    lines.push(`${item.role === 'user' ? '对方' : '你'}：${text}`)
  }
  if (lines.length === 0) return ''
  const title = typeof view.title === 'string' && view.title !== '' ? view.title : view.id
  return [
    '',
    '【DSH 会话近况】',
    `你在电脑那边开着的会话「${title}」，最近是这样：`,
    ...lines.slice(-4),
    '回答时可以自然接上这些内容，但不要逐句复述，也不要说「根据会话记录」。',
  ].join('\n')
}

/* 只有她要开口时才分作用域：桌面与主人私聊算 owner，群里与陌生人算 guest。 */

/**
 * 聊天服务是懒加载的：它读 state、密钥库、人格文案，
 * 这些在插件 apply 之后才齐；第一次有人开口时再装最稳。
 */
function getChatService() {
  if (chatService !== null) return chatService
  chatService = createChatService({
    getSettings: () => ({
      companion: {
        /* 没写过设置时按打开算：窗口有输入框就该能说话，不用先去设置里翻开关。 */
        chat: state.chat ?? { enabled: true },
      },
      wakeWords: state.wakeWords,
    }),
    getApiKey: () => resolveApiKey(),
    getPersonaText: (_settingsArg, context = {}) => {
      /* 桌面观察台可能刚递了一条「消气」意图：先应用，再读她的状态。 */
      try {
        companionRuntime.applyPendingFrictionIntent()
      } catch {
        /* 意图文件坏了也不该挡住这一轮 */
      }
      const scope = personaScopeOf(context?.scope, context?.source)
      maybeRefreshPromptReflections()
      const peer = companionRuntime.peerStateFor(context?.source)
      const moodState = moodStateFor(context?.source, scope)
      const now = buildNowPrompt(
        /*
         * 关掉的轴连状态都不传：提示词里不留空壳。
         * 心情与记忆各走各的：记忆轴关掉时，心情仍留在「此刻的状态」里。
         * 同一种状态只给一条，好感与烦躁对主人和访客一视同仁。
         */
        {
          mood: moodState.mood,
          affinity: axisOn('relation') ? peer.affinity : undefined,
          /* 关系阶段由 runtime 按同一张表算好，这里只转交。 */
          stage: axisOn('relation') ? peer.relationStage : undefined,
          irritation: axisOn('friction') ? peer.irritation : undefined,
          /* 档位边界跟着人格推出来的忍受度走；用户手填的覆盖优先。 */
          frictionTolerance:
            state.companionTraits?.overrides?.irritationTolerance ??
            state.companionTraits?.auto?.irritationTolerance,
        },
        'zh-CN',
      )
      return buildPersonaPrompt(
        {
          nickname: state.nickname,
          companion: { persona: state.persona },
          /* 日记是主人自己的东西：群里、访客、记忆轴关闭时都不带。 */
          reflections: reflectionsForPrompt(promptReflectionGroups, {
            scope,
            memoryOn: axisOn('memory'),
          }),
        },
        { scope, now },
      ).text + sessionContextNote(scope, context?.source)
    },
    /* 记忆摘要按来源取桶：群里不带主人的事，陌生私聊也不串群里的噪声。 */
    getMemoryDigest: (text, scope, source) => {
      /* 关掉记忆轴就整段不注入，不做「留个空壳」。 */
      if (axisOn('memory') === false) return ''
      const basePlan = planMemoryRecall(text)
      const plan = scaleRecallPlan(basePlan, axisSensitivity('memory'))
      const entries = rankMemoryEntries(memoryItemsFor(source), plan.memoryCount, text, recallBiasNow())
      const lines = entries.map((entry) => `${memoryLinePrefix(entry.item)}${entry.text}`)
      const threadNote = threadNoteFor(source, scope, text, entries, basePlan)
      return [...lines, threadNote].filter((line) => line !== '').join('\n')
    },
    /*
     * 结构化事实只给主人：桌面和主人私聊能看见，群里与陌生人一句都不带。
     * 读盘失败或这一层没起来时返回空串，聊天照旧。
     */
    getFactNote: (spoken, scope, source) => {
      /* chat 服务传进来的是会话 scope，事实闸门只认“这一路是不是主人”。 */
      if (personaScopeOf(scope, source) !== 'owner') return ''
      if (source?.channel === 'qq' && ownerBridgeAllows(source) !== true) return ''
      if (axisOn('memory') === false) return ''
      try {
        const store = companionRuntime.factStore
        if (!store || typeof store.digest !== 'function') return ''
        const plan = scaleRecallPlan(planMemoryRecall(spoken), axisSensitivity('memory'))
        return store.digest({
          query: spoken,
          count: plan.factCount,
          scope: 'desktop',
          context: 'private',
          /* 关掉的记忆槽不注入人格，事实也走同一道闸。 */
          slots: activeMemorySlotIds(),
        })
      } catch {
        return ''
      }
    },
    /* 表情清单：只回提示词，模型写 [[表情:标签]]；真的能不能发由回复处决定。 */
    getStickerHint: () => stickerLibrary.promptHint().catch(() => ''),
    /* 好感与烦躁已经由「此刻的状态」定性给出，这里只补它推不出来的方向感：
       最近在变近还是变远。不再报熟悉度、烦躁这类原始数值。 */
    getAffinityNote: (scope) => {
      if (scope !== 'desktop') return ''
      /* 关系轴关掉时，趋势句也不提。 */
      if (axisOn('relation') === false) return ''
      try {
        const peer = companionRuntime.peerStateFor('desktop')
        const snapshot = buildCompanionSnapshot({
          bond: peer.bond,
          irritation: peer.irritation,
          scope: 'desktop',
        })
        if (snapshot.relation.trend === 'up') return '最近比起之前，更近了一点'
        if (snapshot.relation.trend === 'down') return '最近有点疏远'
        return ''
      } catch {
        return ''
      }
    },
    /* 这一轮能不能靠近由陪伴层判断：开关、场景、次数、由头都在那里，读不到就回空串。
       贴近时刻只属于桌面独处，群里和陌生人面前不成立。 */
    getIntimacyNote: (context) => {
      const scope = context?.scope
      if (typeof scope === 'string' && scope !== 'desktop') return ''
      try {
        return companionRuntime.intimacyPrompt()
      } catch {
        return ''
      }
    },
    /* 输出侧红线：命中就整句换安全台词，不重试、不修补。 */
    filterIntimacy: (text) => {
      try {
        return companionRuntime.filterIntimacyReply(text)
      } catch {
        return { ok: true, text: String(text ?? '') }
      }
    },
    /*
     * 窗口聊天与 QQ 的真实发言也走同一套情绪/好感结算。
     * 只记主人这一路：群里和访客不写主人的 bond，避免一段群聊把私聊关系抬高。
     */
    onUserMessage: ({ text, scope, source } = {}) => {
      if (personaScopeOf(scope, source) !== 'owner') return
      try {
        companionRuntime.noteUserText(text, Date.now())
      } catch {
        /* 情绪结算失败不影响这一轮回复 */
      }
    },
    /* 真说出口才记账：只记次数与时间，不记内容。 */
    onIntimacySpoken: () => {
      try {
        companionRuntime.intimacy.noteTurn(Date.now())
      } catch {
        /* 记账失败不影响这一轮回复 */
      }
    },
    persistTurn: (turn) => {
      void saveChatTurn(turn)
    },
    persistClear: () => clearChatHistoryFile(),
    /* 回复写完先让气泡自己刷一次，窗口面板不用等下一轮轮询。 */
    onExchange: () => {
      void writeLive().catch(() => {})
    },
    log: (message, error) => hostCtx?.logger?.warn?.(`${PACKAGE_ID}: ${message}`, error),
  })
  void loadChatHistoryFile()
    .then((list) => {
      chatHistoryCache = list
      chatService?.hydrate(list)
    })
    .catch(() => {})
  return chatService
}

/** 把宿主地址留给桌宠窗口：窗口据此把话交给这里，不再自己建一套对话。 */
const HOST_ENDPOINT_PATH = join(STATE_DIR, 'host.json')
let hostBaseCache = ''

/* 启动时清掉上一次宿主留下的死地址。旧窗口只认 host.json，
   宿主重启换了端口后，这个文件会把它带到已经退出的 pid 上。
   当前 DSH 桌宠走 live.json / pet-command.json，不依赖它；
   但留着死地址会让旧窗口和排查工具误判，所以启动时先扫一遍。 */
function pruneStaleHostEndpoint() {
  try {
    if (!existsSync(HOST_ENDPOINT_PATH)) return
    const info = JSON.parse(readFileSync(HOST_ENDPOINT_PATH, 'utf8'))
    const pid = Number(info?.pid)
    let alive = false
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0)
        alive = true
      } catch {
        alive = false
      }
    }
    /* 本进程刚写的地址保留；其他进程留下的、已经退出的地址清掉。 */
    if (alive && pid === process.pid && info?.owner === 'dsh') return
    if (!alive) unlinkSync(HOST_ENDPOINT_PATH)
  } catch {
    /* 文件坏了也当作遗留地址清掉，下一次请求会重新写。 */
    try {
      unlinkSync(HOST_ENDPOINT_PATH)
    } catch {
      /* 已不存在 */
    }
  }
}

function noteHostBase(host) {
  const raw = typeof host === 'string' ? host.trim() : ''
  if (raw === '') return
  /* 只认本机回环：局域网里的请求不该改写窗口要去的地方。 */
  const baseUrl = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(raw) ? `http://${raw}` : ''
  if (baseUrl === '' || baseUrl === hostBaseCache) return
  hostBaseCache = baseUrl
  void queueChatWrite(async () => {
    await mkdir(STATE_DIR, { recursive: true })
    const temp = `${HOST_ENDPOINT_PATH}.tmp`
    /* owner 是归属声明：这份地址由 DSH 写入。Cyrene 宿主若也往同一文件写，
       读到 owner 不等于 dsh 时就应视为遗留地址，不能直接拿来当 DSH 的宿主。 */
    await writeFile(temp, JSON.stringify({ owner: 'dsh', pid: process.pid, baseUrl, at: Date.now() }, null, 2), 'utf8')
    await rename(temp, HOST_ENDPOINT_PATH)
  })
}

/** 把一句话放上气泡，下一次 writeLive 就能看见。 */
function sayInBubble(text, { emoji = '', speak = true, ms = CHAT_BUBBLE_MS } = {}) {
  const line = filterOutboundText(bubbleText(text))
  if (line === '') return null
  chatSay = { text: line, emoji, until: Date.now() + ms, speak }
  return chatSay
}

function pickEmoji(overBudget, nearLimit, overThreshold, speak) {
  if (overBudget) return 'poorwallet'
  if (nearLimit) return 'thinking'
  if (overThreshold) return 'Whatswrong'
  if (speak) return liveRotation % 2 === 0 ? 'Gigglelots' : 'hello'
  return liveRotation % 4 === 0 ? 'shyshort' : 'HI'
}

/* 游戏模式写给桌宠的那一段。桌宠主进程和渲染层都只认这一份：
   active 决定要不要降存在感，hideBubble 由渲染层负责收气泡，
   dimPet 交给主进程调窗口不透明度，openRequest 变化一次就开一次游戏页。 */
let liveGame = { active: false, hideBubble: false, dimPet: 1, openRequest: 0 }
let liveGameOpenAt = 0

/* 陪看：插件只写「想开哪个页面」和「她要说的一句」，
   窗口、弹幕层都在桌宠那边，插件不碰。
   openRequest 变化一次开一次，active=false 时桌宠关窗。 */
let liveWatch = { active: false, url: '', title: '', openRequest: 0 }
let liveWatchOpenAt = 0

/* 弹幕队列：桌宠按 seq 取增量，seq 相同就说明没有新的。
   只留最近 40 条，避免 live.json 越写越大。 */
const MAX_DANMAKU_ITEMS = 40
let liveDanmaku = { seq: 0, items: [] }

/* 把用户输入收成一个 B 站地址；认不出来就返回 null，让调用方报错。 */
function normalizeBiliUrl(input) {
  const raw = String(input ?? '').trim()
  if (raw === '') return 'https://www.bilibili.com'
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      const host = parsed.hostname.toLowerCase()
      const ok =
        host === 'bilibili.com' ||
        host.endsWith('.bilibili.com') ||
        host === 'b23.tv' ||
        host.endsWith('.b23.tv')
      return ok ? parsed.toString() : null
    } catch {
      return null
    }
  }
  if (/^BV[0-9A-Za-z]{10}$/.test(raw)) return `https://www.bilibili.com/video/${raw}`
  if (/^av\d+$/i.test(raw)) return `https://www.bilibili.com/video/${raw}`
  if (/^\d{1,12}$/.test(raw)) return `https://live.bilibili.com/${raw}`
  return null
}

/* 追加一条桌面弹幕。seq 是总量，items 只留最近几十条；
   桌宠按 id 取比上次大的那几条，不关心顺序。 */
function appendDanmaku(text) {
  const id = liveDanmaku.seq + 1
  const items = [...liveDanmaku.items, { id, text, at: Date.now() }].slice(-MAX_DANMAKU_ITEMS)
  liveDanmaku = { seq: id, items }
  return liveDanmaku
}

async function buildLiveGameSection() {
  const game = state.game ?? DEFAULTS.game
  const base = {
    active: false,
    hideBubble: game.hideBubble === true,
    dimPet: Number(game.dimPet) || 1,
    openRequest: liveGameOpenAt,
    running: [],
  }
  if (game.enabled !== true || game.autoMode !== true) return base
  const probed = await collectGameState({ launcherUrl: game.launcherUrl, m7aPath: game.m7aPath })
  const running = probed.games?.ok === true && Array.isArray(probed.games.running) ? probed.games.running : []
  return {
    ...base,
    active: running.length > 0,
    running: running.map((item) => item.id),
  }
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
  /* 刚聊完的这一句还没到时间，就先让她说完；余额预警仍然压过一切。 */
  const saying = chatSay !== null && Date.now() < chatSay.until ? chatSay : null
  if (chatSay !== null && saying === null) chatSay = null

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

  if (overBudget) {
    line = `今日用掉 ${spent.toFixed(2)} 元，超过 ${limit.toFixed(0)} 的额度了…`
    speak = true
  } else if (nearLimit) {
    line = `今日已用 ${spent.toFixed(2)} 元，快到 ${limit.toFixed(0)} 了呢。`
    speak = true
  } else if (saying !== null) {
    line = saying.text
    speak = saying.speak
  } else if (forcedTalk) {
    line = talk
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
    /* 13 槽生效开关随 live 下发：抽屉只读这份，不读声明表静态默认（乙1 甲案）。 */
    memorySlotIds: activeMemorySlotIds(),
    background: {
      id: typeof state.background?.id === 'string' ? state.background.id : '',
      dim: Number(state.background?.dim) || 0,
      rotateMinutes: Number(state.background?.rotateMinutes) || 0,
      posX: Number.isFinite(Number(state.background?.posX)) ? Number(state.background.posX) : 50,
      posY: Number.isFinite(Number(state.background?.posY)) ? Number(state.background.posY) : 50,
      /* 同一张图铺到哪：页面 / 桌宠窗口。桌宠按 target 决定要不要画自己那一层。 */
      targets: {
        page: state.background?.targets?.page !== false,
        window: state.background?.targets?.window !== false,
      },
      windowBlur: Math.min(24, Math.max(0, Number(state.background?.windowBlur) || 0)),
      /* 四槽各选各的：桌宠只取 window / settingsWindow，另外两个槽给 DSH 页面和设置卡片用。 */
      slots: (() => {
        const source = state.background?.slots
        const readSlot = (name) => {
          const raw = source !== null && typeof source === 'object' ? source[name] : null
          const item = raw !== null && typeof raw === 'object' ? raw : {}
          return {
            id: typeof item.id === 'string' ? item.id : '',
            dim: Math.min(0.85, Math.max(0, Number(item.dim) || 0)),
            posX: Math.min(100, Math.max(0, Number.isFinite(Number(item.posX)) ? Number(item.posX) : 50)),
            posY: Math.min(100, Math.max(0, Number.isFinite(Number(item.posY)) ? Number(item.posY) : 50)),
            zoom: Math.min(3, Math.max(1, Number.isFinite(Number(item.zoom)) ? Number(item.zoom) : 1)),
            blur: Math.min(24, Math.max(0, Math.round(Number(item.blur) || 0)))
          }
        }
        return {
          page: readSlot('page'),
          window: readSlot('window'),
          settingsCard: readSlot('settingsCard'),
          settingsWindow: readSlot('settingsWindow')
        }
      })(),
    },
    bubbleFont: state.bubbleFont,
    bubbleWidth: state.bubbleWidth,
    bubbleStickerSize: state.bubbleStickerSize,
    bubbleRadius: state.bubbleRadius,
    outline: state.outline,
    bubbleAlpha: state.bubbleAlpha,
    hudAlpha: state.hudAlpha,
    askEnabled: Number(state.askEveryMinutes) > 0,
    askEveryMinutes: state.askEveryMinutes,
    askPerQuestionSeconds: state.askPerQuestionSeconds,
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
    game: liveGame,
    /* 陪看：开关和弹幕观感一起下发，桌宠不用再猜参数。 */
    watch: {
      ...liveWatch,
      enabled: state.watch?.enabled !== false,
      style: {
        fontSize: Math.min(40, Math.max(14, Number(state.danmaku?.fontSize) || 22)),
        opacity: Math.min(1, Math.max(0.3, Number(state.danmaku?.opacity) || 0.95)),
        seconds: Math.min(30, Math.max(6, Number(state.danmaku?.seconds) || 12)),
        tracks: Math.min(12, Math.max(3, Math.round(Number(state.danmaku?.tracks) || 7))),
        idleMinutes: Math.min(60, Math.max(1, Number(state.danmaku?.idleMinutes) || 5)),
      },
    },
    danmaku: { ...liveDanmaku, enabled: state.danmaku?.enabled !== false },
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
    modelId: state.modelId,
    modelNotice: state.modelNotice,
    hasKey: hasVaultKey || credentialAvailable || Boolean(process.env.DEEPSEEK_API_KEY),
    vaultError,
    balanceError,
    balanceThreshold: state.balanceThreshold,
    dailyLimit: state.dailyLimit,
    line: filterOutboundText(line),
    emoji:
      saying !== null && saying.emoji !== ''
        ? saying.emoji
        : pickEmoji(overBudget, nearLimit, overThreshold, speak),
    speak,
    ms: saying !== null ? 6000 : speak ? 3200 : 4200,
    /* 窗口据此决定要不要显示输入框；显式关掉时是 false。 */
    chatEnabled: state.chat?.enabled !== false,
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

/**
 * 落盘串行化。
 *
 * 之前每次写都用固定的 live.json.tmp：设置页、轮询、对话回复几乎同时触发时，
 * 第一个 rename 成功后第二个就找不到临时文件了（ENOENT）。窗口聊天会同时
 * 走 onExchange 与路由各一次，所以这里统一排队。
 */
let liveWriteChain = Promise.resolve()

function writeLive() {
  liveWriteChain = liveWriteChain.then(runWriteLive, runWriteLive)
  return liveWriteChain
}

async function runWriteLive() {
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

  /* 游戏探测失败就沿用上一份，不让它挡住余额和状态栏 */
  try {
    liveGame = await buildLiveGameSection()
  } catch {
    /* 保留上一次的 liveGame */
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
        state.modelNotice = `已导入 ${installed.kind} 素材：${installed.id}♪`
        await persist()
        restartPet()
      } catch (error) {
        /* persist 不做归一化，错误消息这里先收口到 200，避免超长落盘。 */
        state.modelNotice = clampText(`导入没成功：${error?.message ?? error}`, 200)
        await persist()
      }
      await writeLive()
    } else if (command.action === 'resetModel') {
      state.modelId = ''
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
      // 等进程树真的清空再写 live，否则桌宠可能读到一份「已经该退场」的状态。
      await stopPet()
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
  /* Cyrene 宿主不提供 Cordis 的 ctx.effect / ctx.on，经 host-compat 垫片降级。 */
  const { effect, on } = adaptHostCtx(ctx)

  effect(() => {
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
  effect(() => {
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
  effect(
    () =>
      on(
        'session/event',
        (session) => {
          trackSession(session)
        },
        { global: true },
      ),
    `${PACKAGE_ID}: todo session tracking`,
  )

  effect(() => {
    const disposeBridge = on(
      'user-questions/request',
      (request, next) => bridgeConversationAsk(request, next, ctx),
      { prepend: true },
    )
    return () => {
      disposeBridge()
      if (conversationAsk !== null) settleConversationAsk(conversationAsk, { kind: 'timeout' })
    }
  }, `${PACKAGE_ID}: conversation ask bridge`)

  effect(() => {
    const disposeApproval = on(
      'approval/request',
      (request, next) => bridgeApproval(request, next, ctx),
      { prepend: true },
    )
    return () => {
      disposeApproval()
      if (approvalAsk !== null) settleApprovalAsk(approvalAsk, { kind: 'cancelled' })
    }
  }, `${PACKAGE_ID}: approval bridge`)

  effect(() => {
    let bootTimer = null
    /* ensureLoaded 失败也要把桌宠拉起来：设置读不到就用默认值，功能先能用 */
    const boot = () => {
      ctx.logger?.info?.(
        `${PACKAGE_ID}: 已挂载（${state.nickname}，桌宠${state.enabled ? '开启' : '关闭'}${runtimeError === '' ? '' : `，运行时问题：${runtimeError}`}）`,
      )
      void bootLog(`mounted nickname=${state.nickname} enabled=${state.enabled} runtimeError=${runtimeError}`)
      pruneStaleHostEndpoint()
      remountPersona(ctx.systemPrompt)
      /* 表情包附录独立挂载：人格 section 可能让位给主题插件，这份不让 */
      void mountStickerSection(ctx.systemPrompt)
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

  effect(
    () => {
      /* Cyrene 宿主只给 apply(ctx)，没有 Cordis 服务表；没有 webServer 时跳过路由，
         设置页会打不开，但桌宠本体必须继续启动。 */
      if (ctx.webServer === undefined || ctx.webServer === null || typeof ctx.webServer.register !== 'function') {
        ctx.logger?.warn?.(`${PACKAGE_ID}: 宿主未提供 webServer，跳过设置页路由`)
        return () => {}
      }
      return ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
          noteHostBase(req.headers?.host)
          try {
            if (route === '/state' && req.method === 'GET') {
              await ensureLoaded()
              /* 桌宠可能刚写过同一份文件，先把映射字段拉回来再回给页面 */
              await syncSettingsFromDisk()
              sendJson(res, 200, { ok: true, value: publicState() })
              return
            }

            if (route === '/state' && req.method === 'POST') {
              await ensureLoaded()
              await syncSettingsFromDisk()
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
              /* 先留一份写前快照，写完对比出这次真正动了哪几项，记进最近改动 */
              const before = JSON.parse(JSON.stringify(state))
              /* schema 设置页按点路径提交（appearance.palette），先展开再合并 */
              state = normalize(mergeStatePatch(state, expandDotPaths(state, body)))
              await persist()
              await flushPendingApiKey()
              await settingsHistory.record(before, state, 'settings')
              sendJson(res, 200, { ok: true, value: publicState() })
              return
            }

            /* C6 设置导出（脱敏）：密钥明文都在加密仓库，state 里只有 syncToken
               与 qq.appSecret 可能残留明文，导出处打码；其余照实导出供备份排查。 */
            if (route === '/settings/export' && req.method === 'GET') {
              await ensureLoaded()
              const copy = JSON.parse(JSON.stringify(state))
              if (typeof copy.syncToken === 'string' && copy.syncToken !== '') copy.syncToken = '••••••••'
              if (copy.qq && typeof copy.qq === 'object' && typeof copy.qq.appSecret === 'string' && copy.qq.appSecret !== '') {
                copy.qq.appSecret = '••••••••'
              }
              sendJson(res, 200, { ok: true, settings: copy })
              return
            }

            /* 单项恢复默认：只接受设置总表里登记过的 path。
               默认值取 DEFAULTS 的现值，不取表里的字面量，避免两处漂移。 */
            if (route === '/settings/reset' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              if (isStaleRev(body?.rev, state.rev)) {
                sendJson(res, 409, {
                  ok: false,
                  error: { code: 'stale', message: '设置已经在别处更新过了，刷新后再试' },
                  value: publicState(),
                })
                return
              }
              const path = String(body?.path ?? '')
              const value = defaultFor(path, DEFAULTS)
              if (value === RESET_NOT_FOUND) {
                sendJson(res, 400, {
                  ok: false,
                  error: { code: 'unknown-field', message: `设置总表里没有这一项：${path}` },
                })
                return
              }
              const beforeReset = JSON.parse(JSON.stringify(state))
              state = normalize(mergeStatePatch(state, patchFromPath(state, path, value)))
              await persist()
              await writeLive()
              await settingsHistory.record(beforeReset, state, `reset:${path}`)
              sendJson(res, 200, { ok: true, path, value: publicState() })
              return
            }

            /* 最近改动：最新在前，最多 10 条；只含总表登记过的字段。 */
            if (route === '/settings/history' && req.method === 'GET') {
              await ensureLoaded()
              const items = await settingsHistory.list()
              sendJson(res, 200, { ok: true, items })
              return
            }

            /* 单条回退：把这一条记下的写前值逐项放回去，再记一条 undo 记录。 */
            if (route === '/settings/undo' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              if (isStaleRev(body?.rev, state.rev)) {
                sendJson(res, 409, {
                  ok: false,
                  error: { code: 'stale', message: '设置已经在别处更新过了，刷新后再试' },
                  value: publicState(),
                })
                return
              }
              const found = await settingsHistory.undo(String(body?.id ?? ''))
              if (found === null) {
                sendJson(res, 404, {
                  ok: false,
                  error: { code: 'not-found', message: '找不到这一条改动，可能已经被更早的回退覆盖了' },
                })
                return
              }
              const beforeUndo = JSON.parse(JSON.stringify(state))
              let next = state
              for (const step of found.patch) {
                next = mergeStatePatch(next, patchFromPath(next, step.path, step.value))
              }
              state = normalize(next)
              await persist()
              await writeLive()
              await settingsHistory.record(beforeUndo, state, `undo:${found.item.id}`)
              sendJson(res, 200, { ok: true, item: found.item, value: publicState() })
              return
            }

            /* 体检四灯：只报事实和修法，不做自动修复。 */
            if (route === '/health' && req.method === 'GET') {
              await ensureLoaded()
              sendJson(res, 200, { ok: true, value: healthReport() })
              return
            }

            /*
             * 双端设置同步：GET 顺手把桌宠刚写进来的值拉回内存；
             * POST 只有两件事 —— 开关同步、手动拉一次。
             */
            if (route === '/settings/sync' && (req.method === 'GET' || req.method === 'POST')) {
              await ensureLoaded()
              let pulled = false
              if (req.method === 'POST') {
                const body = await readJsonBody(req)
                if (typeof body?.enabled === 'boolean' && body.enabled !== state.settingsSync) {
                  const beforeSync = JSON.parse(JSON.stringify(state))
                  state = normalize(mergeStatePatch(state, { settingsSync: body.enabled }))
                  await persist()
                  await settingsHistory.record(beforeSync, state, 'settings-sync')
                }
              }
              pulled = await syncSettingsFromDisk()
              sendJson(res, 200, {
                ok: true,
                value: {
                  enabled: state.settingsSync !== false,
                  stamp: Number(state.settingsStamp ?? 0),
                  pulled,
                  fields: SYNC_FIELDS.map((field) => field.dsh),
                },
              })
              return
            }

            /* 向导：四问走完打一个标记，之后不再自动弹。 */
            if (route === '/settings/wizard' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              if (isStaleRev(body?.rev, state.rev)) {
                sendJson(res, 409, {
                  ok: false,
                  error: { code: 'stale', message: '设置已经在别处更新过了，刷新后再试' },
                  value: publicState(),
                })
                return
              }
              const beforeWizard = JSON.parse(JSON.stringify(state))
              state = normalize(mergeStatePatch(state, { onboarded: body?.done !== false }))
              await persist()
              await settingsHistory.record(beforeWizard, state, 'wizard')
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
                // 等进程真的停了再回响应，调用方拿到的 ok 才是实话。
                await stopPet()
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

            /* 设置页「游戏」页：看一眼有没有游戏在跑，顺带读外部工具状态。
               只读进程名，不启动游戏、不向任何工具下指令。
               ?refresh=1 强制跳过 8 秒缓存，给「立即检查」用。 */
            if (route === '/games' && req.method === 'GET') {
              await ensureLoaded()
              const game = state.game ?? DEFAULTS.game
              const known = KNOWN_GAMES.map((item) => ({ id: item.id, name: item.name, short: item.short }))
              if (game.enabled !== true) {
                sendJson(res, 200, {
                  ok: true,
                  value: { enabled: false, known, games: null, launcher: null, m7a: null },
                })
                return
              }
              const value = await collectGameState({
                force: url.searchParams.get('refresh') === '1',
                launcherUrl: game.launcherUrl,
                m7aPath: game.m7aPath,
              })
              sendJson(res, 200, { ok: true, value: { enabled: true, known, ...value } })
              return
            }

            /* 「打开桌宠游戏页」：只往 live 里写一个时间戳，由桌宠主进程自己开窗。
               插件不直接碰桌宠窗口，也不改它任何设置。 */
            if (route === '/games/open' && req.method === 'POST') {
              await ensureLoaded()
              liveGameOpenAt = Date.now()
              await writeLive()
              sendJson(res, 200, { ok: true, value: { at: liveGameOpenAt } })
              return
            }

            /* 陪看：把 B 站地址交给桌宠开窗。只认 BV 号 / av 号 / 直播间号 / 站内链接，
               别的域名直接拒——这里不是通用浏览器入口。 */
            if (route === '/watch/open' && req.method === 'POST') {
              await ensureLoaded()
              if (state.watch?.enabled === false) {
                sendJson(res, 403, {
                  ok: false,
                  error: { code: 'watch-disabled', message: '陪看关着，先在设置里打开' },
                })
                return
              }
              const body = await readJsonBody(req)
              /* 地址留空就用设置里的「常看的地址」；两边都空就回 B 站首页。 */
              const asked = typeof body?.url === 'string' && body.url.trim() !== ''
                ? body.url
                : state.watch?.defaultUrl
              const target = normalizeBiliUrl(asked)
              if (target === null) {
                sendJson(res, 400, {
                  ok: false,
                  error: {
                    code: 'bad-url',
                    message: '只认 B 站：BV 号、av 号、直播间号，或 bilibili.com / b23.tv 的链接',
                  },
                })
                return
              }
              liveWatchOpenAt = Date.now()
              liveWatch = {
                active: true,
                url: target,
                title: typeof body?.title === 'string' ? body.title.slice(0, 80) : '',
                openRequest: liveWatchOpenAt,
              }
              await writeLive()
              sendJson(res, 200, { ok: true, value: liveWatch })
              return
            }

            /* 关掉陪看：只翻 active，桌宠看到自己关窗。 */
            if (route === '/watch/close' && req.method === 'POST') {
              await ensureLoaded()
              liveWatch = { ...liveWatch, active: false, openRequest: 0 }
              liveWatchOpenAt = 0
              await writeLive()
              sendJson(res, 200, { ok: true, value: liveWatch })
              return
            }

            /* 让她在桌面弹幕里说一句。只进队列，不触发模型。 */
            if (route === '/watch/danmaku' && req.method === 'POST') {
              await ensureLoaded()
              if (state.danmaku?.enabled === false) {
                sendJson(res, 403, {
                  ok: false,
                  error: { code: 'danmaku-disabled', message: '弹幕层关着，先在设置里打开' },
                })
                return
              }
              const body = await readJsonBody(req)
              const text = typeof body?.text === 'string' ? body.text.trim() : ''
              if (text === '') {
                sendJson(res, 400, {
                  ok: false,
                  error: { code: 'empty-text', message: '弹幕不能是空的' },
                })
                return
              }
              const value = appendDanmaku(text.slice(0, 120))
              await writeLive()
              sendJson(res, 200, { ok: true, value })
              return
            }

            /* 设置页的「测试连接」：只验证地址、模型、key 能不能通，不写任何东西 */
            if (route === '/vision/test' && req.method === 'POST') {
              await ensureLoaded()
              const vision = await getStickerVision()
              if (vision === null) {
                sendJson(res, 200, {
                  ok: false,
                  error: { code: 'vision-disabled', message: '先打开视觉标签，并填好地址和模型' },
                })
                return
              }
              const result = await vision.testConnection()
              if (result.ok === true) {
                sendJson(res, 200, { ok: true })
              } else {
                sendJson(res, 200, {
                  ok: false,
                  error: { code: result.reason, message: `没连上：${result.reason}` },
                })
              }
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

            /* ---------------- 窗口聊天（和独立版同一套服务） ---------------- */

            if (route === '/send' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              const text = typeof body?.text === 'string' ? body.text : ''
              /*
               * 来源是结构信息，不能省。窗口聊天固定标成桌面线；如果以后有别的入口
               * 复用 /send，也可以带自己的 source 对象进来。没有 source 时，
               * 历史与记忆都会把这一轮当成「不知道从哪来的」，来源审计就断了。
               */
              const source =
                body?.source !== null && typeof body?.source === 'object'
                  ? body.source
                  : { channel: 'desk', chatType: 'desktop' }
              const service = getChatService()
              const result = await service.send({ text, source })

              if (result.ok !== true) {
                /* 失败也走气泡：窗口不必再画一条红色错误条。 */
                const message = chatReasonText(result.reason)
                sayInBubble(message, { emoji: 'Whatswrong', speak: false })
                await writeLive()
                sendJson(res, 200, {
                  ok: false,
                  error: { code: String(result.reason ?? 'request-failed'), message },
                  value: { at: Date.now() },
                })
                return
              }

              /* 走了「这一轮先不说」的路径（收尾沉默）：气泡保持原样。 */
              const reply = filterOutboundText(String(result.reply ?? ''))
              if (reply.trim() === '') {
                await writeLive()
                sendJson(res, 200, {
                  ok: true,
                  value: { reply: '', silent: result.silent ?? '', at: result.at ?? Date.now() },
                })
                return
              }

              const said = sayInBubble(reply, { emoji: result.emojiId ?? '' })
              /* 模型点了标签就用它的；没点就按情绪兜底，同一窗口 10 分钟内最多补一张。 */
              const fallbackLabel =
                typeof result.stickerLabel === 'string' && result.stickerLabel.trim() !== ''
                  ? ''
                  : stickerFallback.labelFor(reply, text, 'desktop')
              const sticker = await resolveReplySticker(
                typeof result.stickerLabel === 'string' && result.stickerLabel.trim() !== ''
                  ? result.stickerLabel
                  : fallbackLabel
              )
              if (sticker !== null && fallbackLabel !== '') stickerFallback.markSent('desktop')
              await writeLive()
              sendJson(res, 200, {
                ok: true,
                value: {
                  reply,
                  /* 气泡上实际显示的那一行；窗口面板可以显示完整 reply。 */
                  bubble: said?.text ?? bubbleText(reply),
                  emojiId: result.emojiId ?? null,
                  sticker,
                  model: result.model ?? '',
                  usage: result.usage ?? null,
                  at: result.at ?? Date.now(),
                },
              })
              return
            }

            if (route === '/chat/history' && req.method === 'GET') {
              const service = getChatService()
              sendJson(res, 200, { ok: true, value: service.history('desktop') })
              return
            }

            if (route === '/chat/reset' && req.method === 'POST') {
              const service = getChatService()
              const cleared = await service.clear()
              chatSay = null
              await writeLive()
              sendJson(res, cleared.ok === true ? 200 : 500, {
                ok: cleared.ok === true,
                ...(cleared.ok === true ? { value: { cleared: true } } : { error: { code: cleared.reason } }),
              })
              return
            }

            if (route === '/chat/status' && req.method === 'GET') {
              sendJson(res, 200, { ok: true, value: getChatService().status() })
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

            /* 主人亲手把某一段的烦躁调下来：0 就是消气，也能往上调。
               scope 缺省是桌面；写的是绝对值，不跟半衰期叠着加。 */
            if (route === '/companion/friction' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              const scope =
                typeof body?.scope === 'string' && body.scope.trim() !== ''
                  ? body.scope.trim().slice(0, 120)
                  : 'desktop'
              const value = Number(body?.value)
              if (!Number.isFinite(value)) throw new Error('烦躁值必须是数字')
              const next = companionRuntime.setPeerIrritation(scope, value)
              if (next === null) throw new Error('这个会话不记烦躁')
              sendJson(res, 200, { ok: true, scope, irritation: next, ...companionSnapshot() })
              return
            }

            if (route === '/companion/peers' && req.method === 'GET') {
              await ensureLoaded()
              sendJson(res, 200, {
                ok: true,
                peers: companionRuntime.getPeerTiers(),
                known: companionRuntime.peerStateList(),
              })
              return
            }

            if (route === '/companion/peers' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              const pick = (list) =>
                (Array.isArray(list) ? list : [])
                  .map((item) => (typeof item === 'string' ? item.trim().slice(0, 96) : ''))
                  .filter((item) => item !== '')
                  .slice(0, 200)
              const peers = {
                owner: pick(body?.owner),
                important: pick(body?.important),
                secondary: pick(body?.secondary),
              }
              /* 名单是判档的唯一来源：先写密文，再同步一份进 state 供快照读。 */
              companionRuntime.setPeerTiers(peers)
              state = { ...state, companionPeers: peers }
              await persist()
              sendJson(res, 200, { ok: true, ...companionSnapshot() })
              return
            }

            if (route === '/companion/axes' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              const incoming = body?.axes !== null && typeof body.axes === 'object' ? body.axes : {}
              const axes = { ...(state.companionAxes ?? {}) }
              for (const key of AXIS_KEYS) {
                const raw = incoming[key]
                if (raw === null || typeof raw !== 'object') continue
                const current = axes[key] ?? { enabled: true, sensitivity: 'normal' }
                axes[key] = {
                  enabled: typeof raw.enabled === 'boolean' ? raw.enabled : current.enabled,
                  sensitivity: SENSITIVITY_LEVELS.includes(raw.sensitivity) ? raw.sensitivity : current.sensitivity,
                }
              }
              state = { ...state, companionAxes: axes }
              /* 主来源是 settings.json；state 同步一份，旧版本读得到。 */
              writePetAxes(axes)
              await persist()
              sendJson(res, 200, { ok: true, ...companionSnapshot() })
              return
            }

            if (route === '/companion/traits' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              const incoming = body?.overrides !== null && typeof body?.overrides === 'object' ? body.overrides : {}
              const current = state.companionTraits ?? {}
              const overrides = { ...(current.overrides ?? {}) }
              for (const def of TRAIT_DEFS) {
                if (!(def.key in incoming)) continue
                const raw = incoming[def.key]
                /* null 表示「这一项交回人格决定」 */
                if (raw === null) {
                  delete overrides[def.key]
                  continue
                }
                const num = Number(raw)
                if (!Number.isFinite(num)) continue
                overrides[def.key] = Math.min(def.max, Math.max(def.min, num))
              }
              state = { ...state, companionTraits: { ...current, overrides } }
              await persist()
              sendJson(res, 200, { ok: true, ...companionSnapshot() })
              return
            }

            if (route === '/companion/memory' && req.method === 'GET') {
              requireOwnerConsole(req)
              await memoryStore.load()
              const asked = url.searchParams.get('mode')
              const mode = asked === 'all' || asked === 'owner' ? asked : state.memoryViewMode
              const limit = Number(url.searchParams.get('limit'))
              const view = buildMemoryConsole(memoryStore.snapshot().items, {
                mode,
                isOwner: true,
                query: url.searchParams.get('q') ?? '',
                limit: Number.isFinite(limit) ? limit : undefined,
              })
              sendJson(res, 200, { ok: true, ...view })
              return
            }

            if (route === '/companion/memory' && req.method === 'POST') {
              requireOwnerConsole(req)
              const body = await readJsonBody(req)
              const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MEMORY.textLimit) : ''
              if (text === '') throw new Error('记忆内容不能为空')
              /* 槽白名单从 13 槽当前开关派生：旧键先迁移，关了就换 event，全关则报错 */
              const onSlots = activeMemorySlotIds()
              if (onSlots.length === 0) throw new Error('所有记忆槽都已关闭，先去设置页打开一个吧')
              const migrated = migrateSlotId(body?.slot)
              const slot = onSlots.includes(migrated)
                ? migrated
                : (onSlots.includes('event') ? 'event' : onSlots[0])
              /* 记忆台写进来的原话永远落在主人桶，不跟 QQ 私聊 / 群聊混在一起。 */
              const memory = await memoryStore.remember({
                text,
                slot,
                source: 'manual',
                channel: 'dsh',
                scope: 'owner',
                scopeId: resolveOwnerScopeId(),
              })
              syncPromptMemory()
              sendJson(res, 200, { ok: true, count: memory.items.length })
              return
            }

            if (route === '/companion/memory/pin' && req.method === 'POST') {
              requireOwnerConsole(req)
              const body = await readJsonBody(req)
              const id = typeof body?.id === 'string' ? body.id.trim() : ''
              if (id === '') throw new Error('缺少要固定的记忆 id')
              const memory = await memoryStore.pin(id, body?.pinned !== false)
              syncPromptMemory()
              sendJson(res, 200, { ok: true, count: memory.items.length })
              return
            }

            if (route === '/companion/memory/forget' && req.method === 'POST') {
              requireOwnerConsole(req)
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
              requireOwnerConsole(req)
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
              if (typeof body?.noticeDismissed === 'boolean' &&
                  body.noticeDismissed !== state.memoryNoticeDismissed) {
                state.memoryNoticeDismissed = body.noticeDismissed
                changed = true
              }
              /* 记忆台视图只接受 owner / all；all 是主人专属的查看方式。 */
              if ((body?.viewMode === 'owner' || body?.viewMode === 'all') &&
                  body.viewMode !== state.memoryViewMode) {
                state.memoryViewMode = body.viewMode
                changed = true
              }
              /* 13 槽开关：只收声明表里的 id，布尔值逐槽合并 */
              if (body?.slots !== null && typeof body?.slots === 'object') {
                const custom = { ...(state.memorySlots ?? {}) }
                let slotsChanged = false
                for (const slot of MEMORY_SLOTS) {
                  if (!(slot.id in body.slots)) continue
                  const value = body.slots[slot.id] === true
                  if (custom[slot.id] !== value) {
                    custom[slot.id] = value
                    slotsChanged = true
                  }
                }
                if (slotsChanged) {
                  state.memorySlots = custom
                  changed = true
                }
              }
              if (changed) {
                await persist()
                syncPromptMemory()
              }
              sendJson(res, 200, { ok: true, value: publicState() })
              return
            }

            /* 导出明文备份；导入时整份替换，仍走同一套清洗与容量限制 */
            if (route === '/companion/memory/export' && req.method === 'GET') {
              requireOwnerConsole(req)
              await memoryStore.load()
              sendJson(res, 200, {
                ok: true,
                exportedAt: Date.now(),
                memory: memoryStore.snapshot(),
              })
              return
            }

            if (route === '/companion/memory/import' && req.method === 'POST') {
              requireOwnerConsole(req)
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

            /* 整库备份：加密导出、明文导出、恢复，三件事分开走；备份里含记忆，同样只给主人。 */
            if (route === '/companion/backup/export' && req.method === 'POST') {
              requireOwnerConsole(req)
              await ensureLoaded()
              const body = await readJsonBody(req, 1024 * 1024)
              const encrypted = body?.encrypted !== false
              const passphrase = typeof body?.passphrase === 'string' ? body.passphrase : ''
              const { fileName, backup } = await exportBackup(passphrase, encrypted)
              sendJson(res, 200, { ok: true, fileName, backup })
              return
            }

            if (route === '/companion/backup/restore' && req.method === 'POST') {
              requireOwnerConsole(req)
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
                active: effectiveBackground(),
                /* 四槽的名字，前端照着渲染选择器，不各自硬编码 */
                slotNames: BACKGROUND_SLOT_NAMES,
                /* 聊天页要的两个外观值：模糊像素和左侧配色 */
                appearance: {
                  bgBlur: Number(state.appearance?.bgBlur ?? 0) || 0,
                  palette: effectivePalette(),
                },
              })
              return
            }

            /* 上传一张图，同时决定它挂到哪一处；slot 缺省 page。只动这一个槽，别处不受影响。 */
            if (route === '/backgrounds' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req, 34 * 1024 * 1024)
              const item = await saveBackground(body)
              const slotName = BACKGROUND_SLOT_NAMES.includes(body?.slot) ? body.slot : 'page'
              const current = effectiveBackground()
              const nextSlots = { ...current.slots }
              nextSlots[slotName] = { ...nextSlots[slotName], id: item.id }
              state.background = {
                ...current,
                /* 旧字段跟着 page 走，旧客户端读 background.id 时仍然对得上 */
                id: slotName === 'page' ? item.id : current.id,
                slots: nextSlots,
              }
              await persist()
              sendJson(res, 200, { ok: true, item, active: effectiveBackground() })
              return
            }

            /* 删图前先解绑：所有引用这张图的槽位一起清空，避免留下指向空文件的坏引用。 */
            if (route === '/backgrounds/remove' && req.method === 'POST') {
              await ensureLoaded()
              const body = await readJsonBody(req)
              const targetId = String(body?.id ?? '')
              const current = effectiveBackground()
              const nextSlots = { ...current.slots }
              const unbound = []
              if (targetId !== '') {
                for (const name of BACKGROUND_SLOT_NAMES) {
                  if (nextSlots[name]?.id === targetId) {
                    nextSlots[name] = { ...nextSlots[name], id: '' }
                    unbound.push(name)
                  }
                }
              }
              await removeBackground(targetId)
              state.background = {
                ...current,
                id: current.id === targetId ? '' : current.id,
                slots: nextSlots,
              }
              await persist()
              sendJson(res, 200, { ok: true, active: effectiveBackground(), unbound })
              return
            }

            /* 某一处现在用哪张图：返回取景参数和可以直接铺上去的地址。 */
            if (route === '/background/current' && req.method === 'GET') {
              await ensureLoaded()
              const asked = url.searchParams.get('slot')
              const slotName = BACKGROUND_SLOT_NAMES.includes(asked) ? asked : 'page'
              const slot = effectiveBackground().slots[slotName]
              sendJson(res, 200, {
                ok: true,
                slot: slotName,
                value: {
                  ...slot,
                  url: slot.id === '' ? '' : `${ROUTE_PREFIX}/background/${encodeURIComponent(slot.id)}`,
                },
              })
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

            /* 自定义表情包：一套库，上传 / 批量导入 / 改名 / 删除都落 custom 目录。 */
            if (route === '/sticker/custom' && req.method === 'GET') {
              sendJson(res, 200, { ok: true, value: await listCustomStickers() })
              return
            }

            if (route === '/sticker/custom/upload' && req.method === 'POST') {
              const body = await readJsonBody(req, 12 * 1024 * 1024)
              const decoded = decodeStickerDataUrl(body?.dataUrl)
              if (decoded === null) throw new Error('这张图读不出来')
              const value = await saveCustomSticker({
                buffer: decoded.buffer,
                ext: decoded.ext,
                name: body?.name
              })
              sendJson(res, 200, { ok: true, value })
              return
            }

            if (route === '/sticker/custom/import' && req.method === 'POST') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, value: await importCustomStickers(body?.dir) })
              return
            }

            if (route === '/sticker/custom/rename' && req.method === 'POST') {
              const body = await readJsonBody(req)
              sendJson(res, 200, {
                ok: true,
                value: await renameCustomSticker(body?.id, body?.name)
              })
              return
            }

            if (route === '/sticker/custom/delete' && req.method === 'POST') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, value: await deleteCustomSticker(body?.id) })
              return
            }

            /* 待审表情：偷来的照片 / 横幅先留在这儿，由人决定留不留。 */
            if (route === '/sticker/inbox' && req.method === 'GET') {
              const items = await stickerInbox.list()
              sendJson(res, 200, {
                ok: true,
                value: items.map((item) => ({
                  ...item,
                  href: `${ROUTE_PREFIX}/sticker/inbox/raw/${encodeURIComponent(item.file)}`
                }))
              })
              return
            }

            if (route === '/sticker/inbox/approve' && req.method === 'POST') {
              const body = await readJsonBody(req)
              const value = await stickerInbox.approve(String(body?.id ?? ''), {
                /* 默认落进 qq-auto：批过的图立刻能参与「随机」挑图。 */
                packId: typeof body?.packId === 'string' && body.packId !== '' ? body.packId : 'qq-auto',
                name: typeof body?.name === 'string' ? body.name : ''
              })
              stickerLibrary.invalidate()
              sendJson(res, 200, { ok: true, value })
              return
            }

            if (route === '/sticker/inbox/reject' && req.method === 'POST') {
              const body = await readJsonBody(req)
              sendJson(res, 200, { ok: true, value: await stickerInbox.reject(String(body?.id ?? '')) })
              return
            }

            if (route.startsWith('/sticker/inbox/raw/') && req.method === 'GET') {
              await sendInboxFile(res, route.slice('/sticker/inbox/raw/'.length))
              return
            }

            if (route.startsWith('/sticker/') && req.method === 'GET') {
              await sendSticker(res, route.slice('/sticker/'.length))
              return
            }

            sendJson(res, 404, {
              ok: false,
              error: { code: 'not-found', message: `没有这个路由：${req.method} ${route}` },
            })
          } catch (error) {
            ctx.logger?.warn?.(`${PACKAGE_ID}: ${req.method} ${route} 失败`, error)
            const status = Number(error?.statusCode)
            const code = status === 403 ? 'forbidden' : 'bad-request'
            sendJson(res, status >= 400 && status <= 599 ? status : 400, {
              ok: false,
              error: { code, message: error?.message ?? String(error) },
            })
          }
        },
      })
    },
    `${PACKAGE_ID}: pet routes`,
  )
}
