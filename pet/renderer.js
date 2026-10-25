/* 昔涟桌宠渲染层：Live2D + 拖拽 + 点击穿透 + 台词 / 口型 / 状态面板 / 右键菜单 / 设置 */
(function () {
  'use strict'

  const canvas = document.getElementById('stage')
  const bubble = document.getElementById('bubble')
  const bubbleText = document.getElementById('bubble-text')
  const bubbleEmoji = document.getElementById('bubble-emoji')
  const hud = document.getElementById('hud')
  const hudBody = document.getElementById('hud-body')
  const menu = document.getElementById('menu')
  const settings = document.getElementById('settings')
  const askBox = document.getElementById('ask')
  const approvalBox = document.getElementById('approval')
  const taskSheet = document.getElementById('task-sheet')

  const W = window.innerWidth
  const H = window.innerHeight

  let model = null
  let app = null
  let mouthOpen = false
  let speakingUntil = 0
  let dragging = false
  let pressAt = null
  let pressPoint = null
  let interactive = false
  let idleTimer = 0
  let settingsOpen = false
  let live = null
  let zoom = 1
  let hudCollapsed = false
  let simpleCollapsed = true
  let hudExpanded = false
  let emojiHoldUntil = 0
  let lastEmojiName = ''
  let lastAskId = 0
  let lastApprovalId = 0
  let askState = null
  let taskTimer = null
  let lastHudKey = ''

  const report = (payload) => {
    try {
      window.pet && window.pet.report(payload)
    } catch {
      /* 上报失败不影响渲染 */
    }
  }

  const sendCommand = (payload) => {
    try {
      window.pet && window.pet.command(payload)
    } catch {
      /* 命令失败不影响渲染 */
    }
  }

  window.addEventListener('error', (event) => {
    report({ error: String(event.message || event.error), stack: event.error && event.error.stack })
  })
  window.addEventListener('unhandledrejection', (event) => {
    report({ rejection: String(event.reason) })
  })

  report({ stage: 'booting', width: W, height: H, dpr: window.devicePixelRatio })

  if (typeof PIXI === 'undefined' || typeof PIXI.live2d === 'undefined') {
    report({ fatal: 'pixi-not-ready', hasPixi: typeof PIXI, hasLive2d: typeof PIXI !== 'undefined' && !!PIXI.live2d })
    return
  }

  app = new PIXI.Application({
    view: canvas,
    width: W,
    height: H,
    transparent: true,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    powerPreference: 'high-performance',
  })

  report({ stage: 'pixi-ready', version: PIXI.VERSION })

  const MODEL_URL = 'assets/live2d/cyrene/Cyrene.model3.json'
  const EXPRESSIONS = {
    reset: '表情回正',
    glasses: '墨镜',
    question: '问号',
    sparkle: '闪耀',
    starry: '星星眼',
    dizzy: '圈圈眼',
    happyEye: '开心眼',
    ropeOn: '开',
    ropeOff: '关',
  }

  /* ------------------------------ 气泡 / 口型 ------------------------------ */

  const sounds = {
    click: new Audio('../assets/sound/Ya1.mp3'),
    talk: new Audio('../assets/sound/greeting.wav'),
    over: new Audio('../assets/sound/cost-default.wav'),
  }
  let lastTalkSoundAt = 0
  let lastPoseAt = 0
  let lastBalanceTotal = null
  let poseTimer = null
  let poseKey = ''
  let soundEnabled = true
  let soundVolume = 0.5

  /* DeepSeek 优惠时段：北京时间 00:30 - 08:30 */
  function rateLabel() {
    const now = new Date()
    const minutes = now.getHours() * 60 + now.getMinutes()
    const offPeak = minutes >= 30 && minutes < 510
    return offPeak ? { text: '谷价 · 半价', hot: true } : { text: '标准价', hot: false }
  }

  function playSound(name) {
    if (!soundEnabled) return
    const audio = sounds[name]
    if (!audio) return
    try {
      audio.volume = Math.min(1, Math.max(0, soundVolume))
      audio.currentTime = 0
      const result = audio.play()
      if (result && typeof result.catch === 'function') result.catch(() => {})
    } catch {
      /* 自动播放受限时静默 */
    }
  }

  function applyLook(data) {
    const width = Number(data.bubbleWidth) || 0
    bubble.style.width = width > 0 ? `${Math.min(width, window.innerWidth - 12)}px` : 'calc(100% - 12px)'
    bubble.style.fontSize = `${Number(data.bubbleFont) || 14.5}px`
    bubble.style.borderRadius = `${Math.max(0, Number(data.bubbleRadius) || 0)}px`

    const bubbleAlpha = Math.min(1, Math.max(0.5, Number(data.bubbleAlpha) || 0.97))
    bubble.style.setProperty('--bubble-a', String(bubbleAlpha))
    const hudAlpha = Math.min(1, Math.max(0.4, Number(data.hudAlpha) || 0.93))
    hud.style.setProperty('--hud-a', String(hudAlpha))

    const items = Array.isArray(data.hudItems) ? data.hudItems : null
    const show = (key) => items === null || items.includes(key)

    document.querySelectorAll('.hud-metric').forEach((el, index) => {
      el.classList.toggle('hidden', !show(['cpu', 'mem', 'gpu'][index]))
    })
    document.querySelector('.hud-grid').classList.toggle('hidden', !show('cpu') && !show('mem') && !show('gpu'))
    document.querySelector('.hud-line').classList.toggle('hidden', !show('net') && !show('bat'))
    document.getElementById('hud-net').classList.toggle('hidden', !show('net'))
    document.getElementById('hud-bat').classList.toggle('hidden', !show('bat'))
    document.querySelector('.hud-money').classList.toggle('hidden', !show('money'))
    document.querySelector('.hud-chips').classList.toggle('hidden', !show('chips'))
    document.querySelector('.hud-quota').classList.toggle('hidden', !show('quota'))

    soundEnabled = data.soundEnabled !== false
    soundVolume = Math.min(1, Math.max(0, Number(data.soundVolume) ?? 0.5))

    const nextPoseKey = `${data.idlePose !== false}|${Math.max(30, Number(data.poseSeconds) || 60)}`
    if (nextPoseKey !== poseKey) {
      poseKey = nextPoseKey
      if (poseTimer !== null) {
        window.clearInterval(poseTimer)
        poseTimer = null
      }
      if (data.idlePose !== false) {
        const seconds = Math.max(30, Number(data.poseSeconds) || 60)
        poseTimer = window.setInterval(() => {
          if (document.hidden) return
          randomPose()
        }, seconds * 1000)
      }
    }
  }

  function setEmoji(name) {
    if (bubbleEmoji === null) return
    const next = `../assets/emoji/${name}.png`
    if (bubbleEmoji.getAttribute('src') === next) return
    bubbleEmoji.src = next
  }

  function renderQuota(quota) {
    const box = document.querySelector('.hud-quota')
    const fill = document.getElementById('hud-quota-fill')
    const text = document.getElementById('hud-quota-text')
    if (box === null || fill === null || text === null) return
    if (quota === null || !quota || !quota.limit) {
      box.classList.remove('warn', 'over')
      fill.style.width = '0%'
      text.textContent = '未设'
      return
    }
    const percent = Math.min(100, Math.round((Number(quota.ratio) || 0) * 100))
    fill.style.width = `${percent}%`
    text.textContent = `${Number(quota.spent).toFixed(2)} / ${Number(quota.limit).toFixed(0)}`
    box.classList.toggle('over', Boolean(quota.overBudget))
    box.classList.toggle('warn', !quota.overBudget && percent >= 80)
  }

  const FALLBACK_EMOJI = ['HI', 'hello', 'Gigglelots', 'Thumbsup', 'sonice', 'Airkiss', 'thinking']

  const POSE_GROUPS = ['Idle', '动作#6', 'Tick3']

  function localQuota(data) {
    if (data.quota && typeof data.quota === 'object') return data.quota
    const limit = Number(data.dailyLimit) || 0
    if (limit <= 0) return null
    const spent = Number(data.balance && data.balance.spent) || 0
    const ratio = spent / limit
    return {
      limit,
      spent,
      ratio,
      overBudget: spent > limit,
      nearLimit: spent <= limit && ratio >= 0.8,
    }
  }

  function localEmoji(quota, speakNow) {
    if (quota && quota.overBudget) return 'poorwallet'
    if (quota && quota.nearLimit) return 'thinking'
    if (speakNow) return 'Gigglelots'
    return 'HI'
  }

  function randomPose() {
    if (model === null) return
    const group = POSE_GROUPS[Math.floor(Math.random() * POSE_GROUPS.length)]
    try {
      const list = model.internalModel.settings.motions[group]
      if (!list || list.length === 0) return
      model.motion(group, Math.floor(Math.random() * list.length), PIXI.live2d.MotionPriority.NORMAL)
    } catch {
      /* 动作缺失时忽略 */
    }
  }

  function showBubble(text, ms) {
    if (!text) return
    bubbleText.textContent = text
    bubble.classList.add('show')
    window.clearTimeout(showBubble.timer)
    showBubble.timer = window.setTimeout(() => bubble.classList.remove('show'), ms || 2600)
  }

  function speak(text, ms) {
    showBubble(text, Math.max(1800, ms || 2600))
    speakingUntil = performance.now() + Math.max(1200, ms || 2600)
    mouthOpen = true
    const now = Date.now()
    if (now - lastTalkSoundAt > 28000) {
      lastTalkSoundAt = now
      playSound('talk')
    }
    if (model !== null) {
      try {
        model.motion('动作#6', 2)
      } catch {
        /* 动作缺失时只做口型 */
      }
    }
  }

  function playIdle() {
    if (model === null) return
    const idles = ['Tick3', '动作#6']
    const group = idles[Math.floor(Math.random() * idles.length)]
    try {
      const list = model.internalModel.settings.motions[group]
      if (!list || list.length === 0) return
      model.motion(group, Math.floor(Math.random() * list.length), PIXI.live2d.MotionPriority.IDLE)
    } catch {
      /* 待机动作失败不打断渲染 */
    }
  }

  /* ------------------------------ 命中与穿透 ------------------------------ */

  function rectOf(element) {
    if (element === null || element.classList.contains('hidden')) return null
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return rect
  }

  function insideRect(x, y, rect) {
    return rect !== null && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  function onPanel(x, y) {
    return (
      insideRect(x, y, rectOf(hud)) ||
      insideRect(x, y, rectOf(menu)) ||
      insideRect(x, y, rectOf(settings)) ||
      insideRect(x, y, rectOf(askBox)) ||
      insideRect(x, y, rectOf(approvalBox)) ||
      insideRect(x, y, rectOf(taskSheet))
    )
  }

  function isPointOnPet(x, y) {
    if (model === null) return false
    const bounds = model.getBounds()
    if (bounds.width <= 0 || bounds.height <= 0) return false
    const radiusX = bounds.width * 0.5
    const radiusY = bounds.height * 0.5
    const nx = (x - (bounds.x + radiusX)) / radiusX
    const ny = (y - (bounds.y + radiusY)) / radiusY
    return nx * nx + ny * ny <= 1
  }

  function updateInteractive(x, y) {
    const next = onPanel(x, y) || isPointOnPet(x, y)
    if (next === interactive) return
    interactive = next
    if (window.pet) window.pet.setInteractive(next)
  }

  /* ------------------------------ 状态面板 ------------------------------ */

  function setText(id, text) {
    const node = document.getElementById(id)
    if (node !== null) node.textContent = text
  }

  function formatPercent(value) {
    return typeof value === 'number' ? `${Math.round(value)}%` : '--'
  }

  function formatRate(value) {
    if (typeof value !== 'number') return '--'
    if (value >= 1024) return `${(value / 1024).toFixed(1)} MB/s`
    return `${value.toFixed(0)} KB/s`
  }

  function moodOf(quotaInfo) {
    if (quotaInfo && quotaInfo.overBudget) return '额度用完啦…'
    if (quotaInfo && quotaInfo.nearLimit) return '快到额度了'
    if (live !== null && live.balance && live.balance.overThreshold) return '余额有点少'
    const last = Number(live !== null ? live.lastSessionAt : 0) || 0
    if (last <= 0) return '在呢'
    const idle = Date.now() - last
    if (idle < 90 * 1000) return '正在想事情♪'
    if (idle < 10 * 60 * 1000) return '刚和你说过话'
    if (idle < 60 * 60 * 1000) return '等你回来呢'
    return '有点想你了'
  }

  function relTime(then) {
    if (!then) return '还没有记录'
    const diff = Date.now() - then
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    return `${Math.floor(diff / 86400000)} 天前`
  }

  /* 提问气泡：对话里的 ask_user_question 由宿主推来；多题时逐题问，最后一起交回去 */
  function hideAsk() {
    askState = null
    if (askBox !== null) askBox.classList.add('hidden')
  }

  function askEl(id) {
    return document.getElementById(id)
  }

  function resetAskControls() {
    const tip = askEl('ask-tip')
    const confirm = askEl('ask-confirm')
    const skip = askEl('ask-skip')
    if (tip !== null) tip.classList.add('hidden')
    if (confirm !== null) {
      confirm.classList.add('hidden')
      confirm.disabled = true
      confirm.onclick = null
    }
    if (skip !== null) {
      skip.classList.add('hidden')
      skip.onclick = null
    }
  }

  function pulseAsk() {
    if (askBox === null) return
    askBox.classList.remove('hidden')
    askBox.classList.add('pulse')
    window.setTimeout(() => askBox.classList.remove('pulse'), 1200)
  }

  /* 桌宠自己的闲聊提问：点一下就算答完 */
  function paintPetQuestion(ask) {
    const head = askEl('ask-head')
    const text = askEl('ask-text')
    const choices = askEl('ask-choices')
    if (text === null || choices === null) return
    if (head !== null) head.textContent = '人家想问你一下'
    text.textContent = ask.text ?? ''
    resetAskControls()
    choices.innerHTML = ''
    for (const label of Array.isArray(ask.choices) ? ask.choices : []) {
      if (typeof label !== 'string' || label === '') continue
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.addEventListener('click', () => {
        sendCommand({ action: 'answer', askId: Number(ask.id) || 0, question: ask.text, answer: label, selected: [label] })
        hideAsk()
        showBubble(`记下了♪ 「${label}」`, 2200)
      })
      choices.append(button)
    }
    pulseAsk()
  }

  function askBatchAnswers(ask) {
    return ask.questions.map((question) => ({
      id: question.id,
      selected: askState === null ? [] : (askState.answers.get(question.id) ?? []),
    }))
  }

  function finishConversationAsk(ask) {
    sendCommand({ action: 'answer', askId: Number(ask.id) || 0, answers: askBatchAnswers(ask) })
    const skipped = ask.questions.length - (askState === null ? 0 : askState.answers.size)
    hideAsk()
    showBubble(skipped > 0 ? `跳过 ${skipped} 题，回头再答也行♪` : '都记下啦♪', 2400)
  }

  function stepConversationAsk(ask, selected) {
    if (askState === null) return
    const question = ask.questions[askState.index]
    askState.answers.set(question.id, selected)
    if (askState.index + 1 < ask.questions.length) {
      askState.index += 1
      paintConversationQuestion(ask)
      return
    }
    finishConversationAsk(ask)
  }

  function paintConversationQuestion(ask) {
    const head = askEl('ask-head')
    const text = askEl('ask-text')
    const choices = askEl('ask-choices')
    const tip = askEl('ask-tip')
    const confirm = askEl('ask-confirm')
    const skip = askEl('ask-skip')
    if (text === null || choices === null || askState === null) return
    const total = ask.questions.length
    const index = Math.min(askState.index, total - 1)
    const question = ask.questions[index]
    const multi = question.multi === true
    const picked = new Set(askState.answers.get(question.id) ?? [])
    if (head !== null) head.textContent = total > 1 ? `对话里的问题 · ${index + 1}/${total}` : '对话里的问题'
    text.textContent = question.text ?? ''
    if (tip !== null) tip.classList.toggle('hidden', multi !== true)
    if (skip !== null) {
      skip.classList.remove('hidden')
      skip.textContent = total > 1 && index + 1 < total ? '跳过这题' : '跳过'
      skip.onclick = () => stepConversationAsk(ask, [])
    }
    if (confirm !== null) {
      confirm.classList.toggle('hidden', multi !== true)
      confirm.textContent = index + 1 < total ? '下一题♪' : '答好了♪'
      confirm.disabled = picked.size === 0
      confirm.onclick = () => {
        if (picked.size > 0) stepConversationAsk(ask, [...picked])
      }
    }
    choices.innerHTML = ''
    for (const label of Array.isArray(question.choices) ? question.choices : []) {
      if (typeof label !== 'string' || label === '') continue
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.classList.toggle('picked', picked.has(label))
      button.addEventListener('click', () => {
        if (multi !== true) {
          stepConversationAsk(ask, [label])
          return
        }
        if (picked.has(label)) picked.delete(label)
        else picked.add(label)
        button.classList.toggle('picked', picked.has(label))
        if (confirm !== null) confirm.disabled = picked.size === 0
      })
      choices.append(button)
    }
    askBox.classList.remove('hidden')
  }

  function renderAsk() {
    if (askBox === null) return
    const ask = live !== null && live.ask && typeof live.ask === 'object' ? live.ask : null
    if (ask === null) {
      if (lastAskId !== 0) hideAsk()
      return
    }
    const fromConversation = ask.source === 'conversation' && Array.isArray(ask.questions)
    if (fromConversation !== true && live.askEnabled !== true) {
      hideAsk()
      return
    }
    const id = Number(ask.id) || 0
    if (id === lastAskId) return
    lastAskId = id
    askState = null
    if (fromConversation === true) {
      if (ask.questions.length === 0) {
        hideAsk()
        return
      }
      askState = { id, index: 0, answers: new Map() }
      paintConversationQuestion(ask)
      pulseAsk()
      speak('有个问题想问你♪', 2600)
      return
    }
    paintPetQuestion(ask)
  }

  /* 风险审批：只给「允许一次 / 拒绝」两个决定 */
  function hideApproval() {
    if (approvalBox !== null) approvalBox.classList.add('hidden')
  }

  function answerApproval(approval, decision) {
    sendCommand({
      action: 'approval',
      approvalId: Number(approval.id) || 0,
      decision: decision === 'allowed-once' ? 'allowed-once' : 'rejected',
    })
    hideApproval()
    showBubble(decision === 'allowed-once' ? '允许这一次♪' : '拒绝了，保持原样。', 2400)
    playSound('click')
  }

  function renderApproval() {
    if (approvalBox === null) return
    const approval = live !== null && live.approval && typeof live.approval === 'object' ? live.approval : null
    if (approval === null) {
      hideApproval()
      return
    }
    const id = Number(approval.id) || 0
    if (id === lastApprovalId) return
    lastApprovalId = id
    const text = document.getElementById('approval-text')
    const allow = document.getElementById('approval-allow')
    const reject = document.getElementById('approval-reject')
    if (text === null || allow === null || reject === null) return
    const tool = typeof approval.tool === 'string' && approval.tool !== '' ? approval.tool : '工具'
    const reason = typeof approval.reason === 'string' ? approval.reason.trim() : ''
    text.textContent = reason === '' ? `「${tool}」想越权执行` : `「${tool}」想越权执行\n${reason}`
    allow.onclick = () => answerApproval(approval, 'allowed-once')
    reject.onclick = () => answerApproval(approval, 'rejected')
    approvalBox.classList.remove('hidden')
    approvalBox.classList.add('pulse')
    window.setTimeout(() => approvalBox.classList.remove('pulse'), 1200)
    speak('有个操作要你批准一下♪', 2600)
  }

  function todosOf(source) {
    return source !== null && source !== undefined && Array.isArray(source.todos) ? source.todos : []
  }

  function shorten(text, max) {
    const value = typeof text === 'string' ? text.trim() : ''
    return value.length > max ? `${value.slice(0, max - 1)}…` : value
  }

  function todoSpeech() {
    const todos = todosOf(live)
    if (todos.length === 0) return '现在手上还没有任务卡呢。'
    const done = todos.filter((item) => item.status === 'completed').length
    if (done === todos.length) return `刚才那批任务都完成啦，一共 ${todos.length} 项♪`
    const active = todos.find((item) => item.status === 'in_progress')
    const pending = todos.filter((item) => item.status === 'pending')
    const parts = [`任务 ${done}/${todos.length} 完成`]
    if (active !== undefined) parts.push(`正在做「${shorten(active.content, 14)}」`)
    if (pending.length > 0) parts.push(`还排着 ${pending.length} 件，下一件是「${shorten(pending[0].content, 14)}」`)
    return `${parts.join('，')}♪`
  }

  function taskLines() {
    const list = []
    const source = live || {}
    const balance = source.balance && typeof source.balance === 'object' ? source.balance : null
    list.push(['最近对话', relTime(Number(source.lastSessionAt) || 0)])
    const todos = todosOf(source)
    if (todos.length > 0) {
      const done = todos.filter((item) => item.status === 'completed').length
      list.push(['任务进程', `${done}/${todos.length} 完成`])
      const active = todos.find((item) => item.status === 'in_progress')
      if (active !== undefined) list.push(['正在做', shorten(active.content, 14)])
    }
    if (balance !== null) {
      list.push(['今日消耗', `${Number(balance.spent || 0).toFixed(2)} 元`])
      list.push(['账户余额', `${Number(balance.total || 0).toFixed(2)} 元`])
    }
    const quota = localQuota(source)
    if (quota && Number(quota.limit) > 0) {
      list.push(['今日额度', `${Number(quota.spent || 0).toFixed(2)} / ${Number(quota.limit).toFixed(0)}`])
    }
    const asks = Array.isArray(source.asks) ? source.asks : []
    list.push(['已答问题', `${asks.length} 条`])
    const info = source.hud && typeof source.hud === 'object' ? source.hud : {}
    if (typeof info.cpu === 'number') list.push(['CPU', `${Math.round(info.cpu)}%`])
    if (typeof info.mem === 'number') list.push(['内存', `${Math.round(info.mem)}%`])
    return list
  }

  function renderTaskSheet() {
    const body = document.getElementById('task-list')
    const note = document.getElementById('task-note')
    if (body === null) return
    body.innerHTML = ''
    for (const [key, value] of taskLines()) {
      const row = document.createElement('div')
      row.className = 'task-row'
      const name = document.createElement('span')
      name.textContent = key
      const val = document.createElement('b')
      val.textContent = value
      row.append(name, val)
      body.append(row)
    }
    if (note !== null) {
      const asks = live !== null && Array.isArray(live.asks) ? live.asks : []
      const last = asks.length > 0 ? asks[asks.length - 1] : null
      note.textContent = last ? `上次回答：${last.question} → ${last.answer}` : '还没有回答过问题呢。'
    }
    renderTodoList()
  }

  /* 任务进程：从 live.todos 渲染当前任务的进度 */
  function renderTodoList() {
    const box = document.getElementById('task-todos')
    if (box === null) return
    box.innerHTML = ''
    const todos = todosOf(live)
    if (todos.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'task-todo-empty'
      empty.textContent = '还没有任务卡呢。'
      box.append(empty)
      return
    }
    const marks = { completed: '✓', in_progress: '▶', pending: '·' }
    for (const item of todos.slice(0, 6)) {
      const row = document.createElement('div')
      row.className = `task-todo ${item.status || 'pending'}`
      const mark = document.createElement('i')
      mark.textContent = marks[item.status] ?? '·'
      const text = document.createElement('span')
      text.textContent = item.content
      row.append(mark, text)
      box.append(row)
    }
    if (todos.length > 6) {
      const more = document.createElement('div')
      more.className = 'task-todo more'
      more.textContent = `…还有 ${todos.length - 6} 项`
      box.append(more)
    }
  }

  function toggleTaskSheet(force) {
    if (taskSheet === null) return
    const open = force === undefined ? taskSheet.classList.contains('hidden') : force === true
    taskSheet.classList.toggle('hidden', open === false)
    window.clearTimeout(taskTimer)
    if (open) {
      renderTaskSheet()
      taskTimer = window.setTimeout(() => taskSheet.classList.add('hidden'), 14000)
    }
  }

  function renderHud() {
    if (live === null) return
    const detail = live.hudDetail || 'full'
    hud.classList.toggle('hidden', live.showHud !== true)
    hud.classList.toggle('mode-full', detail === 'full')
    hud.classList.toggle('mode-simple', detail === 'simple')
    hud.classList.toggle('mode-simple2', detail === 'simple2')
    hud.classList.toggle('expanded', detail === 'simple2' && hudExpanded)
    const collapsedNow =
      detail === 'full' ? hudCollapsed : detail === 'simple' ? simpleCollapsed : false
    hud.classList.toggle('collapsed', collapsedNow)
    report({
      stage: 'hud',
      hudClass: hud.className,
      hudHeight: Math.round(hud.getBoundingClientRect().height),
      compact: document.getElementById('hud-compact').textContent,
    })

    setText('hud-nickname', live.nickname || '柒柒')
    const quotaInfo = localQuota(live)
    setText('hud-mood', moodOf(quotaInfo))

    const info = live.hud || {}
    setText('hud-cpu', formatPercent(info.cpu))
    setText('hud-mem', formatPercent(info.mem))
    setText('hud-gpu', formatPercent(info.gpu))
    setText('hud-net', `↓ ${formatRate(info.netDown)} · ↑ ${formatRate(info.netUp)}`)
    setText(
      'hud-bat',
      typeof info.battery === 'number' ? `电量 ${info.battery}%${info.charging ? ' ⚡' : ''}` : '电量 --',
    )
    setText(
      'hud-compact',
      `CPU ${formatPercent(info.cpu)} · 内存 ${formatPercent(info.mem)} · GPU ${formatPercent(info.gpu)} · ↓ ${formatRate(info.netDown)}`,
    )

    const balance = live.balance
    if (balance === null || balance === undefined) {
      setText('hud-total', '--')
      setText('hud-spent', '今日 --')
      setText('hud-recharge', '充值 --')
      setText('hud-delta', '±0.00')
      document.getElementById('hud-delta').className = ''
    } else {
      const total = Number(balance.total) || 0
      setText('hud-total', total.toFixed(2))
      setText('hud-spent', `今日 ${Number(balance.spent || 0).toFixed(2)}`)
      setText('hud-recharge', `充值 ${Number(balance.recharge || 0).toFixed(2)}`)

      const delta = document.getElementById('hud-delta')
      if (lastBalanceTotal === null) {
        delta.textContent = '±0.00'
        delta.className = ''
      } else if (Math.abs(total - lastBalanceTotal) >= 0.005) {
        const diff = total - lastBalanceTotal
        delta.textContent = `${diff > 0 ? '+' : ''}${diff.toFixed(2)}`
        delta.className = diff > 0 ? 'up' : 'down'
      }
      lastBalanceTotal = total
    }

    const rate = rateLabel()
    const rateEl = document.getElementById('hud-rate')
    setText('hud-rate', rate.text)
    rateEl.classList.toggle('hot', rate.hot)

    const stamp = Number(live.at) || Date.now()
    const clock = new Date(stamp)
    setText('hud-updated', `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`)

    const rect = hud.getBoundingClientRect()
    const layoutKey = `${detail}|${live.showHud}|${hudCollapsed}|${hudExpanded}|${window.innerWidth}x${window.innerHeight}`
    if (layoutKey !== lastHudKey) {
      lastHudKey = layoutKey
      window.requestAnimationFrame(() => layoutModel())
    }
    /* 文案已经写完，这时量到的状态栏高度才是真的；窗口按它长高 / 收回 */
    syncWindowHeight()
    report({
      stage: 'hud-rendered',
      hudClass: hud.className,
      hudVisible: !hud.classList.contains('hidden'),
      hudRect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      hudText: {
        cpu: document.getElementById('hud-cpu').textContent,
        mem: document.getElementById('hud-mem').textContent,
        gpu: document.getElementById('hud-gpu').textContent,
        net: document.getElementById('hud-net').textContent,
        bat: document.getElementById('hud-bat').textContent,
        total: document.getElementById('hud-total').textContent,
        recharge: document.getElementById('hud-recharge').textContent,
        rate: document.getElementById('hud-rate').textContent,
        delta: document.getElementById('hud-delta').textContent,
        quota: document.getElementById('hud-quota-text').textContent,
        quotaWidth: document.getElementById('hud-quota-fill').style.width,
        emoji: bubbleEmoji === null ? '' : bubbleEmoji.getAttribute('src'),
        alert: bubble.classList.contains('alert'),
      },
    })
  }

  /* ------------------------------ 菜单 ------------------------------ */

  function closeMenu() {
    menu.classList.add('hidden')
  }

  function openMenu(x, y) {
    menu.classList.remove('hidden')
    const rect = menu.getBoundingClientRect()
    const left = Math.max(4, Math.min(x, W - rect.width - 4))
    const top = Math.max(4, Math.min(y, H - rect.height - 4))
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    markMenuState()
  }

  function markMenuState() {
    for (const button of menu.querySelectorAll('[data-bubble]')) {
      button.classList.toggle('active', live !== null && button.dataset.bubble === live.bubbleMode)
    }
  }

  menu.addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (button === null) return
    event.stopPropagation()
    if (button.dataset.bubble) {
      sendCommand({ action: 'state', patch: { bubbleMode: button.dataset.bubble } })
    } else if (button.dataset.action === 'toggle-hud') {
      sendCommand({ action: 'state', patch: { showHud: !(live !== null && live.showHud) } })
    } else if (button.dataset.action === 'say') {
      sendCommand({ action: 'say' })
      playSound('click')
    } else if (button.dataset.action === 'task') {
      toggleTaskSheet(true)
      playSound('click')
    } else if (button.dataset.action === 'pose') {
      sendCommand({ action: 'pose' })
      randomPose()
      playSound('click')
    } else if (button.dataset.action === 'refresh') {
      sendCommand({ action: 'refresh' })
      showBubble('人家去问问余额啦……', 1800)
    } else if (button.dataset.action === 'settings') {
      openSettings()
    } else if (button.dataset.action === 'hide') {
      if (window.pet) window.pet.hide()
    }
    closeMenu()
  })

  document.addEventListener('pointerdown', (event) => {
    if (!menu.classList.contains('hidden') && !menu.contains(event.target)) closeMenu()
  })

  /* ------------------------------ 设置 ------------------------------ */

  /* 从候选值里挑一个最接近的设置值，避免旧 state.json 里的越界值把下拉框弄空 */
  function pickOption(id, value, options, fallback) {
    const node = document.getElementById(id)
    if (node === null) return
    const number = Number(value)
    const match = options.find((option) => Math.abs(option - number) < 0.001)
    node.value = String(match === undefined ? fallback : match)
  }

  function openSettings() {
    settingsOpen = true
    settings.classList.remove('hidden')
    closeMenu()
    if (live !== null) {
      document.getElementById('set-nickname').value = live.nickname || ''
      document.getElementById('set-threshold').value = String(live.balanceThreshold ?? 20)
      document.getElementById('set-limit').value = String(live.dailyLimit ?? 0)
      pickOption('set-scale', live.scale, [0.5, 0.6, 0.7, 0.8, 1, 1.25, 1.5, 1.75], 1)
      pickOption('set-font', live.bubbleFont, [12, 14.5, 18], 14.5)
      pickOption('set-bubble-radius', live.bubbleRadius, [0, 10, 18], 0)

      document.getElementById('set-bubble-alpha').value = String(live.bubbleAlpha ?? 0.97)
      document.getElementById('set-show-hud').checked = live.showHud !== false
      document.getElementById('set-hud-detail').value = live.hudDetail || 'full'
      document.getElementById('set-hud-alpha').value = String(live.hudAlpha ?? 0.93)

      pickOption('set-ask-every', live.askEveryMinutes, [0, 15, 30, 45, 60, 120], 45)
      const handling = document.getElementById('set-ask-handling')
      if (handling !== null) handling.value = live.askHandling || 'pet-all'
      pickOption('set-pose-every', live.poseSeconds, [0, 30, 60, 120, 300], 60)
      pickOption('set-sound-level', live.soundVolume, [0, 0.5, 0.8, 1], 0.5)

      const asks = Array.isArray(live.asks) ? live.asks : []
      const lastAsk = asks.length > 0 ? asks[asks.length - 1] : null
      setText(
        'set-ask-note',
        lastAsk
          ? `上次回答：${lastAsk.question} → ${lastAsk.answer}`
          : '对话提问和风险审批都按这里选的方式出现在桌宠或网页卡片上。',
      )

      const keyInput = document.getElementById('set-key')
      keyInput.value = ''
      keyInput.placeholder = live.hasKey ? '已保存，留空表示不修改' : '粘贴 DeepSeek API Key'
    }
    if (window.pet) window.pet.setInteractive(true)
  }

  function closeSettings() {
    settingsOpen = false
    settings.classList.add('hidden')
  }

  document.getElementById('settings-close').addEventListener('click', closeSettings)

  const taskClose = document.getElementById('task-close')
  if (taskClose !== null) taskClose.addEventListener('click', () => toggleTaskSheet(false))

  document.getElementById('settings-save').addEventListener('click', () => {
    const patch = {
      nickname: document.getElementById('set-nickname').value,
      balanceThreshold: Number(document.getElementById('set-threshold').value),
      dailyLimit: Number(document.getElementById('set-limit').value),
      scale: Number(document.getElementById('set-scale').value),
      bubbleFont: Number(document.getElementById('set-font').value),
      bubbleRadius: Number(document.getElementById('set-bubble-radius').value),
      bubbleAlpha: Number(document.getElementById('set-bubble-alpha').value),
      showHud: document.getElementById('set-show-hud').checked,
      hudDetail: document.getElementById('set-hud-detail').value,
      hudAlpha: Number(document.getElementById('set-hud-alpha').value),
      askEveryMinutes: Number(document.getElementById('set-ask-every').value),
      askHandling: document.getElementById('set-ask-handling').value,
      poseSeconds: Number(document.getElementById('set-pose-every').value),
      soundVolume: Number(document.getElementById('set-sound-level').value),
    }
    const key = document.getElementById('set-key').value.trim()
    if (key !== '') patch.apiKey = key
    sendCommand({ action: 'state', patch })
    setText('settings-hint', '已经记住啦♪')
    window.setTimeout(closeSettings, 700)
  })

  const petRestart = document.getElementById('pet-restart')
  if (petRestart !== null) {
    petRestart.addEventListener('click', () => {
      sendCommand({ action: 'restartPet' })
      setText('settings-hint', '马上重开一下……')
      window.setTimeout(closeSettings, 400)
    })
  }

  const petStop = document.getElementById('pet-stop')
  if (petStop !== null) {
    petStop.addEventListener('click', () => {
      sendCommand({ action: 'stopPet' })
      if (window.pet) window.pet.hide()
    })
  }

  document.getElementById('hud-toggle').addEventListener('click', (event) => {
    event.stopPropagation()
    const detail = live !== null ? live.hudDetail : 'full'
    if (detail === 'simple2') hudExpanded = !hudExpanded
    else if (detail === 'simple') simpleCollapsed = !simpleCollapsed
    else hudCollapsed = !hudCollapsed
    renderHud()
  })

  /* ------------------------------ 模型 ------------------------------ */

  function applyZoom(next) {
    if (typeof next !== 'number' || Math.abs(next - zoom) < 0.01) return
    zoom = next
    if (window.pet) window.pet.setZoom(next)
  }

  function hudHeightNow() {
    if (live === null || live.showHud !== true) return 0
    const rect = hud.getBoundingClientRect()
    return rect.height > 0 ? Math.round(rect.height) : 0
  }

  function hudSpace() {
    const height = hudHeightNow()
    return height > 0 ? height + 10 : 10
  }

  /* 立绘大小按「状态栏收起」时的底部预留算，位置锚在状态栏上沿：
     状态栏贴在窗口底边，人物就永远贴着状态栏 —— 窗口拉高拉矮、面板展开收起都不会把两者分开 */
  const BASE_RESERVE = 52
  const HUD_EDGE = 5
  const HUD_OVERLAP = 6
  const COLLAPSED_HUD = 53
  const MAX_EXTRA = 360
  let lastExtra = -1

  function layoutModel() {
    if (model === null) return
    const w = window.innerWidth
    const h = window.innerHeight
    if (app !== null) app.renderer.resize(w, h)
    const iw = model.internalModel.width
    const ih = model.internalModel.height
    if (!iw || !ih) return
    const hudHeight = hudHeightNow()
    /* 状态栏占掉的底部高度；收起时等于 BASE_RESERVE，保持原来的站位 */
    const band = hudHeight > 0 ? hudHeight + HUD_EDGE - HUD_OVERLAP : BASE_RESERVE
    const topSpace = 46
    const availH = Math.max(80, h - band - topSpace)
    const scale = Math.min(w / iw, availH / ih)
    model.scale.set(scale)
    model.x = (w - iw * scale) / 2
    model.y = h - band - ih * scale

    const bubbleBox = document.getElementById('bubble')
    if (bubbleBox !== null) {
      const bubbleH = bubbleBox.offsetHeight || 40
      bubbleBox.style.top = `${Math.max(4, Math.round(model.y - bubbleH - 2))}px`
    }

    const modelBottom = Math.round(model.y + ih * scale)
    const hudTop = hudHeight > 0 ? Math.round(h - HUD_EDGE - hudHeight) : null
    report({
      stage: 'layout',
      win: `${w}x${h}`,
      hudSpace: Math.round(hudSpace()),
      hudHeight,
      band,
      scale,
      modelY: Math.round(model.y),
      modelBottom,
      hudTop,
      gap: hudTop === null ? null : hudTop - modelBottom,
    })
  }

  /* 状态栏比收起态多出来的高度让窗口一起往上长：人物大小和站位都不变，面板不会越跑越远 */
  function syncWindowHeight() {
    if (window.pet === undefined || typeof window.pet.setExtraHeight !== 'function') return
    const hudHeight = hudHeightNow()
    if (hudHeight <= 0) {
      if (lastExtra !== 0) {
        lastExtra = 0
        void window.pet.setExtraHeight(0)
      }
      return
    }
    const extra = Math.min(MAX_EXTRA, Math.max(0, hudHeight - COLLAPSED_HUD))
    if (Math.abs(extra - lastExtra) < 1) return
    lastExtra = extra
    void window.pet.setExtraHeight(extra)
  }

  window.addEventListener('resize', () => {
    layoutModel()
    window.setTimeout(syncWindowHeight, 0)
  })

  PIXI.live2d.Live2DModel.from(MODEL_URL, { autoInteract: false })
    .then((loaded) => {
      model = loaded
      app.stage.addChild(model)
      layoutModel()

      report({ stage: 'model-loaded', modelWidth: model.internalModel.width, modelHeight: model.internalModel.height, scale: model.scale.x, x: model.x, y: model.y })

      try {
        model.expression(EXPRESSIONS.ropeOn)
      } catch (error) {
        report({ expressionError: String(error) })
      }

      try {
        model.internalModel.on('beforeModelUpdate', () => {
          const core = model.internalModel.coreModel
          const now = performance.now() / 1000
          core.setParameterValueById('ParamBreath', 0.5 + 0.5 * Math.sin(now * 1.7))
          core.setParameterValueById('ParamBodyAngleZ', Math.sin(now * 0.8) * 2)

          if (speakingUntil > performance.now()) {
            const value = 0.32 + 0.3 * Math.sin(now * 16) + Math.random() * 0.18
            core.setParameterValueById('ParamMouthOpenY', Math.max(0, Math.min(1, value)))
          } else if (mouthOpen) {
            mouthOpen = false
            core.setParameterValueById('ParamMouthOpenY', 0)
          }
        })
      } catch (error) {
        report({ lipSyncError: String(error) })
      }

      window.clearInterval(idleTimer)
      idleTimer = window.setInterval(playIdle, 11000)
      window.setTimeout(playIdle, 2200)

      window.setInterval(() => {
        try {
          const core = model.internalModel.coreModel
          const manager = model.internalModel.motionManager
          const current = manager && manager.currentMotion
          report({
            stage: 'anim',
            eyeL: Number(core.getParameterValueById('ParamEyeLOpen').toFixed(3)),
            eyeR: Number(core.getParameterValueById('ParamEyeROpen').toFixed(3)),
            angleX: Number(core.getParameterValueById('ParamAngleX').toFixed(3)),
            angleY: Number(core.getParameterValueById('ParamAngleY').toFixed(3)),
            breath: Number(core.getParameterValueById('ParamBreath').toFixed(3)),
            mouth: Number(core.getParameterValueById('ParamMouthOpenY').toFixed(3)),
            motion: current && current.motion ? `${current.group}:${current.motion.name || current.motion.Name || ''}` : null,
            motionCount: manager && manager.motionGroups ? Object.keys(manager.motionGroups).length : null,
          })
        } catch (error) {
          report({ animError: String(error) })
        }
      }, 4000)

      model.on('hit', (areas) => {
        const list = areas || []
        const area = list[0]
        if (area && area.Motion) {
          const [group, motionName] = String(area.Motion).split(':')
          try {
            const motions = model.internalModel.settings.motions[group] || []
            const index = motions.findIndex((item) => item.Name === motionName || item.File === motionName)
            if (index >= 0) model.motion(group, index)
          } catch {
            /* 命中动作缺失时忽略 */
          }
        }
        showBubble(list.length > 0 ? '人家在这里呢♪' : '嗯？', 1800)
      })

      /* 指针 */
      window.addEventListener('pointermove', (event) => {
        updateInteractive(event.clientX, event.clientY)
        if (dragging) {
          if (pressPoint !== null && Math.hypot(event.clientX - pressPoint.x, event.clientY - pressPoint.y) >= 6) {
            clearPressTimer()
          }
          return
        }
        try {
          model.focus(event.clientX, event.clientY)
        } catch {
          /* 跟随失败不影响渲染 */
        }
      })

      window.addEventListener('pointerdown', (event) => {
        if (event.button === 2) return
        if (!isPointOnPet(event.clientX, event.clientY)) return
        if (onPanel(event.clientX, event.clientY)) return
        /* 抓住指针：松手在窗口外也能收到 pointerup，拖动不会一直粘着鼠标跑 */
        try {
          canvas.setPointerCapture(event.pointerId)
        } catch {
          /* 拿不到捕获时退回旧行为 */
        }
        pressPoint = { x: event.clientX, y: event.clientY }
        pressAt = performance.now()
        pressConsumed = false
        dragging = true
        if (window.pet) window.pet.dragStart()
        clearPressTimer()
        pressTimer = window.setTimeout(() => {
          pressTimer = null
          pressConsumed = true
          onLongPress()
        }, 620)
      })

      window.addEventListener('pointerup', (event) => {
        try {
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
        } catch {
          /* 没有捕获时忽略 */
        }
        if (!dragging) return
        dragging = false
        clearPressTimer()
        if (window.pet) window.pet.dragEnd()
        const moved = pressPoint === null ? 0 : Math.hypot(event.clientX - pressPoint.x, event.clientY - pressPoint.y)
        const held = pressAt === null ? 0 : performance.now() - pressAt
        if (!pressConsumed && moved < 6 && held < 620) registerClick()
        pressPoint = null
        pressAt = null
        pressConsumed = false
      })

      window.addEventListener('pointercancel', () => {
        if (!dragging) return
        dragging = false
        clearPressTimer()
        if (window.pet) window.pet.dragEnd()
      })

      window.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        if (!onPanel(event.clientX, event.clientY) && !isPointOnPet(event.clientX, event.clientY)) return
        openMenu(event.clientX, event.clientY)
      })

      /* 手势：单击说话 / 双击报余额 / 三击刷新 / 长按摊开速览 */
      let pressTimer = null
      let pressConsumed = false
      let clickCount = 0
      let clickTimer = null

      function clearPressTimer() {
        if (pressTimer !== null) {
          window.clearTimeout(pressTimer)
          pressTimer = null
        }
      }

      function registerClick() {
        clickCount += 1
        if (clickTimer !== null) window.clearTimeout(clickTimer)
        if (clickCount >= 3) {
          clickCount = 0
          clickTimer = null
          onGesture(3)
          return
        }
        clickTimer = window.setTimeout(() => {
          const count = clickCount
          clickCount = 0
          clickTimer = null
          onGesture(count)
        }, 320)
      }

      function onGesture(count) {
        if (settingsOpen) return
        if (count === 2) {
          const total = live && live.balance ? Number(live.balance.total) : null
          const spent = live && live.balance ? Number(live.balance.spent) : null
          showBubble(
            total === null
              ? '还没连上余额呢。'
              : `余额 ${total.toFixed(2)} 元\n今日 ${Number(spent || 0).toFixed(2)} 元♪`,
            2800,
          )
          playSound('click')
          return
        }
        if (count >= 3) {
          sendCommand({ action: 'refresh' })
          showBubble('人家去把余额问清楚啦……', 1800)
          playSound('click')
          return
        }
        onClick()
      }

      function onLongPress() {
        if (settingsOpen) return
        playSound('click')
        /* 长按：说一遍当前任务进程（任务面板在右键菜单里看） */
        speak(todoSpeech(), 4200)
      }

      function sheetText() {
        const balance = live && live.balance ? live.balance : null
        if (balance === null) return '手上还没有余额数据呢。'
        const lines = [
          `余额 ${Number(balance.total || 0).toFixed(2)} 元（阈值 ${Number(live.balanceThreshold ?? 20).toFixed(2)}）`,
          `今日 ${Number(balance.spent || 0).toFixed(2)} 元 · 充值 ${Number(balance.recharge || 0).toFixed(2)} 元`,
        ]
        const quota = localQuota(live)
        if (quota && Number(quota.limit) > 0) {
          lines.push(`额度 ${Number(quota.spent || 0).toFixed(2)} / ${Number(quota.limit).toFixed(2)}`)
        }
        lines.push(`时段 ${rateLabel()}`)
        return lines.join('\n')
      }

      function onClick() {
        if (settingsOpen) return
        const pool =
          live !== null && Array.isArray(live.emojiList) && live.emojiList.length > 0
            ? live.emojiList
            : FALLBACK_EMOJI
        if (pool.length > 0) {
          let name = pool[Math.floor(Math.random() * pool.length)]
          if (name === lastEmojiName && pool.length > 1) {
            name = pool[(pool.indexOf(name) + 1) % pool.length]
          }
          lastEmojiName = name
          emojiHoldUntil = Date.now() + 12000
          setEmoji(name)
        }
        const lines = [
          '嗨♪ 人家在这儿呢。',
          '今天也一起走一段吧？',
          '别熬太晚哦，好不好？',
          '你刚才那一下，好轻呢。',
          '人家一直在这里，不用回头找。',
        ]
        speak(lines[Math.floor(Math.random() * lines.length)], 2600)
        playSound('click')
        randomPose()
        const faces = Object.values(EXPRESSIONS).filter((name) => name !== EXPRESSIONS.reset)
        try {
          model.expression(faces[Math.floor(Math.random() * faces.length)])
          window.clearTimeout(onClick.faceTimer)
          onClick.faceTimer = window.setTimeout(() => {
            try {
              model.expression(EXPRESSIONS.reset)
            } catch {
              /* 表情缺失时忽略 */
            }
          }, 8000)
        } catch {
          /* 表情缺失时忽略 */
        }
      }

      /* 插件推送 */
      if (window.pet) {
        window.pet.onLive((data) => {
          if (!data || typeof data !== 'object') return
          live = data
          renderHud()
          applyLook(data)
          if (typeof data.scale === 'number') applyZoom(data.scale)
          const quota = localQuota(data)
          if (Date.now() >= emojiHoldUntil) {
            setEmoji(typeof data.emoji === 'string' ? data.emoji : localEmoji(quota, data.speak === true))
          }
          renderQuota(quota)
          renderAsk()
          renderApproval()
          if (taskSheet !== null && taskSheet.classList.contains('hidden') === false) renderTaskSheet()

          const alert = Boolean(quota && (quota.overBudget || quota.nearLimit))
          bubble.classList.toggle('alert', alert)
          if (alert && quota.overBudget) playSound('over')

          if (typeof data.poseAt === 'number' && data.poseAt !== lastPoseAt) {
            lastPoseAt = data.poseAt
            randomPose()
          }

          if (typeof data.line === 'string' && data.line.trim() !== '') {
            if (data.speak === true) speak(data.line, data.ms || 3000)
            else showBubble(data.line, data.ms || 3000)
          }
          if (typeof data.expression === 'string' && EXPRESSIONS[data.expression]) {
            try {
              model.expression(EXPRESSIONS[data.expression])
            } catch {
              /* 表情缺失时忽略 */
            }
          }
          if (typeof data.expressionName === 'string') {
            try {
              model.expression(data.expressionName)
            } catch {
              /* 表情缺失时忽略 */
            }
          }
          if (data.motion && typeof data.motion.group === 'string') {
            try {
              model.motion(data.motion.group, Number(data.motion.index) || 0)
            } catch {
              /* 动作缺失时忽略 */
            }
          }
        })

        window.pet.onZoom((payload) => {
          const state = payload !== null && typeof payload === 'object' ? payload : null
          if (state !== null && typeof state.zoom === 'number') zoom = state.zoom
          else zoom = Number(payload) || zoom
          /* 缩放后窗口回到基准高度，状态栏要重新把窗口撑起来 */
          lastExtra = -1
          window.setTimeout(() => {
            layoutModel()
            syncWindowHeight()
          }, 80)
        })

        window.pet.onCursor((point) => {
          if (point === null || typeof point.x !== 'number') return
          try {
            model.focus(point.x, point.y)
          } catch {
            /* 跟随失败不影响渲染 */
          }
        })
      }
    })
    .catch((error) => {
      report({ fatal: 'model-load-failed', message: String(error), stack: error && error.stack })
    })
})()
