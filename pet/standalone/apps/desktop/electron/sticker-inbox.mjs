/**
 * 表情包待审核队列。
 *
 * 设计约束：
 *   - QQ 偷来的图先落 packs/.inbox，不直接进素材包；
 *   - 只有用户在预览页点「入库」才会移动到 packs/<packId>/emoji；
 *   - .inbox 以点开头，packStore.list() 会跳过，不会被当成素材包。
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const INBOX_DIR = '.inbox'
const INDEX_FILE = 'index.json'
/** 内容指纹表：同一张图被同一个人发十次，只收一次。 */
const HASH_FILE = 'hashes.json'
/** 指纹只留最近 2000 张；超出的丢最久没再出现的，内存和磁盘都不涨。 */
const MAX_HASHES = 2000
/** 待审核最多留 200 张，超出的从最旧开始丢，避免默默占满磁盘。 */
const MAX_ITEMS = 200
/** 自动收下的图放在这个素材包里，和用户手动入库的分开。 */
const AUTO_PACK_ID = 'qq-auto'
/** 自动收下的上限：表情包基本都远小于这个；超过的更像照片/截图。 */
const AUTO_MAX_BYTES = 1.6 * 1024 * 1024
/** 自动收下的最大边长。 */
const AUTO_MAX_SIDE = 1024

/** 从文件头读宽高，读不到就返回 null，不猜。 */
function readImageSize(buffer, ext) {
  try {
    if (ext === '.png' && buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    }
    if (ext === '.gif' && buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
    }
    if (ext === '.jpg' || ext === '.jpeg') {
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1
          continue
        }
        const marker = buffer[offset + 1]
        const length = buffer.readUInt16BE(offset + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
        }
        if (length <= 0) return null
        offset += 2 + length
      }
      return null
    }
    if (ext === '.webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF') {
      const kind = buffer.toString('ascii', 12, 16)
      if (kind === 'VP8X') {
        return {
          width: 1 + buffer.readUIntLE(24, 3),
          height: 1 + buffer.readUIntLE(27, 3)
        }
      }
      if (kind === 'VP8 ') {
        return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
      }
      if (kind === 'VP8L' && buffer.length >= 25) {
        const bits = buffer.readUInt32LE(21)
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
      }
      return null
    }
  } catch {
    return null
  }
  return null
}

/**
 * 判断一张图「像不像表情包」。
 * 这一步刻意保守：只把明确的小图、接近方块、透明友好的格式自动收下，
 * 横幅截图、长图、大照片都留给人工看一眼。
 */
export function screenSticker({ buffer, contentType, ext }) {
  const size = Number(buffer?.byteLength ?? 0)
  if (size === 0) return { auto: false, reason: 'empty' }
  if (size > AUTO_MAX_BYTES) return { auto: false, reason: 'too-large' }

  const box = readImageSize(buffer, ext)
  if (box === null || box.width <= 0 || box.height <= 0) {
    // 读不出尺寸时只有动图能放心收：静态图可能是截图。
    return {
      auto: ext === '.gif' && size <= AUTO_MAX_BYTES,
      reason: ext === '.gif' ? 'gif-unknown-size' : 'unknown-size'
    }
  }

  const ratio = box.width / box.height
  if (box.width > AUTO_MAX_SIDE || box.height > AUTO_MAX_SIDE) {
    return { auto: false, reason: 'too-big', ...box }
  }
  if (ratio > 1.9 || ratio < 0.53) {
    return { auto: false, reason: 'not-square', ...box }
  }
  if ((contentType === 'image/jpeg' || contentType === 'image/jpg') && size > 700 * 1024) {
    return { auto: false, reason: 'photo-like', ...box }
  }
  return { auto: true, reason: 'small-square', ...box }
}

/** 只接受这几种图片；QQ 发来的贴图基本都在里面。 */
const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp'
}

function sanitizeName(raw, fallback) {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\0]/g, '_')
    .replace(/^\.+$/, '')
    .slice(0, 64)
    .trim()
  return cleaned === '' ? fallback : cleaned
}

