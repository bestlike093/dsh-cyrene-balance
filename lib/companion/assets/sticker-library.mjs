/**
 * 表情库：把「Cyrene 本体表情包」汇到同一份清单里，给聊天层挑、给预览页看、给 QQ 发。
 *
 * 设计约束：
 *   - 只读磁盘，不改任何素材；入库仍然走 sticker-inbox。
 *   - id 是「来源:相对路径」，渲染层传 id，主进程自己还原绝对路径，
 *     不接受任意路径，避免越权读文件。
 *   - 扫描结果缓存 30 秒：QQ 聊天一句话可能问好几次，不必每次都走磁盘。
 *   - root.chat=false 的目录只用来兜底解析历史图片，不参与挑图；
 *     root.listed=false 的目录不出现在预览页，避免把别人的图混进她的表情包。
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const CACHE_TTL_MS = 30_000
/** 超过这个大小就不算指纹：表情图远小于它，读全文也不是负担。 */
const HASH_MAX_BYTES = 4 * 1024 * 1024

const TYPE_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

/** 文件名 → 中文标签。没命中的用文件名本身，至少还能被模型念出来。 */
const LABELS = {
  'cyrene/sticker/bubble-money': '数钱',
  'cyrene/sticker/bubble-petpet': '摸摸头',
  'sticker-packs/cyrene-agent/hello': '打招呼',
  'sticker-packs/cyrene-agent/HI': '嗨',
  'sticker-packs/cyrene-agent/Thanks': '谢谢',
  'sticker-packs/cyrene-agent/OK': '好呀',
  'sticker-packs/cyrene-agent/Thumbsup': '点赞',
  'sticker-packs/cyrene-agent/thinking': '思考',
  'sticker-packs/cyrene-agent/sleepynow': '困了',
  'sticker-packs/cyrene-agent/sotired': '累',
  'sticker-packs/cyrene-agent/deadtired': '累瘫',
  'sticker-packs/cyrene-agent/Hurtcry': '委屈',
  'sticker-packs/cyrene-agent/Sobbinghard': '大哭',
  'sticker-packs/cyrene-agent/weeploud': '号啕',
  'sticker-packs/cyrene-agent/PanincCrying': '慌哭',
  'sticker-packs/cyrene-agent/love-happy': '喜欢',
  'sticker-packs/cyrene-agent/love-calm': '安心',
  'sticker-packs/cyrene-agent/hugtight': '抱抱',
  'sticker-packs/cyrene-agent/fighting': '加油',
  'sticker-packs/cyrene-agent/goodnight': '晚安',
  'sticker-packs/cyrene-agent/goodmoring1': '早安',
  'sticker-packs/cyrene-agent/Gigglelots': '偷笑',
  'sticker-packs/cyrene-agent/playful': '调皮',
  'sticker-packs/cyrene-agent/shy': '害羞',
  'sticker-packs/cyrene-agent/shyshort': '害羞',
  'sticker-packs/cyrene-agent/blushhard': '脸红',
  'sticker-packs/cyrene-agent/please': '拜托',
  'sticker-packs/cyrene-agent/serious': '认真',
  'sticker-packs/cyrene-agent/calm': '平静',
  'sticker-packs/cyrene-agent/confident': '自信',
  'sticker-packs/cyrene-agent/awkward': '尴尬',
  'sticker-packs/cyrene-agent/confused': '困惑',
  'sticker-packs/cyrene-agent/clingy-confused': '黏人困惑',
  'sticker-packs/cyrene-agent/eating': '干饭',
  'sticker-packs/cyrene-agent/teatime': '下午茶',
  'sticker-packs/cyrene-agent/missme': '想我',
  'sticker-packs/cyrene-agent/foryou': '给你',
  'sticker-packs/cyrene-agent/awesome': '好耶',
  'sticker-packs/cyrene-agent/sogood': '太棒了',
  'sticker-packs/cyrene-agent/sonice': '不错',
  'sticker-packs/cyrene-agent/giveup': '放弃',
  'sticker-packs/cyrene-agent/hmph': '哼',
  'sticker-packs/cyrene-agent/Madnow': '生气',
  'sticker-packs/cyrene-agent/midmeh': '一般般',
  'sticker-packs/cyrene-agent/Vcayover': '度假',
  'sticker-packs/cyrene-agent/Free': '自由',
  'sticker-packs/cyrene-agent/Airkiss': '飞吻',
  'sticker-packs/cyrene-agent/Allset': '准备好了',
  'sticker-packs/cyrene-agent/copythat': '收到',
  'sticker-packs/cyrene-agent/outfast': '溜了',
  'sticker-packs/cyrene-agent/poorwallet': '没钱',
  'sticker-packs/cyrene-agent/peek': '偷看',
  'sticker-packs/cyrene-agent/Whatswrong': '怎么了'
}

