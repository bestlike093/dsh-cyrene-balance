/**
 * 宿主侧的 QQ 接线：把配置、密文、传输层、决策桥和 Webhook 拼在一起。
 *
 * 宿主只通过这里碰 QQ，不在 index.js 里散落网络与验签逻辑。
 * AppSecret 只经密文仓库进出，不写 state.json，也不回传给设置页。
 */
import {
  createOfficialQqTransport,
  createQqBridge,
  createQqWebhookServer,
  describeQqConfig,
  normalizeQqConfig
} from './companion/index.mjs'

function safeLog(logger, message) {
  try {
    logger?.warn?.(`cyrene-pet: ${message}`)
  } catch {
    /* 宿主 logger 异常不影响主流程 */
  }
}

export function createQqHost(options = {}) {
  const getState = typeof options.getState === 'function' ? options.getState : () => ({})
  const filterText = typeof options.filterText === 'function' ? options.filterText : (text) => text
  const loadSecret = typeof options.loadSecret === 'function' ? options.loadSecret : async () => ''
  const saveSecret = typeof options.saveSecret === 'function' ? options.saveSecret : async () => {}
  /* 可选：注入 saveConfig 时 configure 自己把归一化后的配置写回 state；
   * 不注入时由调用方负责写回（configure 不碰 state，这里只读 getState）。 */
  const saveConfig = typeof options.saveConfig === 'function' ? options.saveConfig : null
  const onDecision = typeof options.onDecision === 'function' ? options.onDecision : null
  /* 收到带图消息时先过一遍表情包小偷；失败只记日志，不挡对话。 */
  const onImages = typeof options.onImages === 'function' ? options.onImages : null
  const onStickerError = typeof options.onStickerError === 'function' ? options.onStickerError : null
  /* 主人发来的普通消息（不是确认卡片）交给宿主聊天；返回值不用，回复由 onChat 自己发。 */
  const onChat = typeof options.onChat === 'function' ? options.onChat : null
  /* 所有到达的消息先记一笔：记录与是否回复彻底分开，非主人说话也能进记忆。 */
  const onObserve = typeof options.onObserve === 'function' ? options.onObserve : null
  const logger = options.logger ?? null
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  let bridge = null
  let transport = null
  let webhook = null
  let secret = ''
  let lastError = ''
  /* 单一 in-flight 标记：start 全程持有一个 Promise，直到完成才清空；
   * stop() 不再碰它，避免「start 内部 stop 把标记提前清掉」的竞态。 */
  let starting = null

  function config() {
    return normalizeQqConfig(getState().qq ?? {})
  }

  async function stop() {
    if (webhook !== null) {
      const closing = webhook
      webhook = null
      try {
        await closing.stop()
      } catch {
        /* 关不掉也只影响下一次启动 */
      }
    }
    bridge = null
    transport = null
  }

  async function start() {
    await stop()
    const current = config()
    try {
      secret = String(await loadSecret()).trim()
    } catch (error) {
      lastError = `读取 QQ 密文失败：${error?.message ?? error}`
      return
    }
    if (current.enabled !== true) {
      lastError = ''
      return
    }
    /* 主人列表是 describeQqConfig().ready 的一部分：空列表时没有谁能审批/接话，
     * 起一条谁都不能用的通道只会白挂一个端口，直接拒绝并说明原因。 */
    if (current.ownerOpenIds.length === 0) {
      lastError = '还没填主人 openid，QQ 通道不启动'
      return
    }
    if (current.appId === '' || secret === '' || current.targetId === '') {
      lastError = describeQqConfig(current, { hasSecret: secret !== '' }).reason
      return
    }
    try {
      const nextTransport = createOfficialQqTransport({
        appId: current.appId,
        appSecret: secret,
        fetchImpl
      })
      transport = nextTransport
      bridge = createQqBridge({
        config: current,
        transport: nextTransport,
        filterText
      })
      webhook = createQqWebhookServer({
        secret,
        path: current.webhookPath,
        port: current.webhookPort,
        parseEvent: transport.parseEvent,
        onEvent: async (event) => {
          if (onImages !== null && Array.isArray(event?.images) && event.images.length > 0) {
            try {
              await onImages(event)
            } catch (error) {
              const reason = String(error?.message ?? error)
              if (onStickerError !== null) onStickerError(reason)
              safeLog(logger, `表情包没收成：${reason}`)
            }
          }
          /* 先记一笔再决定怎么处理：非主人说话、被网关忽略的消息也留得下来。 */
          if (onObserve !== null) {
            try {
              await onObserve(event)
            } catch (error) {
              safeLog(logger, `QQ 记忆没记上：${String(error?.message ?? error)}`)
            }
          }
          const verdict = await bridge.handleEvent(event)
          if (onDecision !== null && (verdict.action === 'allow' || verdict.action === 'deny')) {
            onDecision(verdict.action === 'allow' ? 'allowed-once' : 'rejected', verdict)
          }
          /* 主人自由说话：卡片已处理完、网关也没有代答时，交给她自己回。 */
          if (
            onChat !== null &&
            verdict.reason === 'owner-message' &&
            String(event?.content ?? '').trim() !== ''
          ) {
            try {
              await onChat(event)
            } catch (error) {
              const reason = String(error?.message ?? error)
              if (onStickerError !== null) onStickerError(`聊天回复失败：${reason}`)
              safeLog(logger, `QQ 聊天没接上：${reason}`)
            }
          }
        }
      })
      await webhook.start()
      lastError = ''
    } catch (error) {
      lastError = String(error?.message ?? error)
      safeLog(logger, `QQ 通道没有起来：${lastError}`)
      await stop()
    }
  }

  function restart() {
    if (starting !== null) return starting
    starting = start().finally(() => {
      starting = null
    })
    return starting
  }

  /**
   * 用配置补丁重配一次：归一化 → （有 saveConfig 时）写回 state → 重启通道。
   * 宿主没注入 saveConfig 时，调用方负责把返回的 config 自己写进 state。
   */
  async function configure(patch = {}) {
    const next = normalizeQqConfig({ ...config(), ...patch })
    if (saveConfig !== null) {
      try {
        await saveConfig(next)
      } catch (error) {
        lastError = `保存 QQ 配置失败：${error?.message ?? error}`
        return describe()
      }
    }
    if (patch.appSecret !== undefined) {
      const value = String(patch.appSecret ?? '').trim()
      await saveSecret(value)
      secret = value
    }
    await restart()
    return describe()
  }

  async function pushApproval(input = {}) {
    if (bridge === null) return { ok: false, reason: 'offline' }
    const summary = String(input.summary ?? '').trim()
    if (summary === '') return { ok: false, reason: 'empty' }
    try {
      const result = await bridge.pushCard({ kind: 'approval', summary: summary.slice(0, 200) })
      /* 成功就清掉上一次的错误，describe 里的 error 才有「最近一次失败」的意义。 */
      lastError = result?.ok === true ? '' : String(result?.error ?? result?.reason ?? 'push-failed')
      return result
    } catch (error) {
      lastError = String(error?.message ?? error)
      return { ok: false, reason: 'transport-failed', error: lastError }
    }
  }

  /**
   * 发一张表情。filePath 可以是本地文件或 http(s) 地址。
   * 群聊传 groupId，私聊传 userId；都不传时用配置里的 target。
   */
  async function sendSticker(input = {}) {
    if (transport === null) return { ok: false, reason: 'offline' }
    const filePath = String(input.filePath ?? '').trim()
    if (filePath === '') return { ok: false, reason: 'empty' }
    const groupId = String(input.groupId ?? '').trim()
    const userId = String(input.userId ?? '').trim()
    try {
      if (groupId !== '') {
        await transport.sendImageToGroup(groupId, filePath)
        lastError = ''
        return { ok: true, kind: 'group' }
      }
      if (userId !== '') {
        await transport.sendImageToUser(userId, filePath)
        lastError = ''
        return { ok: true, kind: 'c2c' }
      }
      /* 没指定就发给配置里的默认对象。 */
      const current = config()
      const targetId = current.targetId
      if (targetId === '') return { ok: false, reason: 'no-target' }
      if (current.targetKind === 'group') {
        await transport.sendImageToGroup(targetId, filePath)
        lastError = ''
        return { ok: true, kind: 'group' }
      }
      await transport.sendImageToUser(targetId, filePath)
      lastError = ''
      return { ok: true, kind: 'c2c' }
    } catch (error) {
      lastError = String(error?.message ?? error)
      return { ok: false, reason: 'transport-failed', error: lastError }
    }
  }

  /** 回一句话。target 可传 { kind, targetId, msgId }；不传就走配置里的默认对象。 */
  async function sendText(text, target = {}) {
    if (bridge === null) return { ok: false, reason: 'offline' }
    try {
      const result = await bridge.sendText(text, target)
      /* 成功就清掉 lastError：错误状态要反映「最近一次」，不是「曾经有过」。 */
      lastError = result?.ok === true ? '' : String(result?.error ?? result?.reason ?? 'send-failed')
      return result
    } catch (error) {
      lastError = String(error?.message ?? error)
      return { ok: false, reason: 'transport-failed', error: lastError }
    }
  }

  /**
   * 回一条语音。audio 必须是已转好的 silk 字节，桥这一层不碰编码。
   *
   * 没上线、没目标、transport 不支持语音都走返回码，
   * 上层据此退回文字，不必自己包一层 try/catch。
   */
  async function sendVoice(audio, target = {}) {
    if (bridge === null) return { ok: false, reason: 'offline' }
    try {
      const result = await bridge.sendVoice(audio, target)
      /* 成功就清掉 lastError，和 sendText 同一套口径。 */
      lastError = result?.ok === true ? '' : String(result?.error ?? result?.reason ?? 'send-failed')
      return result
    } catch (error) {
      lastError = String(error?.message ?? error)
      return { ok: false, reason: 'transport-failed', error: lastError }
    }
  }

  function describe() {
    const current = config()
    const view = describeQqConfig(current, { hasSecret: secret !== '' })
    return {
      ...view,
      online: bridge !== null,
      webhookRunning: webhook?.status().running === true,
      webhookLastError: webhook?.status().lastError ?? '',
      warnings: Array.isArray(current.warnings) ? current.warnings : [],
      error: lastError
    }
  }

  return {
    start,
    stop,
    restart,
    configure,
    pushApproval,
    sendSticker,
    sendText,
    sendVoice,
    describe,
    get bridge() {
      return bridge
    }
  }
}
