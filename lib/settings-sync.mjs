/**
 * dsh-cyrene-pet — 双端设置映射表。
 *
 * 两端存储结构不同，不能整包互换：
 *   DSH  ：state.json，扁平点路径（nickname / ui / bubbleMode / speechEnabled …）
 *   桌宠 ：settings.json，深层结构（nickname / uiMode / bubble.mode / voice.enabled …）
 *
 * 这里只登记「语义确实相同」的字段，逐项转换。未登记的字段各端自理，
 * 宁可少同步几项，也不做猜测式映射。
 *
 * 密钥（apiKey / appSecret / syncToken）永远不进来。
 */

export const SYNC_VERSION = 1

/* 主题：桌宠存预设名，DSH 存短名。 */
const THEME_TO_PET = { pink: 'SakuraPink', blue: 'OceanBlue', ink: 'Paper' }
const THEME_TO_DSH = { SakuraPink: 'pink', OceanBlue: 'blue', Paper: 'ink' }

/* 渲染方式：桌宠叫 renderMode，DSH 叫 renderer。 */
const RENDER_TO_PET = { sprite: 'embedded', live2d: 'live2d' }
const RENDER_TO_DSH = { embedded: 'sprite', live2d: 'live2d' }

/* 界面形态两端同名，但非法值一律回退 pet。 */
const UI_VALUES = new Set(['pet', 'card'])

/**
 * 每项声明：
 *   dsh / pet  两端点路径
 *   type       string | bool | number | enum
 *   toPet / toDsh  可选枚举换算
 *   min / max      数字夹取范围
 */
export const FIELDS = [
  { dsh: 'nickname', pet: 'nickname', type: 'string', maxLength: 24 },
  { dsh: 'ui', pet: 'uiMode', type: 'enum', values: ['pet', 'card'] },
  { dsh: 'theme', pet: 'theme.preset', type: 'enum', values: ['pink', 'blue', 'ink'],
    toPet: (v) => THEME_TO_PET[v] ?? 'SakuraPink', toDsh: (v) => THEME_TO_DSH[v] ?? 'pink' },
  { dsh: 'renderer', pet: 'renderMode', type: 'enum', values: ['sprite', 'live2d'],
    toPet: (v) => RENDER_TO_PET[v] ?? 'embedded', toDsh: (v) => RENDER_TO_DSH[v] ?? 'sprite' },
  { dsh: 'scale', pet: 'window.scale', type: 'number', min: 0.6, max: 1.8 },
  { dsh: 'bubbleMode', pet: 'bubble.mode', type: 'enum', values: ['rotate', 'info', 'talk', 'today'] },
  { dsh: 'bubbleFont', pet: 'bubble.fontSize', type: 'number', min: 11, max: 20 },
  { dsh: 'bubbleWidth', pet: 'bubble.width', type: 'number', min: 0, max: 600 },
  { dsh: 'bubbleStickerSize', pet: 'bubble.stickerSize', type: 'number', min: 24, max: 160 },
  { dsh: 'bubbleRadius', pet: 'bubble.radius', type: 'number', min: 0, max: 18 },
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
  { dsh: 'qq.appId', pet: 'channels.qq.appId', type: 'string', maxLength: 64 },
]

/* ------------------------------ 路径工具 ------------------------------ */

export function readPath(source, path) {
  if (source === null || typeof source !== 'object') return undefined
  const parts = path.split('.')
  let cursor = source
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = cursor[part]
  }
  return cursor
}

export function writePath(target, path, value) {
  const parts = path.split('.')
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

/* ------------------------------ 值规范化 ------------------------------ */

function clamp(value, field) {
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  if (field.min !== undefined && n < field.min) return field.min
  if (field.max !== undefined && n > field.max) return field.max
  return n
}

/** 把一个原始值按字段声明收敛成安全值；不合法返回 undefined，表示「这次跳过」。 */
export function normalizeValue(field, raw) {
  if (raw === undefined || raw === null) return undefined
  if (field.type === 'bool') return raw === true || raw === 'true'
  if (field.type === 'number') return clamp(raw, field)
  if (field.type === 'enum') {
    const list = field.values ?? (field.dsh === 'ui' ? [...UI_VALUES] : [])
    return list.includes(raw) ? raw : undefined
  }
  const text = String(raw).slice(0, field.maxLength ?? 400)
  return text
}

/* ------------------------------ 双向读取 ------------------------------ */

/**
 * 从 DSH state 抽出可同步的字段，转成「桌宠路径 → 值」。
 * 返回 plain patch，调用方负责合并与持久化。
 */
export function dshToPetPatch(state) {
  const patch = {}
  for (const field of FIELDS) {
    const raw = readPath(state, field.dsh)
    const value = normalizeValue(field, raw)
    if (value === undefined) continue
    const converted = field.toPet ? field.toPet(value) : value
    if (converted === undefined) continue
    writePath(patch, field.pet, converted)
  }
  return patch
}

/**
 * 从桌宠 settings 抽出可同步的字段，转成「DSH 路径 → 值」。
 */
export function petToDshPatch(settings) {
  const patch = {}
  for (const field of FIELDS) {
    const raw = readPath(settings, field.pet)
    const value = normalizeValue(field, raw)
    if (value === undefined) continue
    const converted = field.toDsh ? field.toDsh(value) : value
    if (converted === undefined) continue
    writePath(patch, field.dsh, converted)
  }
  return patch
}

/* ------------------------------ 差异比较 ------------------------------ */

export function sameValue(a, b) {
  if (typeof a === 'object' && a !== null) return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}

/**
 * 比较两端同一字段，返回需要执行的动作。
 * 结果形如 { dsh: ['nickname'], pet: [] } —— 列出各自需要写入的路径。
 *
 * 语义：
 *   - 只有一边存在 → 写成另一边。
 *   - 两边都存在且不同 → 由调用方按时间戳判定谁更新；这里只报「不同」。
 */
export function compareSides(dshState, petSettings) {
  const differences = []
  for (const field of FIELDS) {
    const dshValue = readPath(dshState, field.dsh)
    const petValue = readPath(petSettings, field.pet)
    if (dshValue === undefined && petValue === undefined) continue
    if (dshValue === undefined) {
      differences.push({ field, winner: 'pet' })
      continue
    }
    if (petValue === undefined) {
      differences.push({ field, winner: 'dsh' })
      continue
    }
    const normalizedDsh = field.toPet
      ? field.toPet(normalizeValue(field, dshValue))
      : normalizeValue(field, dshValue)
    const normalizedPet = normalizeValue(field, petValue)
    if (!sameValue(normalizedDsh, normalizedPet)) {
      differences.push({ field, winner: null })
    }
  }
  return differences
}
