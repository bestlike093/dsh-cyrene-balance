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
  /* 归一化会把超限值截断/收窄，截过的东西必须让上层看得见，别静默吞掉。 */
  const warnings = []
  const rawAppId = String(input.appId ?? '').trim()
  if (rawAppId.length > MAX_ID) warnings.push('AppID 超过 80 字符，已截断')
  const appId = rawAppId.slice(0, MAX_ID)
  const owners = Array.isArray(input.ownerOpenIds) ? input.ownerOpenIds : []
  const ownerOpenIds = [...new Set(
    owners
      .map((owner) => {
        const value = String(owner ?? '').trim()
        if (value.length > MAX_ID) warnings.push('主人 openid 超过 80 字符，已截断')
        return value.slice(0, MAX_ID)
      })
      .filter((owner) => owner !== '')
  )]
  if (ownerOpenIds.length > MAX_OWNERS) warnings.push(`主人 openid 最多 ${MAX_OWNERS} 个，多余的已忽略`)
  const rawTargetId = String(input.targetId ?? '').trim()
  if (rawTargetId.length > MAX_ID) warnings.push('接收会话 id 超过 80 字符，已截断')
  const targetKind = input.targetKind === 'group' ? 'group' : 'c2c'
  const rawPort = Number(input.webhookPort)
  const webhookPort = clampInt(rawPort, 1, 65535, 17321)
  if (Number.isFinite(rawPort) && webhookPort !== Math.trunc(rawPort)) {
    warnings.push('Webhook 端口不在 1–65535，已收进范围内')
  }
  const rawPath = String(input.webhookPath ?? '').trim()
  const webhookPath = normalizePath(rawPath)
  if (rawPath !== '' && webhookPath !== rawPath.replace(/\/{2,}/g, '/')) {
    warnings.push('Webhook 路径经过整理（补斜杠/去重复斜杠/截断）')
  }
  return {
    enabled: input.enabled === true,
    appId,
    ownerOpenIds: ownerOpenIds.slice(0, MAX_OWNERS),
    targetKind,
    targetId: rawTargetId.slice(0, MAX_ID),
    webhookPort,
    webhookPath,
    warnings
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
  if (summary === '') throw new Error('卡片文本不能为空')
  const lines = [summary]
  const buttons = Array.isArray(message?.buttons) ? message.buttons : []
  let number = 0
  buttons.forEach((button) => {
    // 只渲染合法的按钮对象：action 缺失或不是字符串时跳过，
    // 别把「undefined（回复 undefined）」这种垃圾行发出去。
    if (button === null || typeof button !== 'object') return
    const action = typeof button.action === 'string' ? button.action : ''
    if (action === '') return
    const label =
      typeof button.label === 'string' && button.label !== ''
        ? button.label
        : (LABELS[action] ?? action)
    number += 1
    lines.push(`${number}. ${label}（回复 ${LABELS[action] ?? action}）`)
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

  /**
   * 发语音。调用方给的是已经转好的 silk 字节，桥这一层不碰编码。
   *
   * transport 没有语音能力时返回 voice-unsupported 而不是抛异常，
   * 上层可以据此退回文字，不必写一堆 try/catch。
   */
  async function sendVoice(audio, extra = {}) {
    const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio ?? [])
    if (buffer.length === 0) return { ok: false, reason: 'empty' }
    const { kind, id } = targetOf(extra)
    const payload = { msgId: extra.msgId }
    const method = kind === 'group' ? 'sendVoiceToGroup' : 'sendVoiceToUser'
    if (typeof transport[method] !== 'function') return { ok: false, reason: 'voice-unsupported' }
    try {
      await transport[method](id, buffer, payload)
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
    /* atMe 原样透传给网关与上层：是否「只进记忆不接话」由调用方看着它决定。 */
    const verdict = gateway.handle({
      channelId: 'qq',
      senderId: event.userId,
      text: event.content,
      atMe: typeof event.atMe === 'boolean' ? event.atMe : null
    })
    let sent = null
    // reply 可能缺字段：空或非字符串都当作「没有要回的话」，别把 undefined 拼成 'undefined' 发出去。
    if (typeof verdict.reply === 'string' && verdict.reply !== '') {
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
    sendVoice,
    handleEvent,
    status: () => ({ ...gateway.status(), targetKind: config.targetKind }),
    store: gateway.store
  }
}
