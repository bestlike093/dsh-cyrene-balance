/**
 * 远程决策与通道抽象（P3 第七章）。
 *
 * 这里只做三件事：
 *   1. 决策卡片只带摘要，不把本机上下文带出去
 *   2. 主人校验：owners 为空不执行；非主人只能问，不能拍板
 *   3. 同一时间只允许一个通道在线
 *
 * 网络收发不在这里做。QQ 官方机器人、OneBot、Webhook 都只实现同一个
 * transport 接口，决策与权限规则共用这一份。
 */

export const DECISION_KINDS = Object.freeze(['approval', 'question', 'notice'])
export const DECISION_ACTIONS = Object.freeze(['allow', 'deny', 'answer', 'dismiss'])
export const CHANNEL_IDS = Object.freeze(['local-loopback', 'qq', 'wechat', 'webhook'])

export const DECISION_TIMEOUT_MS = 5 * 60 * 1000
export const OWNERS_UNSET_REPLY = '请在桌宠里确认主人的 QQ 号。'
export const NOT_OWNER_REPLY = '这个问题我可以回答；审批要主人来。'
export const NOT_OWNER_ACTION_REPLY = '只有主人能拍板。'

const ACTIONS_BY_KIND = Object.freeze({
  approval: Object.freeze(['allow', 'deny']),
  question: Object.freeze(['answer', 'dismiss']),
  notice: Object.freeze(['dismiss'])
})

let cardSeq = 0

function nextCardId(now) {
  cardSeq = (cardSeq + 1) % 100000
  return `dec_${now.toString(36)}_${cardSeq.toString(36)}`
}

function clampText(value, max) {
  return String(value ?? '').trim().slice(0, max)
}

/**
 * 只接受摘要。任何 context / prompt / body 字段都不会被复制进卡片，
 * 避免调用方误把整段本机上下文交给远端。
 */
export function createDecisionCard(input = {}, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const kind = DECISION_KINDS.includes(input.kind) ? input.kind : 'notice'
  const summary = clampText(input.summary, 200)
  if (summary === '') throw new Error('决策卡片需要一句摘要')
  const allowed = ACTIONS_BY_KIND[kind]
  const requested = Array.isArray(input.actions) ? input.actions.filter((item) => allowed.includes(item)) : []
  const actions = requested.length === 0 ? [...allowed] : [...new Set(requested)]
  const expiresAt = Number.isFinite(input.expiresAt) ? input.expiresAt : now + DECISION_TIMEOUT_MS
  return {
    id: typeof input.id === 'string' && input.id.trim() !== '' ? input.id.trim().slice(0, 80) : nextCardId(now),
    kind,
    summary,
    actions,
    createdAt: now,
    expiresAt,
    status: 'pending',
    action: null,
    answer: null,
    resolvedAt: null,
    resolvedBy: null
  }
}

/** 平台无关的卡片文本与按钮。transport 自己决定怎么渲染。 */
export function formatDecisionCard(card) {
  if (card === null || typeof card !== 'object') throw new Error('缺少决策卡片')
  const head = card.kind === 'approval' ? '[审批]' : card.kind === 'question' ? '[提问]' : '[通知]'
  const label = { allow: '允许', deny: '拒绝', answer: '回答', dismiss: '知道了' }
  return {
    id: card.id,
    text: `${head} ${card.summary}`,
    buttons: (Array.isArray(card.actions) ? card.actions : []).map((action) => ({
      action,
      label: label[action] ?? action
    }))
  }
}

/**
 * 解析一句回复。审批与通知只认明确命令；问题允许自由回答，
 * 由 resolveReply 结合卡片类型判断。
 */
export function parseDecisionReply(text) {
  const source = String(text ?? '').trim()
  if (source === '') return { action: null, value: '' }
  const lower = source.toLowerCase()
  if (/^(允许|同意|批准|可以|确认|allow|yes|y)$/.test(lower)) return { action: 'allow', value: '' }
  if (/^(拒绝|不行|不允许|不同意|deny|no|n)$/.test(lower)) return { action: 'deny', value: '' }
  if (/^(算了|不用了|忽略|取消|dismiss|cancel)$/.test(lower)) return { action: 'dismiss', value: '' }
  const answer = source.match(/^(?:回答|答复|answer)\s*[:：]\s*(.+)$/i)
  if (answer !== null) return { action: 'answer', value: answer[1].trim() }
  return { action: null, value: source }
}

export function resolveReply(card, text) {
  const parsed = parseDecisionReply(text)
  if (parsed.action !== null) return parsed
  if (card?.kind === 'question' && parsed.value !== '') {
    return { action: 'answer', value: parsed.value }
  }
  return { action: null, value: parsed.value }
}

