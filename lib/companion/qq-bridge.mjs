/**
 * QQ 官方通道的宿主侧桥。
 *
 * 职责边界：
 *   - 配置归一化：只收 AppID / 主人 openid / 目标会话 / Webhook 端口与路径；
 *     AppSecret 不在这里，由调用方从自己的密文仓库取出后注入。
 *   - 卡片渲染：把平台无关的按钮转成纯文本命令，QQ 被动回复只能发文本。
 *   - 收发：出站走 transport，入站交给 remote-decision 的网关做主人校验，
 *     再把网关给的回复发回去。
 *
 * 网关负责权限与账本，传输层负责网络，这一层只做粘合。
 */
import { createRemoteGateway } from './remote-decision.mjs'

const MAX_OWNERS = 5
const MAX_ID = 80
const MAX_PATH = 120

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

function normalizePath(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return '/qq/webhook'
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withSlash.replace(/\/{2,}/g, '/').slice(0, MAX_PATH)
}

export function normalizeQqConfig(input = {}) {
  const appId = String(input.appId ?? '').trim().slice(0, MAX_ID)
  const owners = Array.isArray(input.ownerOpenIds) ? input.ownerOpenIds : []
  const ownerOpenIds = [...new Set(
    owners
      .map((owner) => String(owner ?? '').trim().slice(0, MAX_ID))
      .filter((owner) => owner !== '')
  )].slice(0, MAX_OWNERS)
  const targetKind = input.targetKind === 'group' ? 'group' : 'c2c'
  return {
    enabled: input.enabled === true,
    appId,
    ownerOpenIds,
    targetKind,
    targetId: String(input.targetId ?? '').trim().slice(0, MAX_ID),
    webhookPort: clampInt(input.webhookPort, 1, 65535, 17321),
    webhookPath: normalizePath(input.webhookPath)
  }
}

function maskMiddle(value) {
  const text = String(value ?? '')
  if (text.length <= 6) return text === '' ? '' : '*'.repeat(text.length)
  return `${text.slice(0, 3)}${'*'.repeat(Math.min(8, text.length - 6))}${text.slice(-3)}`
}

/** 给设置页看的视图：永远不包含 AppSecret 原文。 */
export function describeQqConfig(config, options = {}) {
  const hasSecret = options.hasSecret === true
  const ready =
    config.enabled === true &&
    config.appId !== '' &&
    hasSecret &&
    config.ownerOpenIds.length > 0 &&
    config.targetId !== ''
  return {
    enabled: config.enabled,
    appId: maskMiddle(config.appId),
    hasSecret,
    ownerCount: config.ownerOpenIds.length,
    targetKind: config.targetKind,
    targetId: maskMiddle(config.targetId),
    webhookPort: config.webhookPort,
    webhookPath: config.webhookPath,
    ready,
    reason: ready
      ? ''
      : !config.enabled
        ? '未启用'
        : config.appId === ''
          ? '缺少 AppID'
          : !hasSecret
            ? '缺少 AppSecret'
            : config.ownerOpenIds.length === 0
              ? '还没填主人 openid'
              : '还没填接收会话'
  }
}

const LABELS = { allow: '允许', deny: '拒绝', answer: '回答', dismiss: '知道了' }

/** QQ 被动回复只能发文本，把按钮摊成可回复的命令。 */
export function renderCardText(message, options = {}) {
  const summary = String(message?.text ?? '').trim()
  const buttons = Array.isArray(message?.buttons) ? message.buttons : []
  if (summary === '') throw new Error('卡片文本不能为空')
  const lines = [summary]
  buttons.forEach((button, index) => {
    lines.push(`${index + 1}. ${button.label ?? LABELS[button.action] ?? button.action}（回复 ${LABELS[button.action] ?? button.action}）`)
  })
  const minutes = clampInt(options.minutes, 1, 60, 5)
  lines.push(`回复上面的词就行，${minutes} 分钟内有效。`)
  return lines.join('\n')
}

/**
 * transport 需要实现 sendToUser(openid, text, extra) / sendToGroup(groupId, text, extra)；
 * filterText 用于接输出侧红线（亲密层关闭时原样返回）。
 */
export function createQqBridge(options = {}) {
  const config = normalizeQqConfig(options.config)
  const transport = options.transport ?? null
  if (transport === null) throw new Error('QQ 桥需要 transport')
  if (config.targetId === '') throw new Error('QQ 桥需要接收会话')

  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const filterText = typeof options.filterText === 'function' ? options.filterText : (text) => text
  const gateway = createRemoteGateway({ owners: config.ownerOpenIds, now })

  function targetOf(extra = {}) {
    const kind = extra.kind === 'group' || extra.kind === 'c2c' ? extra.kind : config.targetKind
    const id = String(extra.targetId ?? '').trim() || config.targetId
    return { kind, id }
  }

  async function sendText(text, extra = {}) {
    const safe = filterText(String(text ?? ''))
    if (safe.trim() === '') return { ok: false, reason: 'empty' }
    const { kind, id } = targetOf(extra)
    const payload = { msgId: extra.msgId }
    try {
      if (kind === 'group') await transport.sendToGroup(id, safe, payload)
      else await transport.sendToUser(id, safe, payload)
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: 'transport-failed', error: String(error?.message ?? error) }
    }
  }

  const connected = gateway.connect('qq', {
    send: async (message) => {
      const result = await sendText(renderCardText(message))
      if (!result.ok) throw new Error(result.error ?? result.reason)
    }
  })
  if (!connected.ok) throw new Error(`QQ 通道连不上：${connected.reason}`)

  async function pushCard(input) {
    const created = await gateway.sendCard(input)
    return created
  }

  /**
   * 把一条已验签、已归一化的 QQ 事件交给网关。
   * 群聊只有在配置为群目标时才回，避免把私人审批发到群里。
   */
  async function handleEvent(event, extra = {}) {
    if (event === null || typeof event !== 'object') return { ok: false, reason: 'bad-event' }
    if (event.kind === 'group' && config.targetKind !== 'group') {
      return { ok: false, reason: 'group-not-allowed' }
    }
    const verdict = gateway.handle({
      channelId: 'qq',
      senderId: event.userId,
      text: event.content
    })
    let sent = null
    if (verdict.reply !== '') {
      sent = await sendText(verdict.reply, {
        kind: event.kind,
        targetId: event.kind === 'group' ? event.groupId : event.userId,
        msgId: event.messageId
      })
    }
    return { ...verdict, sent }
  }

  return {
    config,
    gateway,
    pushCard,
    sendText,
    handleEvent,
    status: () => ({ ...gateway.status(), targetKind: config.targetKind }),
    store: gateway.store
  }
}