export function createStickerInbox({ root, log = () => {} }) {
  const dir = path.join(root, INBOX_DIR)
  const indexPath = path.join(dir, INDEX_FILE)
  const hashPath = path.join(dir, HASH_FILE)

  async function ensure() {
    await fs.mkdir(dir, { recursive: true })
  }

  async function readIndex() {
    try {
      const raw = await fs.readFile(indexPath, 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed?.items) ? parsed.items : []
    } catch {
      return []
    }
  }

  async function writeIndex(items) {
    await ensure()
    await fs.writeFile(indexPath, JSON.stringify({ items }, null, 2), 'utf8')
  }

  /** 指纹表坏了就当空的：宁可重复收一张，也别让偷图整条链路停下来。 */
  async function readHashes() {
    try {
      const raw = await fs.readFile(hashPath, 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed?.items) ? parsed.items : []
    } catch {
      return []
    }
  }

  async function writeHashes(items) {
    await ensure()
    // 按最近一次出现时间留最近的 2000 条，旧的自然淘汰。
    const trimmed = items
      .filter((item) => typeof item?.hash === 'string' && item.hash !== '')
      .sort((a, b) => Number(b.lastSeenAt ?? 0) - Number(a.lastSeenAt ?? 0))
      .slice(0, MAX_HASHES)
    await fs.writeFile(hashPath, JSON.stringify({ items: trimmed }, null, 2), 'utf8')
  }

  /** 记一张新图；已经有的只更新「最近一次出现」。 */
  async function rememberHash(entry, hashes) {
    const list = hashes ?? (await readHashes())
    const hit = list.find((item) => item.hash === entry.hash)
    if (hit !== undefined) {
      hit.lastSeenAt = entry.lastSeenAt
      hit.seenCount = Math.max(1, Number(hit.seenCount ?? 1)) + 1
      await writeHashes(list)
      return
    }
    list.unshift(entry)
    await writeHashes(list)
  }

  async function fileExists(target) {
    return fs.access(target).then(() => true).catch(() => false)
  }

  function newId() {
    const now = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    return `qi-${stamp}-${crypto.randomBytes(3).toString('hex')}`
  }

  /** 在目标目录里找一个不撞名的位置。 */
  async function uniqueTarget(targetDir, baseName, ext) {
    let target = path.join(targetDir, `${baseName}${ext}`)
    let suffix = 2
    while (await fs.access(target).then(() => true).catch(() => false)) {
      target = path.join(targetDir, `${baseName}-${suffix}${ext}`)
      suffix += 1
      if (suffix > 999) throw new Error('同名文件过多，请先整理素材包')
    }
    return target
  }

  /**
   * 落一张图。buffer 由调用方下载好再交进来，这里只做磁盘与索引。
   *
   * autoApprove 打开且画面判定「像表情包」时，直接进 AUTO_PACK_ID，
   * 不占待审核队列；判定不确定的照旧留在 .inbox 等人看。
   */
  async function add({
    buffer,
    contentType,
    source = 'qq',
    chatType = '',
    senderOpenId = '',
    groupOpenId = '',
    filename = '',
    autoApprove = false
  }) {
    const type = String(contentType ?? '').toLowerCase().split(';')[0].trim()
    const ext = EXT_BY_TYPE[type]
    if (ext === undefined) {
      throw new Error(`不支持的图片类型：${contentType ?? 'unknown'}`)
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('图片内容为空')
    }

    // 同一张表情包在群里被转来转去很常见：按内容指纹只收第一次。
    const hash = crypto.createHash('sha256').update(buffer).digest('hex')
    const hashes = await readHashes()
    const previous = hashes.find((item) => item.hash === hash)
    if (previous !== undefined) {
      const previousPath =
        previous.packId === AUTO_PACK_ID
          ? path.join(root, AUTO_PACK_ID, 'emoji', previous.file)
          : path.join(dir, previous.file)
      if (await fileExists(previousPath)) {
        previous.lastSeenAt = Date.now()
        previous.seenCount = Math.max(1, Number(previous.seenCount ?? 1)) + 1
        await writeHashes(hashes)
        log('[sticker] 这张已经有了，跳过', previous.id)
        return { ...previous, duplicate: true, reason: 'duplicate' }
      }
      // 文件被人删了：指纹记录跟着作废，把它当新图重新收。
      hashes.splice(hashes.indexOf(previous), 1)
      await writeHashes(hashes)
    }

    const id = newId()
    const safeFilename = sanitizeName(filename, `${id}${ext}`)
    const receivedAt = Date.now()

    if (autoApprove) {
      const verdict = screenSticker({ buffer, contentType: type, ext })
      if (verdict.auto) {
        const targetDir = path.join(root, AUTO_PACK_ID, 'emoji')
        await fs.mkdir(targetDir, { recursive: true })
        const base = path.basename(safeFilename, ext)
        const target = await uniqueTarget(targetDir, sanitizeName(base, id), ext)
        await fs.writeFile(target, buffer)
        const item = {
          id,
          file: path.basename(target),
          packId: AUTO_PACK_ID,
          autoApproved: true,
          source,
          chatType,
          groupOpenId,
          senderOpenId,
          filename: safeFilename,
          contentType: type,
          bytes: buffer.byteLength,
          receivedAt,
          reason: verdict.reason
        }
        await rememberHash({ hash, ...item, firstSeenAt: receivedAt, lastSeenAt: receivedAt, seenCount: 1 })
        log('[sticker] 自动收下', id, '→', target, verdict.reason)
        return item
      }
      log('[sticker] 留给人工看一眼：', verdict.reason)
    }

    const file = `${id}${ext}`
    await ensure()
    await fs.writeFile(path.join(dir, file), buffer)

    const items = await readIndex()
    const item = {
      id,
      file,
      source,
      chatType,
      groupOpenId,
      senderOpenId,
      filename: safeFilename,
      contentType: type,
      bytes: buffer.byteLength,
      receivedAt
    }
    items.unshift(item)
    // 超出上限时先删最旧的磁盘文件，再截断索引。
    while (items.length > MAX_ITEMS) {
      const dropped = items.pop()
      if (dropped !== undefined) await fs.rm(path.join(dir, dropped.file), { force: true })
    }
    await writeIndex(items)
    await rememberHash({
      hash,
      id,
      file,
      packId: '',
      source,
      chatType,
      groupOpenId,
      senderOpenId,
      bytes: buffer.byteLength,
      firstSeenAt: receivedAt,
      lastSeenAt: receivedAt,
      seenCount: 1
    })
    log('[sticker] 待审核 +1', id, type, buffer.byteLength)
    return item
  }

  /** 列出仍然存在的待审核项；顺手清掉文件已经丢了的记录。 */
  async function list() {
    const items = await readIndex()
    const alive = []
    for (const item of items) {
      const stat = await fs.stat(path.join(dir, item.file)).catch(() => null)
      if (stat === null || !stat.isFile()) continue
      alive.push({
        ...item,
        url: `pet-media://inbox/${encodeURIComponent(item.file)}`
      })
    }
    if (alive.length !== items.length) await writeIndex(alive)
    return alive
  }

  /** 入库：移动到 packs/<packId>/emoji/<name>.<ext>，重名自动加序号。 */
  async function approve(id, { packId = 'qq-inbox', name = '' } = {}) {
    const items = await readIndex()
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('待审核项不存在')

    const item = items[index]
    const safePack = sanitizeName(packId, 'qq-inbox')
    if (safePack.startsWith('.')) throw new Error('素材包 id 不能以点开头')

    const ext = path.extname(item.file)
    // 用户可能直接粘带扩展名的名字，去掉再拼，免得变成 xxx.png.png。
    const plainName = String(name ?? '').replace(/\.(?:png|jpe?g|gif|webp)$/i, '')
    const baseName = sanitizeName(plainName, item.id)
    const targetDir = path.join(root, safePack, 'emoji')
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
    if (!path.resolve(targetDir).startsWith(rootWithSep)) {
      throw new Error('目标素材包路径越界')
    }

    await fs.mkdir(targetDir, { recursive: true })
    let target = path.join(targetDir, `${baseName}${ext}`)
    let suffix = 2
    while (await fs.access(target).then(() => true).catch(() => false)) {
      target = path.join(targetDir, `${baseName}-${suffix}${ext}`)
      suffix += 1
      if (suffix > 999) throw new Error('同名文件过多，请先整理素材包')
    }

    await fs.rename(path.join(dir, item.file), target)
    items.splice(index, 1)
    await writeIndex(items)
    log('[sticker] 已入库', item.id, '→', target)
    return { ok: true, id, packId: safePack, file: path.basename(target) }
  }

  /** 丢弃：删文件 + 删记录，不可撤销。 */
  async function reject(id) {
    const items = await readIndex()
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) return { ok: false, reason: 'not-found' }

    await fs.rm(path.join(dir, items[index].file), { force: true })
    items.splice(index, 1)
    await writeIndex(items)
    log('[sticker] 已丢弃', id)
    return { ok: true, id }
  }

  /** 给 pet-media://inbox 用：只接受单层文件名，拒绝任何路径段。 */
  async function resolvePath(relative) {
    let name
    try {
      name = decodeURIComponent(relative)
    } catch {
      return null
    }
    if (name === '' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
      return null
    }
    if (name === INDEX_FILE || name === HASH_FILE) return null

    const target = path.resolve(dir, name)
    const dirWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep
    if (!target.startsWith(dirWithSep)) return null
    return target
  }

  return { dir, ensure, add, list, approve, reject, resolvePath }
}