function emptyState() {
  return { version: 1, cards: [] }
}

function normalizeCard(raw) {
  if (raw === null || typeof raw !== 'object') return null
  if (!DECISION_KINDS.includes(raw.kind)) return null
  const summary = clampText(raw.summary, 200)
  if (summary === '') return null
  return {
    id: typeof raw.id === 'string' ? raw.id.slice(0, 80) : '',
    kind: raw.kind,
    summary,
    actions: Array.isArray(raw.actions) ? raw.actions.filter((item) => DECISION_ACTIONS.includes(item)) : [],
    createdAt: Number(raw.createdAt) || 0,
    expiresAt: Number(raw.expiresAt) || 0,
    status: raw.status === 'resolved' || raw.status === 'expired' ? raw.status : 'pending',
    action: DECISION_ACTIONS.includes(raw.action) ? raw.action : null,
    answer: typeof raw.answer === 'string' ? raw.answer.slice(0, 1000) : null,
    resolvedAt: Number(raw.resolvedAt) || null,
    resolvedBy: typeof raw.resolvedBy === 'string' ? raw.resolvedBy.slice(0, 80) : null,
    channelId: CHANNEL_IDS.includes(raw.channelId) ? raw.channelId : null
  }
}

/**
 * 决策账本。默认只放内存；传 file + fs 时落盘。
 * 落盘内容仍然只有摘要，没有原始上下文。
 */
export function createDecisionStore(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const file = typeof options.file === 'string' ? options.file : ''
  const fs = options.fs ?? null
  const maxCards = Number.isFinite(options.maxCards) ? Math.max(1, Math.trunc(options.maxCards)) : 50

  let state = emptyState()

  function load() {
    if (fs === null || file === '') return state
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      const cards = Array.isArray(parsed?.cards) ? parsed.cards.map(normalizeCard).filter(Boolean) : []
      state = { version: 1, cards: cards.slice(-maxCards) }
    } catch {
      state = emptyState()
    }
    return state
  }

  function save() {
    if (fs === null || file === '') return
    try {
      fs.mkdirSync(file.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
      fs.writeFileSync(file, `${JSON.stringify(state)}\n`, 'utf8')
    } catch {
      /* 账本写不进去时，本轮内存里仍然可用 */
    }
  }

  load()

  function prune() {
    if (state.cards.length <= maxCards) return
    state.cards = state.cards.slice(-maxCards)
  }

  function add(input) {
    const card = createDecisionCard(input, { now: now() })
    state.cards.push({ ...card, channelId: CHANNEL_IDS.includes(input.channelId) ? input.channelId : null })
    prune()
    save()
    return card
  }

  function get(id) {
    return state.cards.find((card) => card.id === id) ?? null
  }

  function list(filter = {}) {
    const status = typeof filter.status === 'string' ? filter.status : ''
    const channelId = typeof filter.channelId === 'string' ? filter.channelId : ''
    return state.cards.filter(
      (card) =>
        (status === '' || card.status === status) &&
        (channelId === '' || card.channelId === channelId)
    )
  }

  function latestPending(channelId = '') {
    for (let index = state.cards.length - 1; index >= 0; index -= 1) {
      const card = state.cards[index]
      if (card.status !== 'pending') continue
      if (channelId !== '' && card.channelId !== channelId) continue
      return card
    }
    return null
  }

  function expire() {
    const at = now()
    const changed = []
    for (const card of state.cards) {
      if (card.status !== 'pending') continue
      if (card.expiresAt > 0 && at >= card.expiresAt) {
        card.status = 'expired'
        card.resolvedAt = at
        changed.push(card)
      }
    }
    if (changed.length > 0) save()
    return changed
  }

  function resolve(id, action, meta = {}) {
    expire()
    const card = get(id)
    if (card === null) return { ok: false, reason: 'not-found', card: null }
    if (card.status === 'expired') return { ok: false, reason: 'expired', card }
    if (card.status !== 'pending') return { ok: false, reason: 'already-resolved', card }
    if (!DECISION_ACTIONS.includes(action) || !card.actions.includes(action)) {
      return { ok: false, reason: 'action-not-allowed', card }
    }
    const answer = typeof meta.value === 'string' ? meta.value.trim().slice(0, 1000) : ''
    if (action === 'answer' && answer === '') return { ok: false, reason: 'answer-required', card }
    card.status = 'resolved'
    card.action = action
    card.answer = action === 'answer' ? answer : null
    card.resolvedAt = now()
    card.resolvedBy = typeof meta.by === 'string' ? meta.by.slice(0, 80) : null
    save()
    return { ok: true, reason: 'ok', card }
  }

  return {
    load,
    add,
    get,
    list,
    latestPending,
    expire,
    resolve,
    snapshot: () => ({ ...state, cards: state.cards.map((card) => ({ ...card })) }),
    reset: () => {
      state = emptyState()
      save()
    }
  }
}

