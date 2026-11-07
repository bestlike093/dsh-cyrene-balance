/**
 * 陪伴层：把 `@pet/core` 的 CompanionCore 接进主进程。
 *
 * 这一层只做三件事：
 * - 让心情、断言记忆、话头、表情候选活过一次对话，而不是每轮重新计算；
 * - 把「这一轮该带进提示词的内容」整理成一段可直接拼进 system 的文本；
 * - 把状态落盘 / 接回，落盘方式由调用方注入（主进程用加密仓库）。
 *
 * 不碰窗口、不碰渲染层、不自己发网络请求。
 */

import { CompanionCore, inferScene, pickCandidate, pickEmoji, rescheduleAfter } from '@pet/core/browser'

/** 连续对话时不必每轮都写盘；攒一下再落，退出时由 flush() 兜底。 */
const SAVE_DEBOUNCE_MS = 1_200

/** 话头最多提几条。提醒太多会让每句话都变成追问。 */
const MAX_LOOPS = 3

/**
 * 话头放置多久之后才值得回访。
 *
 * 刚聊完就问「刚才那件事后来怎么样了」会显得没听人说话；
 * 隔两小时以上，才像真的惦记着。
 */
const LOOP_NUDGE_AFTER_MS = 2 * 60 * 60_000

/**
 * 表情 id 的中文提示。只用于让模型更快判断「这张配不配」，
 * 不在表里就只给 id，不编造含义。
 */
const EMOJI_HINTS = {
  airkiss: '轻轻一吻',
  allset: '准备好了',
  awesome: '厉害',
  awkward: '有点尴尬',
  blushhard: '脸红',
  copythat: '收到',
  deadtired: '累瘫',
  dream: '困困的',
  eating: '在吃东西',
  fighting: '加油',
  foryou: '为你',
  free: '自由了',
  gigglelots: '偷笑',
  giveup: '放弃',
  goodmorning: '早安',
  goodnight: '晚安',
  hello: '你好',
  hellyeah: '太好了',
  hi: '打招呼',
  hmph: '哼',
  hugtight: '抱紧',
  hurtcry: '委屈',
  madnow: '生气',
  midmeh: '一般般',
  missme: '想你',
  ok: '好',
  outfast: '先走了',
  paniccrying: '慌哭',
  please: '拜托',
  poorwallet: '钱包空空',
  putmd: '摆烂',
  shyshort: '害羞',
  sleepynow: '困了',
  sobbinghard: '哭得很凶',
  sogood: '好吃',
  sonice: '真好',
  sotired: '好累',
  teatime: '喝茶时间',
  thanks: '谢谢',
  thinking: '在想',
  thumbsup: '赞',
  vacayover: '假期结束',
  weeploud: '大哭',
  whatswrong: '怎么了'
}

/**
 * 表情标记：`[图:id]`、`【图：id】`、`(图: id)` 三种写法都认。
 *
 * 这里故意不限制 id 的字符合法性：模型编出 `[图:../../etc/passwd]` 时，
 * 也要把整段标记摘掉，否则残骸会直接漏进气泡。合法性交给 allowlist 判断。
 */
const EMOJI_TAG_PATTERN = /[[【(（]\s*图\s*[:：]\s*([^\]】)）\n]{1,40})\s*[\]】)）]/

/**
 * 从模型输出里摘出表情标记。
 *
 * 必须在 cleanBubbleLine 之前调用：清洗只保留第一句话，
 * 句末的标记会被整段砍掉，图也就丢了。
 * allowedIds 用来挡住模型自己编的 id，不认识的直接丢掉，不留空图框。
 *
 * @returns {{text:string, emojiId:string|null}}
 */
