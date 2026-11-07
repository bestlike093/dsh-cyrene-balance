/**
 * 素材包库：用户导入的字体 / 图标 / 气泡 / 表情包。
 *
 * 与 models.mjs 的分工：
 *   - models.mjs 只管 Live2D（userData/models）；
 *   - 这里只管静态素材（userData/packs），两边目录与扩展名都不交叉。
 *
 * 兼容两种包：
 *   1. 带 pack.json：按声明读元信息，文件仍按实际路径分类；
 *   2. 不带 pack.json：按目录名 / 文件名 / 扩展名推断，并在结果里标 guessed。
 *
 * 这里只做磁盘操作，不碰 Electron；主进程负责注入 root 和日志。
 */
import AdmZip from 'adm-zip'
import fs from 'node:fs/promises'
import path from 'node:path'

/** 允许的四类素材。推断不出类型的一律跳过，不硬塞。 */
export const PACK_KINDS = ['emoji', 'icon', 'font', 'bubble']

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico'])
const FONT_EXTS = new Set(['.woff', '.woff2', '.ttf', '.otf'])

/** 模型文件留在 models 目录；素材包里出现就整包拒绝。 */
const MODEL_SUFFIXES = ['.moc3', '.model3.json', '.motion3.json', '.physics3.json']

/** 压缩包垃圾。 */
const SKIP_NAMES = new Set(['__MACOSX', '.DS_Store', 'Thumbs.db'])

/** 上限：总量 128MB、单文件 16MB。 */
const MAX_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_DEPTH = 6

/** 目录名 / 文件名 → 素材类型。顺序有意义：emoji 先于 icon，避免 sticker 被吃。 */
const DIR_HINTS = [
  [/emoji|emote|sticker|表情|贴纸/i, 'emoji'],
  [/icon|图标/i, 'icon'],
  [/font|字体|字型/i, 'font'],
  [/bubble|气泡|对话|dialogue/i, 'bubble']
]

/** 这个名字本身是不是素材类型目录（emoji / fonts 等）。 */
function isKindDir(name) {
  return DIR_HINTS.some(([pattern]) => pattern.test(name))
}

/** zip slip 防线：绝对路径、反斜杠穿越、`..` 段一律不安全。单测直接用它。 */
export function isSafeEntryName(entryName) {
  const normalized = entryName.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return false
  if (normalized.split('/').includes('..')) return false
  return true
}

function sanitizeId(raw, fallback) {
  const cleaned = (raw ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\0]/g, '_')
    .replace(/^\.+$/, '')
    .slice(0, 64)
    .trim()
  return cleaned.length > 0 ? cleaned : fallback
}

async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function isSkippable(name) {
  return SKIP_NAMES.has(name)
}

function extOf(name) {
  return path.extname(name).toLowerCase()
}

function isModelFile(name) {
  const lower = name.toLowerCase()
  return MODEL_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

/** 判断一个相对路径属于哪类素材；判断不出返回 null。 */
export function kindFromPath(relative) {
  const parts = relative.split('/').filter(Boolean)
  if (parts.length === 0) return null

  const fileName = parts[parts.length - 1]
  const dirs = parts.slice(0, -1)

  for (const dir of dirs) {
    for (const [pattern, kind] of DIR_HINTS) {
      if (pattern.test(dir)) return kind
    }
  }

  const ext = extOf(fileName)
  if (FONT_EXTS.has(ext)) return 'font'
  if (!IMAGE_EXTS.has(ext)) return null

  // 根目录直接放图时，只能靠文件名判断；认不出就不猜。
  for (const [pattern, kind] of DIR_HINTS) {
    if (pattern.test(fileName)) return kind
  }
  return null
}

/** 深度受限地找 pack.json，返回最深允许范围内的候选绝对路径。 */
async function findManifestFiles(dir, depth = 0) {
  if (depth > MAX_DEPTH) return []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const found = []
  for (const entry of entries) {
    if (isSkippable(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await findManifestFiles(full, depth + 1)))
    } else if (entry.name === 'pack.json') {
      found.push(full)
    }
  }
  return found
}

/** 包根目录：优先 pack.json 所在目录；没有就取「只有一层子目录」的那层。 */
async function resolvePackBase(staging) {
  const manifests = await findManifestFiles(staging)
  if (manifests.length > 0) {
    const shallowest = manifests.sort((a, b) => a.length - b.length)[0]
    return { base: path.dirname(shallowest), manifestPath: shallowest }
  }

  const entries = await fs.readdir(staging, { withFileTypes: true }).catch(() => [])
  const dirs = entries.filter((entry) => entry.isDirectory() && !isSkippable(entry.name))
  const files = entries.filter((entry) => entry.isFile())
  // 只有「唯一子目录且不是 emoji/fonts 这类素材目录」时才把它当包根；
  // 否则会把 emoji/ 本身当成包根，把里面的文件名当成无法识别的散图。
  if (dirs.length === 1 && files.length === 0 && !isKindDir(dirs[0].name)) {
    return { base: path.join(staging, dirs[0].name), manifestPath: null }
  }
  return { base: staging, manifestPath: null }
}

