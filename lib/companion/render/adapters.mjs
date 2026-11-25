/**
 * 媒体适配器注册表（P7 渲染卫星，契约 §6.5）。
 *
 * 适配器只回答三件事：这条素材是什么、能不能加载、交给渲染层怎么描述。
 * 不碰 DOM、不碰 fs、不写死通道名——catalog 给什么就认什么。
 *
 * 认不出来的类型返回 null，不猜；猜错的代价是白屏，比「不支持」更糟。
 */

/** 四媒体＋Live2D。顺序即匹配优先级：越具体越靠前。 */
export const MEDIA_KINDS = ['sprite', 'live2d', 'gif', 'image', 'video']

const EXTENSIONS = {
  image: ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.bmp'],
  gif: ['.gif'],
  video: ['.mp4', '.webm', '.mov', '.m4v'],
  live2d: ['.model3.json'],
  sprite: ['.sprite.json'],
}

export function extensionOf(path) {
  const text = String(path ?? '')
  const name = text.split(/[\\/]/).pop() ?? ''
  const lower = name.toLowerCase()
  /* .model3.json / .sprite.json 这类双后缀要整体看，不能只取最后一段。 */
  for (const suffix of ['.model3.json', '.sprite.json']) {
    if (lower.endsWith(suffix)) return suffix
  }
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? lower.slice(dot) : ''
}

function mediaOf(path) {
  const ext = extensionOf(path)
  if (ext === '') return null
  for (const kind of MEDIA_KINDS) {
    if (EXTENSIONS[kind].includes(ext)) return { kind, ext }
  }
  return null
}

/** 一条素材是否超过单文件上限；读不到大小就当未知，不拦。 */
function sizeProblem(entry, maxBytes) {
  const bytes = Number(entry?.bytes)
  if (!Number.isFinite(bytes) || bytes <= 0) return null
  return bytes > maxBytes ? 'too-large' : null
}

/**
 * 定义一个适配器。
 *
 * contract 是给渲染层的形状说明：它需要哪些字段、哪些可选。
 * validate 只看条目本身，不读盘；真正的存在性由调用方先确认。
 */
export function defineAdapter({ id, kind, validate, describe }) {
  if (typeof id !== 'string' || id === '') throw new Error('adapter id required')
  if (!MEDIA_KINDS.includes(kind)) throw new Error(`unknown media kind: ${kind}`)
  return {
    id,
    kind,
    extensions: EXTENSIONS[kind].slice(),
    matches(path) {
      return mediaOf(path)?.kind === kind
    },
    validate(entry, { maxBytes = 64 * 1024 * 1024 } = {}) {
      const tooLarge = sizeProblem(entry, maxBytes)
      if (tooLarge !== null) return { ok: false, reason: tooLarge }
      return validate(entry)
    },
    describe: typeof describe === 'function' ? describe : (entry) => ({ kind, path: entry?.path ?? '' }),
  }
}

/* ------------------------------- 五适配器 ------------------------------- */

export const live2dAdapter = defineAdapter({
  id: 'live2d',
  kind: 'live2d',
  validate(entry) {
    if (typeof entry?.model3 !== 'string' || entry.model3 === '') {
      return { ok: false, reason: 'missing-model3' }
    }
    /* 少了 moc3 一定打不开；纹理等资源缺失由模型自身报，先不在这里猜。 */
    if (entry.moc3 !== undefined && entry.moc3 !== null && entry.moc3 === '') {
      return { ok: false, reason: 'missing-moc3' }
    }
    return { ok: true }
  },
  describe(entry) {
    return {
      kind: 'live2d',
      path: entry.model3,
      /* catalog 不在这里读：渲染层拿到 model3 后自己请求 catalog.json。 */
      catalog: entry.catalog ?? null,
    }
  },
})