/** 提示词里只列精选，避免一句话塞进几十个标签把上下文撑爆。 */
const HINT_TAGS = [
  '喜欢',
  '害羞',
  '抱抱',
  '加油',
  '打招呼',
  '谢谢',
  '好呀',
  '点赞',
  '思考',
  '晚安',
  '早安',
  '偷笑',
  '调皮',
  '委屈',
  '生气',
  '困了',
  '大哭',
  '好耶',
  '太棒了',
  '数钱',
  '摸摸头'
]

function labelOf(relative) {
  const key = relative.replace(/\\/g, '/').replace(/\.[^.]+$/, '')
  return LABELS[key] ?? LABELS[key.toLowerCase()] ?? path.basename(key)
}

/** 视觉标签表：{ '文件名.png': { labels: ['开心'], at } }，坏了就当没有。 */
async function readLabelsFile(pathname) {
  if (typeof pathname !== 'string' || pathname === '') return {}
  try {
    const parsed = JSON.parse(await fs.readFile(pathname, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function createStickerLibrary({ roots = [], log = () => {}, usage = null } = {}) {
  let cache = null
  let cacheAt = 0

  /** 内容指纹：同一张图从群里存两次、又导一次，库里只留一份。算不了就返回空串。 */
  async function hashFile(abs) {
    try {
      const stat = await fs.stat(abs)
      if (!stat.isFile() || stat.size > HASH_MAX_BYTES) return ''
      const buffer = await fs.readFile(abs)
      return crypto.createHash('sha1').update(buffer).digest('hex')
    } catch {
      return ''
    }
  }

  async function walkRoot(root, visionLabels = {}) {
    const out = []
    async function walk(dir, prefix) {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        // symlink / junction 一律跳过：可能指回本树造成无限递归，也可能扫到素材目录之外。
        if (entry.isSymbolicLink()) continue
        const abs = path.join(dir, entry.name)
        const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) {
          await walk(abs, rel)
          continue
        }
        const ext = path.extname(entry.name).toLowerCase()
        const contentType = TYPE_BY_EXT[ext]
        if (contentType === undefined) continue
        const stat = await fs.stat(abs).catch(() => null)
        if (stat === null || !stat.isFile()) continue
        out.push({ abs, rel, ext, contentType, bytes: stat.size })
      }
    }
    await walk(root.dir, root.prefix ?? '')
    const rows = []
    for (const item of out) {
      /* 标签表既可能是相对路径，也可能只写文件名，两种都认。 */
      const visionEntry = visionLabels[item.rel] ?? visionLabels[path.basename(item.rel)]
      const vision = Array.isArray(visionEntry?.labels) ? visionEntry.labels : []
      const label = vision.length > 0 ? vision[0] : labelOf(item.rel)
      rows.push({
        id: `${root.id}:${item.rel}`,
        source: root.source,
        packId: root.packId ?? root.id,
        packName: root.packName ?? '',
        name: path.basename(item.rel, item.ext),
        file: item.rel,
        ext: item.ext,
        contentType: item.contentType,
        bytes: item.bytes,
        label,
        labels: vision.length > 0 ? vision : [label],
        labelSource: vision.length > 0 ? 'vision' : 'name',
        chat: root.chat !== false,
        listed: root.listed !== false,
        abs: item.abs,
        /* 只有声明了 dedupe 的目录才算指纹：内置素材是固定的，不值得每次扫。 */
        hash: root.dedupe === true ? await hashFile(item.abs) : ''
      })
    }
    return rows
  }

  async function scan() {
    const now = Date.now()
    if (cache !== null && now - cacheAt < CACHE_TTL_MS) return cache

    const all = []
    for (const root of roots) {
      try {
        const visionLabels = await readLabelsFile(root.labelsPath)
        all.push(...(await walkRoot(root, visionLabels)))
      } catch (error) {
        log('[sticker] 扫描表情目录失败：', root.id, String(error?.message ?? error))
      }
    }
    // 同一个 id 只留第一条；顺序由 roots 决定，内置优先。
    // 再按内容指纹去重：同名不同图会留下来，同图换个文件名只留先扫到的那条。
    const seen = new Set()
    const seenHash = new Set()
    cache = all.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      if (typeof item.hash === 'string' && item.hash !== '') {
        if (seenHash.has(item.hash)) return false
        seenHash.add(item.hash)
      }
      return true
    })
    cacheAt = now
    return cache
  }

  function invalidate() {
    cache = null
    cacheAt = 0
  }

  async function list() {
    const items = await scan()
    return items
      .filter((item) => item.listed !== false)
      .map(({ abs, chat, listed, hash, ...rest }) => ({
        ...rest,
        // 渲染层只拿 pet-media 地址，拿不到磁盘路径。
        url:
          rest.source === 'pack'
            ? `pet-media://pack/${rest.file.split('/').map(encodeURIComponent).join('/')}`
            : `pet-media://asset/${rest.file.split('/').map(encodeURIComponent).join('/')}`
      }))
  }

  /** 只认清单里的 id，绝不接受任意路径。 */
  async function resolve(id) {
    const text = String(id ?? '').trim()
    if (text === '') return null
    const items = await scan()
    const found = items.find((item) => item.id === text)
    return found === undefined ? null : found
  }

  /** 按标签（或文件名）找一张，用来解析模型给的 [[表情:xxx]]。 */
  async function pick(label) {
    const key = String(label ?? '').trim().toLowerCase()
    if (key === '') return null
    /* 「随机」是给偷来的图留的口子：它们没有标签，只能按账本随手挑。 */
    if (key === '随机' || key === 'random') return pickStolen()
    // 聊天只从 Cyrene 自己的表情里挑，别人的图不参与。
    const items = (await scan()).filter((item) => item.chat !== false)
    /* 同一个标签常常对应好几张（害羞 / 害羞短版），别总发第一张。 */
    const groups = [
      items.filter((item) => item.label.toLowerCase() === key),
      items.filter((item) => item.name.toLowerCase() === key)
    ]
    // 兜底包含匹配只对多字词开：单字命中面太宽（「笑」撞上「偷笑」「大笑」「害羞」），等于乱挑。
    if (key.length > 1) {
      groups.push(items.filter((item) => item.label.toLowerCase().includes(key)))
    }
    const picks = groups.find((group) => group.length > 0) ?? []
    if (picks.length === 0) return null
    if (picks.length > 1 && usage !== null && typeof usage.pick === 'function') {
      const chosen = usage.pick(picks)
      if (chosen !== null) {
        if (typeof usage.record === 'function') usage.record(chosen.id)
        return chosen
      }
    }
    return picks[0]
  }

  /** 从「QQ 偷来的」里随手挑一张；没有就返回 null，不硬凑。 */
  async function pickStolen() {
    const items = (await scan()).filter((item) => item.chat !== false && item.packId === 'qq-auto')
    if (items.length === 0) return null
    /* 有使用账本时按「发得少、最近没发过」加权，避免总挑到同一张。 */
    if (usage !== null && typeof usage.pick === 'function') {
      const chosen = usage.pick(items)
      if (chosen !== null) {
        if (typeof usage.record === 'function') usage.record(chosen.id)
        return chosen
      }
    }
    return items[Math.floor(Math.random() * items.length)]
  }

  async function promptHint() {
    const items = (await scan()).filter((item) => item.chat !== false)
    if (items.length === 0) return ''
    const available = []
    for (const tag of HINT_TAGS) {
      if (items.some((item) => item.label === tag)) available.push(tag)
    }
    const stolen = items.filter((item) => item.packId === 'qq-auto').length
    /* 人工命名过的偷来图（审核入库会放到 emoji/ 下）也告诉模型，不然它不知道这些标签能用。 */
    const named = []
    for (const item of items) {
      if (item.packId !== 'qq-auto' || !item.file.includes('/emoji/')) continue
      if (!named.includes(item.label)) named.push(item.label)
    }
    if (available.length === 0 && stolen === 0) return ''
    const lines = [
      '【发表情】你有一整套自己的表情包，可以像真人聊天那样，顺手在回复末尾带一张。'
    ]
    if (available.length > 0) {
      lines.push(`写法是 [[表情:标签]]，一次最多一个；标签只能从这些里选：${available.join('、')}。`)
    }
    if (named.length > 0) {
      lines.push(`收来的图里也有起过名字的：${named.slice(0, 8).join('、')}，同样能按标签用。`)
    }
    if (stolen > 0) {
      lines.push(
        `另外还有 ${stolen} 张从群里收来的图，没起名字；想随手配一张就写 [[表情:随机]]，会挑一张最近没发过的。`
      )
    }
    lines.push('被逗笑、撒娇、道早安晚安、被夸、安慰对方、想说抱抱的时候，优先用一张。')
    lines.push('平常的普通对话不用硬塞，一两句里最多一处就够。')
    return lines.join('')
  }

  return { list, resolve, pick, pickStolen, promptHint, invalidate }
}
