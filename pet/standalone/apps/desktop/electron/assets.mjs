/**
 * 随包素材库：扫 assets/ 下的表情与立绘，给渲染侧一份可直接用的清单。
 *
 * 只做两件事：列目录、拼 pet-media://asset 地址。不读图片内容、不改文件，
 * 也不把绝对路径交给渲染进程。
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import { DEFAULT_EMOJI_CATALOG } from '@pet/core/browser'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** 素材目录的展示名；不认识的目录直接用目录名，不瞎猜。 */
const GROUP_NAMES = {
  cyrene: 'Cyrene · 默认素材'
}

/** 拼 pet-media://asset/...；逐段编码，目录名有中文也不会坏。 */
export function assetUrl(relative) {
  const segments = relative.split(/[\\/]+/).filter((part) => part !== '')
  return `pet-media://asset/${segments.map(encodeURIComponent).join('/')}`
}

/** 列一层目录里的图片；subdir 只用于拼相对路径。 */
async function listImages(dir, groupId, subdir = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const items = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = path.extname(entry.name).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue

    const stem = path.basename(entry.name, ext)
    const relative = subdir === ''
      ? path.join(groupId, entry.name)
      : path.join(groupId, subdir, entry.name)

    items.push({
      id: subdir === '' ? `${groupId}/${stem}` : `${groupId}/${subdir}/${stem}`,
      name: stem,
      file: subdir === '' ? entry.name : `${subdir}/${entry.name}`,
      url: assetUrl(relative)
    })
  }

  items.sort((a, b) => a.file.localeCompare(b.file))
  return items
}

/**
 * Cyrene 默认素材：立绘、帧、头像分在子目录里，只列这几类给素材面板。
 * 表情 40+ 张不进 items（体积白扛），渲染侧按 manifest 的 emotions 直接取地址。
 */
async function listCyrene(dir, groupId) {
  const items = []
  for (const subdir of ['stand', 'frames']) {
    items.push(...(await listImages(path.join(dir, subdir), groupId, subdir)))
  }
  const avatar = await listImages(dir, groupId)
  items.push(...avatar.filter((item) => item.file === 'avatar.png'))
  items.sort((a, b) => a.file.localeCompare(b.file))
  return items
}

/** manifest 里的相对路径 → pet-media 地址；语义字段（license 等）原样保留。 */
function resolveCyreneUrls(manifest) {
  const prefix = (relative) =>
    typeof relative === 'string' ? assetUrl(path.join('cyrene', relative)) : relative

  const mapValues = (source) => {
    if (source === null || typeof source !== 'object') return source
    const out = {}
    for (const [key, value] of Object.entries(source)) {
      out[key] = Array.isArray(value) ? value.map(prefix) : prefix(value)
    }
    return out
  }

  return {
    poses: mapValues(manifest.poses),
    frames: mapValues(manifest.frames),
    emotions: mapValues(manifest.emotions),
    sounds: mapValues(manifest.sounds),
    stickers: mapValues(manifest.stickers),
    avatar: prefix(manifest.avatar),
    // 陪伴层给表情 id（如 hugtight），渲染层要能换成实际图片地址。
    // 清单以 core 的 DEFAULT_EMOJI_CATALOG 为准，和选图器保持同一份来源。
    emojiFiles: Object.fromEntries(
      DEFAULT_EMOJI_CATALOG.map((entry) => [entry.id, assetUrl(path.join('cyrene', 'emoji', entry.file))])
    )
  }
}

/** 读 assets/cyrene/manifest.json；缺文件或坏 JSON 都不抛，返回 null 让调用方退回默认。 */
async function readCyreneManifest(root) {
  try {
    const raw = await fs.readFile(path.join(root, 'cyrene', 'manifest.json'), 'utf8')
    // PowerShell 写出的 JSON 带 BOM，直接 parse 会报 Unexpected token。
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
    return parsed !== null && typeof parsed === 'object' ? resolveCyreneUrls(parsed) : null
  } catch {
    return null
  }
}

/**
 * @param {{ root: string }} options
 */
export function createAssetLibrary({ root }) {
  /** 只扫 root 下的已知目录，不递归全盘。 */
  async function list() {
    let entries
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { ok: true, groups: [], total: 0, reason: 'assets-missing' }
      }
      throw error
    }

    const groups = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue

      const dir = path.join(root, entry.name)
      let items
      if (entry.name === 'cyrene') {
        items = await listCyrene(dir, entry.name)
      } else {
        items = await listImages(dir, entry.name)
      }
      if (items.length === 0) continue

      groups.push({
        id: entry.name,
        name: GROUP_NAMES[entry.name] ?? entry.name,
        items
      })
    }

    groups.sort((a, b) => a.id.localeCompare(b.id))
    const cyrene = await readCyreneManifest(root)
    return {
      ok: true,
      groups,
      total: groups.reduce((sum, group) => sum + group.items.length, 0),
      ...(cyrene === null ? {} : { cyrene })
    }
  }

  return { root, list }
}