export const imageAdapter = defineAdapter({
  id: 'image',
  kind: 'image',
  validate(entry) {
    return typeof entry?.path === 'string' && entry.path !== ''
      ? { ok: true }
      : { ok: false, reason: 'missing-path' }
  },
  describe(entry) {
    return { kind: 'image', path: entry.path }
  },
})

export const gifAdapter = defineAdapter({
  id: 'gif',
  kind: 'gif',
  validate(entry) {
    return typeof entry?.path === 'string' && entry.path !== ''
      ? { ok: true }
      : { ok: false, reason: 'missing-path' }
  },
  /* 动图不自动循环到天荒地老：给一个上限，渲染层到点回到首帧。 */
  describe(entry) {
    return {
      kind: 'gif',
      path: entry.path,
      loop: entry.loop !== false,
      maxSeconds: Number.isFinite(Number(entry.maxSeconds)) ? Number(entry.maxSeconds) : 30,
    }
  },
})

export const spriteAdapter = defineAdapter({
  id: 'sprite',
  kind: 'sprite',
  validate(entry) {
    const frames = Array.isArray(entry?.frames) ? entry.frames : []
    if (frames.length === 0) return { ok: false, reason: 'missing-frames' }
    if (frames.some((frame) => typeof frame !== 'string' || frame === '')) {
      return { ok: false, reason: 'bad-frame' }
    }
    return { ok: true }
  },
  describe(entry) {
    return {
      kind: 'sprite',
      path: entry.path ?? entry.frames[0],
      frames: entry.frames.slice(),
      fps: Number.isFinite(Number(entry.fps)) && Number(entry.fps) > 0 ? Number(entry.fps) : 8,
      loop: entry.loop !== false,
    }
  },
})

export const videoAdapter = defineAdapter({
  id: 'video',
  kind: 'video',
  validate(entry) {
    return typeof entry?.path === 'string' && entry.path !== ''
      ? { ok: true }
      : { ok: false, reason: 'missing-path' }
  },
  describe(entry) {
    return {
      kind: 'video',
      path: entry.path,
      loop: entry.loop === true,
      muted: entry.muted !== false,
    }
  },
})

export const DEFAULT_ADAPTERS = [
  spriteAdapter,
  live2dAdapter,
  gifAdapter,
  imageAdapter,
  videoAdapter,
]

/* ------------------------------- 注册表 ------------------------------- */

export function createAdapterRegistry(adapters = DEFAULT_ADAPTERS) {
  const byId = new Map()
  const byKind = new Map()

  function register(adapter) {
    if (adapter === null || typeof adapter !== 'object') throw new Error('adapter required')
    if (byId.has(adapter.id)) throw new Error(`duplicate adapter: ${adapter.id}`)
    byId.set(adapter.id, adapter)
    if (!byKind.has(adapter.kind)) byKind.set(adapter.kind, [])
    byKind.get(adapter.kind).push(adapter)
    return adapter
  }

  for (const adapter of adapters) register(adapter)

  /**
   * 按路径或条目找适配器。
   * 条目带 kind 时优先按 kind；否则按扩展名。
   * 认不出来返回 null。
   */
  function resolve(entryOrPath) {
    if (typeof entryOrPath === 'string') {
      const media = mediaOf(entryOrPath)
      if (media === null) return null
      const list = byKind.get(media.kind) ?? []
      /* 同一 kind 多个适配器时，先看它自己的 matches（双后缀靠这里区分）。 */
      return list.find((adapter) => adapter.matches(entryOrPath)) ?? list[0] ?? null
    }
    const entry = entryOrPath
    if (entry === null || typeof entry !== 'object') return null
    if (typeof entry.kind === 'string' && entry.kind !== '') {
      return (byKind.get(entry.kind) ?? [])[0] ?? null
    }
    return resolve(entry.path ?? entry.model3 ?? '')
  }

  return {
    register,
    resolve,
    get(id) { return byId.get(id) ?? null },
    list() { return [...byId.values()] },
    kinds() { return [...byKind.keys()] },
  }
}
