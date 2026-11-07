/**
 * Live2D 模型库。
 *
 * 模型文件不再随包分发（作者授权禁止再分发），全部放在 userData/models 下，
 * 由使用者自己从作者处下载后经「导入本地模型」放进来。
 *
 * 这里只负责磁盘操作，不碰 Electron；主进程负责注入 root 和日志。
 */
import AdmZip from 'adm-zip'
import fs from 'node:fs/promises'
import path from 'node:path'

/** 这些扩展名对运行没帮助，但会让导入慢很多（作者的 PSD 有 131MB）。 */
const SKIP_EXTENSIONS = new Set(['.psd', '.psb', '.ai', '.clip', '.xcf'])
/** 压缩包里常见的垃圾目录。 */
const SKIP_NAMES = new Set(['__MACOSX', '.DS_Store', 'Thumbs.db'])

/** 解压总量上限，防 zip 炸弹。 */
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
/** 单个模型目录扫描深度上限。 */
const MAX_DEPTH = 6

/** 目录名只保留安全字符，避免拼路径时带出分隔符。 */
function sanitizeId(raw, fallback) {
  const base = (raw ?? '').trim().replace(/\.model3\.json$/i, '')
  const cleaned = base
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
  if (SKIP_NAMES.has(name)) return true
  return SKIP_EXTENSIONS.has(path.extname(name).toLowerCase())
}

/** 深度受限地找 model3.json，返回相对路径列表。 */
async function findModelFiles(dir, depth = 0) {
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
      found.push(...(await findModelFiles(full, depth + 1)))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.model3.json')) {
      found.push(full)
    }
  }
  return found
}

/** 读 model3.json 里的显示名，读不到就用目录名。 */
async function readModelName(modelFile) {
  try {
    const raw = JSON.parse(await fs.readFile(modelFile, 'utf8'))
    const name = raw?.Name ?? raw?.name
    return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null
  } catch {
    return null
  }
}

/** 校验模型自洽：moc3 必须真实存在，否则加载时才炸，用户看不到原因。 */
async function validateModel(modelFile) {
  let raw
  try {
    raw = JSON.parse(await fs.readFile(modelFile, 'utf8'))
  } catch (error) {
    return { ok: false, reason: `model3.json 解析失败：${error instanceof Error ? error.message : String(error)}` }
  }

  const mocRelative = raw?.FileReferences?.Moc
  if (typeof mocRelative !== 'string' || mocRelative.length === 0) {
    return { ok: false, reason: '缺少 FileReferences.Moc' }
  }

  const mocPath = path.resolve(path.dirname(modelFile), mocRelative)
  if (!(await pathExists(mocPath))) {
    return { ok: false, reason: `缺少 moc3 文件：${mocRelative}` }
  }

  const textures = raw?.FileReferences?.Textures
  const textureCount = Array.isArray(textures) ? textures.length : 0
  return { ok: true, mocPath, textureCount }
}

/**
 * @param {{ root: string, log?: (...args: unknown[]) => void }} options
 */
