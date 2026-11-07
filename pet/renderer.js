/* 昔涟桌宠渲染层：Live2D + 拖拽 + 点击穿透 + 台词 / 口型 / 状态面板 / 右键菜单 / 设置 */
(function () {
  'use strict'
  const canvas = document.getElementById('stage')
  const sprite = document.getElementById('sprite')
  const bubble = document.getElementById('bubble')
  const bubbleText = document.getElementById('bubble-text')
  const bubbleEmoji = document.getElementById('bubble-emoji')
  const hud = document.getElementById('hud')
  const hudBody = document.getElementById('hud-body')
  const menu = document.getElementById('menu')
  const settings = document.getElementById('settings')

  /* 设置页分组：与独立版一致，左导航只切面板，控件仍然是同一批 id */
  const SETTINGS_PANEL_META = {
    overview: ['概览', '先看她现在怎么样', '常用动作和第一次上手的顺序都放在这里。'],
    look: ['她的样子', '立绘、气泡和状态栏', '形象怎么显示、状态栏要不要露出来，都在这一页。'],
    talk: ['说话与互动', '声音、频率和审批落点', '决定她什么时候开口、在哪里问你。'],
    persona: ['人格', '她是谁，怎么说话', '七段人格按顺序拼起来，留空就回落默认。'],
    data: ['余额与运行', '余额、进程与说明', 'Key 走本机加密，进程和文档都在最下面。'],
  }
  let settingsPanel = 'overview'
  const onboard = document.getElementById('onboard')
  const askBox = document.getElementById('ask')
  const approvalBox = document.getElementById('approval')
  const taskSheet = document.getElementById('task-sheet')

  /* 人格七段：与宿主 PERSONA_SECTIONS 一致，留空回落默认 */
  const PERSONA_FIELDS = [
    ['identity', 'set-persona-identity'],
    ['lore', 'set-persona-lore'],
    ['worldview', 'set-persona-worldview'],
    ['lifeview', 'set-persona-lifeview'],
    ['values', 'set-persona-values'],
    ['manner', 'set-persona-manner'],
    ['style', 'set-persona-style'],
  ]

  const W = window.innerWidth
  const H = window.innerHeight

  /* 卡片模式：只保留审批 / 提问卡片，不加载立绘，给已经有自己形象的用户 */
  const PARAMS = new URLSearchParams(window.location.search)
  const CARD_ONLY = PARAMS.get('ui') === 'card'
  if (CARD_ONLY) document.body.classList.add('card-only')

  /*
   * 形象分两层：默认立绘（纯静态图，公开版也带），
   * 或者 Live2D（模型自备，只有宿主确认模型存在时才把 renderer=live2d 传进来）。
   */
  const LIVE2D_REQUESTED = !CARD_ONLY && PARAMS.get('renderer') === 'live2d'
  /*
   * 自定义素材包由主进程校验后以 ?model=<json> 传进来：
   *   { kind: 'sprite'|'live2d'|'image'|'gif'|'video', entry, poses?: [{name,url}] }
   * 没传就是内置立绘。
   */
  const CUSTOM_MODEL = (() => {
    const raw = PARAMS.get('model')
    if (raw === null || raw === '') return null
    try {
      const parsed = JSON.parse(raw)
      return parsed !== null && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  })()
  const BUNDLED_POSES = ['default.png', 'calm.png', 'confident.png', 'love-happy.png', 'playful.png', 'serious.png']
  const CUSTOM_POSES = CUSTOM_MODEL !== null && Array.isArray(CUSTOM_MODEL.poses) ? CUSTOM_MODEL.poses : null
  const SPRITE_POSES = CUSTOM_POSES !== null ? CUSTOM_POSES.map((pose) => pose.name) : BUNDLED_POSES
  const CUSTOM_KIND = CUSTOM_MODEL === null ? null : CUSTOM_MODEL.kind
  /* 心情 → 姿态：只做一层轻映射，素材包里没有对应姿态就保持原样 */
  const MOOD_POSES = {
    calm: 'default.png',
    gentle: 'calm.png',
    focused: 'confident.png',
    love: 'love-happy.png',
    happy: 'playful.png',
    serious: 'serious.png',
  }
  let spritePoseIndex = 0
  let spriteVideo = null
  let moodPose = null
  let moodKey = ''

  function poseUrl(name) {
    if (CUSTOM_POSES !== null && CUSTOM_POSES.length > 0) {
      const exact = CUSTOM_POSES.find((pose) => pose.name === name)
      const fallback =
        CUSTOM_POSES.find((pose) => pose.name === CUSTOM_MODEL.defaultPose) ?? CUSTOM_POSES[0]
      return (exact ?? fallback).url
    }
    return `../assets/${BUNDLED_POSES.includes(name) ? name : BUNDLED_POSES[0]}`
  }

  let model = null
  let spriteMode = false
  let spriteLiveBound = false
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
  let liveRev = 0
  let lastLiveNotice = ''
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
  let outlinePref = 'light'
  let outlineLuma = null
  let detachOutline = null

  const report = (payload) => {
    try {
      window.pet && window.pet.report(payload)
    } catch {
      /* 上报失败不影响渲染 */
    }
  }

  function acceptLive(data) {
    live = data
    const rev = Number(data.rev)
    if (Number.isFinite(rev) && rev >= 0) liveRev = Math.floor(rev)
    const rotate = Number(data.background?.rotateMinutes)
    if (Number.isFinite(rotate)) {
      const next = [0, 10, 30, 60, 180].includes(rotate) ? rotate : 0
      if (next !== bgRotateMinutes) {
        bgRotateMinutes = next
        applyBackgroundRotation(next)
        const node = document.getElementById('set-bg-rotate')
        if (node !== null) node.value = String(next)
      }
    }
    const notice = typeof data.notice === 'string' ? data.notice.trim() : ''
    if (notice === '') {
      lastLiveNotice = ''
      return
    }
    if (notice !== lastLiveNotice) {
      lastLiveNotice = notice
      showBubble(notice, 4600)
    }
  }

  const sendCommand = (payload) => {
    try {
      /* 设置写入带上最近一次读到的 rev，宿主半能发现别处已经改过 */
      const next = payload && payload.action === 'state' && payload.patch !== null &&
        typeof payload.patch === 'object' && liveRev > 0
        ? { ...payload, rev: liveRev }
        : payload
      window.pet && window.pet.command(next)
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

  /* 立绘加载失败：内置图先退回 default.png；自定义素材直接交给纯色块兜底 */
  if (sprite !== null) {
    sprite.addEventListener('error', () => {
      const src = sprite.getAttribute('src') || ''
      if (CUSTOM_MODEL === null && !src.endsWith('default.png')) {
        report({ stage: 'sprite-retry', src })
        setSpritePose('default.png')
        return
      }
      sprite.classList.add('hidden')
      document.body.classList.add('no-sprite')
      report({ stage: CUSTOM_MODEL === null ? 'sprite-missing' : 'model-missing', src })
    })
  }

  report({ stage: 'booting', width: W, height: H, dpr: window.devicePixelRatio })

  const hasLive2d = typeof PIXI !== 'undefined' && !!PIXI.live2d
  if (LIVE2D_REQUESTED && !hasLive2d) {
    useSpriteFallback('pixi-not-ready', { hasPixi: typeof PIXI, hasLive2d })
  }
  if (!CARD_ONLY && !LIVE2D_REQUESTED) {
    /* 默认就是立绘：不碰 PIXI，也不去请求不存在的 Live2D 资源 */
    useSpriteFallback('sprite-default', { renderer: 'sprite' })
  }

  if (!CARD_ONLY && !spriteMode) {
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
  }

  const MODEL_URL =
    CUSTOM_MODEL !== null && CUSTOM_MODEL.kind === 'live2d'
      ? CUSTOM_MODEL.entry
      : 'assets/live2d/cyrene/Cyrene.model3.json'
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
  let lastClosenessAt = 0
  let soundEnabled = true
  let soundVolume = 0.5
  let speechEnabled = false
  let speechProvider = 'system'
  let lastSpeechSeq = 0
  let pendingLocalText = ''
  let lastLocalRequestAt = 0
  let localSpeechAudio = null

  function applyTheme(theme) {
    document.body.dataset.theme = theme === 'blue' || theme === 'ink' ? theme : 'pink'
  }

  /* ---------------- 桌面背景 ---------------- */

  const BG_CACHE = new Map()
  let bgCurrentId = ''
  let bgLastKey = ''
  let bgSeq = 0
  let bgItems = []
  let bgRotateTimer = null
  /* 自动轮换分钟数单独记住：设置面板没打开时也不能被默认 0 覆盖 */
  let bgRotateMinutes = 0

  function currentDim() {
    const node = document.getElementById('set-bg-dim')
    const value = node === null ? 0.35 : Number(node.value)
    return Math.min(0.85, Math.max(0, Number.isFinite(value) ? value : 0.35))
  }

  /* 用主题粉白压一层薄纱，dim 越大照片越淡 */
  function backgroundVeil(dim) {
    const alpha = Math.min(0.85, Math.max(0, Number(dim)))
    const safe = Number.isFinite(alpha) ? alpha.toFixed(2) : '0.35'
    return `linear-gradient(rgba(255, 246, 250, ${safe}), rgba(255, 246, 250, ${safe}))`
  }

  /* 大图先缩放成 JPEG：CSS 变量存不下几 MB 的 data URL，窗口也用不到 1920 宽 */
  async function shrinkBackgroundImage(data) {
    try {
      const img = new Image()
      img.src = data
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        if (img.complete && img.naturalWidth > 0) resolve()
      })
      const width = img.naturalWidth > 0 ? img.naturalWidth : 960
      const height = img.naturalHeight > 0 ? img.naturalHeight : 540
      const scale = Math.min(1, 960 / width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext('2d')
      if (ctx === null) return ''
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.85)
    } catch {
      return ''
    }
  }

  async function backgroundUrl(id) {
    if (BG_CACHE.has(id)) return BG_CACHE.get(id)
    if (!window.pet || !window.pet.backgroundData) return ''
    const data = await window.pet.backgroundData(id).catch(() => '')
    if (typeof data !== 'string' || data === '') return ''
    BG_CACHE.set(id, data)
    return data
  }

  async function applyBackground(bg) {
    const id = bg !== null && typeof bg?.id === 'string' ? bg.id : ''
    const dim = bg !== null && Number.isFinite(Number(bg?.dim)) ? Number(bg.dim) : 0.35
    const key = `${id}|${dim}`
    if (key === bgLastKey) return
    bgLastKey = key
    document.body.style.setProperty('--scene-veil', backgroundVeil(dim))
    if (id === '') {
      bgCurrentId = ''
      document.body.classList.remove('has-bg')
      document.body.style.removeProperty('--scene-bg')
      return
    }
    /* 只是拖动淡化条：不重载图片，也不闪一下 */
    if (id === bgCurrentId && document.body.classList.contains('has-bg')) return
    const seq = ++bgSeq
    const data = await backgroundUrl(id)
    if (seq !== bgSeq) return
    if (data === '') {
      /* 图被删掉或读不出来：安静退回无背景，不白屏 */
      bgCurrentId = ''
      document.body.classList.remove('has-bg')
      document.body.style.removeProperty('--scene-bg')
      return
    }
    const wasVisible = document.body.classList.contains('has-bg')
    if (wasVisible) {
      document.body.classList.remove('has-bg')
      await new Promise((resolve) => window.setTimeout(resolve, 180))
      if (seq !== bgSeq) return
    }
    bgCurrentId = id
    /* 大图的 data URL 超过 CSS 值长度上限会被丢弃：先缩到 960 宽再交给样式 */
    let src = data
    if (data.length > 900000) {
      const small = await shrinkBackgroundImage(data)
      if (small !== '') src = small
    }
    document.body.style.setProperty('--scene-bg', `url("${src}")`)
    /* 强制重排一次，让新图从透明淡进来 */
    void document.body.offsetWidth
    document.body.classList.add('has-bg')
  }

  /* 下一张：按当前清单顺序循环，没有背景时选第一张 */
  async function cycleBackground(step = 1) {
    const list = bgItems.filter((item) => item !== null && typeof item?.id === 'string' && item.id !== '')
    if (list.length === 0) return false
    const index = list.findIndex((item) => item.id === bgCurrentId)
    const next = list[(index + step + list.length) % list.length]
    await selectBackground(next.id)
    return true
  }

  /* 自动轮换：分钟数 <= 0 就关掉；窗口隐藏时跳过，不打扰 */
  function applyBackgroundRotation(minutes) {
    if (bgRotateTimer !== null) {
      window.clearInterval(bgRotateTimer)
      bgRotateTimer = null
    }
    const value = Number(minutes)
    if (!Number.isFinite(value) || value <= 0) return
    bgRotateTimer = window.setInterval(() => {
      if (document.hidden) return
      void cycleBackground(1)
    }, Math.max(1, value) * 60 * 1000)
  }

  function readAsDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => resolve('')
      reader.readAsDataURL(file)
    })
  }

  /* 大图先缩到 2560 像素内再存，省内存也省磁盘；gif 保留原样不动画 */
  function shrinkImage(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const longest = Math.max(img.naturalWidth, img.naturalHeight)
        const scale = longest > 2560 ? 2560 / longest : 1
        if (scale >= 1) {
          resolve(dataUrl)
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
        const ctx = canvas.getContext('2d')
        if (ctx === null) {
          resolve(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.88))
        } catch {
          resolve(dataUrl)
        }
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    })
  }

  async function prepareImage(file) {
    const raw = await readAsDataUrl(file)
    if (raw === '') return ''
    if (file.type === 'image/gif' || file.size <= 2 * 1024 * 1024) return raw
    return shrinkImage(raw)
  }

  async function renderBackgroundGrid() {
    const grid = document.getElementById('set-bg-grid')
    if (grid === null) return
    const items = window.pet && window.pet.backgrounds
      ? await window.pet.backgrounds().catch(() => [])
      : []
    const list = Array.isArray(items) ? items : []
    bgItems = list
    grid.replaceChildren()
    const empty = document.getElementById('set-bg-empty')
    if (empty !== null) empty.hidden = list.length > 0
    for (const item of list) {
      const cell = document.createElement('div')
      cell.className = item.id === bgCurrentId ? 'bg-item active' : 'bg-item'
      cell.dataset.id = item.id
      cell.setAttribute('role', 'button')
      cell.tabIndex = 0
      cell.title = `${Math.max(1, Math.round(item.size / 1024))} KB`
      const img = document.createElement('img')
      img.alt = ''
      img.loading = 'lazy'
      const src = await backgroundUrl(item.id)
      if (src !== '') img.src = src
      cell.appendChild(img)
      const del = document.createElement('span')
      del.className = 'bg-del'
      del.textContent = '×'
      del.title = '删掉这张'
      del.addEventListener('click', (event) => {
        event.stopPropagation()
        void removeBackground(item.id)
      })
      cell.appendChild(del)
      cell.addEventListener('click', () => void selectBackground(item.id))
      cell.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          void selectBackground(item.id)
        }
      })
      grid.appendChild(cell)
    }
  }

  function currentRotateMinutes() {
    return [0, 10, 30, 60, 180].includes(bgRotateMinutes) ? bgRotateMinutes : 0
  }

  function pushBackground(id) {
    sendCommand({
      action: 'state',
      patch: { background: { id, dim: currentDim(), rotateMinutes: currentRotateMinutes() } },
    })
  }

  async function selectBackground(id) {
    await applyBackground({ id, dim: currentDim() })
    pushBackground(id)
    setText('set-bg-note', '就用这张啦♪')
    await renderBackgroundGrid()
  }

  async function removeBackground(id) {
    const ok = window.pet && window.pet.removeBackground
      ? await window.pet.removeBackground(id).catch(() => false)
      : false
    BG_CACHE.delete(id)
    if (bgCurrentId === id || ok === true) {
      if (bgCurrentId === id) {
        await applyBackground({ id: '', dim: currentDim() })
        pushBackground('')
      }
    }
    setText('set-bg-note', ok === true ? '这张已经删掉了' : '没删掉，可能正被占用')
    await renderBackgroundGrid()
  }

  let onboardDismissed = false
  function syncOnboard(data) {
    if (onboard === null) return
    onboard.classList.toggle('hidden', data.onboarded === true || onboardDismissed)
  }

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

  /* 描边：默认白边，设置里可以换深边 / 按亮度自动 / 关掉 */
  function applyOutlinePreference(prefer) {
    if (CARD_ONLY || !window.CyreneOutline) return
    outlinePref = prefer === 'dark' || prefer === 'auto' || prefer === 'none' ? prefer : 'light'
    const key = window.CyreneOutline.resolveKey(outlinePref, outlineLuma)
    if (key === 'none') window.CyreneOutline.apply(canvas, '', 0)
    else window.CyreneOutline.apply(canvas, window.CyreneOutline.COLORS[key], 2)
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
    speechEnabled = data.speechEnabled === true
    speechProvider = data.speechProvider === 'local' ? 'local' : 'system'
    applyTheme(data.theme)
    void applyBackground(data.background)
    syncOnboard(data)
    playSpeechClip(data.speech)
    applyOutlinePreference(data.outline)

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

    if (typeof data.mood === 'string' && data.mood !== moodKey) {
      moodKey = data.mood
      setMood(data.mood)
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

  function setMood(name) {
    const wanted = MOOD_POSES[name] ?? null
    if (wanted === null) return
    const match = [wanted, wanted.replace(/\.png$/, '')].find((pose) => SPRITE_POSES.includes(pose))
    if (match === undefined) return
    moodPose = match
    setSpritePose(match)
  }

  function randomPose() {
    /* 有明确心情时先让心情占住姿态，心情回到 calm 再继续轮换 */
    if (moodPose !== null && moodPose !== 'default.png' && moodPose !== 'default') return
    if (spriteMode) {
      if (SPRITE_POSES.length < 2) return
      let next = spritePoseIndex
      while (next === spritePoseIndex) next = Math.floor(Math.random() * SPRITE_POSES.length)
      setSpritePose(SPRITE_POSES[next])
      return
    }
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

  /* 主动贴近：界面只负责这一下的回应，好感由主进程按 closeness 规则记 */
  function onCloseness() {
    if (settingsOpen) return
    const now = Date.now()
    if (now - lastClosenessAt < 4000) return
    lastClosenessAt = now
    sendCommand({ action: 'closeness' })
    const lines = [
      '唔……再靠近一点，也可以哦。',
      '就一小会儿，别急着走呀。',
      '人家听见你的心跳啦♪',
      '今天的你，离得好近呢。',
    ]
    speak(lines[Math.floor(Math.random() * lines.length)], 2600)
    playSound('click')
    randomPose()
  }

  function showBubble(text, ms) {
    if (!text) return
    bubbleText.textContent = text
    bubble.classList.add('show')
    window.clearTimeout(showBubble.timer)
    showBubble.timer = window.setTimeout(() => bubble.classList.remove('show'), ms || 2600)
  }

  /* 系统语音只念主动开口，不碰余额、审批这类功能性气泡 */
  function systemSpeak(clean) {
    if (!window.speechSynthesis) return
    try {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(clean)
      utterance.lang = 'zh-CN'
      utterance.rate = 1.02
      utterance.volume = 0.9
      const voices = window.speechSynthesis.getVoices()
      const voice =
        voices.find((item) => /^zh[-_]CN/i.test(item.lang)) ??
        voices.find((item) => /^zh/i.test(item.lang))
      if (voice) utterance.voice = voice
      window.speechSynthesis.speak(utterance)
    } catch {
      /* 系统没有可用语音时静默 */
    }
  }

  function speakText(text) {
    if (!speechEnabled) return
    const clean = String(text)
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/[*_`#>~♪]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (clean === '') return

    if (speechProvider === 'local') {
      const now = Date.now()
      /* 同一句台词 20 秒内不重复送合成，避免主循环每轮都压本地推理 */
      if (clean === pendingLocalText && now - lastLocalRequestAt < 20000) return
      pendingLocalText = clean
      lastLocalRequestAt = now
      sendCommand({ action: 'speak', text: clean })
      return
    }
    systemSpeak(clean)
  }

  /* 宿主把合成好的 wav 路径塞进 live.speech；只有新序号才播，失败退回系统语音 */
  function playSpeechClip(clip) {
    if (!clip || typeof clip !== 'object') return
    const seq = Number(clip.seq) || 0
    if (seq === 0 || seq === lastSpeechSeq) return
    lastSpeechSeq = seq
    /* 宿主重启后 live 里还留着上一条，超过 15 秒就不补播 */
    const at = Number(clip.at) || 0
    if (at > 0 && Date.now() - at > 15000) {
      pendingLocalText = ''
      return
    }
    if (typeof clip.url === 'string' && clip.url !== '') {
      try {
        if (localSpeechAudio !== null) localSpeechAudio.pause()
        localSpeechAudio = new Audio(clip.url)
        localSpeechAudio.volume = Math.min(1, Math.max(0, soundVolume))
        const result = localSpeechAudio.play()
        if (result && typeof result.catch === 'function') result.catch(() => {})
        pendingLocalText = ''
        return
      } catch {
        /* 文件读不出来时走下面的系统语音 */
      }
    }
    if (pendingLocalText !== '') systemSpeak(pendingLocalText)
    pendingLocalText = ''
  }

  function speak(text, ms) {
    showBubble(text, Math.max(1800, ms || 2600))
    speakText(text)
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
      insideRect(x, y, rectOf(onboard)) ||
      insideRect(x, y, rectOf(askBox)) ||
      insideRect(x, y, rectOf(approvalBox)) ||
      insideRect(x, y, rectOf(taskSheet))
    )
  }

  function isPointOnPet(x, y) {
    if (spriteMode) {
      if (sprite === null) return false
      const rect = sprite.getBoundingClientRect()
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }
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
      if (!CARD_ONLY) speak('有个问题想问你♪', 2600)
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
    if (!CARD_ONLY) speak('有个操作要你批准一下♪', 2600)
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
    renderToolList()
    renderSessionPanel()
  }

  /* 现在的对话：标题、最近一两句、是否还在生成 */
  function renderSessionPanel() {
    const title = document.getElementById('task-session-title')
    const last = document.getElementById('task-session-last')
    const busy = document.getElementById('task-session-busy')
    if (title === null || last === null) return
    const session = live !== null && live.session && typeof live.session === 'object' ? live.session : null
    if (session === null) {
      title.textContent = '还没读到对话'
      last.textContent = ''
      if (busy !== null) busy.classList.add('hidden')
      return
    }
    title.textContent = typeof session.title === 'string' && session.title !== '' ? session.title : '未命名对话'
    if (busy !== null) busy.classList.toggle('hidden', session.busy !== true)
    /* 只画对话消息：工具调用与回合标记各有自己的位置，混进来会变成空行 */
    const messages = (Array.isArray(session.messages) ? session.messages : []).filter(
      (item) => item !== null && (item.kind === undefined || item.kind === 'message'),
    )
    const tail = messages.slice(-2)
    last.innerHTML = ''
    if (tail.length === 0) {
      last.textContent = '这一页还没有消息呢。'
      return
    }
    for (const item of tail) {
      const row = document.createElement('p')
      row.className = `task-session-line ${item.role === 'user' ? 'user' : 'assistant'}`
      const who = document.createElement('i')
      who.textContent = item.role === 'user' ? '你' : '昔涟'
      const text = document.createElement('span')
      const raw = typeof item.text === 'string' ? item.text.trim() : ''
      text.textContent = raw.length > 90 ? `${raw.slice(0, 90)}…` : raw
      row.append(who, text)
      last.append(row)
    }
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

  /* 工具调用：最近几次用了什么、成没成、花了多久 */
  const TOOL_MARKS = { running: '▶', ok: '✓', failed: '✗' }

  function durationText(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
    return ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`
  }

  function renderToolList() {
    const box = document.getElementById('task-tools')
    if (box === null) return
    box.innerHTML = ''
    const session = live !== null && live.session && typeof live.session === 'object' ? live.session : null
    const tools = session !== null && Array.isArray(session.tools) ? session.tools : []
    if (tools.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'task-tool-empty'
      empty.textContent = '还没有工具调用呢。'
      box.append(empty)
      return
    }
    for (const tool of tools.slice(-8)) {
      const status = tool.status === 'failed' ? 'failed' : tool.status === 'running' ? 'running' : 'ok'
      const row = document.createElement('div')
      row.className = `task-tool ${status}`
      const mark = document.createElement('i')
      mark.textContent = TOOL_MARKS[tool.status] ?? '·'
      const name = document.createElement('b')
      name.textContent = typeof tool.name === 'string' && tool.name !== '' ? tool.name : '工具'
      const summary = document.createElement('span')
      summary.textContent = typeof tool.summary === 'string' ? tool.summary : ''
      const time = document.createElement('em')
      time.textContent = durationText(tool.durationMs)
      row.append(mark, name, summary, time)

      /* 点开才看参数原文与结果，默认折叠 */
      const detail = document.createElement('div')
      detail.className = 'task-tool-detail'
      if (typeof tool.argText === 'string' && tool.argText !== '') {
        const args = document.createElement('p')
        args.className = 'task-tool-args'
        args.textContent = tool.argText
        detail.append(args)
      }
      if (typeof tool.detail === 'string' && tool.detail !== '') {
        const result = document.createElement('p')
        result.className = 'task-tool-result'
        result.textContent = tool.detail
        detail.append(result)
      }
      row.append(detail)
      row.onclick = () => row.classList.toggle('expanded')
      box.append(row)
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

    setText('hud-nickname', live.nickname || '旅人')
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
  }

  menu.addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (button === null) return
    event.stopPropagation()
    if (button.dataset.action === 'dock') {
      playSound('click')
      if (window.pet && typeof window.pet.dock === 'function') {
        void window.pet.dock()
          .then((moved) => {
            if (moved) showBubble('人家回来啦♪', 1600)
          })
          .catch(() => {})
      }
    } else if (button.dataset.action === 'look') {
      playSound('click')
      openSettings('look')
      return
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

  function setSettingsPanel(name) {
    const meta = SETTINGS_PANEL_META[name] === undefined ? SETTINGS_PANEL_META.overview : SETTINGS_PANEL_META[name]
    settingsPanel = SETTINGS_PANEL_META[name] === undefined ? 'overview' : name
    for (const panel of settings.querySelectorAll('.set-panel')) {
      panel.classList.toggle('active', panel.dataset.panel === settingsPanel)
    }
    for (const button of settings.querySelectorAll('#settings-nav button')) {
      button.classList.toggle('active', button.dataset.panel === settingsPanel)
    }
    setText('settings-kicker', meta[0])
    setText('settings-title', meta[1])
    setText('settings-desc', meta[2])
    const panels = document.querySelector('.set-panels')
    if (panels !== null) panels.scrollTop = 0
  }

  /* 搜索只做本地文本过滤，不重新渲染控件，已填的值不会丢 */
  function filterSettings(raw) {
    const query = String(raw === undefined ? '' : raw).trim().toLowerCase()
    const panels = settings.querySelectorAll('.set-panel')
    const counts = {}
    let total = 0
    for (const panel of panels) {
      let hits = 0
      for (const node of panel.querySelectorAll('.set-group, .set-doc, .set-guide')) {
        const text = (node.textContent || '').toLowerCase()
        const match = query === '' || text.includes(query)
        node.classList.toggle('search-hidden', !match)
        if (match) hits += 1
      }
      counts[panel.dataset.panel] = hits
      total += hits
    }
    for (const button of settings.querySelectorAll('#settings-nav button')) {
      button.classList.toggle('has-search-hit', query !== '' && (counts[button.dataset.panel] || 0) > 0)
    }
    const countNode = document.getElementById('settings-search-count')
    if (countNode !== null) {
      countNode.hidden = query === ''
      countNode.textContent = String(total)
    }
    const empty = document.getElementById('settings-search-empty')
    if (empty !== null) empty.hidden = !(query !== '' && total === 0)
    const panelBox = settings.querySelector('.set-panels')
    if (panelBox !== null) panelBox.classList.toggle('searching-empty', query !== '' && total === 0)

    if (query !== '' && (counts[settingsPanel] || 0) === 0) {
      const first = Array.from(panels).find((panel) => (counts[panel.dataset.panel] || 0) > 0)
      if (first !== undefined) setSettingsPanel(first.dataset.panel)
    }
  }

  function openSettings(panel = 'overview') {
    settingsOpen = true
    settings.classList.remove('hidden')
    setSettingsPanel(panel)
    const search = document.getElementById('settings-search')
    if (search !== null) search.value = ''
    filterSettings('')
    closeMenu()
    if (CARD_ONLY && window.pet && window.pet.setPanel) window.pet.setPanel('settings')
    if (window.pet && window.pet.windowState) {
      window.pet.windowState()
        .then((windowState) => {
          const node = document.getElementById('set-always-on-top')
          if (node !== null) node.value = windowState && windowState.alwaysOnTop === false ? '0' : '1'
        })
        .catch(() => {})
    }
    const bgState = live !== null && live.background !== undefined ? live.background : null
    const bgDimNode = document.getElementById('set-bg-dim')
    if (bgDimNode !== null) {
      const dimValue = bgState !== null && Number.isFinite(Number(bgState.dim)) ? Number(bgState.dim) : 0.35
      bgDimNode.value = String(Math.min(0.85, Math.max(0, dimValue)))
    }
    const bgRotateNode = document.getElementById('set-bg-rotate')
    if (bgRotateNode !== null) {
      const rotate = bgState !== null && Number.isFinite(Number(bgState.rotateMinutes)) ? Number(bgState.rotateMinutes) : 0
      bgRotateMinutes = [0, 10, 30, 60, 180].includes(rotate) ? rotate : 0
      bgRotateNode.value = String(bgRotateMinutes)
      applyBackgroundRotation(bgRotateMinutes)
    }
    void renderBackgroundGrid()
    if (live !== null) {
      document.getElementById('set-nickname').value = live.nickname || ''
      const persona = live.persona ?? {}
      document.getElementById('set-persona-enabled').checked = persona.enabled !== false
      for (const [key, id] of PERSONA_FIELDS) {
        const node = document.getElementById(id)
        if (node !== null) node.value = typeof persona.sections?.[key] === 'string' ? persona.sections[key] : ''
      }
      document.getElementById('set-persona-extra').value = typeof persona.extraPrompt === 'string' ? persona.extraPrompt : ''
      document.getElementById('set-threshold').value = String(live.balanceThreshold ?? 20)
      document.getElementById('set-limit').value = String(live.dailyLimit ?? 0)
      pickOption('set-scale', live.scale, [0.5, 0.6, 0.7, 0.8, 1, 1.25, 1.5, 1.75], 1)
      const uiSelect = document.getElementById('set-ui')
      if (uiSelect !== null) uiSelect.value = live.ui === 'card' ? 'card' : 'pet'
      const rendererSelect = document.getElementById('set-renderer')
      if (rendererSelect !== null) rendererSelect.value = live.renderer === 'live2d' ? 'live2d' : 'sprite'
      const modelPath = document.getElementById('set-model-path')
      if (modelPath !== null) modelPath.value = ''
      const modelNote = document.getElementById('set-model-note')
      if (modelNote !== null) {
        const current = typeof live.modelId === 'string' && live.modelId !== '' ? `当前素材：${live.modelId}。` : '当前用的是内置立绘。'
        modelNote.textContent = `${current}${live.modelNotice || ''}`
      }
      pickOption('set-font', live.bubbleFont, [12, 14.5, 18], 14.5)
      pickOption('set-bubble-radius', live.bubbleRadius, [0, 10, 18], 0)
      const outlineSelect = document.getElementById('set-outline')
      if (outlineSelect !== null) outlineSelect.value = live.outline || 'light'

      document.getElementById('set-bubble-alpha').value = String(live.bubbleAlpha ?? 0.97)
      const bubbleMode = document.getElementById('set-bubble-mode')
      if (bubbleMode !== null) bubbleMode.value = live.bubbleMode || 'rotate'
      document.getElementById('set-show-hud').checked = live.showHud !== false
      document.getElementById('set-hud-detail').value = live.hudDetail || 'full'
      document.getElementById('set-hud-alpha').value = String(live.hudAlpha ?? 0.93)

      pickOption('set-ask-every', live.askEveryMinutes, [0, 15, 30, 45, 60, 120], 45)
      const handling = document.getElementById('set-ask-handling')
      if (handling !== null) handling.value = live.askHandling || 'pet-all'
      pickOption('set-pose-every', live.poseSeconds, [0, 30, 60, 120, 300], 60)
      pickOption('set-sound-level', live.soundVolume, [0, 0.5, 0.8, 1], 0.5)
      pickOption('set-speech', live.speechEnabled === true ? 1 : 0, [0, 1], 0)
      const themeSelect = document.getElementById('set-theme')
      if (themeSelect !== null) themeSelect.value = live.theme || 'pink'
      const providerSelect = document.getElementById('set-speech-provider')
      if (providerSelect !== null) providerSelect.value = live.speechProvider === 'local' ? 'local' : 'system'
      const ttsEndpoint = document.getElementById('set-tts-endpoint')
      if (ttsEndpoint !== null) ttsEndpoint.value = typeof live.ttsEndpoint === 'string' ? live.ttsEndpoint : ''
      const ttsRef = document.getElementById('set-tts-ref')
      if (ttsRef !== null) ttsRef.value = typeof live.ttsRefAudio === 'string' ? live.ttsRefAudio : ''

      const qq = live.qq !== null && typeof live.qq === 'object' ? live.qq : {}
      const qqEnabled = document.getElementById('set-qq-enabled')
      if (qqEnabled !== null) qqEnabled.checked = qq.enabled === true
      const qqAppId = document.getElementById('set-qq-appid')
      if (qqAppId !== null) qqAppId.value = typeof qq.appId === 'string' ? qq.appId : ''
      const qqSecret = document.getElementById('set-qq-secret')
      if (qqSecret !== null) {
        qqSecret.value = ''
        const hasSecret = live.qqView !== null && typeof live.qqView === 'object' && live.qqView.hasSecret === true
        qqSecret.placeholder = hasSecret ? '已保存，留空表示不修改' : '粘贴 AppSecret'
      }
      const qqOwners = document.getElementById('set-qq-owners')
      if (qqOwners !== null) {
        qqOwners.value = Array.isArray(qq.ownerOpenIds) ? qq.ownerOpenIds.join(', ') : ''
      }
      const qqKind = document.getElementById('set-qq-kind')
      if (qqKind !== null) qqKind.value = qq.targetKind === 'group' ? 'group' : 'c2c'
      const qqTarget = document.getElementById('set-qq-target')
      if (qqTarget !== null) qqTarget.value = typeof qq.targetId === 'string' ? qq.targetId : ''
      const qqPort = document.getElementById('set-qq-port')
      if (qqPort !== null) qqPort.value = String(qq.webhookPort ?? 17321)
      if (live.qqView !== null && typeof live.qqView === 'object' && live.qqView.reason) {
        setText('set-qq-note', live.qqView.reason)
      }

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
    if (CARD_ONLY && window.pet && window.pet.setPanel) window.pet.setPanel('normal')
  }

  /* 三步引导只出现到用户点掉为止；存储不可用时每次打开都显示，不影响功能 */
  const guide = document.getElementById('set-guide')
  const guideClose = document.getElementById('set-guide-close')
  try {
    if (guide !== null && window.localStorage.getItem('pet-guide-done') === '1') guide.classList.add('hidden')
  } catch {
    /* 忽略存储异常 */
  }
  if (guideClose !== null) {
    guideClose.addEventListener('click', () => {
      if (guide !== null) guide.classList.add('hidden')
      try {
        window.localStorage.setItem('pet-guide-done', '1')
      } catch {
        /* 忽略存储异常 */
      }
    })
  }

  /* 首次引导：关掉即写回 onboarded，重看入口只显示这一轮，不去改持久状态 */
  function finishOnboard() {
    onboardDismissed = true
    if (onboard !== null) onboard.classList.add('hidden')
    sendCommand({ action: 'state', patch: { onboarded: true } })
  }
  const onboardStart = document.getElementById('onboard-start')
  if (onboardStart !== null) onboardStart.addEventListener('click', finishOnboard)
  const onboardLater = document.getElementById('onboard-later')
  if (onboardLater !== null) onboardLater.addEventListener('click', finishOnboard)
  const onboardSettings = document.getElementById('onboard-settings')
  if (onboardSettings !== null) {
    onboardSettings.addEventListener('click', () => {
      finishOnboard()
      openSettings()
    })
  }
  const guideReopen = document.getElementById('guide-reopen')
  if (guideReopen !== null) {
    guideReopen.addEventListener('click', () => {
      onboardDismissed = false
      if (onboard !== null) onboard.classList.remove('hidden')
      closeSettings()
    })
  }

  document.getElementById('settings-close').addEventListener('click', closeSettings)

  for (const button of settings.querySelectorAll('#settings-nav button')) {
    button.addEventListener('click', () => {
      setSettingsPanel(button.dataset.panel)
      const search = document.getElementById('settings-search')
      if (search !== null && search.value.trim() !== '') filterSettings(search.value)
      playSound('click')
    })
  }

  const settingsSearch = document.getElementById('settings-search')
  if (settingsSearch !== null) {
    settingsSearch.addEventListener('input', () => filterSettings(settingsSearch.value))
    settingsSearch.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      settingsSearch.value = ''
      filterSettings('')
      settingsSearch.blur()
    })
  }

  const taskClose = document.getElementById('task-close')
  if (taskClose !== null) taskClose.addEventListener('click', () => toggleTaskSheet(false))

  document.getElementById('settings-save').addEventListener('click', () => {
    const uiSelect = document.getElementById('set-ui')
    const ui = uiSelect !== null && uiSelect.value === 'card' ? 'card' : 'pet'
    const uiBefore = live !== null && live.ui === 'card' ? 'card' : 'pet'
    const rendererNode = document.getElementById('set-renderer')
    const renderer = rendererNode !== null && rendererNode.value === 'live2d' ? 'live2d' : 'sprite'
    const rendererBefore = live !== null && live.renderer === 'live2d' ? 'live2d' : 'sprite'
    const patch = {
      nickname: document.getElementById('set-nickname').value,
      theme: document.getElementById('set-theme').value,
      ui,
      renderer,
      scale: Number(document.getElementById('set-scale').value),
      bubbleFont: Number(document.getElementById('set-font').value),
      bubbleRadius: Number(document.getElementById('set-bubble-radius').value),
      outline: document.getElementById('set-outline').value,
      bubbleAlpha: Number(document.getElementById('set-bubble-alpha').value),
      showHud: document.getElementById('set-show-hud').checked,
      hudDetail: document.getElementById('set-hud-detail').value,
      hudAlpha: Number(document.getElementById('set-hud-alpha').value),
      askEveryMinutes: Number(document.getElementById('set-ask-every').value),
      askHandling: document.getElementById('set-ask-handling').value,
      poseSeconds: Number(document.getElementById('set-pose-every').value),
      soundVolume: Number(document.getElementById('set-sound-level').value),
      speechEnabled: document.getElementById('set-speech').value === '1',
      speechProvider: document.getElementById('set-speech-provider').value === 'local' ? 'local' : 'system',
      ttsEndpoint: document.getElementById('set-tts-endpoint').value.trim(),
      ttsRefAudio: document.getElementById('set-tts-ref').value.trim(),
    }
    const bubbleModeNode = document.getElementById('set-bubble-mode')
    if (bubbleModeNode !== null) patch.bubbleMode = bubbleModeNode.value
    patch.background = { id: bgCurrentId, dim: currentDim() }

    /* QQ 凭证：secret 留空表示沿用已存的那份，不覆盖 */
    const qqEnabledNode = document.getElementById('set-qq-enabled')
    const qqAppIdNode = document.getElementById('set-qq-appid')
    const qqOwnersNode = document.getElementById('set-qq-owners')
    const qqKindNode = document.getElementById('set-qq-kind')
    const qqTargetNode = document.getElementById('set-qq-target')
    const qqPortNode = document.getElementById('set-qq-port')
    const qqSecretNode = document.getElementById('set-qq-secret')
    if (qqEnabledNode !== null && qqAppIdNode !== null) {
      const qqPatch = {
        enabled: qqEnabledNode.checked,
        appId: qqAppIdNode.value.trim(),
        ownerOpenIds: qqOwnersNode === null
          ? []
          : qqOwnersNode.value.split(/[,，\s]+/).map((item) => item.trim()).filter((item) => item !== ''),
        targetKind: qqKindNode !== null && qqKindNode.value === 'group' ? 'group' : 'c2c',
        targetId: qqTargetNode === null ? '' : qqTargetNode.value.trim(),
        webhookPort: qqPortNode === null ? 17321 : Number(qqPortNode.value) || 17321,
      }
      const secretValue = qqSecretNode === null ? '' : qqSecretNode.value.trim()
      if (secretValue !== '') qqPatch.appSecret = secretValue
      patch.qq = qqPatch
    }

    const personaSections = {}
    for (const [key, id] of PERSONA_FIELDS) {
      const node = document.getElementById(id)
      if (node === null) continue
      const value = node.value.trim()
      if (value !== '') personaSections[key] = value
    }
    patch.persona = {
      enabled: document.getElementById('set-persona-enabled').checked,
      sections: personaSections,
      extraPrompt: document.getElementById('set-persona-extra').value.trim(),
    }
    /*
     * 留空表示「这次不改」。空字符串直接 Number() 会变成 0，
     * 而 0 在宿主那边等于「关掉提醒」，不能让它悄悄生效。
     */
    const skipped = []
    const thresholdRaw = document.getElementById('set-threshold').value.trim()
    const limitRaw = document.getElementById('set-limit').value.trim()
    if (thresholdRaw !== '' && Number.isFinite(Number(thresholdRaw))) patch.balanceThreshold = Number(thresholdRaw)
    else skipped.push('余额阈值')
    if (limitRaw !== '' && Number.isFinite(Number(limitRaw))) patch.dailyLimit = Number(limitRaw)
    else skipped.push('今日额度')
    const key = document.getElementById('set-key').value.trim()
    if (key !== '') patch.apiKey = key
    const alwaysOnTopNode = document.getElementById('set-always-on-top')
    if (alwaysOnTopNode !== null && window.pet && window.pet.setAlwaysOnTop) {
      window.pet.setAlwaysOnTop(alwaysOnTopNode.value === '1').catch(() => {})
    }
    sendCommand({ action: 'state', patch })
    if (ui !== uiBefore) {
      setText('settings-hint', '界面模式换好了，重开一下桌宠……')
      window.setTimeout(() => sendCommand({ action: 'restartPet' }), 800)
      window.setTimeout(closeSettings, 900)
    } else if (renderer !== rendererBefore) {
      setText('settings-hint', '形象渲染换好了，重开一下桌宠……')
      window.setTimeout(() => sendCommand({ action: 'restartPet' }), 800)
      window.setTimeout(closeSettings, 900)
    } else {
      setText('settings-hint', skipped.length > 0 ? `${skipped.join('、')}留空，保持原值♪` : '已经记住啦♪')
      window.setTimeout(closeSettings, 700)
    }
  })

  /* ---------------- 背景图交互 ---------------- */

  const bgUpload = document.getElementById('set-bg-upload')
  const bgFile = document.getElementById('set-bg-file')
  if (bgUpload !== null && bgFile !== null) {
    bgUpload.addEventListener('click', () => bgFile.click())
    bgFile.addEventListener('change', () => {
      const file = bgFile.files !== null && bgFile.files.length > 0 ? bgFile.files[0] : null
      bgFile.value = ''
      if (file === null) return
      setText('set-bg-note', '正在收图…')
      void (async () => {
        const dataUrl = await prepareImage(file)
        if (dataUrl === '') {
          setText('set-bg-note', '这张图读不出来，换一张试试')
          return
        }
        const result = window.pet && window.pet.uploadBackground
          ? await window.pet.uploadBackground({ dataUrl }).catch(() => null)
          : null
        if (result === null || result.ok !== true) {
          setText('set-bg-note', (result !== null && result.error) || '上传没成功，再试一次？')
          return
        }
        BG_CACHE.set(result.id, dataUrl)
        await applyBackground({ id: result.id, dim: currentDim() })
        pushBackground(result.id)
        setText('set-bg-note', '背景换好啦♪')
        await renderBackgroundGrid()
      })()
    })
  }

  const bgDim = document.getElementById('set-bg-dim')
  if (bgDim !== null) {
    bgDim.addEventListener('input', () => {
      document.body.style.setProperty('--scene-veil', backgroundVeil(Number(bgDim.value)))
    })
    bgDim.addEventListener('change', () => {
      if (bgCurrentId !== '') pushBackground(bgCurrentId)
    })
  }

  const bgRotate = document.getElementById('set-bg-rotate')
  if (bgRotate !== null) {
    bgRotate.addEventListener('change', () => {
      const minutes = Number(bgRotate.value)
      bgRotateMinutes = [0, 10, 30, 60, 180].includes(minutes) ? minutes : 0
      applyBackgroundRotation(bgRotateMinutes)
      if (bgCurrentId !== '') pushBackground(bgCurrentId)
      setText('set-bg-note', minutes > 0 ? `好呀，每 ${minutes} 分钟换一张♪` : '就停在这一张啦')
    })
  }

  const bgNext = document.getElementById('set-bg-next')
  if (bgNext !== null) {
    bgNext.addEventListener('click', () => {
      void (async () => {
        const changed = await cycleBackground(1)
        setText('set-bg-note', changed ? '换到下一张啦♪' : '先上传一张图吧')
      })()
    })
  }

  const bgClear = document.getElementById('set-bg-clear')
  if (bgClear !== null) {
    bgClear.addEventListener('click', () => {
      void (async () => {
        await applyBackground({ id: '', dim: currentDim() })
        pushBackground('')
        setText('set-bg-note', '背景收起来了，桌面还是原来的样子')
        await renderBackgroundGrid()
      })()
    })
  }

  const modelImport = document.getElementById('set-model-import')
  if (modelImport !== null) {
    modelImport.addEventListener('click', () => {
      const pathNode = document.getElementById('set-model-path')
      const path = pathNode === null ? '' : pathNode.value.trim()
      if (path === '') {
        setText('settings-hint', '先填一个素材路径……')
        return
      }
      setText('settings-hint', '正在复制素材，稍等一下……')
      sendCommand({ action: 'importModel', path })
      window.setTimeout(closeSettings, 1600)
    })
  }

  const modelReset = document.getElementById('set-model-reset')
  if (modelReset !== null) {
    modelReset.addEventListener('click', () => {
      setText('settings-hint', '换回内置立绘，重开一下桌宠……')
      sendCommand({ action: 'resetModel' })
      window.setTimeout(closeSettings, 1200)
    })
  }

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

  /* 右键菜单收窄后，互动动作集中到设置页，点完就回到桌宠上 */
  const setSay = document.getElementById('set-say')
  if (setSay !== null) {
    setSay.addEventListener('click', () => {
      sendCommand({ action: 'say' })
      playSound('click')
      closeSettings()
    })
  }

  const setPose = document.getElementById('set-pose')
  if (setPose !== null) {
    setPose.addEventListener('click', () => {
      sendCommand({ action: 'pose' })
      randomPose()
      playSound('click')
      closeSettings()
    })
  }

  const setCloseness = document.getElementById('set-closeness')
  if (setCloseness !== null) {
    setCloseness.addEventListener('click', () => {
      closeSettings()
      onCloseness()
    })
  }

  const setRefresh = document.getElementById('set-refresh')
  if (setRefresh !== null) {
    setRefresh.addEventListener('click', () => {
      sendCommand({ action: 'refresh' })
      playSound('click')
      setText('settings-hint', '人家去问问余额啦……')
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

  /* 立绘起不来时退回静态姿态图：至少能看到人，气泡 / 状态栏 / 卡片照常工作 */
  function mountSpriteVideo(url) {
    if (spriteVideo !== null) return
    spriteVideo = document.createElement('video')
    spriteVideo.id = 'sprite-video'
    spriteVideo.className = 'sprite'
    spriteVideo.src = url
    spriteVideo.autoplay = true
    spriteVideo.loop = true
    spriteVideo.muted = true
    spriteVideo.playsInline = true
    spriteVideo.addEventListener('error', () => {
      report({ stage: 'model-video-missing', src: url })
      spriteVideo?.classList.add('hidden')
      document.body.classList.add('no-sprite')
    })
    document.body.appendChild(spriteVideo)
    if (sprite !== null) sprite.classList.add('hidden')
  }

  function useSpriteFallback(reason, detail) {
    if (spriteMode) return
    spriteMode = true
    if (canvas !== null) canvas.classList.add('hidden')
    if (CUSTOM_KIND === 'video' && CUSTOM_MODEL !== null) {
      mountSpriteVideo(CUSTOM_MODEL.entry)
    } else if (sprite !== null) {
      sprite.classList.remove('hidden')
      if (CUSTOM_KIND === 'image' || CUSTOM_KIND === 'gif') {
        sprite.src = CUSTOM_MODEL.entry
      } else {
        setSpritePose('default.png')
      }
    }
    report({ stage: 'sprite-ready', reason, detail: detail === undefined ? null : detail })
    /* 立绘模式也要收 live：背景、昵称、HUD 不依赖 Live2D 加载成功 */
    window.setTimeout(bindSpriteLive, 0)
  }

  function bindSpriteLive() {
    if (spriteLiveBound || !window.pet || !window.pet.onLive) return
    spriteLiveBound = true
    window.pet.onLive((data) => {
      if (!data || typeof data !== 'object') return
      acceptLive(data)
      renderHud()
      applyLook(data)
      if (typeof data.scale === 'number') applyZoom(data.scale)
      renderAsk()
      renderApproval()
    })
  }

  function setSpritePose(name) {
    if (sprite === null) return
    /* 单张图 / gif / 视频没有表情差分，保持原样就好 */
    if (spriteVideo !== null || CUSTOM_KIND === 'video') return
    if (CUSTOM_KIND === 'image' || CUSTOM_KIND === 'gif') return
    if (CUSTOM_POSES !== null) {
      const exact = SPRITE_POSES.includes(name) ? name : CUSTOM_MODEL.defaultPose
      const index = Math.max(0, SPRITE_POSES.indexOf(exact))
      spritePoseIndex = index
      const src = poseUrl(exact)
      if (sprite.getAttribute('src') !== src) sprite.src = src
      return
    }
    const file = SPRITE_POSES.includes(name) ? name : SPRITE_POSES[0]
    spritePoseIndex = Math.max(0, SPRITE_POSES.indexOf(file))
    const src = poseUrl(file)
    if (sprite.getAttribute('src') !== src) sprite.src = src
  }

  function layoutModel() {
    if (spriteMode || model === null) return
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

  /* 托盘里的「打开设置」：卡片模式没有右键菜单，这是切回立绘模式的入口 */
  if (window.pet && typeof window.pet.onOpenSettings === 'function') {
    window.pet.onOpenSettings(() => openSettings())
  }

  /* ------------------------------ 卡片模式 ------------------------------ */

  /* 卡片模式没有立绘，可点区域只剩审批 / 提问卡片；卡片收起时整窗穿透 */
  let cardInteractive = false

  function syncCardInteractive() {
    if (!CARD_ONLY) return
    const active = rectOf(approvalBox) !== null || rectOf(askBox) !== null
    if (active === cardInteractive) return
    cardInteractive = active
    if (window.pet && window.pet.setInteractive) window.pet.setInteractive(active)
  }

  if (CARD_ONLY && window.pet) {
    window.pet.onLive((data) => {
      if (!data || typeof data !== 'object') return
      acceptLive(data)
      renderAsk()
      renderApproval()
      syncCardInteractive()
    })

    window.addEventListener('pointermove', syncCardInteractive)
    renderApproval()
  }

  if (!CARD_ONLY && !spriteMode) {
    PIXI.live2d.Live2DModel.from(MODEL_URL, { autoInteract: false })
    .then((loaded) => {
      model = loaded
      app.stage.addChild(model)
      layoutModel()

      if (window.CyreneOutline) {
        if (detachOutline) detachOutline()
        detachOutline = window.CyreneOutline.attach({
          canvas,
          renderer: app && app.renderer ? app.renderer : null,
          prefer: outlinePref,
          onResult: (result) => {
            if (result.ok === true) outlineLuma = result.luma
            report({ outline: result })
          },
        })
      }

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
          acceptLive(data)
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
      useSpriteFallback('model-load-failed', String(error))
      report({ stage: 'model-load-failed', message: String(error), stack: error && error.stack })
    })
  }
})()