function normalizeOwners(owners) {
  if (!Array.isArray(owners)) return []
  return owners
    .map((owner) => String(owner ?? '').trim())
    .filter((owner) => owner !== '')
}

/**
 * 通道网关。transport 只负责收和发，权限与决策都在这里。
 * `push` 只在通道在线时生成卡片；`handle` 返回平台需要回的那句话。
 */
export function createRemoteGateway(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const owners = normalizeOwners(options.owners)
  const store = options.store ?? createDecisionStore({ now })
  let activeChannel = null
  let transport = null

  function status() {
    return {
      channelId: activeChannel,
      online: activeChannel !== null,
      ownersConfigured: owners.length > 0,
      pending: store.list({ status: 'pending' }).length
    }
  }

  function connect(channelId, nextTransport = null) {
    if (!CHANNEL_IDS.includes(channelId)) return { ok: false, reason: 'unknown-channel' }
    if (activeChannel !== null && activeChannel !== channelId) {
      return { ok: false, reason: 'channel-busy', activeChannel }
    }
    activeChannel = channelId
    transport = nextTransport
    return { ok: true, channelId }
  }

  function disconnect(channelId = activeChannel) {
    if (channelId !== activeChannel) return { ok: false, reason: 'not-active' }
    activeChannel = null
    transport = null
    return { ok: true }
  }

  function createCard(input = {}) {
    if (activeChannel === null) return { ok: false, reason: 'offline' }
    const card = store.add({ ...input, channelId: activeChannel })
    return { ok: true, card, message: formatDecisionCard(card) }
  }

  async function sendCard(input) {
    const created = createCard(input)
    if (!created.ok) return created
    if (transport !== null && typeof transport.send === 'function') {
      try {
        await transport.send(created.message)
      } catch (error) {
        return { ok: false, reason: 'transport-failed', card: created.card, error: String(error?.message ?? error) }
      }
    }
    return created
  }

  /**
   * 处理一条远端消息。
   * - owners 为空：一律不执行动作，只回确认主人的提示
   * - 非主人：可以问问题，不能审批/执行工具
   * - 主人：可以解析当前通道最新一张待决卡片
   */
  function handle(input = {}) {
    if (activeChannel === null) return { ok: false, reason: 'offline', reply: '' }
    const channelId = typeof input.channelId === 'string' ? input.channelId : activeChannel
    if (channelId !== activeChannel) return { ok: false, reason: 'not-active', reply: '' }
    const senderId = String(input.senderId ?? '').trim()
    if (senderId === '') return { ok: false, reason: 'no-sender', reply: '' }

    if (owners.length === 0) {
      return {
        ok: false,
        reason: 'owners-unset',
        reply: OWNERS_UNSET_REPLY,
        isOwner: false,
        canAnswer: false,
        canApprove: false,
        canUseTools: false
      }
    }

    const isOwner = owners.includes(senderId)
    const text = String(input.text ?? '').trim()
    const card = store.latestPending(channelId)

    if (card !== null) {
      const parsed = resolveReply(card, text)
      if (parsed.action !== null) {
        if (!isOwner) {
          return {
            ok: false,
            reason: 'not-owner',
            reply: NOT_OWNER_ACTION_REPLY,
            card,
            isOwner: false,
            canAnswer: true,
            canApprove: false,
            canUseTools: false
          }
        }
        const resolved = store.resolve(card.id, parsed.action, { by: senderId, value: parsed.value })
        return {
          ...resolved,
          reply: resolved.ok ? `已记录：${parsed.action}` : `没有执行：${resolved.reason}`,
          isOwner: true,
          canAnswer: true,
          canApprove: true,
          canUseTools: true
        }
      }
    }

    if (!isOwner) {
      return {
        ok: true,
        reason: 'question-only',
        reply: NOT_OWNER_REPLY,
        isOwner: false,
        canAnswer: true,
        canApprove: false,
        canUseTools: false
      }
    }

    return {
      ok: true,
      reason: 'owner-message',
      reply: '',
      isOwner: true,
      canAnswer: true,
      canApprove: true,
      canUseTools: true
    }
  }

  return {
    status,
    connect,
    disconnect,
    createCard,
    sendCard,
    handle,
    store,
    expire: () => store.expire(),
    format: formatDecisionCard,
    get activeChannel() {
      return activeChannel
    }
  }
}