export function createModelStore({ root, log = () => {} }) {
  async function ensureRoot() {
    await fs.mkdir(root, { recursive: true })
    return root
  }

  /** 列出现有模型。坏掉的模型也列出来，但带 invalid 标记，设置窗能显示原因。 */
  async function list() {
    await ensureRoot()
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    const models = []

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = path.join(root, entry.name)
      const files = await findModelFiles(dir)
      if (files.length === 0) continue

      // 同一模型目录里可能躺着多份 model3.json（作者留的旧版本），取最浅的那份。
      const modelFile = files.sort((a, b) => a.length - b.length)[0]
      const check = await validateModel(modelFile)
      const displayName = (await readModelName(modelFile)) ?? entry.name

      models.push({
        id: entry.name,
        name: displayName,
        // 相对「模型自己的目录」，不含 id 前缀：拼 URL 时 id 只出现一次。
        modelFile: path.relative(dir, modelFile).split(path.sep).join('/'),
        valid: check.ok,
        ...(check.ok
          ? { textureCount: check.textureCount }
          : { reason: check.reason })
      })
    }

    models.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    return models
  }

  /** 找一个还没被占用的目录名，重名时追加 -2 / -3。 */
  async function pickFreeId(preferred) {
    let candidate = preferred
    let index = 2
    while (await pathExists(path.join(root, candidate))) {
      candidate = `${preferred}-${index}`
      index += 1
      if (index > 99) throw new Error('模型目录名冲突过多，请先整理 models 目录')
    }
    return candidate
  }

  /**
   * 把「模型根目录」搬进 models/<id>。
   * 调用方已经保证 modelDir 里直接放着 model3.json。
   */
  async function adoptDirectory(modelDir, nameHint) {
    await ensureRoot()
    const desired = sanitizeId(nameHint, 'model')
    const id = await pickFreeId(desired)
    const target = path.join(root, id)

    await fs.cp(modelDir, target, {
      recursive: true,
      filter: (source) => {
        const name = path.basename(source)
        if (isSkippable(name)) return false
        return true
      }
    })

    const files = await findModelFiles(target)
    if (files.length === 0) {
      await fs.rm(target, { recursive: true, force: true })
      throw new Error('导入后找不到 model3.json')
    }

    const modelFile = files.sort((a, b) => a.length - b.length)[0]
    const check = await validateModel(modelFile)
    if (!check.ok) {
      await fs.rm(target, { recursive: true, force: true })
      throw new Error(check.reason)
    }

    return {
      id,
      name: (await readModelName(modelFile)) ?? id,
      modelFile: path.relative(target, modelFile).split(path.sep).join('/'),
      textureCount: check.textureCount
    }
  }

  /** 从文件夹导入：找到最浅的 model3.json，把它的父目录当作模型根。 */
  async function importFromDirectory(sourceDir) {
    const stat = await fs.stat(sourceDir).catch(() => null)
    if (stat === null || !stat.isDirectory()) {
      throw new Error('选择的路径不是文件夹')
    }

    const files = await findModelFiles(sourceDir)
    if (files.length === 0) {
      throw new Error('这个文件夹里没有 .model3.json')
    }
    const modelFile = files.sort((a, b) => a.length - b.length)[0]
    const modelDir = path.dirname(modelFile)
    log('[models] 文件夹导入，模型根 =', modelDir)

    return adoptDirectory(modelDir, path.basename(modelDir))
  }

  /** 从 zip 导入：先解到临时目录，找到模型根后再搬进 models。 */
  async function importFromZip(zipFile) {
    const stat = await fs.stat(zipFile).catch(() => null)
    if (stat === null || !stat.isFile()) {
      throw new Error('选择的文件不存在')
    }

    await ensureRoot()
    const staging = path.join(root, `.import-${Date.now()}`)
    await fs.mkdir(staging, { recursive: true })

    try {
      const zip = new AdmZip(zipFile)
      const entries = zip.getEntries()
      let total = 0

      for (const entry of entries) {
        // zip slip：entryName 里出现 .. 或绝对路径一律拒绝整包。
        const normalized = entry.entryName.replace(/\\/g, '/')
        if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
          throw new Error(`压缩包内路径非法：${entry.entryName}`)
        }
        const baseName = path.basename(normalized)
        if (isSkippable(baseName)) continue
        total += entry.header.size
        if (total > MAX_TOTAL_BYTES) {
          throw new Error('压缩包解压后超过 512MB，已中止')
        }
      }

      // extractAllTo 会自己处理目录层级；上面已经逐个校验过路径。
      zip.extractAllTo(staging, true)

      const files = await findModelFiles(staging)
      if (files.length === 0) {
        throw new Error('压缩包里没有 .model3.json')
      }
      const modelFile = files.sort((a, b) => a.length - b.length)[0]
      const modelDir = path.dirname(modelFile)
      log('[models] zip 导入，模型根 =', modelDir)

      return await adoptDirectory(modelDir, path.basename(modelDir))
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** 渲染侧用的相对地址：pet-media://model/<id>/<modelFile 的剩余部分>。 */
  function toMediaUrl(model) {
    const relative = model.modelFile.split('/').map(encodeURIComponent).join('/')
    return `pet-media://model/${encodeURIComponent(model.id)}/${relative}`
  }

  return { root, ensureRoot, list, importFromDirectory, importFromZip, toMediaUrl }
}
