/**
 * dsh-cyrene-pet/qq —— QQ 通道 组件行（M3，已从主插件拆出）。
 *
 * 本行只管 QQ 官方机器人这一条线：
 *   - qq.vault.json 里的 AppSecret 读写（仓库实例经 cyrene/kernel.getVaultClient() 取，
 *     与主行的视觉 key 共用同一实例，不会各开一个仓库互相覆盖）；
 *   - qqHost 生命周期（起 / 停 / 重启 / describe / 发文本 / 语音 / 贴纸 / 审批卡）；
 *   - 入站消息的观察（选择性记忆）与回复（走主行提供的 cyrene/chat 聊天服务）。
 *
 * 不做的事：不碰模型请求本身（聊天服务在主行）、不改别的插件的状态、
 * 不注册全局副作用；行内失败只降级自己（缺服务就跳过对应能力）。
 *
 * 拆分蓝图与里程碑见 docs/component-split.md。
 */
import { normalizeDshEnvelope } from '../companion/index.mjs'
import { createQqHost } from '../qq-host.mjs'

export const name = 'dsh-cyrene-pet/qq'
export const inject = ['webServer', 'systemPrompt', 'cyrene/kernel']

export function apply(ctx) {
  /* DSH 的 cordis 只把 (ctx, config) 传给 apply；注入的服务一律经 ctx.get 取。 */
  const kernel = ctx.get('cyrene/kernel')
  if (kernel === null || kernel === undefined) {
    throw new Error('dsh-cyrene-pet/qq：cyrene/kernel 未提供，本行无法启动')
  }
  const memory = ctx.get('cyrene/memory', { optional: true })
  const sticker = ctx.get('cyrene/sticker', { optional: true })
  const chat = ctx.get('cyrene/chat', { optional: true })
  const companion = ctx.get('cyrene/companion', { optional: true })
  /* 语音合成归 pet-voice 行：这里只发 bytes，缺了它 QQ 语音如实降级。 */
  const voice = ctx.get('cyrene/voice', { optional: true })

  const log = (message, error) => {
    if (error === undefined) ctx.logger?.warn?.(`${name}: ${message}`)
    else ctx.logger?.warn?.(`${name}: ${message}`, error)
  }

  /* ---------------- QQ AppSecret 密文 ---------------- */

  /*
   * 仓库文件与解锁都由主行（kernel）管：cyrene/kernel.getVaultClient() 返回
   * qq.vault.json 的 VaultStore 实例（拆分前就是同一个）。这里只包一层
   * 「失败后重置缓存」的记忆化，实例仍是 kernel 里那一份。
   */
  let qqVaultPromise = null

  function getQqVault() {
    if (qqVaultPromise === null) {
      qqVaultPromise = Promise.resolve(kernel.getVaultClient()).catch((error) => {
        qqVaultPromise = null
        throw error
      })
    }
    return qqVaultPromise
  }

  async function loadQqSecret() {
    const vault = await getQqVault()
    const data = await vault.load()
    return typeof data?.appSecret === 'string' ? data.appSecret : ''
  }

  async function saveQqSecret(appSecret) {
    const vault = await getQqVault()
    const data = (await vault.load()) ?? {}
    await vault.save({ ...data, appSecret: String(appSecret ?? '') })
  }

  /* ---------------- QQ 选择性记忆 ---------------- */

  /* 群聊每攒够这么多条原话、且离上次压缩超过两小时，就压成一条摘要。 */
  const QQ_DIGEST_EVERY = 50
  const QQ_DIGEST_GAP = 2 * 60 * 60 * 1000
  const qqDigestAt = new Map()

  async function maybeDigestGroup(groupId, at) {
    if (memory === null || memory === undefined) return
    const last = Number(qqDigestAt.get(groupId) ?? 0)
    if (at - last < QQ_DIGEST_GAP) return
    const items = memory.snapshot().items
    const rawCount = items.filter(
      (item) =>
        item.scope === 'group' && item.scopeId === groupId && item.kind === 'raw' && !item.pinned,
    ).length
    if (rawCount < QQ_DIGEST_EVERY) return
    const result = await memory.digest('group', groupId)
    if (result.changed !== true) return
    qqDigestAt.set(groupId, at)
    log(`[memory] 群 ${groupId} 压了 ${result.removed} 条成摘要`)
  }

  /**
   * 这个 QQ 号跟她是什么关系：主人、重要的人、次重要的人，还是路过的。
   * 名单只认主人在设置里点过的号；没点过的一律按路人看前十句话。
   */
  function peerTierOf(userId, isOwner) {
    if (isOwner === true) return 'owner'
    const id = String(userId ?? '').trim()
    if (id === '') return 'guest'
    const peers = kernel.readState()?.companionPeers ?? {}
    const important = Array.isArray(peers.important) ? peers.important : []
    const secondary = Array.isArray(peers.secondary) ? peers.secondary : []
    if (important.includes(id)) return 'important'
    if (secondary.includes(id)) return 'secondary'
    return 'guest'
  }

  /**
   * 所有到达 QQ 的消息先落进记忆，之后再谈要不要回。
   * 群聊进群桶并带发言人；主人在群里说话时，同时留一份进主人桶。
   */
  async function observeQqMessage(event) {
    const envelope = normalizeDshEnvelope(event)
    const text = envelope.text
    if (text === '') return
    const userId = envelope.userId
    if (userId === '') return
    const at = Date.now()
    const owners = Array.isArray(kernel.readState()?.qq?.ownerOpenIds)
      ? kernel.readState().qq.ownerOpenIds
      : []
    const isOwner = owners.includes(userId)
    const base = { slot: 'event', text, source: 'session', channel: 'qq', at }
    const observeSource = {
      channel: 'qq',
      chatType: envelope.chatType,
      openId: envelope.kind === 'group' ? envelope.targetId : userId,
      senderOpenId: userId,
      isOwner,
      tier: peerTierOf(userId, isOwner),
    }
    /* 群里和私聊里见到的人各记一份；前十句话会定一次第一印象。
       主人那条线由桌面 bond 单独管，这里不重复记。 */
    if (!isOwner && companion !== null && companion !== undefined) {
      try {
        companion.notePeerSeen(observeSource, 1, text)
      } catch (error) {
        log(`[companion] 记住 QQ 说话人失败：${String(error?.message ?? error)}`)
      }
    }

    /* 记忆层可选：pet-memory 没起来时这条消息只被观察，不落记忆。 */
    if (memory === null || memory === undefined) return

    if (envelope.kind === 'group') {
      const groupId = envelope.targetId
      if (groupId === '') return
      await memory.remember({ ...base, scope: 'group', scopeId: groupId, peer: userId })
      if (isOwner) {
        await memory.remember({ ...base, scope: 'owner', scopeId: userId })
      }
      await maybeDigestGroup(groupId, at)
      memory.notifyChanged()
      return
    }

    if (isOwner) {
      await memory.remember({ ...base, scope: 'owner', scopeId: userId })
      memory.notifyChanged()
      return
    }
    await memory.remember({ ...base, scope: 'private', scopeId: userId })
    memory.notifyChanged()
  }

  /**
   * 主人在 QQ 里直接说话：走主行的同一套聊天服务，回复回原会话，顺手带一张表情。
   * 审批卡片已经由网关处理完，这里只接「卡片之外的自由对话」。
   */
  async function replyToQqChat(event) {
    const envelope = normalizeDshEnvelope(event)
    const text = envelope.text
    if (text === '') return { ok: false, reason: 'empty' }
    const { kind, targetId, target } = envelope

    const owners = Array.isArray(kernel.readState()?.qq?.ownerOpenIds)
      ? kernel.readState().qq.ownerOpenIds
      : []
    const senderOpenId = envelope.userId
    const source = {
      channel: 'qq',
      chatType: kind,
      openId: targetId,
      senderOpenId,
      isOwner: owners.includes(senderOpenId),
      tier: peerTierOf(senderOpenId, owners.includes(senderOpenId)),
    }

    /* 聊天服务由主行提供；读不到时这条消息只进观察，没有人回。 */
    if (chat === null || chat === undefined) {
      log('[qq] 聊天服务不可用（cyrene/chat 未提供），这条消息没有回复')
      return { ok: false, reason: 'chat-unavailable' }
    }

    let result
    try {
      /* 绑了会话就先读一眼最新的几条，别拿十分钟前的桌面当上下文。 */
      await chat.refreshActiveSession()
      result = await chat.send({ text, source })
    } catch (error) {
      log(`[qq] 聊天服务出错：${String(error?.message ?? error)}`)
      return { ok: false, reason: 'chat-failed' }
    }

    if (result?.ok !== true) {
      const reason = String(result?.reason ?? 'request-failed')
      await qqHost.sendText(chat.reasonText(reason), target)
      return { ok: false, reason }
    }

    const reply = kernel.filterOutboundText(String(result.reply ?? ''))
    if (reply.trim() === '') return { ok: true, silent: true }

    const sent = await qqHost.sendText(reply, target)

    /* 文字是主，语音是添头。语音慢，不挡这一轮返回。 */
    void speakToQqChat(reply, event, target).catch(() => null)

    /* 模型点了标签就用它的；没点就按情绪兜底，QQ 侧同样 10 分钟冷却。
       表情库在主行，这里经 cyrene/sticker 服务取。 */
    if (sticker !== null && sticker !== undefined) {
      const modelLabel = typeof result.stickerLabel === 'string' ? result.stickerLabel.trim() : ''
      const fallbackLabel = modelLabel === '' ? sticker.fallbackLabelFor(reply, text, 'qq') : ''
      const label = modelLabel !== '' ? modelLabel : fallbackLabel
      if (label !== '') {
        /* 标签挑不到就用偷来的；偷来的图没有标签，只能这样上场。 */
        const item =
          (await sticker.pick(label).catch(() => null)) ??
          (await sticker.pickStolen().catch(() => null))
        if (item !== null && typeof item.abs === 'string' && item.abs !== '') {
          const image = await qqHost.sendSticker({
            filePath: item.abs,
            groupId: kind === 'group' ? targetId : '',
            userId: kind === 'group' ? '' : targetId
          })
          if (fallbackLabel !== '' && image?.ok === true) sticker.markFallbackSent('qq')
        }
      }
    }
    return { ok: true, sent }
  }

  /**
   * QQ 里补一条语音。
   *
   * 文字已经发出去了，这里只负责「再念一遍」。任何一步不成只记一笔，
   * 不回滚、不重发文字，也不会让语音失败把整轮回复拖垮。
   * 群聊不发：一条语音在群里能被所有人点开，私聊才合适。
   */
  async function speakToQqChat(text, event, target) {
    const stateNow = kernel.readState()
    if (stateNow.qqVoiceEnabled !== true) return { ok: false, reason: 'disabled' }
    if (event?.kind === 'group') return { ok: false, reason: 'group-skip' }

    const spoken = kernel.filterOutboundText(text).replace(/\s+/g, ' ').trim()
    if (spoken === '') return { ok: false, reason: 'empty' }

    /* 触发词可以填一组：按顿号、逗号、空白拆开，任一说中就算。 */
    const wakeWords = String(stateNow.qqVoiceWakeWord ?? '')
      .split(/[、,，;；\s]+/)
      .map((word) => word.trim())
      .filter((word) => word !== '')
    if (stateNow.qqVoiceMode !== 'always' && wakeWords.length > 0) {
      const heard = String(event?.content ?? '')
      if (!wakeWords.some((word) => heard.includes(word))) {
        return { ok: false, reason: 'no-wake-word' }
      }
    }

    const endpoint = String(stateNow.ttsEndpoint ?? '').trim()
    const refAudioPath = String(stateNow.ttsRefAudio ?? '').trim()
    if (endpoint === '') return { ok: false, reason: 'no-endpoint' }
    /* 本地 TTS 要参考音频才能出她的声音；没配就不硬凑一个陌生的腔调。 */
    if (refAudioPath === '') return { ok: false, reason: 'no-ref-audio' }
    if (voice === null || voice === undefined) {
      return { ok: false, reason: 'voice-unavailable' }
    }

    const result = await voice.synthesize({
      endpoint,
      text: spoken.slice(0, 200),
      refAudioPath,
      promptText: String(stateNow.ttsPromptText ?? ''),
      timeoutMs: 30000,
    })
    if (result.ok !== true) {
      log(`[qq] 语音没合成出来：${result.error ?? 'unknown'}`)
      return { ok: false, reason: result.error }
    }

    const silk = await voice.toSilk(result.audio)
    if (silk.ok !== true) {
      log(`[qq] 语音转码失败：${silk.error ?? 'unknown'}`)
      return { ok: false, reason: silk.error }
    }

    const sent = await qqHost.sendVoice(silk.silk, target)
    if (sent.ok !== true) {
      log(`[qq] 语音没发出去：${sent.reason ?? 'unknown'}`)
      return { ok: false, reason: sent.reason }
    }
    return { ok: true, durationMs: silk.durationMs }
  }

  /* ---------------- 宿主接线 ---------------- */

  const qqHost = createQqHost({
    getState: () => kernel.readState(),
    filterText: (text) => kernel.filterOutboundText(text),
    loadSecret: loadQqSecret,
    saveSecret: saveQqSecret,
    onImages: async (event) => {
      /* 收图走主行的表情包小偷；组件缺省时明确回一个降级码。 */
      if (sticker === null || sticker === undefined) {
        return { ok: false, reason: 'sticker-unavailable' }
      }
      return sticker.pickFromEvent(event)
    },
    onChat: (event) => replyToQqChat(event),
    /* 所有到达的消息都进记忆；回不回复仍由 onChat 与网关决定。 */
    onObserve: (event) => observeQqMessage(event),
    onStickerError: (reason) => {
      log(`[sticker] 没收成：${reason}`)
    },
    /* 网关的审批决定：广播给主行，主行正在等的审批卡据此结账。 */
    onDecision: (outcome) => {
      ctx.emit('cyrene/qq-decision', outcome)
    },
    logger: ctx.logger,
  })

  ctx.provide('cyrene/qq', {
    start: () => qqHost.start(),
    stop: () => qqHost.stop(),
    restart: () => qqHost.restart(),
    describe: () => qqHost.describe(),
    sendText: (text, target) => qqHost.sendText(text, target),
    sendVoice: (audio, target) => qqHost.sendVoice(audio, target),
    sendSticker: (input) => qqHost.sendSticker(input),
    pushApproval: (input) => qqHost.pushApproval(input),
    /**
     * 设置写入后的落尾：AppSecret 写密文、配置变了就重绑通道。
     * state 本身由主行写（setting 归 kernel），这里只接 prev/next 做差异判断。
     * 永不 reject：调用方用 void 触发，失败只记日志。
     */
    applySettings: async ({ prevQq, nextQq, secretPatch }) => {
      try {
        if (typeof secretPatch === 'string') {
          try {
            await saveQqSecret(secretPatch)
          } catch (error) {
            log(`QQ 密文没写进去：${error?.message ?? error}`)
          }
        }
        /* 配置没动就不重绑端口，免得白掉一次回调 */
        const qqChanged =
          JSON.stringify(nextQq) !== JSON.stringify(prevQq) || typeof secretPatch === 'string'
        if (qqChanged) await qqHost.restart()
      } catch (error) {
        log(`QQ 设置应用失败：${error?.message ?? error}`)
      }
    },
  })

  /* 生命周期：QQ 通道跟着本行一起起停；没配置就静默待命。
     设置由主行异步加载，这里先按当前状态试一次，等主行广播 state-loaded 再补一次。 */
  ctx.effect(() => {
    const startIfConfigured = () => {
      const qq = kernel.readState().qq
      if (qq?.enabled === true && String(qq?.appId ?? '').trim() !== '') {
        void qqHost.start().catch((error) => {
          log(`QQ 通道启动失败 ${error?.message ?? error}`)
        })
      }
    }
    startIfConfigured()
    const disposeStateListener = ctx.on('cyrene/state-loaded', startIfConfigured)
    return () => {
      disposeStateListener()
      void qqHost.stop()
    }
  }, `${name}: qq lifecycle`)
}