export function parseEmojiTag(raw, allowedIds = null) {
  if (typeof raw !== 'string') return { text: '', emojiId: null }
  // 用带 g 的副本：matchAll 需要全局标志，但常量本身要保持无状态，
  // 否则 lastIndex 会跨调用残留，下一次匹配从上次的位置开始。
  const pattern = new RegExp(EMOJI_TAG_PATTERN.source, 'g')
  const tags = [...raw.matchAll(pattern)]
  if (tags.length === 0) return { text: raw, emojiId: null }

  const isAllowed = (id) => {
    if (allowedIds === null) return true
    return Array.isArray(allowedIds) ? allowedIds.includes(id) : allowedIds.has(id)
  }

  // 只认第一个合法 id；但所有标记都要摘掉，模型写两个或编出非法 id 时，
  // 残骸留在正文里会直接进气泡。
  let emojiId = null
  for (const tag of tags) {
    const id = tag[1].trim()
    if (emojiId === null && isAllowed(id)) emojiId = id
  }
  return {
    text: raw.replace(pattern, '').trim(),
    emojiId
  }
}

/**
 * 把一轮上下文拼成提示词片段。
 *
 * 只在真有内容时输出对应的段落：没有相关记忆就不提「你记得」，
 * 免得模型为了填满格式去编一件根本没发生的事。
 */
export function buildCompanionNote(turn, options = {}) {
  if (turn === null || typeof turn !== 'object') return ''
  const maxLoops = Number.isFinite(options.maxLoops) ? Math.max(0, Math.floor(options.maxLoops)) : MAX_LOOPS
  const lines = []

  if (typeof turn.moodNote === 'string' && turn.moodNote.trim() !== '') {
    lines.push(`你此刻的心情：${turn.moodNote.trim()}。`)
  }

  // 节目单只给「此刻在做什么」和「接下来是什么」。
  // 铺开整张表会让每句话都变成日程播报。
  if (typeof turn.agendaNote === 'string' && turn.agendaNote.trim() !== '') {
    lines.push('', '你现在正在过的这一天：', turn.agendaNote.trim())
  }

  const memory = typeof turn.memoryNote === 'string' ? turn.memoryNote.trim() : ''
  if (memory !== '') {
    lines.push(
      '',
      '下面是你记得的、和这句话有关的事。用得上的时候自然带一句，不要逐条复述，也不要说成「记录里写着」：',
      memory
    )
  }

  const loops = Array.isArray(turn.openLoops)
    ? turn.openLoops.filter((item) => item !== null && typeof item?.text === 'string' && item.text.trim() !== '')
    : []
  if (loops.length > 0 && maxLoops > 0) {
    lines.push('', '还有几件没聊完的事。想接就轻轻接一句，不必每条都提，也不要追问：')
    for (const loop of loops.slice(-maxLoops)) lines.push(`- ${loop.text.trim()}`)
  }

  const emoji = Array.isArray(turn.emoji) ? turn.emoji.filter((item) => typeof item?.entry?.id === 'string') : []
  if (emoji.length > 0) {
    const names = emoji
      .map((item) => {
        const hint = EMOJI_HINTS[item.entry.id]
        return hint === undefined ? item.entry.id : `${item.entry.id}（${hint}）`
      })
      .join('、')
    lines.push(
      '',
      `这一轮可以配一张小表情。想配就在整句末尾单独写 [图:id]，id 只能从这些里面挑：${names}。`,
      '配不上就不写，不要为了配图硬凑，也不要用别的写法。'
    )
  }

  return lines.join('\n')
}

/**
 * 建一个陪伴服务。
 *
 * @param {object} options
 * @param {() => Promise<unknown>|unknown} options.load  读回上次的状态；失败可抛，由本层兜底
 * @param {(state:unknown) => Promise<unknown>|unknown} options.save  落盘
 * @param {() => object} options.getSettings  读设置，用于总开关
 * @param {() => number} [options.now]
 * @param {() => number} [options.favor]  当前好感度，用于主动开口的分层节奏
 * @param {(message:string, error:unknown) => void} [options.log]
 */