/** 递归列出 base 下的文件，返回相对路径（统一 /）。 */
async function listFiles(base, dir = base, depth = 0, out = []) {
  if (depth > MAX_DEPTH) return out
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (isSkippable(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await listFiles(base, full, depth + 1, out)
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join('/'))
    }
  }
  return out
}

/** 带稳定错误码的素材包错误：主进程把 code 转给界面，文案由 i18n 提供。 */
function packError(code, message, details) {
  const error = new Error(message)
  error.code = code
  if (Array.isArray(details) && details.length > 0) error.details = details
  return error
}

/** 读 pack.json；坏 JSON 不抛到调用方以外，转为可见错误。 */
async function readManifest(manifestPath) {
  const raw = await fs.readFile(manifestPath, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw packError(
      'MANIFEST_INVALID',
      `pack.json 解析失败：${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw packError('MANIFEST_INVALID', 'pack.json 必须是一个对象')
  }
  return parsed
}

/** 把 manifest 里声明的 fonts / bubble 映射到实际文件上。 */
function applyManifestHints(manifest, files) {
  const fonts = new Map()
  const bubbles = new Map()

  const declaredFonts = Array.isArray(manifest.fonts) ? manifest.fonts : []
  for (const item of declaredFonts) {
    if (item === null || typeof item !== 'object') continue
    const file = typeof item.file === 'string' ? item.file.replace(/^\.?\//, '') : ''
    if (file === '' || !files.includes(file)) continue
    const family = typeof item.family === 'string' && item.family.trim() !== ''
      ? item.family.trim()
      : path.basename(file, path.extname(file))
    fonts.set(file, family)
  }

  const bubble = manifest.bubble
  if (bubble !== null && typeof bubble === 'object') {
    const file = typeof bubble.file === 'string' ? bubble.file.replace(/^\.?\//, '') : ''
    if (file !== '' && files.includes(file)) {
      const slice = Number.isInteger(bubble.slice) ? bubble.slice : 12
      bubbles.set(file, slice)
    }
  }

  return { fonts, bubbles }
}

/** 渲染侧专用地址；逐段编码，中文文件名不会坏。 */
export function packUrl(packId, relative) {
  const segments = relative.split(/[\\/]+/).filter(Boolean)
  const encoded = segments.map(encodeURIComponent).join('/')
  return `pet-media://pack/${encodeURIComponent(packId)}/${encoded}`
}

/**
 * @param {{ root: string, log?: (...args: unknown[]) => void }} options
 */
/** 内置包 id 前缀：与用户导入的 id 隔离，同时让 pack:<id>:<file> 仍可解析。 */
const BUILTIN_PREFIX = 'builtin-'

export function createPackStore({ root, builtinRoot = null, log = () => {} }) {
  /** 按 id 找包目录：builtin-* 落内置根，其余落导入根。 */
  function resolvePackRoot(packId) {
    if (builtinRoot !== null && packId.startsWith(BUILTIN_PREFIX)) {
      return path.join(builtinRoot, packId.slice(BUILTIN_PREFIX.length))
    }
    return path.join(root, packId)
  }

  async function ensureRoot() {
    await fs.mkdir(root, { recursive: true })
    return root
  }

  /** 被禁用的包只记 id；文件放在 packs 根下，`.import-*` 与它都会被列表跳过。 */
  async function readDisabled() {
    try {
      const raw = await fs.readFile(path.join(root, '.disabled.json'), 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
    } catch {
      return []
    }
  }

  async function writeDisabled(ids) {
    const unique = [...new Set(ids)]
    await fs.writeFile(path.join(root, '.disabled.json'), JSON.stringify(unique, null, 2), 'utf8')
  }

  /** 启用 / 停用一个包；只改清单，不删文件。 */
  async function setEnabled(id, enabled) {
    const safe = sanitizeId(id, '')
    if (safe === '' || safe !== id) {
      throw packError('PACK_ID_INVALID', '素材包 id 非法')
    }
    if (!(await pathExists(path.join(root, safe)))) {
      throw packError('PACK_NOT_FOUND', '素材包不存在')
    }
    const disabled = new Set(await readDisabled())
    if (enabled === false) {
      disabled.add(safe)
    } else {
      disabled.delete(safe)
    }
    await writeDisabled(disabled)
    log('[packs] 启用状态变更', safe, enabled !== false)
    return { ok: true, id: safe, enabled: enabled !== false }
  }

  function describeFile(packId, relative, kind, hints) {
    const base = {
      file: relative,
      name: path.basename(relative, path.extname(relative)),
      url: packUrl(packId, relative)
    }
    if (kind === 'font') {
      return { ...base, family: hints.fonts.get(relative) ?? base.name }
    }
    if (kind === 'bubble') {
      return { ...base, slice: hints.bubbles.get(relative) ?? 12 }
    }
    return base
  }

  /** 读一个已落盘的包目录，返回可直接给渲染侧的清单。坏包不抛出，带 reason。 */
  async function describePack(packId) {
    const dir = resolvePackRoot(packId)
    const stat = await fs.stat(dir).catch(() => null)
    if (stat === null || !stat.isDirectory()) return null

    const { base, manifestPath } = await resolvePackBase(dir)
    const files = await listFiles(base)
    const metaSource = manifestPath === null ? 'guessed' : 'manifest'

    let manifest = {}
    let manifestError
    if (manifestPath !== null) {
      try {
        manifest = await readManifest(manifestPath)
      } catch (error) {
        manifestError = error instanceof Error ? error.message : String(error)
      }
    }

    const hints = applyManifestHints(manifest, files)
    const byKind = { emoji: [], icon: [], font: [], bubble: [] }
    let totalBytes = 0
    for (const relative of files) {
      if (isModelFile(relative)) continue
      const kind = kindFromPath(relative)
      if (kind === null) continue
      // 逐个 stat 只为给设置页报真实占用；认不出的文件不计入。
      const stat = await fs.stat(path.join(base, relative)).catch(() => null)
      const bytes = stat?.size ?? 0
      totalBytes += bytes
      byKind[kind].push({ ...describeFile(packId, relative, kind, hints), bytes })
    }

    for (const kind of PACK_KINDS) {
      byKind[kind].sort((a, b) => a.file.localeCompare(b.file))
    }

    const kinds = PACK_KINDS.filter((kind) => byKind[kind].length > 0)
    const declaredKinds = Array.isArray(manifest.kinds)
      ? manifest.kinds.filter((kind) => PACK_KINDS.includes(kind))
      : []

    return {
      id: packId,
      source: packId.startsWith(BUILTIN_PREFIX) ? 'builtin' : 'imported',
      name: typeof manifest.name === 'string' && manifest.name.trim() !== ''
        ? manifest.name.trim()
        : path.basename(base),
      version: typeof manifest.version === 'string' ? manifest.version : '',
      author: typeof manifest.author === 'string' ? manifest.author : '',
      license: typeof manifest.license === 'string' ? manifest.license : '',
      metaSource,
      // 元信息坏了，或整包认不出任何素材，都算损坏。设置页要能看到它，而不是静默消失。
      broken: manifestError !== undefined || kinds.length === 0,
      ...(manifestError === undefined ? {} : { manifestError }),
      declaredKinds,
      kinds,
      counts: Object.fromEntries(PACK_KINDS.map((kind) => [kind, byKind[kind].length])),
      bytes: totalBytes,
      files: byKind,
      bubble: byKind.bubble[0] ?? null,
      font: byKind.font[0] ?? null,
      icon: byKind.icon[0] ?? null,
      emoji: byKind.emoji[0] ?? null
    }
  }

  /** 列全部包：内置在前、导入在后；`.import-*` 临时目录直接跳过。 */
  async function list() {
    await ensureRoot()
    const disabled = new Set(await readDisabled())
    const packs = []

    // 内置包只读：目录不存在就当作没有，不显示空分组。
    if (builtinRoot !== null) {
      const builtinEntries = await fs.readdir(builtinRoot, { withFileTypes: true }).catch(() => [])
      for (const entry of builtinEntries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const pack = await describePack(`${BUILTIN_PREFIX}${entry.name}`)
        if (pack !== null && pack.kinds.length > 0) packs.push({ ...pack, enabled: true })
      }
    }

    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const pack = await describePack(entry.name)
      // 导入目录里认不出素材的包也列出来，标成损坏，方便用户直接删掉。
      if (pack !== null) {
        packs.push({ ...pack, enabled: !disabled.has(pack.id) })
      }
    }
    packs.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    return packs
  }

  async function pickFreeId(preferred) {
    let candidate = preferred
    let index = 2
    while (await pathExists(path.join(root, candidate))) {
      candidate = `${preferred}-${index}`
      index += 1
      if (index > 99) throw new Error('素材包目录名冲突过多，请先清理 packs 目录')
    }
    return candidate
  }

  /** 校验压缩包条目；收集全部问题后一次性带回，界面可以逐条展示。 */
  function validateEntries(entries) {
    const issues = []
    let total = 0
    for (const entry of entries) {
      const normalized = entry.entryName.replace(/\\/g, '/')
      if (!isSafeEntryName(normalized)) {
        issues.push({
          code: 'PATH_UNSAFE',
          message: `压缩包内路径非法：${entry.entryName}`,
          entry: entry.entryName
        })
        continue
      }
      const baseName = path.basename(normalized)
      if (isSkippable(baseName)) continue
      if (entry.isDirectory) continue

      if (isModelFile(baseName)) {
        issues.push({
          code: 'MODEL_FILE',
          message: `素材包里不能放 Live2D 模型文件：${entry.entryName}`,
          entry: entry.entryName
        })
        continue
      }

      const ext = extOf(baseName)
      // README / LICENSE 这类附带文件直接跳过，不因为夹了一个说明文件就拒整包。
      if (!IMAGE_EXTS.has(ext) && !FONT_EXTS.has(ext) && baseName !== 'pack.json') {
        continue
      }

      const size = entry.header.size
      if (size > MAX_FILE_BYTES) {
        issues.push({
          code: 'FILE_TOO_LARGE',
          message: `单个文件超过 16MB：${entry.entryName}`,
          entry: entry.entryName
        })
        continue
      }
      total += size
      if (total > MAX_TOTAL_BYTES) {
        const mb = Math.round(total / (1024 * 1024))
        issues.push({
          code: 'TOTAL_TOO_LARGE',
          message: `解压后超过 128MB（累计到 ${mb}MB 时中止）`,
          entry: entry.entryName
        })
        break
      }
    }
    return issues
  }

  /** 从 zip 导入：先解到临时目录，校验通过后再搬进 packs/<id>。 */
  async function importFromZip(zipFile) {
    const stat = await fs.stat(zipFile).catch(() => null)
    if (stat === null || !stat.isFile()) {
      throw packError('INPUT_MISSING', '选择的文件不存在')
    }

    await ensureRoot()
    const staging = path.join(root, `.import-${Date.now()}`)
    await fs.mkdir(staging, { recursive: true })

    try {
      const zip = new AdmZip(zipFile)
      const issues = validateEntries(zip.getEntries())
      if (issues.length > 0) {
        throw packError(issues[0].code, issues[0].message, issues)
      }
      zip.extractAllTo(staging, true)

      const { base, manifestPath } = await resolvePackBase(staging)
      const files = await listFiles(base)
      const recognized = files.filter((relative) => kindFromPath(relative) !== null)
      if (recognized.length === 0) {
        throw packError(
          'NO_RECOGNIZED',
          '压缩包里没有可识别的素材。请按 emoji/ icons/ fonts/ bubbles/ 分目录，或在包根放 pack.json。',
          [
            {
              code: 'NO_RECOGNIZED',
              message: '未在 emoji/ icons/ fonts/ bubbles/ 下找到图片或字体',
              entry: ''
            },
            { code: 'NO_RECOGNIZED', message: '包根也没有可用的 pack.json', entry: 'pack.json' }
          ]
        )
      }

      let manifest = {}
      if (manifestPath !== null) {
        manifest = await readManifest(manifestPath)
      }

      const fallbackName = path.basename(zipFile, path.extname(zipFile))
      const preferred = sanitizeId(
        typeof manifest.id === 'string' && manifest.id.trim() !== '' ? manifest.id : fallbackName,
        'pack'
      )
      const id = await pickFreeId(preferred)
      const target = path.join(root, id)
      await fs.cp(base, target, { recursive: true })

      const pack = await describePack(id)
      if (pack === null || pack.kinds.length === 0) {
        await fs.rm(target, { recursive: true, force: true })
        throw packError('EMPTY_AFTER_IMPORT', '导入后没有可用素材')
      }

      log(`[packs] 导入完成 ${id}`, pack.metaSource, pack.counts)
      return pack
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** 删除一个包；只接受目录名，不接受路径。 */
  async function remove(id) {
    const safe = sanitizeId(id, '')
    if (safe === '' || safe !== id) {
      throw new Error('素材包 id 非法')
    }
    const target = path.join(root, safe)
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
    if (!target.startsWith(rootWithSep)) {
      throw new Error('素材包路径越界')
    }
    await fs.rm(target, { recursive: true, force: true })
    log('[packs] 已删除', safe)
    return { ok: true, id: safe }
  }

  /**
   * 把 pet-media 的相对路径解析成真实文件；越界一律返回 null。
   * 协议层只需要判断 null。
   */
  function resolvePackPath(packId, relative) {
    const safeId = sanitizeId(packId, '')
    if (safeId === '' || safeId !== packId) return null
    const packRoot = resolvePackRoot(safeId)
    const target = path.resolve(packRoot, relative)
    const rootWithSep = packRoot.endsWith(path.sep) ? packRoot : packRoot + path.sep
    if (target !== packRoot && !target.startsWith(rootWithSep)) return null
    return target
  }

  return { root, ensureRoot, list, importFromZip, remove, setEnabled, resolvePackPath }
}
