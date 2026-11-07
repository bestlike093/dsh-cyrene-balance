/**
 * 拍照：把她此刻的样子存成一张真实的 PNG。
 *
 * 素材来源就是她自己——桌宠窗口里那块 canvas。这里不画任何东西，
 * 只负责「截下来的一帧怎么落盘」。截屏动作由调用方注入，
 * 这样单测不用真的开窗口。
 *
 * 两条边界：
 * - 没截到就不生成文件，绝不用占位图冒充一张照片。
 * - 写入失败要如实返回原因，不能让她在聊天里说「拍好了」。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 最近保留几张，供「刚才那张」这类指代使用；只在内存里。 */
const RECENT_LIMIT = 8

/** 本地时间命名，按名字排序就是拍摄顺序。 */
export function photoFileName(at = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `selfie-${date}-${time}.png`
}

/**
 * 决定照片放哪儿。
 *
 * 优先用设置里的路径；没设置时用调用方给的默认目录。
 * 两条都空就返回空串，由上层当成「没有可用位置」处理。
 */
export function resolvePhotoFolder({ preferred = '', fallback = '' } = {}) {
  const trimmed = (value) => (typeof value === 'string' ? value.trim() : '')
  const first = trimmed(preferred)
  if (first !== '') return first
  return trimmed(fallback)
}

/**
 * @param {object} options
 * @param {() => Promise<Buffer|Uint8Array|null>} options.capture 截一帧，返回 PNG 字节
 * @param {string} [options.folder] 照片目录，缺省时 take() 直接失败
 * @param {() => number} [options.now]
 * @param {(message: string) => void} [options.log]
 */
export function createPhotoStudio(options = {}) {
  const capture = options.capture
  const folder = typeof options.folder === 'string' ? options.folder.trim() : ''
  const now = typeof options.now === 'function' ? options.now : Date.now
  const log = typeof options.log === 'function' ? options.log : () => undefined
  const recent = []

  /** 最近拍过的几张，最新在前；只读副本。 */
  function recentPhotos(limit = RECENT_LIMIT) {
    const size = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : RECENT_LIMIT
    return recent.slice(0, size)
  }

  async function take(meta = {}) {
    if (typeof capture !== 'function') return { ok: false, reason: 'no-capture' }
    if (folder === '') return { ok: false, reason: 'no-folder' }

    let bytes = null
    try {
      bytes = await capture()
    } catch (error) {
      log(`[photo] 截屏失败：${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, reason: 'capture-failed' }
    }
    if (bytes === null || bytes === undefined || bytes.length === 0) {
      return { ok: false, reason: 'empty-frame' }
    }

    const at = new Date(now())
    const file = path.join(folder, photoFileName(at))
    try {
      mkdirSync(folder, { recursive: true })
      writeFileSync(file, bytes)
    } catch (error) {
      log(`[photo] 写文件失败：${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, reason: 'write-failed' }
    }

    const photo = {
      path: file,
      at: at.toISOString(),
      bytes: bytes.length,
      note: typeof meta.note === 'string' ? meta.note.trim() : ''
    }
    recent.unshift(photo)
    if (recent.length > RECENT_LIMIT) recent.length = RECENT_LIMIT
    log(`[photo] 拍下一张：${file}（${bytes.length} 字节）`)
    return { ok: true, photo }
  }

  return { take, recentPhotos, folder: () => folder }
}

/** 目录存在与否，方便上层在启动时提示一次。 */
export function photoFolderExists(folder) {
  if (typeof folder !== 'string' || folder.trim() === '') return false
  try {
    return existsSync(folder)
  } catch {
    return false
  }
}

/**
 * 问「有没有拍照这个功能」不触发；「拍张照，发我可以吗」是请求，该拍。
 * 只看功能问法，不拿「可以吗 / 能不能」这类礼貌问句一票否决。
 */
const ASKING =
  /(为什么|怎么).{0,4}(不能|没法|没有|不会)?拍|(能|可以)(拍照|拍照片)|(拍照|拍照片).{0,4}(功能|吗|么)/

/**
 * 这句话是不是在要一张照片。
 *
 * 宁可漏判也不误判：单独出现「照片」两个字不算，
 * 必须带上「拍 / 自拍 / 照张相」这类明确的动作。
 */
export function wantsSelfie(text) {
  if (typeof text !== 'string') return false
  const said = text.trim()
  if (said === '' || said.length > 40) return false
  if (ASKING.test(said)) return false
  if (/自拍/.test(said)) return true
  if (/照(一张|张|个)?相/.test(said)) return true
  // 「拍张」「拍一张」「拍一下」这类动作词组本身就是索要照片。
  if (/(拍|照)(一张|张|个|一下|几张)/.test(said)) return true
  return /拍.{0,3}(照|相|你)/.test(said)
}

/**
 * 聊天里该不该真去拍一张。
 *
 * 群聊里只认主人：陌生人的一句「拍张照」不该把桌面画面要走。
 */
export function shouldSelfieInChat({ text, chatType, isOwner } = {}) {
  if (!wantsSelfie(text)) return false
  if (chatType === 'group') return isOwner === true
  return chatType === 'private'
}

/**
 * 照片文件 → 渲染层能直接放进 <img> 的地址。
 *
 * 只认照片目录里的单层文件名，别处路径一律不给地址，
 * 免得把协议变成任意读文件的通道。
 */
export function photoMediaUrl(filePath, folder) {
  if (typeof filePath !== 'string' || typeof folder !== 'string') return ''
  if (folder.trim() === '') return ''
  const name = path.basename(filePath)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return ''
  try {
    if (path.resolve(path.dirname(filePath)) !== path.resolve(folder)) return ''
  } catch {
    return ''
  }
  return `pet-media://photo/${encodeURIComponent(name)}`
}

