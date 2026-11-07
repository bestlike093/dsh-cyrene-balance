/**
 * 形象素材包：识别与校验。
 *
 * 五类素材共用同一套目录约定：
 *   sprite   —— sprite.json / manifest.json，写多张立绘的表情映射
 *   live2d   —— *.model3.json
 *   image    —— png / jpg / jpeg / webp / avif
 *   gif      —— gif
 *   video    —— mp4 / webm / mov / m4v
 *
 * 单文件直接导入；文件夹按上面的优先级找入口。
 * 这个文件同时被宿主半（导入时校验）和桌宠半（启动时解析）使用。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

export const MODEL_KINDS = ['sprite', 'live2d', 'image', 'gif', 'video']

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.avif']
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v']
const SPRITE_MANIFESTS = ['sprite.json', 'manifest.json']

const EXT_KIND = new Map([
  ...IMAGE_EXTS.map((ext) => [ext, 'image']),
  ['.gif', 'gif'],
  ...VIDEO_EXTS.map((ext) => [ext, 'video']),
])

export function kindFromExt(name) {
  return EXT_KIND.get(extname(String(name ?? '')).toLowerCase()) ?? null
}

/** 把用户给的名字收成安全的目录名；非 ASCII 名字也能拿到稳定的 fallback。 */
export function sanitizeModelId(name) {
  const raw = String(name ?? '').trim().toLowerCase()
  const ascii = raw
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return ascii === '' ? `model-${Date.now().toString(36)}` : ascii
}

/**
 * 识别一个素材来源（文件或文件夹）。
 * 返回 { kind, entry }，entry 是相对来源根目录的入口文件名。
 * 无法识别时抛错，错误文案直接给用户看。
 */
export function detectModelSource(source) {
  const info = statSync(source)
  if (info.isDirectory()) {
    const files = readdirSync(source).filter((name) => !name.startsWith('.'))
    const live2d = files.find((name) => name.toLowerCase().endsWith('.model3.json'))
    if (live2d !== undefined) return { kind: 'live2d', entry: live2d }

    const manifest = SPRITE_MANIFESTS.find((name) => files.includes(name))
    if (manifest !== undefined) return { kind: 'sprite', entry: manifest }

    const media = files.filter((name) => kindFromExt(name) !== null)
    if (media.length === 1) return { kind: kindFromExt(media[0]), entry: media[0] }
    if (media.length === 0) {
      throw new Error('这个文件夹里没有找到立绘或模型文件（sprite.json / *.model3.json / 图片 / 视频）')
    }
    throw new Error('文件夹里有多张素材，分不清用哪一张；请只留一张，或写一份 sprite.json 指定表情')
  }

  const kind = kindFromExt(source)
  if (kind === null) {
    throw new Error('不认识这种文件格式，支持 png / jpg / webp / gif / mp4 / webm / model3.json / sprite.json')
  }
  return { kind, entry: basename(source) }
}

/**
 * sprite.json 的两种写法都接受：
 *   { "default": "calm", "poses": { "calm": "calm.png", "happy": "happy.png" } }
 *   { "poses": [ { "name": "calm", "file": "calm.png" }, ... ] }
 * 返回 { defaultPose, poses: [{ name, file }] }。
 */
export function parseSpriteManifest(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('sprite.json 不是合法的 JSON')
  }
  if (data === null || typeof data !== 'object') throw new Error('sprite.json 需要一个对象')

  const poses = []
  if (Array.isArray(data.poses)) {
    for (const item of data.poses) {
      if (item === null || typeof item !== 'object') continue
      if (typeof item.name !== 'string' || typeof item.file !== 'string') continue
      poses.push({ name: item.name, file: item.file })
    }
  } else if (data.poses !== null && typeof data.poses === 'object') {
    for (const [name, file] of Object.entries(data.poses)) {
      if (typeof file === 'string') poses.push({ name, file })
    }
  }
  if (poses.length === 0) throw new Error('sprite.json 里没有可用的 poses')

  const named = poses.map((pose) => pose.name)
  const fallback = typeof data.default === 'string' && named.includes(data.default) ? data.default : poses[0].name
  return { defaultPose: fallback, poses }
}

/**
 * 在已安装的素材目录里解析出可用的配置。
 * 返回 null 表示目录缺失或已损坏，调用方应回落到内置立绘。
 */
export function resolveModelConfig(dir, id) {
  let detected
  try {
    detected = detectModelSource(dir)
  } catch {
    return null
  }
  const config = { id, kind: detected.kind, entry: detected.entry }

  if (detected.kind === 'sprite') {
    let raw
    try {
      raw = readFileSync(join(dir, detected.entry), 'utf8')
    } catch {
      return null
    }
    try {
      const manifest = parseSpriteManifest(raw)
      config.poses = manifest.poses
      config.defaultPose = manifest.defaultPose
    } catch {
      return null
    }
  }

  return config
}
