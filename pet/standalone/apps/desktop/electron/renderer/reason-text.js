/**
 * UI 契约的唯一翻译层。reason 码并同一张表，按域命名空间隔离：
 * - voice.* → i18n key，交给 settings.js 的 t()
 * - chat.*  → 可直接显示的文案，交给 chat.js
 *
 * 新增码只允许加在这里。未知码一律落到兜底文案，并计入 reason-unmapped；
 * 任何输入都不得返回空串或抛出。计数只增不减，供诊断读取，不在 UI 显示。
 * chat 状态码统一 `chat.state.*`；stale 是远端可达性的独立文案，不复用 voice 的 offline。
 */
(function () {
  const REASON_TEXT = {
    voice: {
      ready: 'voice.state.ready',
      disabled: 'voice.state.disabled',
      offline: 'voice.state.offline',
      'no-endpoint': 'voice.state.noEndpoint',
      'no-ref-audio': 'voice.state.noRefAudio',
      'cloud-unconfigured': 'voice.state.cloudUnconfigured',
      'cloud-unverified': 'voice.state.cloudUnverified',
      'not-loopback': 'voice.state.notLoopback',
      unknown: 'voice.state.unknown'
    },
    chat: {
      disabled: '聊天还没有打开。去设置里的「聊天」把开关打开，再来找我呀。',
      'no-key': '还没配置 DeepSeek 密钥。去设置里的「聊天」填一下，就能说话了。',
      'vault-unavailable': '加密仓库没有装配成功，读不到密钥。为避免用明文替代，暂时不能发送。',
      empty: '先写点什么吧。',
      'too-long': '这段话太长了，拆成几段再说好不好？',
      busy: '上一条还在路上，稍等一下下。',
      timeout: '等太久了，这次没有收到回复。可以再试一次。',
      'auth-failed': '密钥被拒绝了。检查一下设置里的密钥是不是复制完整。',
      'insufficient-balance': '账户余额不足，这次请求没有发出去。',
      'rate-limited': '请求太频繁，被限流了。歇一会儿再试。',
      'server-error': '对方服务暂时出问题，过几分钟再试试。',
      'bad-response': '收到的回复是空的，这次算失败。',
      'request-failed': '网络这一趟没走通。检查一下网络，再试一次。',
      'persist-failed': '清空没有落到磁盘，记录还在。稍后再试一次好吗？',
      'no-capture': '这会儿窗口没准备好，画面抓不到。',
      'no-folder': '还没确定照片存哪儿，先把保存位置设一下。',
      'empty-frame': '这一帧是空的，拍出来什么都看不见。',
      'capture-failed': '画面抓取没成功，再试一次吧。',
      'write-failed': '照片写不进磁盘，检查一下那个文件夹还在不在。',
      'chat.state.disabled': '聊天还没有打开。去设置里的「聊天」把开关打开，再来找我呀。',
      'chat.state.no-context': '还没有可用的对话上下文，先把聊天配置补上。',
      'chat.state.ready': '聊天可用。',
      'chat.state.stale': '远端暂时不可达，显示的是上次状态；正在后台重试。',
      'chat.state.unknown': '尚未检测到聊天状态。'
    }
  }

  let unmapped = 0

  function describeUnmapped(reason) {
    let label = '未知原因'
    try {
      if (reason !== undefined && reason !== null && reason !== '') label = String(reason)
    } catch {
      label = '未知原因'
    }
    return `出了点状况（${label}）。`
  }

  function lookup(domain, code) {
    try {
      const text = REASON_TEXT[domain][code]
      if (typeof text === 'string' && text.length > 0) return text
    } catch {
      // 访问器或键转换抛错也走兜底，不再向上抛。
    }
    unmapped += 1
    return null
  }

  window.CyreneReasonText = {
    voiceKey(state) {
      return lookup('voice', state) ?? 'voice.state.unknown'
    },
    chat(reason) {
      return lookup('chat', reason) ?? describeUnmapped(reason)
    },
    unmappedCount() {
      return unmapped
    },
    // 仅测试与诊断入口调用。进程内计数只增不减，生产路径不得重置。
    resetUnmapped() {
      unmapped = 0
    }
  }
})()
