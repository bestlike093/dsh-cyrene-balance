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
import fs from 'node:fs/promises'
import path from 'node:path'

const CACHE_TTL_MS = 30_000

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

export function createStickerLibrary({ roots = [], log = () => {} } = {}) {
  let cache = null
  let cacheAt = 0

  async function walkRoot(root) {
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
    return out.map((item) => ({
      id: `${root.id}:${item.rel}`,
      source: root.source,
      packId: root.packId ?? root.id,
      packName: root.packName ?? '',
      name: path.basename(item.rel, item.ext),
      file: item.rel,
      ext: item.ext,
      contentType: item.contentType,
      bytes: item.bytes,
      label: labelOf(item.rel),
      chat: root.chat !== false,
      listed: root.listed !== false,
      abs: item.abs
    }))
  }

  async function scan() {
    const now = Date.now()
    if (cache !== null && now - cacheAt < CACHE_TTL_MS) return cache

    const all = []
    for (const root of roots) {
      try {
        all.push(...(await walkRoot(root)))
      } catch (error) {
        log('[sticker] 扫描表情目录失败：', root.id, String(error?.message ?? error))
      }
    }
    // 同一个 id 只留第一条；顺序由 roots 决定，内置优先。
    const seen = new Set()
    cache = all.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
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
      .map(({ abs, chat, listed, ...rest }) => ({
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
    // 聊天只从 Cyrene 自己的表情里挑，别人的图不参与。
    const items = (await scan()).filter((item) => item.chat !== false)
    const exact = items.find((item) => item.label.toLowerCase() === key)
    if (exact !== undefined) return exact
    const byName = items.find((item) => item.name.toLowerCase() === key)
    if (byName !== undefined) return byName
    return items.find((item) => item.label.toLowerCase().includes(key)) ?? null
  }

  /** 从「QQ 偷来的」里随手挑一张；没有就返回 null，不硬凑。 */
  async function pickStolen() {
    const items = (await scan()).filter((item) => item.chat !== false && item.packId === 'qq-auto')
    if (items.length === 0) return null
    return items[Math.floor(Math.random() * items.length)]
  }

  async function promptHint() {
    const items = (await scan()).filter((item) => item.chat !== false)
    if (items.length === 0) return ''
    const available = []
    for (const tag of HINT_TAGS) {
      if (items.some((item) => item.label === tag)) available.push(tag)
    }
    if (available.length === 0) return ''
    return [
      '【发表情】你有一整套自己的表情包，可以像真人聊天那样，顺手在回复末尾带一张。',
      `写法是 [[表情:标签]]，一次最多一个；标签只能从这些里选：${available.join('、')}。`,
      '被逗笑、撒娇、道早安晚安、被夸、安慰对方、想说抱抱的时候，优先用一张。',
      '平常的普通对话不用硬塞，一两句里最多一处就够。'
    ].join('')
  }

  return { list, resolve, pick, pickStolen, promptHint, invalidate }
}