export function createCompanionService(options = {}) {
  const {
    load = null,
    save = null,
    getSettings = () => ({}),
    now = Date.now,
    favor = () => 50,
    // 情绪运行时：余波 / 表情实验 / 需求。不传时完全退回原行为。
    emotion = null,
    log = () => {},
    saveDelayMs = SAVE_DEBOUNCE_MS
  } = options

  let core = new CompanionCore({ now, favor })
  let loaded = false
  let loading = null
  let saveTimer = null
  let dirty = false
  // 已经主动提过的话头 id；跟陪伴快照一起落盘，重启后不会重复提同一件事。
  const nudgedLoops = new Set()
  // 最近一次真正收到用户消息的时间；落盘后，「很久没联系」跨重启仍然成立。
  let lastUserAt = null
  // 这一段连续对话从什么时候开始：用来判断「聊了多久算打断」。
  let chatSessionStart = 0
  let lastTurnAt = 0
  let lastAgendaInterruptAt = 0

  /** 服务层自己的两个小状态：能认就认，认不出按空值，不拖累整份快照。 */
  function restoreServiceState(raw) {
    if (typeof raw !== 'object' || raw === null) return
    const record = raw
    const loops = record.nudgedLoops
    if (Array.isArray(loops)) {
      nudgedLoops.clear()
      for (const id of loops) {
        if (typeof id === 'string' && id !== '') nudgedLoops.add(id)
      }
    }
    const at = Number(record.lastUserAt)
    lastUserAt = Number.isFinite(at) && at > 0 ? at : null
  }

  function enabled() {
    const layer = getSettings()?.companion?.companionLayer
    // 没写过这一项时默认开：陪伴层的价值全在「一直记得」，默认关掉等于没有。
    return layer?.enabled !== false
  }

  function scheduleSave() {
    if (typeof save !== 'function') return
    dirty = true
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flush()
    }, saveDelayMs)
    saveTimer.unref?.()
  }

  /** 接回磁盘状态。只做一次；失败就带着空状态继续跑，下次对话照常。 */
  async function ready() {
    if (loaded) return core
    if (loading !== null) return loading
    loading = (async () => {
      try {
        if (typeof load === 'function') {
          const raw = await load()
          if (raw !== null && raw !== undefined) {
            core = CompanionCore.fromJSON(raw, { now })
            restoreServiceState(raw)
          }
        }
      } catch (error) {
        log('陪伴状态读取失败，按新状态继续', error)
      } finally {
        loaded = true
        loading = null
      }
      return core
    })()
    return loading
  }

  /**
   * 用户说完一句话。返回这一轮的上下文；关闭、空句或内部出错时返回 null，
   * 调用方据此走原来的提示词，而不是拿到半份数据。
   */
  async function beginTurn(text) {
    if (!enabled()) return null
    if (typeof text !== 'string' || text.trim() === '') return null
    const instance = await ready()
    try {
      const context = instance.onUserMessage(text.trim())
      lastUserAt = now()
      // 余波与连接需求：只影响表现层和下一次开口的分寸，读不到就算了。
      emotion?.noteUserTurn?.({
        emotion: typeof context?.emotion === 'string' ? context.emotion : 'neutral'
      })
      // 先把「她刚收到这句话」落下去：下一轮可能直接退出，不能等 endTurn。
      scheduleSave()
      return context
    } catch (error) {
      log('陪伴层处理用户消息失败', error)
      return null
    }
  }

  /** 自己说完一句话。失败不影响已经发出去的回复。 */
  function endTurn(text, emojiId = null) {
    if (!enabled()) return
    if (typeof text !== 'string' || text.trim() === '') return
    try {
      if (typeof emojiId === 'string' && emojiId !== '') core.onAssistantReply(text.trim(), emojiId)
      else core.onAssistantReply(text.trim())
      emotion?.noteAssistantReply?.()
      scheduleSave()
      // 连续聊得够久，就等于把这段时间从日程里占走了：重排一次。
      // 放在 try 外面也没关系，内部自己吞异常，不影响已经发出去的回复。
      maybeInterruptAgenda()
    } catch (error) {
      log('陪伴层收尾失败', error)
    }
  }

  /**
   * 她正在做正事的时候，用户一直聊，日程就会被占掉。
   *
   * 只按「同一段连续对话」计时：距上一轮超过五分钟就当作新的一段。
   * 聊满 15 分钟才值得重排；一小时内最多改一次，避免每句话都把时间线往后推。
   * 真正的判断（睡觉不动、后面压不出时间不动）在 core 的 rescheduleAfter 里。
   */
  function maybeInterruptAgenda() {
    if (!enabled()) return
    const at = now()
    if (chatSessionStart === 0 || at - lastTurnAt > 5 * 60_000) chatSessionStart = at
    lastTurnAt = at
    const minutes = Math.round((at - chatSessionStart) / 60_000)
    if (minutes < 15) return
    if (at - lastAgendaInterruptAt < 60 * 60_000) return

    lastAgendaInterruptAt = at
    // 重新起一段，不然下一轮又会带着同一个起点来算。
    chatSessionStart = at
    void interruptAgenda(minutes).catch((error) => {
      log('陪伴层重排日程失败', error)
    })
  }

  /**
   * 被打断之后重排今天。
   *
   * 只在「手头有正事」时改日程：本来就在休息，多聊一会儿不算打断。
   * 返回 core 的结果，调用方可以据此决定要不要给用户一句解释。
   */
  async function interruptAgenda(minutes) {
    if (!enabled()) return { changed: false, reason: 'disabled' }
    const delay = Math.round(Number(minutes))
    if (!Number.isFinite(delay) || delay <= 0) return { changed: false, reason: 'no-delay' }
    const plan = await currentAgenda()
    if (plan === null) return { changed: false, reason: 'no-agenda' }
    const result = rescheduleAfter(plan, { now: now(), delayMinutes: delay })
    if (!result.changed) return result
    const accepted = await setAgenda(result.plan)
    if (!accepted) return { changed: false, reason: 'rejected' }
    return result
  }

  /** 用户对某条被提到的记忆作出反应后调用；用于把「提得对不对」学进去。 */
  function noteMemoryReaction(assertionId, reaction) {
    if (typeof assertionId !== 'string' || assertionId === '') return
    try {
      core.noteMemoryReaction(assertionId, reaction)
      scheduleSave()
    } catch (error) {
      log('陪伴层记忆反馈失败', error)
    }
  }

  /** 主动说话用：只要心情那一句，不推进对话轮次。 */
  async function currentMoodNote() {
    if (!enabled()) return ''
    const instance = await ready()
    try {
      return instance.mood.describe()
    } catch (error) {
      log('陪伴层读取心情失败', error)
      return ''
    }
  }

  /**
   * 主动说话用的提示词片段。
   *
   * 不调 onUserMessage：那是「用户说了话」的语义，会在话头池里记一笔，
   * 主动搭话不该污染对话节奏。这里只读心情和未完成的话头。
   */
  async function presenceNote() {
    if (!enabled()) return ''
    const instance = await ready()
    try {
      const lines = [`你此刻的心情：${instance.mood.describe()}。`]
      const agendaNote = instance.agendaNote()
      if (typeof agendaNote === 'string' && agendaNote.trim() !== '') {
        lines.push('', '你现在正在过的这一天：', agendaNote.trim())
      }
      // 今天已经开口过几次、上次是什么方向：避免每句话都绕回同一个话题。
      const pacingNote = instance.openings.describeForPrompt(now())
      if (pacingNote !== '') lines.push('', pacingNote)
      const loops = instance.reflection
        .loops('open')
        .filter((item) => typeof item?.text === 'string' && item.text.trim() !== '')
        .slice(-2)
      if (loops.length > 0) {
        lines.push('', '还有几件没聊完的事。想接就轻轻接一句，不必每条都提，也不要追问：')
        for (const loop of loops) lines.push(`- ${loop.text.trim()}`)
      }
      return lines.join('\n')
    } catch (error) {
      log('陪伴层读取在场状态失败', error)
      return ''
    }
  }

  /**
   * 当天的节目单生成好后注入。
   *
   * 生成是主进程的事（要调模型），这里只负责收下、换日、落盘。
   * 传进来的不是今天的单也没关系，core 会把它挪成今天。
   */
  async function setAgenda(plan) {
    if (plan === null || typeof plan !== 'object') return false
    const instance = await ready()
    try {
      instance.setAgenda(plan)
      scheduleSave()
      return true
    } catch (error) {
      log('陪伴层写入节目单失败', error)
      return false
    }
  }

  /** 今天这份节目单的人话概要；设置页只读它，不铺整张表。 */
  async function agendaNote() {
    if (!enabled()) return ''
    const instance = await ready()
    try {
      return instance.agendaNote()
    } catch (error) {
      log('陪伴层读取日程失败', error)
      return ''
    }
  }

  /** 只读：今天这份节目单。 */
  async function currentAgenda() {
    if (!enabled()) return null
    const instance = await ready()
    try {
      return instance.agenda
    } catch (error) {
      log('陪伴层读取节目单失败', error)
      return null
    }
  }

  /**
   * 认领当前时段。
   *
   * 同一段一天只会成功一次；返回 null 表示「这一轮不该主动开口」。
   * 调度器应当在真正发消息之前调用，避免同一段反复触发。
   */
  async function claimAgenda() {
    if (!enabled()) return null
    const instance = await ready()
    try {
      const claimed = instance.claims.claim(instance.agenda, now())
      if (claimed !== null) scheduleSave()
      return claimed
    } catch (error) {
      log('陪伴层认领节目单失败', error)
      return null
    }
  }

  /**
   * 该主动回访的话头。
   *
   * 只挑放置够久、这轮还没提过的；一次只给一条，避免一口气把三件事都翻出来。
   * 已经在内存里提过的 id 会跳过；重启后可能再提一次，但话头本身有 TTL，
   * 而且重复一次比「永远不敢开口」更接近真人。
   */
  async function pendingLoop(minAgeMs = LOOP_NUDGE_AFTER_MS) {
    if (!enabled()) return null
    const instance = await ready()
    try {
      const nowMs = now()
      const due = instance.reflection
        .loops('open')
        .filter((item) => typeof item?.text === 'string' && item.text.trim() !== '')
        .filter((item) => !nudgedLoops.has(item.id))
        .filter((item) => {
          // 说了「明天」就等到明天上午，别当晚就问「面试怎么样了」；
          // 没有时间词的旧话头仍按最短间隔走。传 0 表示调试时立刻可读。
          if (minAgeMs <= 0) return true
          const dueAt = typeof item.dueAt === 'number' ? item.dueAt : item.createdAt + minAgeMs
          return nowMs >= Math.max(dueAt, item.createdAt + minAgeMs)
        })
      if (due.length === 0) return null

      const oldest = due.reduce((acc, item) => (item.createdAt < acc.createdAt ? item : acc))
      return {
        id: oldest.id,
        text: oldest.text.trim(),
        createdAt: oldest.createdAt,
        ...(typeof oldest.dueAt === 'number' ? { dueAt: oldest.dueAt } : {})
      }
    } catch (error) {
      log('陪伴层读取待回访话头失败', error)
      return null
    }
  }

  /** 这句话已经就着某个话头说过了，别再提前催下一次。 */
  function markLoopNudged(id) {
    if (typeof id !== 'string' || id === '') return
    nudgedLoops.add(id)
    scheduleSave()
  }

  /**
   * 这一拍要不要主动开口、为什么。
   *
   * 只做判断，不发消息：真正说话、挑表情、选通道仍由主进程决定。
   * 睡着了、免打扰、冷却期没过，都返回 null 并说明原因。
   */
  async function pickOpening(options = {}) {
    if (!enabled()) return null
    // 需求层说「真的很需要休息」时，这一拍就先不开口；关着时恒为 false。
    if (emotion?.shouldHoldBackOpening?.() === true) return null
    const instance = await ready()
    try {
      const agenda = instance.agenda
      const claimedSegmentIds = agenda.segments
        .filter((segment) => instance.claims.isClaimed(agenda.date, segment.id))
        .map((segment) => segment.id)
      const loop = await pendingLoop()
      // 身体状态优先：社交力气见底时不主动开口，睡着也一样；
      // 只是累了就先不挑日常话题，没说完的事仍然可以轻轻问。
      const flags = options.body?.flags ?? {}
      const candidate = pickCandidate({
        now: now(),
        agenda,
        claimedSegmentIds,
        loop: loop === null ? null : { id: loop.id, text: loop.text, createdAt: loop.createdAt },
        thought: options.thought ?? null,
        lastUserAt,
        quiet: options.quiet === true || flags.drained === true,
        asleep: options.asleep === true || flags.exhausted === true,
        tired: flags.lowEnergy === true || flags.sleepy === true,
        ...(typeof options.cooldownUntil === 'number'
          ? { cooldownUntil: options.cooldownUntil }
          : {})
      })
      if (candidate === null) return null

      // 机会账本：今天说太多次、或同一个方向刚说过，都不再开口。
      // 一条念头只说一次：指纹跟着 id 走，不和别的念头混成一个方向。
      const thoughtId = typeof candidate.thoughtId === 'string' ? candidate.thoughtId.trim() : ''
      const fingerprint =
        thoughtId !== ''
          ? `thought:${thoughtId}`
          : candidate.segmentId !== null
            ? `agenda:${candidate.segmentId}`
            : `${candidate.kind}:${candidate.reason}`
      const gate = instance.openings.allows(candidate.kind, candidate.reason, fingerprint, now())
      if (!gate.allowed) return null
      return { ...candidate, fingerprint }
    } catch (error) {
      log('陪伴层判断主动开口失败', error)
      return null
    }
  }

  /**
   * 此刻的开口分寸。
   *
   * 调度器用它决定下一次最早什么时候可以再试：每天有上限，
   * 连续开口没人接话时把间隔拉长，而不是一直按固定节拍说话。
   */
  async function openingPacing() {
    if (!enabled()) return null
    const instance = await ready()
    try {
      return instance.openings.pacing(now())
    } catch (error) {
      log('陪伴层读取开口节奏失败', error)
      return null
    }
  }

  /** 一句话真的说出去了。失败或空回复不要调用，下一拍还有机会。 */
  async function noteSpoken(opening, line) {
    if (!enabled() || opening === null || typeof opening !== 'object') return false
    if (typeof line !== 'string' || line.trim() === '') return false
    const instance = await ready()
    try {
      instance.openings.spoken(
        opening.kind ?? 'auto',
        typeof opening.reason === 'string' ? opening.reason : '',
        typeof opening.fingerprint === 'string' ? opening.fingerprint : '',
        now()
      )
      scheduleSave()
      return true
    } catch (error) {
      log('陪伴层记录主动开口失败', error)
      return false
    }
  }

  /**
   * QQ 群插话的共享闸门。
   *
   * 群消息由 proactiveGate 自己控制节奏；这里只共享「今天总共说了几次」
   * 和同方向重复。未回应降速、桌面冷却都不共享，免得群里的沉默
   * 把桌面端正常开口一起拖慢。
   *
   * 陪伴层关掉时返回放行：这类插话本来就不依赖陪伴层是否开启。
   */
  async function allowsSharedOpening(fingerprint) {
    if (!enabled()) return { allowed: true, reason: null }
    const instance = await ready()
    try {
      return instance.openings.allowsShared(String(fingerprint ?? ''), now())
    } catch (error) {
      log('陪伴层判断共享开口失败', error)
      return { allowed: true, reason: null }
    }
  }

  /** QQ 群那边真的说出去了。失败或空回复不要调用，下一拍还有机会。 */
  async function noteSharedOpening(fingerprint) {
    if (!enabled()) return false
    const instance = await ready()
    try {
      instance.openings.spokenShared(String(fingerprint ?? ''), now())
      scheduleSave()
      return true
    } catch (error) {
      log('陪伴层记录共享开口失败', error)
      return false
    }
  }

  /** 有机会但没说出话：留下证据，不计入今天，也不进入冷却。 */
  async function noteOpeningFailed(opening) {
    if (!enabled() || opening === null || typeof opening !== 'object') return false
    const instance = await ready()
    try {
      instance.openings.failed(
        opening.kind ?? 'auto',
        typeof opening.reason === 'string' ? opening.reason : '',
        typeof opening.fingerprint === 'string' ? opening.fingerprint : '',
        now()
      )
      scheduleSave()
      return true
    } catch (error) {
      log('陪伴层记录主动开口失败', error)
      return false
    }
  }

  /** 主动说话的表情候选：按此刻的心情与时段的情绪挑，最近用过的会降权。 */
  async function emojiCandidates(limit = 3) {
    if (!enabled()) return []
    const instance = await ready()
    try {
      const mood = instance.mood.snapshot()
      const moodEmotion = instance.mood.toEmotionTag(mood)
      // 表情实验：off 时原样返回，experiment 才会换，control 只记录。
      const decided = emotion?.decideExpression?.(moodEmotion) ?? null
      const pickedEmotion =
        decided !== null && decided.changed === true && typeof decided.tag === 'string'
          ? decided.tag
          : moodEmotion
      const scene = inferScene(pickedEmotion, new Date(now()).getHours())
      return pickEmoji(
        {
          emotion: pickedEmotion,
          mood,
          recentIds: instance.recentEmoji,
          ...(scene === undefined ? {} : { scene })
        },
        { limit }
      )
        .map((item) => item.entry.id)
        .filter((id) => typeof id === 'string')
    } catch (error) {
      log('陪伴层挑选表情失败', error)
      return []
    }
  }

  /** 只读快照，给设置页诊断用。不含原文对话。 */
  async function snapshot() {
    const instance = await ready()
    try {
      return instance.snapshot()
    } catch (error) {
      log('陪伴层快照失败', error)
      return null
    }
  }

  /** 把攒着的改动立刻落盘；退出前调用。 */
  async function flush() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!dirty || typeof save !== 'function') return false
    dirty = false
    try {
      await save({
        ...core.toJSON(),
        nudgedLoops: [...nudgedLoops],
        lastUserAt
      })
      return true
    } catch (error) {
      // 写失败就留个脏标记，下次对话再试；不重试到死。
      dirty = true
      log('陪伴状态落盘失败', error)
      return false
    }
  }

  /** 清空陪伴状态（设置页「忘掉这些」）。 */
  async function reset() {
    core = new CompanionCore({ now, favor })
    nudgedLoops.clear()
    lastUserAt = null
    dirty = true
    await flush()
    return true
  }

  return {
    enabled,
    ready,
    beginTurn,
    endTurn,
    noteMemoryReaction,
    currentMoodNote,
    presenceNote,
    setAgenda,
    currentAgenda,
    agendaNote,
    interruptAgenda,
    claimAgenda,
    emojiCandidates,
    pendingLoop,
    markLoopNudged,
    pickOpening,
    openingPacing,
    noteSpoken,
    noteOpeningFailed,
    allowsSharedOpening,
    noteSharedOpening,
    snapshot,
    flush,
    reset
  }
}
