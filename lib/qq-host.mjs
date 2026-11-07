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
  const onDecision = typeof options.onDecision === 'function' ? options.onDecision : null
  const logger = options.logger ?? null
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  let bridge = null
  let webhook = null
  let secret = ''
  let lastError = ''
  let starting = null

  function config() {
    return normalizeQqConfig(getState().qq ?? {})
  }

  async function stop() {
    starting = null
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
    if (current.appId === '' || secret === '' || current.targetId === '') {
      lastError = describeQqConfig(current, { hasSecret: secret !== '' }).reason
      return
    }
    try {
      const transport = createOfficialQqTransport({
        appId: current.appId,
        appSecret: secret,
        fetchImpl
      })
      bridge = createQqBridge({
        config: current,
        transport,
        filterText
      })
      webhook = createQqWebhookServer({
        secret,
        path: current.webhookPath,
        port: current.webhookPort,
        parseEvent: transport.parseEvent,
        onEvent: async (event) => {
          const verdict = await bridge.handleEvent(event)
          if (onDecision !== null && (verdict.action === 'allow' || verdict.action === 'deny')) {
            onDecision(verdict.action === 'allow' ? 'allowed-once' : 'rejected', verdict)
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

  async function configure(patch = {}) {
    const next = normalizeQqConfig({ ...config(), ...patch })
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
      return await bridge.pushCard({ kind: 'approval', summary: summary.slice(0, 200) })
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
      error: lastError
    }
  }

  return {
    start,
    stop,
    restart,
    configure,
    pushApproval,
    describe,
    get bridge() {
      return bridge
    }
  }
}
