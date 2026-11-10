// 设置窗逻辑：读一次全量设置，之后每个控件改动即保存并立即生效。
// 这里不发任何网络请求，只走 preload 白名单方法。

// 主题只写 data-theme，具体颜色统一在 theme.css；这里不再维护第二张色表。

const $ = (id) => document.getElementById(id)

// 口令长度下限由 BackupPolicy 统一提供，HTML 的 minlength 只作静态兜底。
if ($('backup-password') !== null) {
  $('backup-password').minLength = BackupPolicy.PASSPHRASE_MIN_LENGTH
}

let current = null
let savedTipTimer = null

function t(key) {
  const locale = current?.locale ?? 'zh-CN'
  return window.PetI18n?.t(key, locale) ?? key
}

/**
 * 统一确认入口。normal 说明后果即可；danger 要求输入确认词。
 * 调用点集中在这里，之后换成自绘对话框时不用逐处改。
 */
function confirmAction({ message, strength = 'normal', confirmWord = '确认' }) {
  if (strength !== 'danger') return window.confirm(message)
  const answer = window.prompt(`${message}\n\n此操作不可撤销。请输入「${confirmWord}」继续。`, '')
  return answer !== null && answer.trim() === confirmWord
}

function applyI18n(locale) {
  window.PetI18n?.apply(locale)
}

/**
 * 唤醒词输入：顿号、逗号、分号、空白都当分隔符。
 * 清洗规则与主进程迁移保持一致（最多 8 个、每个 16 字、去重），
 * 避免界面上能填进去、保存时又被悄悄截断。
 */
function parseWakeWords(text) {
  const seen = new Set()
  const words = []
  for (const raw of String(text ?? '').split(/[、,，;；\s]+/)) {
    const word = raw.trim().slice(0, 16)
    if (word === '' || seen.has(word)) continue
    seen.add(word)
    words.push(word)
    if (words.length >= 8) break
  }
  return words
}

const THEME_SHORT = { OceanBlue: 'blue', SakuraPink: 'pink', Paper: 'ink' }

// 一级导航只负责分组，真正的面板仍由 data-panel 决定。
// 旧深链（chat / voice / status …）全部保留，showPanel 负责把一级与子标签一起点亮。
const PANEL_GROUPS = {
  self: { labelKey: 'nav.self', panels: ['axes', 'assessment', 'speech'] },
  look: { labelKey: 'nav.look', panels: ['general', 'hud'] },
  ability: { labelKey: 'nav.ability', panels: ['ability'] },
  memory: { labelKey: 'nav.memory', panels: ['memory'] },
  talk: { labelKey: 'nav.talk', panels: ['connection', 'voice'] },
  outside: { labelKey: 'nav.outside', panels: ['account'] },
  active: { labelKey: 'nav.active', panels: ['proactive', 'routine'] },
  system: { labelKey: 'nav.system', panels: ['overview', 'data'] }
}

const PANEL_TO_GROUP = Object.fromEntries(
  Object.entries(PANEL_GROUPS).flatMap(([group, meta]) => meta.panels.map((panel) => [panel, group]))
)

const PANEL_META = {
  overview: { titleKey: 'panel.overview', descKey: 'page.overview.desc' },
  general: { titleKey: 'panel.general', descKey: 'page.general.desc' },
  hud: { titleKey: 'panel.hud', descKey: 'page.hud.desc' },
  connection: { titleKey: 'panel.connection', descKey: 'page.connection.desc' },
  voice: { titleKey: 'panel.voice', descKey: 'page.voice.desc' },
  proactive: { titleKey: 'panel.proactive', descKey: 'page.proactive.desc' },
  routine: { titleKey: 'panel.routine', descKey: 'page.routine.desc' },
  assessment: { titleKey: 'panel.assessment', descKey: 'page.assessment.desc' },
  speech: { titleKey: 'panel.speech', descKey: 'page.speech.desc' },
  memory: { titleKey: 'panel.memory', descKey: 'page.memory.desc' },
  ability: { titleKey: 'panel.ability', descKey: 'page.ability.desc' },
  account: { titleKey: 'panel.account', descKey: 'page.account.desc' },
  data: { titleKey: 'panel.data', descKey: 'page.data.desc' }
}

// 旧深链与旧记忆里的面板名仍要能落地；页面合并后旧名字统一指到新页面。
const LEGACY_PANELS = {
  companion: 'proactive',
  persona: 'general',
  language: 'voice',
  chat: 'connection',
  life: 'routine',
  mood: 'routine',
  game: 'ability',
  status: 'data'
}

let activePanel = 'overview'
const lastPanelByGroup = {}

// 与 packages/shared/src/types/model.ts 的 SIZE_PROFILES 保持一致。
// 只用于把缩放倍数换算成像素读数，不改窗口尺寸的计算来源。
const SIZE_PROFILES = {
  vertical: { w: 600, h: 800 },
  horizontal: { w: 800, h: 450 },
  square: { w: 512, h: 512 },
  card: { w: 380, h: 240 }
}

function applyTheme(preset) {
  document.documentElement.dataset.theme = THEME_SHORT[preset] ?? 'pink'
  for (const button of document.querySelectorAll('#theme-seg button')) {
    button.classList.toggle('active', button.dataset.theme === preset)
  }
}

/* 配色作用范围：勾上的位置跟着上面选的配色走，取消勾选就固定成当前这套。 */
function themeScopePatch(preset) {
  const slots = {}
  for (const button of document.querySelectorAll('#theme-scope-seg button')) {
    const key = button.dataset.themeSlot
    slots[key] = button.classList.contains('active')
      ? { follow: true }
      : { follow: false, preset }
  }
  return slots
}

function renderPageHead(name) {
  const meta = PANEL_META[name] ?? PANEL_META.general
  const group = PANEL_TO_GROUP[name] ?? 'general'
  const groupLabel = $('page-group')
  const title = $('page-title')
  const desc = $('page-desc')
  if (groupLabel !== null) {
    groupLabel.dataset.i18n = PANEL_GROUPS[group].labelKey
    groupLabel.textContent = t(PANEL_GROUPS[group].labelKey)
  }
  if (title !== null) {
    title.dataset.i18n = meta.titleKey
    title.textContent = t(meta.titleKey)
  }
  if (desc !== null) {
    desc.dataset.i18n = meta.descKey
    desc.textContent = t(meta.descKey)
  }
}

/** 子标签只在多面板分组里出现；单面板分组把整条收掉，省一行高度。 */
function renderSubnav(group) {
  const subnav = $('subnav')
  if (subnav === null) return
  const meta = PANEL_GROUPS[group] ?? PANEL_GROUPS.general
  subnav.hidden = meta.panels.length <= 1
  for (const button of subnav.querySelectorAll('button[data-panel]')) {
    const visible = button.dataset.group === group
    button.hidden = !visible
    button.classList.toggle('active', visible && button.dataset.panel === activePanel)
  }
}

/**
 * 页头保存四态。成功与失败都走这里，页脚只保留「填写未提交」与错误原因，
 * 避免同一句「已保存」在上下两处同时闪。
 */
function setSaveState(state, detail = '') {
  const box = $('save-state')
  const text = $('save-state-text')
  if (box === null || text === null) return
  box.dataset.state = state
  text.dataset.i18n = `save.${state}`
  text.textContent = t(`save.${state}`)
  box.title = detail
}

let toastTimer = null

/**
 * 右上角短提示。保存成功也走这里，键盘和读屏用户不用去页头找状态。
 * 同一时刻只留一条，新的直接覆盖旧的。
 */
function showToast(message, options = {}) {
  const box = $('settings-toast')
  if (box === null || message === '') return
  if (toastTimer !== null) clearTimeout(toastTimer)
  box.textContent = message
  box.classList.toggle('is-error', options.error === true)
  box.hidden = false
  toastTimer = setTimeout(() => {
    box.hidden = true
    box.textContent = ''
    toastTimer = null
  }, options.duration ?? 2600)
}

/** 地址只收 http/https；留空表示不启用，不算错。 */
function watchUrlField(id) {
  const input = $(id)
  if (input === null) return
  const check = () => {
    const raw = input.value.trim()
    if (raw === '') {
      input.setCustomValidity('')
      return
    }
    let valid = false
    try {
      const url = new URL(raw)
      valid = url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      valid = false
    }
    input.setCustomValidity(valid ? '' : '要填 http:// 或 https:// 开头的地址，例如 http://127.0.0.1:9880')
  }
  input.addEventListener('input', check)
  check()
}

/**
 * 保存前校验：数字字段走浏览器自带的 min/max/step，地址走 setCustomValidity。
 * 失败时聚焦并滚到第一个错误字段，不让用户只看到一句「保存失败」。
 */
function blockInvalidSave() {
  const controls = document.querySelectorAll('input[type="number"], #voice-local-url')
  for (const control of controls) {
    if (control.disabled || control.hidden) continue
    const validity = control.validity
    if (validity === undefined) continue
    // step 只用于滑杆步进，不阻止保存（主进程会按范围收敛），这里只拦真正越界与格式错误。
    const invalid =
      validity.badInput === true ||
      validity.rangeOverflow === true ||
      validity.rangeUnderflow === true ||
      validity.customError === true
    if (!invalid) continue
    showToast(control.validationMessage || '这个值不符合要求', { error: true, duration: 4200 })
    control.focus({ preventScroll: true })
    control.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return true
  }
  return false
}

/** 未开放区统一锁定：可见、可读、不可操作，不用假控件骗人。 */
function refreshLockedState() {
  const targets = document.querySelectorAll('.section.pending, .section[data-locked], .item[data-locked]')
  for (const target of targets) {
    target.classList.add('is-locked')
    target.setAttribute('aria-disabled', 'true')
    const reason = target.dataset.lockedReason || t('lock.reason')
    target.title = reason

    for (const control of target.querySelectorAll('input, select, button, textarea')) {
      control.disabled = true
      control.setAttribute('tabindex', '-1')
    }

    const host = target.querySelector('.section-title') ?? target.querySelector('.item-text')
    if (host !== null && host.querySelector('.locked-badge') === null) {
      const badge = document.createElement('span')
      badge.className = 'locked-badge'
      badge.dataset.i18n = 'lock.badge'
      badge.textContent = t('lock.badge')
      host.append(badge)
    }
  }
}

function showPanel(name) {
  const target = LEGACY_PANELS[name] ?? name
  const group = PANEL_TO_GROUP[target]
  if (group === undefined) return
  activePanel = target
  lastPanelByGroup[group] = target
  for (const button of document.querySelectorAll('#nav button[data-group]')) {
    button.classList.toggle('active', button.dataset.group === group)
  }
  for (const panel of document.querySelectorAll('.panel')) {
    panel.classList.toggle('active', panel.dataset.panel === target)
  }
  renderSubnav(group)
  renderPageHead(target)
  $('s-body').scrollTop = 0
  rememberPanel(target)
  // 列表与体检按需加载：不在首屏时不去动磁盘。
  if (target === 'memory') {
    void refreshMemoryList()
    const scopeSelect = $('memory-facts-scope')
    const kindSelect = $('memory-facts-kind')
    if (scopeSelect !== null) scopeSelect.onchange = () => void refreshMemoryFacts()
    if (kindSelect !== null) kindSelect.onchange = () => void refreshMemoryFacts()
    void refreshMemoryFacts()
  }
  if (target === 'speech') {
    bindSpeechPanel()
    void refreshSpeechHabits()
  }
  if (target === 'data') void refreshPreflight()
  if (target === 'routine') void refreshAgenda()
  if (target === 'overview') {
    void refreshOverview()
    void refreshPreflight()
  }
}

/* ---------- 她学到的说法 ---------- */

// 桌宠本体与设置窗同源，学习维度先固定成 desktop。
const SPEECH_SCOPE = 'desktop'

async function resolveSpeech(text, keep) {
  try {
    await window.pet.resolveSpeechHabit(SPEECH_SCOPE, text, keep === true)
    await refreshSpeechHabits()
    showSaved()
  } catch {
    showToast(t('speech.failed'))
  }
}

function renderSpeechChips(container, items, canKeep) {
  if (container === null) return
  container.replaceChildren()
  if (items.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'section-note speech-empty'
    empty.textContent = canKeep ? t('speech.emptyPending') : t('speech.emptyAdopted')
    container.append(empty)
    return
  }
  for (const item of items) {
    const chip = document.createElement('span')
    chip.className = 'speech-chip'

    const label = document.createElement('span')
    label.className = 'speech-chip-text'
    label.textContent = item.text
    chip.append(label)

    const count = document.createElement('span')
    count.className = 'speech-chip-count'
    count.textContent = String(item.count ?? 0)
    chip.append(count)

    if (canKeep) {
      const keep = document.createElement('button')
      keep.type = 'button'
      keep.className = 'speech-chip-action'
      keep.textContent = t('speech.keep')
      keep.onclick = () => void resolveSpeech(item.text, true)
      chip.append(keep)
    }

    const drop = document.createElement('button')
    drop.type = 'button'
    drop.className = 'speech-chip-action is-quiet'
    drop.textContent = t('speech.drop')
    drop.onclick = () => void resolveSpeech(item.text, false)
    chip.append(drop)

    container.append(chip)
  }
}

async function refreshSpeechHabits() {
  const adoptedBox = $('speech-adopted')
  const pendingBox = $('speech-pending')
  if (adoptedBox === null || pendingBox === null) return
  try {
    const data = await window.pet.listSpeechHabits(SPEECH_SCOPE)
    const toggle = $('speech-learning-enabled')
    if (toggle !== null) toggle.checked = data?.learning !== false
    renderSpeechChips(adoptedBox, data?.adopted ?? [], false)
    renderSpeechChips(pendingBox, data?.pending ?? [], true)
  } catch {
    adoptedBox.replaceChildren()
    pendingBox.replaceChildren()
    showToast(t('speech.failed'))
  }
}

function bindSpeechPanel() {
  const toggle = $('speech-learning-enabled')
  if (toggle === null || toggle.dataset.bound === '1') return
  toggle.dataset.bound = '1'
  toggle.onchange = async () => {
    try {
      await window.pet.setSpeechLearning(toggle.checked)
      showSaved()
    } catch {
      toggle.checked = !toggle.checked
      showToast(t('speech.failed'))
    }
  }
}

function showSaved() {
  const tip = $('saved-tip')
  if (tip !== null) {
    if (savedTipTimer !== null) {
      clearTimeout(savedTipTimer)
      savedTipTimer = null
    }
    tip.classList.remove('show', 'is-error')
  }
  setSaveState('saved')
  showToast(t('save.saved'))
}

/**
 * 未保存：设置是改动即存，所以这里的「未保存」只有一种真实含义——
 * 这次写盘失败了，而且还没重试成功。页头常驻错误态，页脚保留原因。
 */
function showUnsaved(detail = '') {
  const tip = $('saved-tip')
  setSaveState('error', detail)
  if (tip === null) return
  if (savedTipTimer !== null) {
    clearTimeout(savedTipTimer)
    savedTipTimer = null
  }
  tip.textContent = t('foot.unsaved')
  tip.classList.add('show', 'is-error')
  showToast(detail === '' ? t('save.error') : detail, { error: true, duration: 4200 })
}

// 余额模块和聊天都靠这一把钥匙。serviceId / field 要和主进程读的那一对保持一致，
// 改一处就得改两处。
const DEEPSEEK_SERVICE = 'deepseek'
const DEEPSEEK_FIELD = 'api_key'
const QQ_SECRET_SERVICE = 'qq-token'
const QQ_SECRET_FIELD = 'value'

/** QQ 主人名单按逗号 / 中文逗号 / 换行拆分，去空去重。 */
function readQqOwners() {
  const raw = String($('qq-owners')?.value ?? '')
  return [...new Set(raw.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))]
}

/** webhook 专用字段只在 webhook 模式下出现，避免网关模式误填。 */
function updateQqTransportVisibility() {
  const webhook = $('qq-transport')?.value === 'webhook'
  for (const node of document.querySelectorAll('[data-qq-webhook-only]')) {
    node.hidden = !webhook
  }
}

async function refreshQqMask() {
  const label = $('qq-secret-mask')
  if (label === null) return
  try {
    const result = await window.pet.getSecretMasked(QQ_SECRET_SERVICE, QQ_SECRET_FIELD)
    const masked = typeof result?.masked === 'string' ? result.masked : ''
    label.textContent = masked === '' ? t('qq.secretMissing') : `已保存 ${masked}`
  } catch (error) {
    label.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`
  }
}

/** 读回掩码写进提示行。没配是正常状态，写明「未配置」就够。 */
async function refreshDeepSeekMask() {
  const label = $('deepseek-mask')
  if (label === null) return
  try {
    const result = await window.pet.getSecretMasked(DEEPSEEK_SERVICE, DEEPSEEK_FIELD)
    const masked = typeof result?.masked === 'string' ? result.masked : ''
    label.textContent = masked === '' ? t('chat.keyMissing') : `已保存 ${masked}`
  } catch (error) {
    label.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * 递归合并。companion 有若干层嵌套，浅合并会顺手把兄弟字段冲掉。
 * 数组与 null 直接替换，不做元素级合并。
 */
function mergeDeep(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const out = { ...(base !== null && typeof base === 'object' ? base : {}) }
  for (const [key, value] of Object.entries(patch)) {
    out[key] =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? mergeDeep(out[key], value)
        : value
  }
  return out
}

/** 保存增量并回写本地副本。失败时不做乐观更新，避免界面显示假状态。 */
async function patch(partial, options = {}) {
  if (blockInvalidSave()) {
    setSaveState('error', '输入不符合要求')
    return false
  }
  const merged = mergeDeep(current, partial)
  setSaveState('saving')
  try {
    current = await window.pet.saveSettings(merged)
    if (partial.locale !== undefined) {
      applyI18n(current.locale)
      document.title = t('app.title')
    }
    showSaved()
    if (options.applySize === true) {
      await window.pet.applyWindowSize()
    }
    return true
  } catch (error) {
    console.error('[settings] 保存失败', error)
    showUnsaved(error instanceof Error ? error.message : String(error))
    return false
  }
}

/** 贴近时刻滑杆的单位文案；取不到字典就退回中文。 */
function intimacyUnit(key, fallback) {
  const text = window.PetI18n?.t?.(key)
  return typeof text === 'string' && text !== key ? text : fallback
}

/**
 * 缩放读数：倍数 + 换算后的实际像素。
 * 像素按当前比例预设计算（CSS 像素，不含 zoomFactor），拿不到预设时退回竖屏。
 */
function renderScaleLabel(value) {
  const label = $('scale-value')
  if (label === null) return
  const scale = Number(value)
  const profile = $('profile')?.value ?? current?.profile ?? 'vertical'
  const base = SIZE_PROFILES[profile] ?? SIZE_PROFILES.vertical
  label.textContent = `${scale.toFixed(2)} · ${Math.round(base.w * scale)}×${Math.round(base.h * scale)}`
}

/** 滑杆旁边的数字。`<id>-value` 是该滑杆的读数节点。 */
function renderRangeLabel(id, value, digits = 1) {
  const label = $(`${id}-value`)
  if (label === null) return
  label.textContent = Number(value).toFixed(digits)
}

/** 缩放滑杆用百分比读数，比 0.85 这种小数更容易一眼看懂。 */
function renderPercentLabel(id, value) {
  const label = $(`${id}-value`)
  if (label === null) return
  label.textContent = `${Math.round(Number(value) * 100)}%`
}

// 与 packages/shared/src/types/settings.ts 的 DEFAULT_SETTINGS 对齐。
// section 上的 data-reset 按顶层键取这里的值，只覆盖该组涉及的字段。
const DEFAULT_PATCH = {
  nickname: '',
  profile: 'vertical',
  window: { scale: 0.7, alwaysOnTop: true, edgeSnap: true, edgeSnapDistance: 12 },
  bubble: {
    mode: 'rotate',
    fontSize: 14.5,
    radius: 10,
    alpha: 0.92,
    width: 300,
    height: 200,
    padding: 14,
    lineHeight: 1.5,
    fontFamily: '',
    stickerSize: 64,
    background: '',
    backgroundSlice: 12
  },
  live2dModelId: '',
  poseEverySeconds: 60,
  icon: { tray: '', app: '' },
  sticker: { source: '' },
  askHandling: 'pet-all',
  askEveryMinutes: 0,
  uiMode: 'pet',
  soundLevel: 0.5,
  locale: 'zh-CN',
  hudName: '昔涟',
  showHud: false,
  hudDetail: 'full',
  hudAlpha: 0.9,
  hudScale: 1,
  hudFontScale: 1,
  voice: {
    enabled: false,
    trigger: 'proactive',
    quietHours: { enabled: true, start: '22:00', end: '08:00' },
    provider: 'local',
    localUrl: 'http://127.0.0.1:9880',
    localProtocol: 'gpt-sovits',
    refAudioPath: '',
    promptLang: 'zh',
    cloud: { baseUrl: '', voice: '' },
    volume: 1,
    maxChars: 60,
    minIntervalSeconds: 8,
    // 「DSH 语音」：四个场景各管一段，互不牵连，默认全关。
    dshScenes: { reply: false, wakeWord: false, autonomous: false, moments: false },
    readDsh: false
  },
  // 四条轴：默认全开、灵敏度正常；关掉一条就整段不注入。
  'companion.axes': {
    relation: { enabled: true, sensitivity: 'normal' },
    friction: { enabled: true, sensitivity: 'normal' },
    body: { enabled: true, sensitivity: 'normal' },
    memory: { enabled: true, sensitivity: 'normal' },
    proactive: { enabled: true, sensitivity: 'normal' }
  },
  'companion.memory': { enabled: false, maxItems: 500 },
  'companion.persona': { enabled: true, extraPrompt: '', sections: {} },
  'companion.chat': {
    enabled: false,
    provider: 'deepseek',
    model: 'deepseek-chat',
    maxTokens: 800,
    temperature: 0.8,
    historyLimit: 10
  },
  'companion.care': {
    dailyReview: { enabled: false, at: '22:30' },
    // 每天最多花多少 token；0 表示不限。
    dailyTokenBudget: { enabled: false, limit: 0 },
    // 短时间内请求太多时先停一轮；默认每分钟 20 次，正常聊天碰不到。
    requestGuard: { enabled: true, perMinute: 20 },
    // 模型没回上来时用本地句接一句，不写历史。
    offlineReply: { enabled: true }
  },
  'companion.emotion': {
    // 一句话之后心情慢慢回落，不会瞬间归零。
    afterglow: { enabled: false, halfLifeMinutes: 30 },
    // 表情是否跟着心情走：off / experiment（真的换）/ control（只记录）。
    expression: { group: 'off' },
    // 连接、新鲜、成就、休息四类状态，用来决定要不要少说一句。
    needs: { enabled: false }
  },
  'companion.body': {
    enabled: true,
    sleepWindow: { start: '23:30', end: '07:30' },
    cycle: { enabled: false, lastStart: '' }
  },
  presence: {
    aiEnabled: false,
    intervalMinutes: 45,
    city: '',
    useWeather: true,
    quiet: { enabled: true, from: '23:00', to: '08:00', mode: 'urgentOnly', hideHud: false },
    dailyCap: 8,
    silenceDays: 7,
    outline: 'light',
    screen: { enabled: false, consentAsked: false }
  },
  balance: { threshold: 20, intervalMinutes: 30 },
  mail: {
    defaultRecipient: '',
    fromName: '昔涟',
    smtp: { host: '', port: 465, user: '', pass: '' }
  },
  browse: { enabledWrites: [], maxCoinsPerAction: 2 },
  channels: {
    qq: {
      enabled: false,
      transport: 'gateway',
      appId: '',
      credentialRef: 'vault:qq-token',
      ownerOpenIds: [],
      targetOpenId: '',
      publicKey: '',
      webhookPort: 8787,
      imitateFormat: true
    }
  },
  theme: { preset: 'SakuraPink', custom: {} },
  modules: {
    'builtin.bubble': { enabled: true, permissions: ['ui.render'] },
    'builtin.reminder': { enabled: true, permissions: ['memory.read', 'memory.write'] },
    'builtin.balance': { enabled: false, permissions: ['net.egress'] }
  },
  defaultEmotion: 'neutral',
  wakeWords: []
}

/** 「全部恢复默认」覆盖的字段；刻意不动主题、语言、引导状态与模块开关。 */
const RESET_ALL_KEYS = [
  'nickname',
  'profile',
  'window',
  'bubble',
  'live2dModelId',
  'poseEverySeconds',
  'hudName',
  'showHud',
  'hudDetail',
  'hudAlpha',
  'hudScale',
  'hudFontScale',
  'voice',
  'companion.memory',
  'companion.persona'
]

/** 把 a.b.c 这样的路径写进嵌套对象，供 patch 组装分组默认值。 */
function setPath(target, path, value) {
  const parts = path.split('.')
  let cursor = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor[parts[index]] = cursor[parts[index]] ?? {}
    cursor = cursor[parts[index]]
  }
  cursor[parts[parts.length - 1]] = value
}

/**
 * 每个一级分组挂一个「清除本模块设置」。
 * keys 只包含设置项；记忆内容与聊天记录不在这里清，避免和「清空聊天记录」重复。
 */
const MODULE_RESETS = [
  {
    group: 'self',
    panel: 'general',
    keys: [
      'nickname',
      'profile',
      'window',
      'bubble',
      'icon',
      'sticker',
      'live2dModelId',
      'poseEverySeconds',
      'soundLevel',
      'hudName',
      'showHud',
      'hudDetail',
      'hudAlpha',
      'hudScale',
      'hudFontScale',
      'presence.outline',
      'companion.persona'
    ]
  },
  {
    group: 'self',
    panel: 'connection',
    keys: ['voice', 'locale', 'companion.chat', 'wakeWords']
  },
  {
    group: 'company',
    panel: 'proactive',
    keys: ['presence', 'companion.care', 'companion.body']
  },
  { group: 'company', panel: 'axes', keys: ['companion.axes'] },
  { group: 'memory', panel: 'memory', keys: ['companion.memory'] },
  { group: 'ability', panel: 'ability', keys: ['modules', 'balance', 'mail', 'browse'] },
  {
    group: 'system',
    panel: 'account',
    keys: ['channels', 'askHandling', 'askEveryMinutes']
  }
]

/** 四条轴与插件侧 AXIS_KEYS 保持一致；改这里之前先看 lib/companion/index.mjs。 */
const AXIS_KEYS = ['relation', 'friction', 'body', 'memory', 'proactive']

/** 把某一分组的设置恢复成默认；只改设置，不碰聊天记录与记忆内容。 */
async function resetModule(button) {
  const entry = MODULE_RESETS.find((item) => item.group === button.dataset.resetModule)
  if (entry === undefined) return
  if (
    !confirmAction({
      message: t('moduleClear.confirm'),
      strength: 'danger',
      confirmWord: t('moduleClear.confirmWord')
    })
  ) {
    return
  }

  const partial = {}
  for (const key of entry.keys) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_PATCH, key)) {
      setPath(partial, key, DEFAULT_PATCH[key])
    }
  }
  const ok = await patch(partial, { applySize: true })
  if (!ok) return
  await loadSettings()
  renderScaleLabel($('scale').value)
}

/** 在每个分组第一个面板底部补一个模块级危险操作区。 */
function injectModuleResets() {
  for (const entry of MODULE_RESETS) {
    const panel = document.querySelector(`.panel[data-panel="${entry.panel}"]`)
    if (panel === null || panel.querySelector('.module-reset') !== null) continue

    const section = document.createElement('section')
    section.className = 'section module-reset'

    const title = document.createElement('h2')
    title.className = 'section-title'
    title.dataset.i18n = 'moduleClear.title'
    title.textContent = t('moduleClear.title')

    const note = document.createElement('p')
    note.className = 'section-note'
    note.dataset.i18n = `moduleClear.${entry.group}Note`
    note.textContent = t(note.dataset.i18n)

    const zone = document.createElement('div')
    zone.className = 'danger-zone'
    const zoneTitle = document.createElement('div')
    zoneTitle.className = 'danger-title'
    zoneTitle.dataset.i18n = 'moduleClear.danger'
    zoneTitle.textContent = t('moduleClear.danger')

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'danger-btn'
    button.dataset.resetModule = entry.group
    button.dataset.i18n = 'moduleClear.run'
    button.textContent = t('moduleClear.run')
    button.addEventListener('click', () => {
      void resetModule(button)
    })

    zone.append(zoneTitle, button)
    section.append(title, note, zone)
    panel.append(section)
  }
}

/**
 * 恢复出厂设置：主进程负责清数据、写默认设置并重启。
 * 这里只做两次确认和按钮态，失败时把原因留在页脚提示里。
 */
async function factoryReset() {
  if (!confirmAction({ message: t('data.factoryConfirm'), strength: 'normal' })) return
  if (
    !confirmAction({
      message: t('data.factoryConfirm'),
      strength: 'danger',
      confirmWord: t('data.factoryWord')
    })
  ) {
    return
  }

  const button = $('factory-reset')
  if (button !== null) {
    button.disabled = true
    button.textContent = t('data.factoryRunning')
  }
  try {
    const result = await window.pet.factoryReset()
    if (result?.ok !== true) throw new Error(result?.message ?? t('data.factoryFailed'))
  } catch (error) {
    if (button !== null) {
      button.disabled = false
      button.textContent = t('data.factoryRun')
    }
    showUnsaved(error instanceof Error ? error.message : String(error))
  }
}

const LAST_PANEL_KEY = 'pet.settings.panel'

/** 记住最后看的面板。隐私模式或配额满时读写会抛，忽略即可。 */
function rememberPanel(name) {
  try {
    window.localStorage.setItem(LAST_PANEL_KEY, name)
  } catch {
    // 存不下就算了，不影响本次操作
  }
}

function readLastPanel() {
  try {
    return window.localStorage.getItem(LAST_PANEL_KEY)
  } catch {
    return null
  }
}

// 搜索命中的位置，回车 / 上下键按这个顺序跳。
let searchHits = []
let searchCursor = -1

/** 面板自己的名字也参与搜索：搜「记忆」应该能找到整个记忆页。 */
function panelSearchName(panel) {
  const name = panel.dataset.panel
  const meta = PANEL_META[name]
  const group = PANEL_TO_GROUP[name]
  return [meta === undefined ? '' : t(meta.titleKey), group === undefined ? '' : t(PANEL_GROUPS[group].labelKey)]
    .filter((text) => text !== '')
    .join(' ')
}

/** 把一段 section 拆成标题、说明、条目文字与按钮文字，交给纯匹配模块。 */
function readSearchSection(section) {
  const title = section.querySelector(':scope > .section-title')?.textContent ?? ''
  const note = [...section.querySelectorAll(':scope > .section-note')]
    .map((node) => node.textContent ?? '')
    .join(' ')
  const itemEls = [...section.querySelectorAll('.item')]
  const actions = [...section.querySelectorAll('.model-actions button, .model-actions select')].map(
    (node) => node.textContent ?? ''
  )
  return {
    title,
    note,
    actions,
    itemEls,
    items: itemEls.map((node) => node.textContent ?? '')
  }
}

/** 清空搜索高亮与隐藏，恢复完整列表。 */
function clearSearchFilter(restore = true) {
  for (const node of document.querySelectorAll('.is-search-hidden, .is-search-hit')) {
    node.classList.remove('is-search-hidden', 'is-search-hit')
  }
  for (const group of document.querySelectorAll('details.section-group[data-search-opened]')) {
    group.open = false
    delete group.dataset.searchOpened
  }
  for (const button of document.querySelectorAll('#nav button[data-group]')) {
    button.classList.remove('has-search-hit')
  }
  searchHits = []
  searchCursor = -1
  const empty = $('search-empty')
  if (empty !== null) empty.hidden = true
  const count = $('search-count')
  if (count !== null) {
    count.hidden = true
    count.textContent = ''
  }
  if (restore) showPanel(activePanel)
}

/** 跳到第 index 个命中位置，并把它滚到视野中间。 */
function jumpToSearchHit(index) {
  if (searchHits.length === 0) return
  const hit = searchHits[index]
  if (hit === undefined) return
  searchCursor = index
  showPanel(hit.panel)
  const count = $('search-count')
  if (count !== null) count.textContent = `${index + 1}/${searchHits.length}`
  requestAnimationFrame(() => hit.target.scrollIntoView({ block: 'center', behavior: 'auto' }))
}

/** Enter / ↑ / ↓ 在命中项之间移动，不改变输入内容。 */
function stepSearchHit(delta) {
  if (searchHits.length === 0) return
  const next = (searchCursor + delta + searchHits.length) % searchHits.length
  jumpToSearchHit(next)
}

/**
 * 按关键词过滤：面板名、段落标题、说明、按钮和条目文字都参与匹配。
 * 词与词之间用空格分开，多个词同时命中才算。
 */
function runSearch(rawQuery) {
  const tokens = window.SettingsSearch.tokenize(rawQuery)
  if (tokens.length === 0) {
    clearSearchFilter(true)
    return
  }
  clearSearchFilter(false)
  searchHits = []

  let total = 0
  const groupsWithHits = new Set()
  for (const panel of document.querySelectorAll('.panel')) {
    let panelHits = 0
    const nameHit = window.SettingsSearch.matchPanelName(panelSearchName(panel), tokens)
    for (const section of panel.querySelectorAll('.section')) {
      const { title, note, actions, itemEls, items } = readSearchSection(section)
      const result = nameHit
        ? { hit: true, scope: 'section', itemHits: items.map(() => true) }
        : window.SettingsSearch.matchSection({ title, note, actions, items }, tokens)

      itemEls.forEach((item, index) => {
        const matched = result.itemHits[index] === true
        item.classList.toggle('is-search-hidden', !matched)
        item.classList.toggle('is-search-hit', matched)
      })
      section.classList.toggle('is-search-hidden', !result.hit)
      if (!result.hit) continue

      // 命中的 section 可能藏在默认折叠的分组里，先展开，否则等于搜不到
      const group = section.closest('details.section-group')
      if (group !== null && !group.open) {
        group.open = true
        group.dataset.searchOpened = '1'
      }
      panelHits += 1
      const matchedItems = itemEls.filter((_, index) => result.itemHits[index] === true)
      if (matchedItems.length === 0) {
        searchHits.push({ panel: panel.dataset.panel, target: section })
      } else {
        for (const item of matchedItems) searchHits.push({ panel: panel.dataset.panel, target: item })
      }
    }
    panel.classList.toggle('is-search-hidden', panelHits === 0)
    if (panelHits > 0) {
      const group = PANEL_TO_GROUP[panel.dataset.panel]
      if (group !== undefined) groupsWithHits.add(group)
    }
    total += panelHits
  }

  for (const button of document.querySelectorAll('#nav button[data-group]')) {
    button.classList.toggle('has-search-hit', groupsWithHits.has(button.dataset.group))
  }

  const count = $('search-count')
  if (count !== null) {
    count.hidden = false
    count.textContent = total === 0 ? t('nav.searchNone') : String(total)
  }

  const empty = $('search-empty')
  if (total === 0) {
    if (empty !== null) empty.hidden = false
    for (const panel of document.querySelectorAll('.panel')) panel.classList.remove('active')
    for (const button of document.querySelectorAll('#nav button[data-group]')) {
      button.classList.remove('active')
    }
    const subnav = $('subnav')
    if (subnav !== null) subnav.hidden = true
    const groupLabel = $('page-group')
    const title = $('page-title')
    const desc = $('page-desc')
    if (groupLabel !== null) {
      groupLabel.dataset.i18n = 'nav.search'
      groupLabel.textContent = t('nav.search')
    }
    if (title !== null) {
      title.dataset.i18n = 'search.emptyTitle'
      title.textContent = t('search.emptyTitle')
    }
    if (desc !== null) {
      desc.dataset.i18n = 'search.emptyHint'
      desc.textContent = t('search.emptyHint')
    }
    return
  }

  if (empty !== null) empty.hidden = true
  // 输入时就落在第一个命中处，省去再按一次回车；后续用回车 / 上下键继续走。
  jumpToSearchHit(0)
}

/** 把某个 section 涉及的字段恢复成默认值。 */
async function resetSection(button) {
  const keys = (button.dataset.reset ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '' && Object.prototype.hasOwnProperty.call(DEFAULT_PATCH, key))
  if (keys.length === 0) return

  const partial = {}
  for (const key of keys) setPath(partial, key, DEFAULT_PATCH[key])
  const ok = await patch(partial, { applySize: true })
  if (!ok) return
  await loadSettings()
  renderScaleLabel($('scale').value)
}

/** 整窗恢复默认：只覆盖可编辑的外观与陪伴项，不动主题、语言与模块开关。 */
async function resetAllSettings() {
  if (
    !confirmAction({
      message: t('data.resetAllConfirm'),
      strength: 'danger',
      confirmWord: t('data.resetAllWord')
    })
  ) {
    return
  }
  const partial = {}
  for (const key of RESET_ALL_KEYS) setPath(partial, key, DEFAULT_PATCH[key])
  const ok = await patch(partial, { applySize: true })
  if (!ok) return
  await loadSettings()
  renderScaleLabel($('scale').value)
}

/** ISO 时间转本地可读文本；空串或坏值回空串，界面据此显示占位文案。 */
function formatSyncTime(iso) {
  if (typeof iso !== 'string' || iso === '') return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

/**
 * 填写未提交的标记。
 * 这三类输入不会即时落盘：API Key 要按保存，备份口令只在本次导出/恢复时用，
 * 人格额外说明是 change 时自动保存。和 foot.unsaved 的「写盘失败」是两回事。
 */
const pendingInputs = new Set()

function refreshPendingTip() {
  const tip = $('pending-tip')
  if (tip === null) return
  tip.hidden = pendingInputs.size === 0
}

function markPending(id) {
  pendingInputs.add(id)
  refreshPendingTip()
}

function clearPending(id) {
  pendingInputs.delete(id)
  refreshPendingTip()
}

/** 给还没有恢复按钮的主要分组补一个；已有按钮的分组不重复注入。 */
const SECTION_RESET_DEFAULTS = [
  ['general.model', 'live2dModelId'],
  ['general.hud', 'hudName,showHud,hudDetail,hudAlpha,hudScale,hudFontScale'],
  ['voice.title', 'voice'],
  ['memory.title', 'companion.memory'],
  ['persona.title', 'companion.persona']
]

function injectSectionResets() {
  for (const [titleKey, keys] of SECTION_RESET_DEFAULTS) {
    const title = document.querySelector(`.section-title[data-i18n="${titleKey}"]`)
    const section = title?.closest('.section')
    if (section === null || section === undefined) continue
    if (section.querySelector('.section-reset') !== null) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'section-reset'
    button.dataset.reset = keys
    button.dataset.i18n = 'general.reset'
    button.textContent = t('general.reset')
    button.addEventListener('click', () => {
      void resetSection(button)
    })
    section.append(button)
  }
}

/** 从 packs 清单里找 pack:<id>:<file> 对应的条目。 */
function findPackItem(kind, value) {
  const match = /^pack:([^:]+):(.+)$/.exec(value ?? '')
  if (match === null) return null
  const [, id, file] = match
  const pack = packs.find((item) => item.id === id)
  return (pack?.files?.[kind] ?? []).find((item) => item.file === file) ?? null
}

/** 气泡预览：把当前滑杆与素材选择直接映射到示例气泡上。 */
function renderBubblePreview() {
  const balloon = $('bubble-preview-balloon')
  if (balloon === null) return

  const fontSize = Number($('bubble-fontSize')?.value ?? 14.5)
  const radius = Number($('bubble-radius')?.value ?? 10)
  const alpha = Number($('bubble-alpha')?.value ?? 0.92)
  balloon.style.fontSize = `${fontSize}px`
  // 宽度 0 = 跟随预览容器；非 0 时按设置值收窄，和主界面的 max-width 同一套语义。
  const previewWidth = Number($('bubble-width')?.value ?? 300)
  balloon.style.maxWidth = previewWidth > 0 ? `${previewWidth}px` : '100%'
  balloon.style.borderRadius = `${radius}px`
  balloon.style.opacity = String(alpha)

  const background = findPackItem('bubble', $('bubble-background')?.value ?? '')
  balloon.style.backgroundImage = background === null ? '' : `url("${background.url}")`
  balloon.classList.toggle('has-background', background !== null)

  const font = findPackItem('font', $('bubble-font')?.value ?? '')
  balloon.style.fontFamily = font?.family ?? ''
  balloon.classList.toggle('has-font', font !== null)

  // 切片与底图同一处回显：预览用九宫格边框图，改切片立刻能看到四角变化
  const slice = Number($('bubble-slice')?.value ?? 12)
  balloon.style.setProperty('--preview-slice', `${Number.isFinite(slice) ? slice : 12}px`)
  balloon.style.setProperty(
    '--preview-image',
    background === null ? 'none' : `url("${background.url}")`
  )

  // 贴纸跟着下拉走；没选就收起，避免留下一张过期的图
  const sticker = findPackItem('emoji', $('sticker-source')?.value ?? '')
  const stickerImage = $('bubble-preview-sticker')
  if (stickerImage !== null) {
    stickerImage.hidden = sticker === null
    stickerImage.src = sticker === null ? '' : sticker.url
  }
}

async function loadSettings() {
  current = await window.pet.getSettings()
  applyI18n(current.locale ?? 'zh-CN')
  document.title = t('app.title')

  $('nickname').value = current.nickname ?? ''
  applyTheme(current.theme?.preset ?? 'SakuraPink')

  const profile = current.profile ?? 'vertical'
  $('profile').value = profile === 'custom' ? 'vertical' : profile

  const scale = Number(current.window?.scale ?? 0.7)
  $('scale').value = String(scale)
  renderScaleLabel(scale)

  $('alwaysOnTop').checked = Boolean(current.window?.alwaysOnTop)
  $('edgeSnap').checked = Boolean(current.window?.edgeSnap)
  $('edgeSnapDistance').value = String(current.window?.edgeSnapDistance ?? 12)

  // 换立绘间隔：下拉只有五档，旧配置里的其他数字归一到最近的可选档。
  const poseOptions = [0, 30, 60, 120, 300]
  const rawPoseEvery = Number(current.poseEverySeconds ?? 60)
  const poseEvery = poseOptions.includes(rawPoseEvery)
    ? rawPoseEvery
    : poseOptions.reduce(
        (best, item) =>
          Math.abs(item - rawPoseEvery) < Math.abs(best - rawPoseEvery) ? item : best,
        60
      )
  $('poseEverySeconds').value = String(poseEvery)

  // 描边：只认三个值，其余按白边显示，和主进程的迁移保持一致。
  const outline = current.presence?.outline
  $('presence-outline').value = outline === 'dark' || outline === 'auto' ? outline : 'light'

  // 气泡
  const bubble = current.bubble ?? {}
  $('bubble-mode').value = bubble.mode ?? 'rotate'
  $('bubble-fontSize').value = String(bubble.fontSize ?? 14.5)
  renderRangeLabel('bubble-fontSize', bubble.fontSize ?? 14.5, 1)
  $('bubble-radius').value = String(bubble.radius ?? 10)
  renderRangeLabel('bubble-radius', bubble.radius ?? 10, 0)
  /* 停留时长两个滑杆：控件在才填。缺了也直接往下走，
     免得一个 TypeError 把后面 HUD、模块、配色的填充一起带走。 */
  const holdControl = $('bubble-holdSeconds')
  if (holdControl !== null) {
    holdControl.value = String(bubble.holdSeconds ?? 8)
    renderRangeLabel('bubble-holdSeconds', bubble.holdSeconds ?? 8, 0)
  }
  const noticeControl = $('bubble-noticeHoldSeconds')
  if (noticeControl !== null) {
    noticeControl.value = String(bubble.noticeHoldSeconds ?? 10)
    renderRangeLabel('bubble-noticeHoldSeconds', bubble.noticeHoldSeconds ?? 10, 0)
  }
  $('bubble-alpha').value = String(bubble.alpha ?? 0.92)
  renderRangeLabel('bubble-alpha', bubble.alpha ?? 0.92, 2)
  $('bubble-width').value = String(bubble.width ?? 300)
  renderRangeLabel('bubble-width', bubble.width ?? 300, 0)
  $('bubble-stickerSize').value = String(bubble.stickerSize ?? 64)
  renderRangeLabel('bubble-stickerSize', bubble.stickerSize ?? 64, 0)

  // HUD：showHud 是唯一显隐真源；老配置里的 off 视为关闭。
  const hudOff = current.hudDetail === 'off'
  $('hudName').value = current.hudName ?? '昔涟'
  $('showHud').checked = current.showHud === true && !hudOff
  // 老配置里的 simple 就是新的「紧凑」档，off 归一到紧凑，避免下拉框空着。
  $('hudDetail').value =
    current.hudDetail === 'simple' || hudOff ? 'compact' : (current.hudDetail ?? 'compact')
  $('hudAlpha').value = String(current.hudAlpha ?? 0.9)
  renderRangeLabel('hudAlpha', current.hudAlpha ?? 0.9, 2)
  $('hudScale').value = String(current.hudScale ?? 1)
  renderPercentLabel('hudScale', current.hudScale ?? 1)
  $('hudFontScale').value = String(current.hudFontScale ?? 1)
  renderPercentLabel('hudFontScale', current.hudFontScale ?? 1)

  // 模块开关
  const modules = current.modules ?? {}
  $('module-bubble').checked = modules['builtin.bubble']?.enabled !== false
  $('module-reminder').checked = modules['builtin.reminder']?.enabled !== false
  $('module-balance').checked = modules['builtin.balance']?.enabled === true

  // 语音：缺字段一律按「不出声」处理，避免旧配置被误读成开着
  const voice = current.voice ?? {}
  $('voice-enabled').checked = voice.enabled === true
  $('voice-trigger').value = voice.trigger ?? 'proactive'

  const quiet = voice.quietHours ?? {}
  $('voice-quiet-enabled').checked = quiet.enabled !== false
  $('voice-quiet-start').value = quiet.start ?? '22:00'
  $('voice-quiet-end').value = quiet.end ?? '08:00'

  // 本地合成：地址只连回环，参考音频空着就静默不出声。
  $('voice-local-url').value = voice.localUrl ?? 'http://127.0.0.1:9880'
  $('voice-ref-audio').value = voice.refAudioPath ?? ''
  const promptTextEl = $('voice-prompt-text')
  if (promptTextEl !== null) promptTextEl.value = voice.promptText ?? ''
  $('voice-volume').value = String(voice.volume ?? 1)
  renderRangeLabel('voice-volume', voice.volume ?? 1, 2)
  $('voice-max-chars').value = String(voice.maxChars ?? 60)
  $('voice-min-interval').value = String(voice.minIntervalSeconds ?? 8)
  // 四个场景各点各的灯；老配置里只有 readDsh，第一盏灯替它亮起来。
  const dshScenes = { reply: false, wakeWord: false, autonomous: false, moments: false, ...(voice.dshScenes ?? {}) }
  if (dshScenes.reply !== true && voice.readDsh === true) dshScenes.reply = true
  $('voice-dsh-reply').checked = dshScenes.reply === true
  $('voice-dsh-wake').checked = dshScenes.wakeWord === true
  $('voice-dsh-autonomous').checked = dshScenes.autonomous === true
  $('voice-dsh-moments').checked = dshScenes.moments === true
  $('voice-wake-words').value = Array.isArray(voice.voiceWakeWords)
    ? voice.voiceWakeWords.join('、')
    : ''

  // 语言
  $('locale').value = current.locale ?? 'zh-CN'

  // 唤醒词：空值在输入框里也留空，提示行会说明默认是哪几个。
  $('chat-wake-words').value = Array.isArray(current.wakeWords)
    ? current.wakeWords.join('、')
    : ''

  // 主动台词
  const presence = current.presence ?? {}
  $('presence-ai-enabled').checked = presence.aiEnabled === true
  $('presence-interval').value = String(presence.intervalMinutes ?? 45)
  $('presence-city').value = presence.city ?? ''
  $('presence-owner-city').value = presence.ownerCity ?? ''
  $('presence-owner-autolocate').checked = presence.ownerAutoLocate !== false
  $('presence-daily-cap').value = String(presence.dailyCap ?? 8)
  $('presence-silence-days').value = String(presence.silenceDays ?? 7)
  // 默认开着天气：这是「结合此刻」里最直观的一项。
  $('presence-weather').checked = presence.useWeather !== false
  // 识屏默认关；只有用户自己在这里打开过才会读。
  $('presence-screen').checked = presence.screen?.enabled === true

  const quietSettings = presence.quiet ?? {}
  $('quiet-enabled').checked = quietSettings.enabled === true
  $('quiet-from').value = typeof quietSettings.from === 'string' ? quietSettings.from : '23:00'
  $('quiet-to').value = typeof quietSettings.to === 'string' ? quietSettings.to : '08:00'
  // 只认三种已知方式；旧配置或手改出错时回落到「保留提醒」。
  $('quiet-mode').value =
    quietSettings.mode === 'silent' || quietSettings.mode === 'reduce'
      ? quietSettings.mode
      : 'urgentOnly'
  $('quiet-hide-hud').checked = quietSettings.hideHud === true

  // 陪伴：每日复盘（界面只保留这一项真的会跑的任务）
  const companion = current.companion ?? {}
  const care = companion.care ?? {}

  $('care-daily-review-enabled').checked = care.dailyReview?.enabled === true
  $('care-daily-review-at').value = care.dailyReview?.at ?? '22:30'

  // 每日额度：0 表示不限，界面照实显示。
  const budget = care.dailyTokenBudget ?? {}
  const budgetEnabled = $('care-budget-enabled')
  const budgetLimit = $('care-budget-limit')
  if (budgetEnabled !== null) budgetEnabled.checked = budget.enabled === true
  if (budgetLimit !== null) budgetLimit.value = String(budget.limit ?? 0)

  // 请求守门与离线兜底：默认开着；关掉就完全按旧路径走。
  const guard = care.requestGuard ?? {}
  const guardEnabled = $('care-guard-enabled')
  const guardPerMinute = $('care-guard-per-minute')
  const offlineEnabled = $('care-offline-enabled')
  if (guardEnabled !== null) guardEnabled.checked = guard.enabled !== false
  if (guardPerMinute !== null) guardPerMinute.value = String(guard.perMinute ?? 20)
  if (offlineEnabled !== null) offlineEnabled.checked = care.offlineReply?.enabled !== false

  // 情绪与需求：默认都关着，打开才影响表情和开口分寸。
  const emotionConfig = companion.emotion ?? {}
  const afterglow = emotionConfig.afterglow ?? {}
  const expressionConfig = emotionConfig.expression ?? {}
  const needs = emotionConfig.needs ?? {}
  const afterglowEnabled = $('emotion-afterglow-enabled')
  const afterglowHalfLife = $('emotion-afterglow-half-life')
  const expressionGroup = $('emotion-expression-group')
  const needsEnabled = $('emotion-needs-enabled')
  if (afterglowEnabled !== null) afterglowEnabled.checked = afterglow.enabled === true
  if (afterglowHalfLife !== null) afterglowHalfLife.value = String(afterglow.halfLifeMinutes ?? 30)
  if (expressionGroup !== null) expressionGroup.value = expressionConfig.group ?? 'off'
  if (needsEnabled !== null) needsEnabled.checked = needs.enabled === true

  // 四条轴：没配过按「开、正常」显示，不把缺省值写进界面。
  const axesConfig = companion.axes ?? {}
  for (const key of AXIS_KEYS) {
    const axis = axesConfig[key] ?? {}
    const enabledInput = $(`axis-${key}-enabled`)
    const sensitivitySelect = $(`axis-${key}-sensitivity`)
    if (enabledInput !== null) enabledInput.checked = axis.enabled !== false
    if (sensitivitySelect !== null) sensitivitySelect.value = axis.sensitivity ?? 'normal'
  }

  // 记忆
  const memory = companion.memory ?? {}
  $('memory-enabled').checked = memory.enabled === true
  $('memory-max-items').value = String(memory.maxItems ?? 500)

  // 聊天
  const chat = companion.chat ?? {}
  $('chat-enabled').checked = chat.enabled === true
  $('chat-model').value = chat.model ?? 'deepseek-chat'
  $('chat-max-tokens').value = String(chat.maxTokens ?? 800)
  $('chat-temperature').value = String(chat.temperature ?? 0.8)
  renderRangeLabel('chat-temperature', chat.temperature ?? 0.8, 1)
  $('chat-history-limit').value = String(chat.historyLimit ?? 10)

  // 人格
  const persona = companion.persona ?? {}
  $('persona-enabled').checked = persona.enabled !== false
  $('persona-extra').value = persona.extraPrompt ?? ''
  for (const key of PERSONA_SECTIONS) {
    const field = personaField(key)
    if (field !== null) field.value = persona.sections?.[key] ?? ''
    updatePersonaSectionCount(key)
  }
  updatePersonaCount()
  void renderPersonaPreview()

  // 贴近时刻：开关 + 两个节奏滑杆；次数与冷却由主进程按版本固定。
  const intimacy = companion.intimacy ?? {}
  $('intimacy-enabled').checked = intimacy.enabled === true
  const idleHours = Number(intimacy.idleHours ?? 6)
  $('intimacy-idle').value = String(idleHours)
  $('intimacy-idle-value').textContent = `${idleHours} ${intimacyUnit('persona.intimacyHoursUnit', '小时')}`
  const aftercareMinutes = Number(intimacy.aftercareMinutes ?? 120)
  $('intimacy-aftercare').value = String(aftercareMinutes)
  $('intimacy-aftercare-value').textContent =
    `${aftercareMinutes} ${intimacyUnit('persona.intimacyMinutesUnit', '分钟')}`

  // QQ：凭据本体在 Vault，这里只回显 appId、主人名单与传输方式。
  const qq = current.channels?.qq ?? {}
  $('qq-enabled').checked = qq.enabled === true
  $('qq-privacy-mode').checked = qq.privacyMode !== false
  $('memory-privacy-mode').checked = qq.privacyMode !== false
  $('qq-imitate-format').checked = qq.imitateFormat !== false
  $('qq-transport').value = qq.transport === 'webhook' ? 'webhook' : 'gateway'
  updateQqTransportVisibility()
  $('qq-app-id').value = qq.appId ?? ''
  $('qq-owners').value = Array.isArray(qq.ownerOpenIds) ? qq.ownerOpenIds.join(', ') : ''
  $('qq-target').value = qq.targetOpenId ?? ''
  $('qq-public-key').value = qq.publicKey ?? ''
  $('qq-port').value = String(qq.webhookPort ?? 8787)

  await refreshModels()
  await refreshDeepSeekMask()
  await refreshQqMask()
  await refreshMemoryStats()
  await refreshCareStatus()
}

/** 立绘区：拉模型列表填下拉，并把「装了没 / 可用几个 / 放在哪」写清楚。 */
async function refreshModels() {
  const select = $('live2d-model')
  const status = $('model-status')
  try {
    const result = await window.pet.listModels()
    if (result?.ok !== true) {
      status.textContent = `读取模型失败：${result?.message ?? '未知原因'}`
      return
    }

    const models = Array.isArray(result.models) ? result.models : []
    const activeId = current?.live2dModelId ?? ''

    select.innerHTML = ''
    const none = document.createElement('option')
    none.value = ''
    none.textContent = t('general.modelNone')
    select.appendChild(none)

    for (const model of models) {
      const option = document.createElement('option')
      option.value = model.id
      option.textContent = model.valid ? model.name : `${model.name}（不可用）`
      option.disabled = model.valid !== true
      select.appendChild(option)
    }
    select.value = models.some((model) => model.id === activeId) ? activeId : ''

    if (models.length === 0) {
      status.textContent = t('general.modelEmpty')
    } else {
      const usable = models.filter((model) => model.valid).length
      status.textContent = `已导入 ${models.length} 个模型，其中 ${usable} 个可用。目录：${result.root}`
    }

    renderModelGrid(models)
  } catch (error) {
    status.textContent = `读取模型失败：${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * 立绘缩略图：只画带 preview 的模型，没有预览图就不占位置。
 * 点击写回下拉框，仍然走同一条 setActiveModel 路径。
 */
function renderModelGrid(models) {
  const grid = $('model-grid')
  const select = $('live2d-model')
  if (grid === null || select === null) return
  grid.replaceChildren()

  const withPreview = models.filter(
    (model) => typeof model.preview === 'string' && model.preview !== ''
  )
  if (withPreview.length === 0) return

  for (const model of withPreview) {
    const tile = document.createElement('button')
    tile.type = 'button'
    tile.className = 'asset-tile'
    tile.dataset.value = model.id
    tile.title = model.valid ? model.name : `${model.name}（不可用）`
    tile.disabled = model.valid !== true

    const image = document.createElement('img')
    image.src = model.preview
    image.alt = model.name
    image.loading = 'lazy'

    const label = document.createElement('span')
    label.textContent = model.name

    tile.append(image, label)
    tile.addEventListener('click', () => {
      if (model.valid !== true) return
      select.value = model.id
      syncModelGridActive()
      select.dispatchEvent(new Event('change'))
    })
    grid.append(tile)
  }

  syncModelGridActive()
}

function syncModelGridActive() {
  const grid = $('model-grid')
  const select = $('live2d-model')
  if (grid === null || select === null) return
  for (const tile of grid.querySelectorAll('.asset-tile')) {
    tile.classList.toggle('is-active', tile.dataset.value === select.value)
  }
}

/** 记忆统计：接口缺失写「尚未接入」，加密不可用写「不可用」，不写假的 0。 */
async function refreshMemoryStats() {
  const count = $('memory-count')
  const updated = $('memory-updated')
  if (typeof window.pet.getMemoryStats !== 'function') {
    count.textContent = '尚未接入'
    updated.textContent = '—'
    return
  }
  try {
    const stats = await window.pet.getMemoryStats()
    if (stats?.available === false) {
      count.textContent = '不可用（加密仓库未装配）'
      updated.textContent = '—'
      return
    }
    count.textContent = `${stats?.count ?? 0} / ${stats?.limit ?? '—'}`
    updated.textContent = stats?.updatedAt ?? '尚未写入'
  } catch (error) {
    count.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`
  }
}

const MEMORY_PAGE_SIZE = 20
let memoryOffset = 0
let memoryQuery = ''
let memoryRole = ''
let memoryFrom = ''
let memoryTo = ''
let memoryTotal = 0

/** 是否有任何筛选条件；决定空态文案与「条匹配」单位。 */
function memoryFiltering() {
  return memoryQuery !== '' || memoryRole !== '' || memoryFrom !== '' || memoryTo !== ''
}

/** 记忆列表：最新在前，只显示文本；渲染用 textContent，不拼 HTML。 */
async function refreshMemoryList() {
  const box = $('memory-list')
  const page = $('memory-page')
  if (box === null) return

  if (typeof window.pet.listMemory !== 'function') {
    box.textContent = t('memory.unsupported')
    if (page !== null) page.textContent = '—'
    return
  }

  try {
    const result = await window.pet.listMemory({
      offset: memoryOffset,
      limit: MEMORY_PAGE_SIZE,
      query: memoryQuery,
      role: memoryRole,
      from: memoryFrom,
      to: memoryTo
    })
    if (result?.ok === false) {
      memoryTotal = 0
      box.textContent =
        result.reason === 'vault-unavailable' ? t('memory.vaultUnavailable') : t('memory.readFailed')
      if (page !== null) page.textContent = '—'
      return
    }

    const items = Array.isArray(result?.items) ? result.items : []
    memoryTotal = Number.isFinite(Number(result?.total)) ? Number(result.total) : 0
    box.textContent = ''

    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'memory-empty'
      empty.textContent =
        memoryTotal !== 0
          ? t('memory.emptyPage')
          : t(memoryFiltering() ? 'memory.emptyMatch' : 'memory.emptyTotal')
      box.append(empty)
    }

    for (const item of items) {
      const row = document.createElement('div')
      row.className = 'memory-row'

      const meta = document.createElement('div')
      meta.className = 'memory-meta'
      const when = typeof item.at === 'string' && item.at !== '' ? item.at : t('memory.timeUnknown')
      meta.textContent = `${item.role === 'user' ? t('memory.you') : t('memory.her')} · ${when}`

      const text = document.createElement('div')
      text.className = 'memory-text'
      text.textContent = typeof item.text === 'string' ? item.text : ''

      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = t('memory.delete')
      remove.addEventListener('click', () => {
        void deleteMemoryEntry(item.id)
      })

      row.append(meta, text, remove)
      box.append(row)
    }

    if (page !== null) {
      const pages = Math.max(1, Math.ceil(memoryTotal / MEMORY_PAGE_SIZE))
      const currentPage = Math.floor(memoryOffset / MEMORY_PAGE_SIZE) + 1
      const unit = t(memoryFiltering() ? 'memory.pageUnitMatch' : 'memory.pageUnit')
      page.textContent = `${t('memory.pagePrefix')}${currentPage}${t('memory.pageMiddle')}${pages}${t(
        'memory.pageSuffix'
      )} · ${memoryTotal}${unit}`
    }
  } catch (error) {
    box.textContent = `${t('memory.readFailed')}：${
      error instanceof Error ? error.message : String(error)
    }`
    if (page !== null) page.textContent = '—'
  }
}

/** 来源标签：桌面 / QQ 私聊 / QQ 群聊 / 共同。 */
function factScopeLabel(scope) {
  if (scope === 'shared') return '共同'
  if (scope === 'desktop') return '桌面'
  if (scope.startsWith('qq:group')) return 'QQ 群聊'
  if (scope.startsWith('qq:')) return 'QQ 私聊'
  return '其他'
}

/**
 * 结构化事实：偏好 / 人物 / 项目 / 约定。
 * 可按来源与分类筛选；每条都能就地改文字或删掉。
 */
async function refreshMemoryFacts() {
  const box = $('memory-facts-list')
  if (box === null) return
  if (typeof window.pet.getMemoryFacts !== 'function') {
    box.textContent = t('memory.unsupported')
    return
  }
  const scopeSelect = $('memory-facts-scope')
  const kindSelect = $('memory-facts-kind')
  const scope = scopeSelect === null ? 'all' : scopeSelect.value
  const kind = kindSelect === null ? '' : kindSelect.value
  try {
    const result = await window.pet.getMemoryFacts({ scope, kind })
    const active = $('memory-facts-active')
    const archived = $('memory-facts-archived')
    if (active !== null) active.textContent = String(result?.active ?? 0)
    if (archived !== null) archived.textContent = String(result?.archived ?? 0)
    if (result?.ok === false) {
      box.textContent = t('memory.factsUnavailable')
      return
    }

    const items = Array.isArray(result?.facts) ? result.facts : []
    box.textContent = ''
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'memory-empty'
      empty.textContent = t('memory.factsEmpty')
      box.append(empty)
      return
    }

    const kindLabel = {
      lesson: t('memory.factKindLesson'),
      preference: t('memory.factKindPreference'),
      person: t('memory.factKindPerson'),
      project: t('memory.factKindProject'),
      promise: t('memory.factKindPromise'),
      knowledge: t('memory.factKindKnowledge')
    }
    for (const item of items) {
      const row = document.createElement('div')
      row.className = 'memory-row'
      row.style.opacity = item.archived === true ? '0.55' : '1'

      const meta = document.createElement('div')
      meta.className = 'memory-meta'
      const kindName = kindLabel[item.kind] ?? String(item.kind ?? '')
      const strength = Number(item.strength ?? 0).toFixed(1)
      const marks = [`${factScopeLabel(String(item.scope ?? 'desktop'))} · ${kindName} · ${strength}`]
      if (item.mentions > 1) marks.push(t('memory.factMentions').replace('{count}', String(item.mentions)))
      if (item.archived === true) marks.push(t('memory.factArchived'))
      meta.textContent = marks.join(' · ')

      const text = document.createElement('div')
      text.className = 'memory-text'
      text.textContent = typeof item.text === 'string' ? item.text : ''

      // 这条是从哪句话来的：把原话留在下面，方便回头核对，也方便发现她记岔了。
      const quote = typeof item.evidence === 'string' ? item.evidence.trim() : ''
      const evidence = document.createElement('div')
      evidence.className = 'memory-evidence'
      if (quote !== '') {
        evidence.textContent = t('memory.factEvidence').replace('{quote}', quote)
        evidence.title = quote
      }

      const actions = document.createElement('div')
      actions.className = 'memory-actions'

      // 就地改：点一下进入可编辑，再点一下保存。不做弹窗，避免打断。
      let editing = false
      const editBtn = document.createElement('button')
      editBtn.type = 'button'
      editBtn.textContent = '改'
      editBtn.addEventListener('click', async () => {
        if (!editing) {
          editing = true
          editBtn.textContent = '保存'
          text.contentEditable = 'true'
          text.classList.add('memory-text-editing')
          text.focus()
          const range = document.createRange()
          range.selectNodeContents(text)
          const selection = window.getSelection()
          if (selection !== null) {
            selection.removeAllRanges()
            selection.addRange(range)
          }
          return
        }
        const next = text.textContent.trim()
        if (next === '') {
          text.textContent = typeof item.text === 'string' ? item.text : ''
          return
        }
        if (typeof window.pet.updateMemoryFact !== 'function') return
        const saved = await window.pet.updateMemoryFact(item.id, next).catch(() => null)
        editing = false
        text.contentEditable = 'false'
        text.classList.remove('memory-text-editing')
        editBtn.textContent = '改'
        if (saved?.ok !== true) {
          text.textContent = typeof item.text === 'string' ? item.text : ''
        }
        refreshMemoryFacts()
      })

      const deleteBtn = document.createElement('button')
      deleteBtn.type = 'button'
      deleteBtn.textContent = '删'
      deleteBtn.addEventListener('click', async () => {
        if (
          !confirmAction({
            message: `删掉这条记忆？\n\n${String(item.text ?? '').slice(0, 80)}`,
            strength: 'danger',
            confirmWord: '删除'
          })
        ) {
          return
        }
        if (typeof window.pet.removeMemoryFact !== 'function') return
        const removed = await window.pet.removeMemoryFact(item.id).catch(() => null)
        if (removed?.ok !== true) {
          showToast('这条记忆没删掉，稍后再试', { error: true })
          return
        }
        showToast('已删除')
        refreshMemoryFacts()
      })

      actions.append(editBtn, deleteBtn)
      row.append(meta, text, evidence, actions)
      box.append(row)
    }
  } catch (error) {
    box.textContent = `${t('memory.readFailed')}：${
      error instanceof Error ? error.message : String(error)
    }`
  }
}

async function exportMemory() {
  const status = $('memory-export-status')
  if (typeof window.pet.exportMemory !== 'function') return
  try {
    const result = await window.pet.exportMemory({
      query: memoryQuery,
      role: memoryRole,
      from: memoryFrom,
      to: memoryTo
    })
    if (result?.canceled === true) return
    if (result?.ok !== true) {
      if (status !== null) {
        status.textContent =
          result?.code === 'MEMORY_EMPTY'
            ? t('memory.exportEmpty')
            : `${t('memory.exportFailed')} · ${result?.message ?? result?.code ?? ''}`
      }
      return
    }
    if (status !== null) status.textContent = `${t('memory.exported')} · ${result.path}`
  } catch (error) {
    if (status !== null) {
      status.textContent = `${t('memory.exportFailed')} · ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}

/** 删除单条：删完按剩余总数修正页码，再刷新统计与列表。 */
async function deleteMemoryEntry(id) {
  if (typeof window.pet.deleteMemory !== 'function') return
  if (
    !confirmAction({
      message: '删掉这条对话记忆？摘要与原文会一起移除，无法恢复。',
      strength: 'danger',
      confirmWord: '删除'
    })
  ) {
    return
  }
  try {
    const result = await window.pet.deleteMemory(id)
    if (result?.ok === false && result.reason !== 'not-found') {
      showToast('这条记忆没删掉，稍后再试', { error: true })
      return
    }
    showToast('已删除')
    if (memoryOffset > 0 && memoryTotal <= memoryOffset + 1) {
      memoryOffset = Math.max(0, memoryOffset - MEMORY_PAGE_SIZE)
    }
    await refreshMemoryStats()
    await refreshMemoryFacts()
    await refreshMemoryList()
  } catch {
    // 删除失败时保持现状；下一次刷新会显示真实结果。
  }
}

/** 字节数只用于体检展示，不做精确单位换算。 */
function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let scaled = bytes
  let index = 0
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024
    index += 1
  }
  return `${scaled.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const VOICE_PROVIDER_LABEL = { off: '关闭', local: '本地', cloud: '云端' }

/** 启动前体检：只展示主进程返回的真实字段，缺项写「不可用」。 */
async function refreshPreflight() {
  const fields = ['chat', 'models', 'secret', 'voice', 'disk', 'vault', 'memory']
  if (typeof window.pet.preflight !== 'function') {
    for (const field of fields) {
      const element = $(`preflight-${field}`)
      if (element !== null) element.textContent = '尚未接入'
    }
    return
  }

  try {
    const info = await window.pet.preflight()
    if (info?.ok !== true) {
      for (const field of fields) {
        const element = $(`preflight-${field}`)
        if (element !== null) element.textContent = '检查失败'
      }
      return
    }

    const chat = info.chat ?? {}
    $('preflight-chat').textContent =
      chat.historyPersisted === true
        ? `已加密落盘 · ${chat.historyCount ?? 0} 条`
        : `仅内存 · ${chat.historyCount ?? 0} 条`

    const models = info.models ?? {}
    $('preflight-models').textContent =
      typeof models.error === 'string'
        ? '不可用'
        : models.count > 0
          ? `${models.count} 个${models.activeValid ? ' · 当前可用' : ' · 当前未选中或不可用'}`
          : '未导入'

    const secret = info.secret ?? {}
    $('preflight-secret').textContent =
      typeof secret.error === 'string'
        ? '不可用'
        : secret.configured === true
          ? `已配置 ${secret.masked ?? ''}`.trim()
          : '未配置'

    const voice = info.voice ?? {}
    $('preflight-voice').textContent = `${VOICE_PROVIDER_LABEL[voice.provider] ?? voice.provider ?? '—'}${voice.endpointConfigured === true ? ' · 地址已填' : ' · 地址未填'}`

    const disk = info.disk ?? {}
    $('preflight-disk').textContent = Number.isFinite(disk.freeBytes)
      ? `剩余 ${formatBytes(disk.freeBytes)} / 共 ${formatBytes(disk.totalBytes)}`
      : '不可用'

    $('preflight-vault').textContent = describeKeyRingState(info.vault)

    const memory = info.memory ?? {}
    $('preflight-memory').textContent =
      memory.available === false ? '不可用' : `${memory.count ?? 0} / ${memory.limit ?? '—'}`
  } catch (error) {
    for (const field of fields) {
      const element = $(`preflight-${field}`)
      if (element !== null) element.textContent = '检查失败'
    }
    console.error('[settings] 体检读取失败', error)
  }
}

/** 今日日程：只读「现在 / 接下来」；还没生成时给一句说明，不造内容。 */
async function refreshAgenda() {
  const box = $('companion-agenda-note')
  if (box === null) return
  if (typeof window.pet.companionAgenda !== 'function') {
    box.textContent = t('companion.agendaEmpty')
    return
  }
  try {
    const result = await window.pet.companionAgenda()
    const note = result?.ok === true && typeof result.note === 'string' ? result.note.trim() : ''
    box.textContent = note !== '' ? note : t('companion.agendaEmpty')
  } catch {
    box.textContent = t('companion.agendaEmpty')
  }
}

/** 手动顺延：改不改由主进程判断，这里只把结果翻译成一句人话。 */
async function delayAgenda() {
  const status = $('companion-agenda-status')
  if (typeof window.pet.rescheduleAgenda !== 'function') return
  if (status !== null) status.textContent = ''
  try {
    const result = await window.pet.rescheduleAgenda(30)
    if (result?.ok !== true) {
      if (status !== null) status.textContent = t('companion.agendaFailed')
      return
    }
    if (status !== null) {
      if (result.changed === true) {
        status.textContent = t('companion.agendaShifted')
      } else {
        const reason = result.reason
        const key =
          reason === 'disabled'
            ? 'companion.agendaDisabled'
            : reason === 'no-agenda'
              ? 'companion.agendaMissing'
              : reason === 'sleeping'
                ? 'companion.agendaSleeping'
                : reason === 'no-room'
                  ? 'companion.agendaNoRoom'
                  : reason === 'rejected'
                    ? 'companion.agendaRejected'
                    : 'companion.agendaNotChanged'
        status.textContent = t(key)
      }
    }
    await refreshAgenda()
  } catch {
    if (status !== null) status.textContent = t('companion.agendaFailed')
  }
}

/** 概览：只汇总已经读得到的三种状态，读不到就写「还没读到」。 */
async function refreshOverview() {
  const model = $('overview-model')
  const voice = $('overview-voice')
  const agenda = $('overview-agenda')
  if (model === null && voice === null && agenda === null) return

  if (typeof window.pet.preflight === 'function') {
    try {
      const info = await window.pet.preflight()
      const models = info?.ok === true ? (info.models ?? {}) : null
      const secret = info?.ok === true ? (info.secret ?? {}) : null
      const speech = info?.ok === true ? (info.voice ?? {}) : null
      if (model !== null) {
        model.textContent =
          models !== null && models.count > 0 && models.activeValid === true && secret?.configured === true
            ? t('overview.modelReady')
            : t('overview.modelMissing')
      }
      if (voice !== null) {
        const provider = speech?.provider
        voice.textContent =
          typeof provider === 'string' && provider !== 'off'
            ? (VOICE_PROVIDER_LABEL[provider] ?? provider)
            : t('overview.voiceOff')
      }
    } catch {
      if (model !== null) model.textContent = t('overview.unknown')
      if (voice !== null) voice.textContent = t('overview.unknown')
    }
  } else {
    if (model !== null) model.textContent = t('overview.unknown')
    if (voice !== null) voice.textContent = t('overview.unknown')
  }

  if (agenda !== null) {
    if (typeof window.pet.companionAgenda !== 'function') {
      agenda.textContent = t('overview.agendaEmpty')
      return
    }
    try {
      const result = await window.pet.companionAgenda()
      const note = result?.ok === true && typeof result.note === 'string' ? result.note.trim() : ''
      agenda.textContent = note !== '' ? note : t('overview.agendaEmpty')
    } catch {
      agenda.textContent = t('overview.agendaEmpty')
    }
  }
}

/** 结构化事实导出：主进程弹保存框，成功后把真实路径写在下面。 */
async function exportMemoryFacts() {
  const status = $('memory-facts-status')
  if (typeof window.pet.exportMemoryFacts !== 'function') return
  try {
    const result = await window.pet.exportMemoryFacts({ scope: 'all', includeArchived: true })
    if (result?.canceled === true) return
    if (result?.ok !== true) {
      if (status !== null) {
        status.textContent =
          result?.code === 'MEMORY_EMPTY'
            ? t('memory.factsExportEmpty')
            : `${t('memory.factsExportFailed')} · ${result?.message ?? result?.code ?? ''}`
      }
      return
    }
    if (status !== null) status.textContent = `${t('memory.factsExported')} · ${result.path}`
  } catch (error) {
    if (status !== null) {
      status.textContent = `${t('memory.factsExportFailed')} · ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}

/** 结构化事实导入：主进程读完才回来；成功后连同统计与列表一起刷新。 */
async function importMemoryFacts() {
  const status = $('memory-facts-status')
  if (typeof window.pet.importMemoryFacts !== 'function') return
  if (status !== null) status.textContent = ''
  try {
    const result = await window.pet.importMemoryFacts({ scope: 'all', includeArchived: true })
    if (result?.canceled === true) return
    if (result?.ok !== true) {
      if (status !== null) {
        status.textContent =
          result?.reason === 'empty'
            ? t('memory.factsImportEmpty')
            : `${t('memory.factsImportFailed')} · ${result?.message ?? result?.reason ?? ''}`
      }
      return
    }
    const added = Number(result.added ?? 0)
    const merged = Number(result.merged ?? 0)
    if (status !== null) status.textContent = `${t('memory.factsImported')} · +${added} / ${merged}`
    await refreshMemoryFacts()
    await refreshMemoryStats()
    await refreshMemoryList()
  } catch (error) {
    if (status !== null) {
      status.textContent = `${t('memory.factsImportFailed')} · ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}

/** 陪伴任务状态：没跑过就写「尚未运行」。 */
async function refreshCareStatus() {
  const last = $('care-last-run')
  const next = $('care-next-run')
  const result = $('care-last-result')
  if (typeof window.pet.careStatus !== 'function') {
    last.textContent = '尚未接入'
    next.textContent = '—'
    result.textContent = '尚未运行'
    return
  }
  try {
    const status = await window.pet.careStatus()
    last.textContent = status?.lastRunAt ?? '尚未运行'
    next.textContent = status?.nextRunAt ?? '—'
    result.textContent = status?.lastSummary ?? '尚未运行'
  } catch (error) {
    last.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`
  }
}

// 七个核心段落 + 三个补充维度。核心七段在 settings.html 里是静态节点，
// 三个补充维度（persona.mjs 的 EXTRA_SECTIONS）由 ensurePersonaExtraFields()
// 动态注入，注入必须先于 loadSettings() 的字段回填。
const PERSONA_SECTIONS = [
  'identity',
  'lore',
  'worldview',
  'lifeview',
  'values',
  'manner',
  'style',
  'relationPosture',
  'repair',
  'limits'
]

/** 三个补充维度的中文标签：i18n 词典里没有这些键，先在这里兜底。 */
const PERSONA_EXTRA_LABELS = {
  relationPosture: '关系姿态',
  repair: '冲突与修复',
  limits: '知识边界'
}
const PERSONA_EXTRA_KEYS = Object.keys(PERSONA_EXTRA_LABELS)

function personaExtraLabel(key) {
  const localized = window.PetI18n?.t?.(`persona.section.${key}`, current?.locale ?? 'zh-CN')
  return typeof localized === 'string' && localized !== `persona.section.${key}`
    ? localized
    : PERSONA_EXTRA_LABELS[key]
}

/**
 * 把三个补充维度的编辑框动态挂进人格区（七个核心段落之后）。
 *
 * 本次重构只允许改 settings.js，settings.html 的静态七段动不了；
 * 这里按现有七段的 DOM 结构（.item.item-stack + textarea + 字数 + 恢复默认）
 * 原样复制一份，读写路径与七段完全一致：settings.companion.persona.sections[key]。
 * 默认文案不写死：留空即用 persona.mjs 里的默认补充维度。
 */
function ensurePersonaExtraFields() {
  const anchor = personaField('style')?.closest('.item')
  if (anchor === null || personaField('relationPosture') !== null) return
  for (const key of PERSONA_EXTRA_KEYS) {
    const item = document.createElement('div')
    item.className = 'item item-stack'

    const text = document.createElement('div')
    text.className = 'item-text'
    const label = document.createElement('div')
    label.className = 'item-label'
    label.textContent = personaExtraLabel(key)
    const hint = document.createElement('div')
    hint.className = 'item-hint'
    hint.textContent = '留空则跟随默认；改了就整段替换'
    text.append(label, hint)

    const field = document.createElement('textarea')
    field.id = `persona-section-${key}`
    field.rows = 4
    field.maxLength = 1200
    field.spellcheck = false

    const foot = document.createElement('div')
    foot.className = 'persona-section-foot'
    const counter = document.createElement('span')
    counter.className = 'char-count'
    counter.id = `persona-section-${key}-count`
    counter.textContent = '0 / 1200'
    const reset = document.createElement('button')
    reset.type = 'button'
    reset.className = 'inline-btn'
    reset.id = `persona-section-${key}-reset`
    reset.textContent = '恢复默认'
    foot.append(counter, reset)

    item.append(text, field, foot)
    anchor.after(item)
  }
}

/** 主进程下发的默认段落；拉不到就留空，输入框仍按「留空跟随默认」处理。 */
let personaSectionDefaults = {}

function personaField(key) {
  return $(`persona-section-${key}`)
}

/** 每一段的字数：上限取自 textarea 自身，超九成变黄、写满变红。 */
function updatePersonaSectionCount(key) {
  const field = personaField(key)
  const counter = $(`persona-section-${key}-count`)
  if (field === null || counter === null) return
  const max = field.maxLength > 0 ? field.maxLength : 1200
  const used = field.value.length
  counter.textContent = `${used} / ${max}`
  counter.classList.toggle('is-near', used >= max * 0.9 && used < max)
  counter.classList.toggle('is-full', used >= max)
}

/** 把空着的段落填上默认文本，方便直接改；已有自定义内容不动。 */
function fillPersonaSectionDefaults() {
  if (Object.keys(personaSectionDefaults).length === 0) return
  for (const key of PERSONA_SECTIONS) {
    const field = personaField(key)
    if (field === null) continue
    const saved = current?.companion?.persona?.sections?.[key]
    field.value =
      typeof saved === 'string' && saved.trim() !== ''
        ? saved
        : (personaSectionDefaults[key] ?? '')
    updatePersonaSectionCount(key)
  }
}

/** 值与默认一致就存空串，继续跟随默认；改过才落自定义。 */
async function savePersonaSection(key) {
  const field = personaField(key)
  if (field === null) return
  const value = field.value
  const fallback = personaSectionDefaults[key] ?? ''
  const stored = value.trim() === '' || value.trim() === fallback.trim() ? '' : value
  await patch({ companion: { persona: { sections: { [key]: stored } } } })
  await renderPersonaPreview()
}

/** 人格额外说明的字数：随输入实时更新，上限取自 textarea 自身。 */
function updatePersonaCount() {
  const field = $('persona-extra')
  const counter = $('persona-count')
  if (field === null || counter === null) return
  const max = field.maxLength > 0 ? field.maxLength : 2000
  const used = field.value.length
  counter.textContent = `${used} / ${max}`
  counter.classList.toggle('is-near', used >= max * 0.9 && used < max)
  counter.classList.toggle('is-full', used >= max)
}

/**
 * 人格预览。
 * 文本由主进程的人格模块拼装，这里原样展示；
 * 接口不可用时退回本地拼一份，并注明是简版。
 */
async function renderPersonaPreview() {
  const box = $('persona-preview')
  const persona = current?.companion?.persona ?? {}

  if (typeof window.pet.getPersonaPreview === 'function') {
    try {
      const result = await window.pet.getPersonaPreview()
      if (result?.defaults && Object.keys(personaSectionDefaults).length === 0) {
        personaSectionDefaults = result.defaults
        fillPersonaSectionDefaults()
      }
      if (persona.enabled === false) {
        box.textContent = '人格提示词已关闭，只使用最基础的语气设定。'
        return
      }
      if (typeof result?.text === 'string' && result.text.trim() !== '') {
        box.textContent = result.text
        return
      }
    } catch {
      // 回退到下面的本地简版，不把错误页塞给用户。
    }
  }

  if (persona.enabled === false) {
    box.textContent = '人格提示词已关闭，只使用最基础的语气设定。'
    return
  }

  const extra = (persona.extraPrompt ?? '').trim()
  const lines = ['（主进程预览不可用，下面是简版）']
  if (extra !== '') lines.push(`补充设定：${extra}`)
  box.textContent = lines.join('\n')
}

function bindEvents() {
  // 左侧一级导航：只切分组，落到该组上次停留的面板。
  $('nav').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-group]')
    if (button === null) return
    const group = button.dataset.group
    const meta = PANEL_GROUPS[group]
    if (meta === undefined) return
    const search = $('settings-search')
    if (search !== null && search.value !== '') {
      search.value = ''
      clearSearchFilter(false)
    }
    showPanel(lastPanelByGroup[group] ?? meta.panels[0])
  })

  // 组内子标签：只切面板，不动一级高亮。
  $('subnav')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-panel]')
    if (button === null) return
    const search = $('settings-search')
    if (search !== null && search.value !== '') {
      search.value = ''
      clearSearchFilter(false)
    }
    showPanel(button.dataset.panel)
  })

  // 素材包：导入 / 刷新 / 四类来源选择
  bindPackEvents()

  // 立绘：切换 / 导入 / 打开目录
  $('live2d-model').addEventListener('change', async () => {
    const modelId = $('live2d-model').value
    const result = await window.pet.setActiveModel(modelId)
    if (result?.ok === true) {
      current = { ...current, live2dModelId: result.live2dModelId ?? '' }
      showSaved()
    } else {
      $('model-status').textContent = `切换失败：${result?.message ?? '未知原因'}`
      await refreshModels()
    }
  })

  const doImport = async (kind) => {
    const ids = ['import-model-zip', 'import-model-folder']
    for (const id of ids) $(id).disabled = true
    $('model-status').textContent =
      kind === 'zip' ? '正在解压并校验模型……' : '正在复制并校验模型……'

    try {
      const result = await window.pet.importModel(kind)
      if (result?.canceled === true) {
        $('model-status').textContent = '已取消导入'
        return
      }
      if (result?.ok !== true) {
        $('model-status').textContent = `导入失败：${result?.message ?? '未知原因'}`
        return
      }
      current = { ...current, live2dModelId: result.model?.id ?? '' }
      await refreshModels()
      showSaved()
    } catch (error) {
      $('model-status').textContent = `导入失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      for (const id of ids) $(id).disabled = false
    }
  }

  $('import-model-zip').addEventListener('click', () => {
    void doImport('zip')
  })

  $('import-model-folder').addEventListener('click', () => {
    void doImport('folder')
  })

  $('open-models-folder').addEventListener('click', async () => {
    const result = await window.pet.openModelsFolder()
    if (result?.ok !== true) {
      $('model-status').textContent = `打不开模型目录：${result?.message ?? '未知原因'}`
    }
  })

  $('nickname').addEventListener('change', () => {
    const value = $('nickname').value.trim()
    void patch({ nickname: value })
  })

  $('theme-seg').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-theme]')
    if (button === null) return
    const preset = button.dataset.theme
    applyTheme(preset)
    void patch({ theme: { preset, slots: themeScopePatch(preset) } })
  })

  /* 作用范围：勾上=跟着配色走，取消=这个位置固定成现在这套。 */
  $('theme-scope-seg')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-theme-slot]')
    if (button === null) return
    button.classList.toggle('active')
    const preset = document.querySelector('#theme-seg button.active')?.dataset.theme ?? 'OceanBlue'
    void patch({ theme: { slots: themeScopePatch(preset) } })
  })

  /* 聊天页背景：图片本体留在主进程，这里只显示当前在用哪一张。 */
  function renderBackgroundState(active, total) {
    const stateEl = $('bg-state')
    if (stateEl === null) return
    const id = active?.id ?? ''
    if (id === '') {
      stateEl.textContent = total > 0 ? '还没选，可以换回以前传过的图' : '还没有设置背景图'
      return
    }
    stateEl.textContent = `正在使用 ${id}`
  }

  async function refreshBackgroundState() {
    try {
      const result = await window.pet.listBackgrounds()
      renderBackgroundState(result?.active ?? {}, Array.isArray(result?.items) ? result.items.length : 0)
    } catch {
      const stateEl = $('bg-state')
      if (stateEl !== null) stateEl.textContent = '读取背景状态失败'
    }
  }

  /* 背景库有独立页：这里只留入口，导入与切换都在那一页完成。 */
  $('open-bg-library')?.addEventListener('click', () => {
    void window.pet.openBackgrounds?.()
  })

  $('pick-bg')?.addEventListener('click', async () => {
    const result = await window.pet.pickBackground()
    if (result?.ok === true) {
      const stateEl = $('bg-state')
      if (stateEl !== null) stateEl.textContent = `正在使用 ${result.id}`
      return
    }
    const stateEl = $('bg-state')
    if (stateEl === null) return
    if (result?.reason === 'too-large') stateEl.textContent = '图片超过 12MB，换一张小一点的'
    else if (result?.reason === 'unsupported') stateEl.textContent = '只支持 PNG / JPG / GIF / WebP / AVIF'
    else if (result?.reason !== 'canceled') stateEl.textContent = '这张图没读进来，换一张试试'
  })

  $('clear-bg')?.addEventListener('click', async () => {
    await window.pet.clearBackground()
    renderBackgroundState({ id: '' }, 0)
  })

  void refreshBackgroundState()

  $('profile').addEventListener('change', () => {
    const value = $('profile').value
    // 比例变了，像素读数要跟着换基准，但倍数不动
    renderScaleLabel($('scale').value)
    void patch({ profile: value }, { applySize: true })
  })

  // 拖滑杆时只更新数字，松手才保存，避免一路拖一路写盘
  $('scale').addEventListener('input', (event) => {
    renderScaleLabel(event.target.value)
  })
  $('scale').addEventListener('change', (event) => {
    const value = Number(event.target.value)
    void patch({ window: { scale: value } }, { applySize: true })
  })

  $('alwaysOnTop').addEventListener('change', (event) => {
    const value = event.target.checked
    void window.pet.setAlwaysOnTop(value)
    void patch({ window: { alwaysOnTop: value } })
  })

  $('poseEverySeconds').addEventListener('change', (event) => {
    const raw = Number(event.target.value)
    const value = Number.isFinite(raw) ? Math.max(0, Math.min(3600, Math.round(raw))) : 60
    event.target.value = String(value)
    void patch({ poseEverySeconds: value })
  })

  $('presence-outline').addEventListener('change', () => {
    void patch({ presence: { outline: $('presence-outline').value } })
  })

  $('edgeSnap').addEventListener('change', (event) => {
    void patch({ window: { edgeSnap: event.target.checked } })
  })

  $('edgeSnapDistance').addEventListener('change', (event) => {
    const raw = Number(event.target.value)
    const value = Number.isFinite(raw) ? Math.max(4, Math.min(64, Math.round(raw))) : 12
    event.target.value = String(value)
    void patch({ window: { edgeSnapDistance: value } })
  })

  // 气泡：模式立即保存，滑杆拖动只改读数、松手才落盘
  $('bubble-mode').addEventListener('change', () => {
    void patch({ bubble: { mode: $('bubble-mode').value } })
  })

  for (const [id, key, digits] of [
    ['bubble-fontSize', 'fontSize', 1],
    ['bubble-width', 'width', 0],
    ['bubble-stickerSize', 'stickerSize', 0],
    ['bubble-radius', 'radius', 0],
    ['bubble-alpha', 'alpha', 2],
    ['bubble-holdSeconds', 'holdSeconds', 0],
    ['bubble-noticeHoldSeconds', 'noticeHoldSeconds', 0]
  ]) {
    /* 控件缺席时跳过，不要让一个 id 找不到就抛 TypeError 打断整段绑定 ——
       这里一断，后面配色、作用范围那些监听全都注册不上，表现就是主题「失控」。 */
    const control = $(id)
    if (control === null) continue
    control.addEventListener('input', (event) => {
      renderRangeLabel(id, event.target.value, digits)
      if (id.startsWith('bubble-')) renderBubblePreview()
    })
    $(id).addEventListener('change', (event) => {
      void patch({ bubble: { [key]: Number(event.target.value) } })
    })
  }

  // HUD
  $('hudName').addEventListener('change', () => {
    const name = $('hudName').value.trim()
    $('hudName').value = name
    void patch({ hudName: name === '' ? '昔涟' : name })
  })

  $('showHud').addEventListener('change', () => {
    void patch({ showHud: $('showHud').checked })
  })

  $('hudDetail').addEventListener('change', () => {
    void patch({ hudDetail: $('hudDetail').value })
  })

  $('hudAlpha').addEventListener('input', (event) => {
    renderRangeLabel('hudAlpha', event.target.value, 2)
  })
  $('hudAlpha').addEventListener('change', (event) => {
    void patch({ hudAlpha: Number(event.target.value) })
  })

  $('hudScale').addEventListener('input', (event) => {
    renderPercentLabel('hudScale', event.target.value)
  })
  $('hudScale').addEventListener('change', (event) => {
    void patch({ hudScale: Number(event.target.value) })
  })

  $('hudFontScale').addEventListener('input', (event) => {
    renderPercentLabel('hudFontScale', event.target.value)
  })
  $('hudFontScale').addEventListener('change', (event) => {
    void patch({ hudFontScale: Number(event.target.value) })
  })

  // 语音：每项单独存，改触发时机不会顺手把免打扰时段清掉
  $('voice-enabled').addEventListener('change', () => {
    void patch({ voice: { enabled: $('voice-enabled').checked } })
  })

  $('voice-trigger').addEventListener('change', () => {
    void patch({ voice: { trigger: $('voice-trigger').value } })
  })

  $('voice-quiet-enabled').addEventListener('change', () => {
    void patch({ voice: { quietHours: { enabled: $('voice-quiet-enabled').checked } } })
  })

  for (const id of ['voice-quiet-start', 'voice-quiet-end']) {
    $(id).addEventListener('change', () => {
      void patch({
        voice: {
          quietHours: {
            start: $('voice-quiet-start').value,
            end: $('voice-quiet-end').value
          }
        }
      })
    })
  }

  // 本地合成：地址与参考音频也各存各的，互不覆盖。
  watchUrlField('voice-local-url')
  $('voice-local-url').addEventListener('change', () => {
    void patch({ voice: { localUrl: $('voice-local-url').value.trim() } })
  })

  $('voice-ref-audio').addEventListener('change', () => {
    void patch({ voice: { refAudioPath: $('voice-ref-audio').value.trim() } })
  })

  const voicePromptTextEl = $('voice-prompt-text')
  if (voicePromptTextEl !== null) {
    voicePromptTextEl.addEventListener('change', () => {
      void patch({ voice: { promptText: voicePromptTextEl.value.trim() } })
    })
  }

  // 选择参考音频：主进程只弹框回路径，选中后立刻落盘，取消就保持原值。
  $('voice-ref-audio-pick')?.addEventListener('click', async () => {
    const button = $('voice-ref-audio-pick')
    button.disabled = true
    try {
      const picked = await window.pet.pickRefAudio()
      if (picked?.ok !== true) return
      $('voice-ref-audio').value = picked.path
      void patch({ voice: { refAudioPath: picked.path } })
    } finally {
      button.disabled = false
    }
  })

  // 试听：走和小喇叭同一条合成链路，reason=manual 不受「只在主动搭话时」限制。
  $('voice-preview-btn')?.addEventListener('click', async () => {
    const button = $('voice-preview-btn')
    const text = $('voice-preview-text')?.textContent?.trim() ?? ''
    button.disabled = true
    try {
      const result = await window.pet.speakVoice(text, 'manual')
      if (result?.ok !== true) {
        $('voice-service-note')?.setAttribute('data-preview', 'failed')
      }
    } finally {
      button.disabled = false
    }
  })

  // ---- 用声音叫醒：默认关闭；运行时按需下载，不随安装包走 ----
  const renderWake = (status) => {
    const hint = $('wake-runtime-status')
    const installBtn = $('wake-install-btn')
    const removeBtn = $('wake-remove-btn')
    const toggle = $('wake-enabled')
    if (status === null) return
    if (toggle !== null) toggle.checked = status.enabled === true
    if (hint !== null) {
      if (status.installedVersion) {
        hint.textContent = `${t('wake.statusInstalled')} · ${status.installedVersion}`
      } else if (status.manifestConfigured === false) {
        hint.textContent = t('wake.statusNoSource')
      } else {
        hint.textContent = t('wake.statusMissing')
      }
    }
    if (installBtn !== null) {
      installBtn.disabled = status.installing === true || status.installedVersion !== null
      installBtn.textContent = status.installing === true ? t('wake.installing') : t('wake.install')
    }
    if (removeBtn !== null) removeBtn.disabled = status.installing === true || !status.installedVersion
  }

  const refreshWake = async () => {
    try {
      renderWake(await window.pet.wakeStatus())
    } catch {
      $('wake-runtime-status')?.replaceChildren(document.createTextNode(t('wake.statusUnknown')))
    }
  }
  void refreshWake()

  $('wake-enabled')?.addEventListener('change', async () => {
    const toggle = $('wake-enabled')
    // 内测未开放：控件留在原位，但不接受操作；这里兜住键盘与脚本触发的 change。
    if (toggle.closest('.beta-locked') !== null) {
      toggle.checked = !toggle.checked
      return
    }
    const wanted = toggle.checked === true
    toggle.disabled = true
    try {
      const result = await window.pet.wakeSetEnabled(wanted)
      if (result?.ok !== true) {
        // 没装运行时就不让开关停在「已开」，否则用户会以为她在听。
        toggle.checked = false
        $('wake-runtime-status')?.replaceChildren(document.createTextNode(t('wake.statusMissing')))
        $('wake-install-btn')?.focus()
        return
      }
      renderWake(result)
    } catch {
      toggle.checked = false
    } finally {
      toggle.disabled = false
    }
  })

  // 点徽标解锁：先把代价说清楚，接受后只在这个窗口内放开，重开又回到锁定。
  $('wake-unlock-btn')?.addEventListener('click', () => {
    const badge = $('wake-unlock-btn')
    if (badge === null) return
    const item = badge.closest('.beta-locked')
    const toggle = $('wake-enabled')
    if (item === null || toggle === null) return
    if (window.confirm(t('beta.unlockWarn')) !== true) return
    item.classList.remove('beta-locked')
    item.setAttribute('aria-disabled', 'false')
    toggle.removeAttribute('tabindex')
    const hint = item.querySelector('.item-hint')
    if (hint !== null) {
      hint.setAttribute('data-i18n', 'wake.enabledHintUnlocked')
      hint.textContent = t('wake.enabledHintUnlocked')
    }
    badge.remove()
  })

  $('wake-install-btn')?.addEventListener('click', async () => {
    const button = $('wake-install-btn')
    button.disabled = true
    button.textContent = t('wake.installing')
    try {
      const result = await window.pet.wakeInstall()
      if (result?.ok !== true) {
        $('wake-runtime-status')?.replaceChildren(
          document.createTextNode(`${t('wake.installFailed')} · ${result?.reason ?? 'unknown'}`)
        )
        return
      }
      await refreshWake()
    } catch {
      $('wake-runtime-status')?.replaceChildren(document.createTextNode(t('wake.installFailed')))
    } finally {
      await refreshWake()
    }
  })

  $('wake-remove-btn')?.addEventListener('click', async () => {
    const button = $('wake-remove-btn')
    button.disabled = true
    try {
      await window.pet.wakeRemove()
    } finally {
      await refreshWake()
    }
  })

  // 连接自检：只把结果写在这一行提示里，不改设置、不写聊天记录。
  $('chat-test-btn')?.addEventListener('click', async () => {
    const button = $('chat-test-btn')
    const hint = $('chat-test-result')
    button.disabled = true
    if (hint !== null) hint.textContent = '…'
    try {
      const result = await window.pet.testLlm()
      if (hint === null) return
      hint.textContent = result?.ok === true
        ? `OK · ${result.model} · ${result.elapsedMs}ms`
        : `FAIL · ${result?.reason ?? 'unknown'}`
    } finally {
      button.disabled = false
    }
  })

  // 同步：导出/应用都走主进程，结果只写在这一行提示里。
  const runSync = async (action) => {
    const button = action === 'export' ? $('sync-export-btn') : $('sync-apply-btn')
    const hint = $('sync-result')
    button.disabled = true
    if (hint !== null) hint.textContent = '…'
    try {
      const result = await window.pet.runSync(action)
      if (hint === null) return
      if (result?.ok !== true) {
        hint.textContent = `FAIL · ${result?.reason ?? 'unknown'}`
        return
      }
      if (action === 'export') {
        hint.textContent = `OK · ${result.count ?? 0}`
      } else {
        hint.textContent = `OK · applied ${result.applied ?? 0}`
        // 对端值已经写回设置，重新读一次让界面跟上。
        await loadSettings()
      }
    } finally {
      button.disabled = false
      void refreshSyncInfo()
    }
  }
  $('sync-export-btn')?.addEventListener('click', () => void runSync('export'))
  $('sync-apply-btn')?.addEventListener('click', () => void runSync('apply'))

  // 同步目录与最近一次导出 / 合并时间：只读展示，换目录交给系统目录选择器。
  const refreshSyncInfo = async () => {
    const pathHint = $('sync-dir-path')
    const exportHint = $('sync-last-export')
    const pullHint = $('sync-last-pull')
    if (typeof window.pet.getSyncInfo !== 'function') return
    try {
      const info = await window.pet.getSyncInfo()
      if (pathHint !== null) {
        pathHint.textContent =
          info?.enabled === true && info.dir !== '' ? info.dir : t('sync.dirUnavailable')
      }
      const exportAt = formatSyncTime(info?.lastExportAt)
      const pullAt = formatSyncTime(info?.lastPullAt)
      if (exportHint !== null) {
        exportHint.textContent =
          exportAt === '' ? t('sync.historyEmpty') : `${t('sync.lastExport')}${exportAt}`
      }
      if (pullHint !== null) {
        pullHint.textContent =
          pullAt === '' ? t('sync.historyEmpty') : `${t('sync.lastPull')}${pullAt}`
      }
    } catch {
      if (pathHint !== null) pathHint.textContent = t('sync.dirUnavailable')
    }
  }

  $('sync-dir-btn')?.addEventListener('click', async () => {
    const button = $('sync-dir-btn')
    if (button === null) return
    button.disabled = true
    try {
      const result = await window.pet.chooseSyncDir()
      if (result?.ok === true) showSaved()
    } finally {
      button.disabled = false
      await refreshSyncInfo()
    }
  })

  void refreshSyncInfo()

  // 同步口令：只用来加密同步包里的敏感字段。状态行只显示是否已设置，不回明文。
  const refreshSyncPassphrase = async () => {
    const status = $('sync-passphrase-status')
    if (status === null) return
    if (typeof window.pet.getSyncPassphraseStatus !== 'function') {
      status.textContent = '当前版本不支持同步口令'
      return
    }
    try {
      const result = await window.pet.getSyncPassphraseStatus()
      if (result?.ok !== true) {
        status.textContent = '加密仓库不可用，暂时读不到口令状态'
        return
      }
      status.textContent = result.configured
        ? `已设置 ${result.masked ?? ''} · 敏感字段只以密文同步`
        : '未设置 · 敏感字段不会进同步包'
    } catch (error) {
      status.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`
    }
  }

  $('sync-passphrase-save')?.addEventListener('click', async () => {
    const input = $('sync-passphrase')
    const status = $('sync-passphrase-status')
    const button = $('sync-passphrase-save')
    if (input === null) return
    const value = input.value.trim()
    if (!BackupPolicy.isPassphraseLongEnough(value)) {
      if (status !== null) status.textContent = BackupPolicy.passphraseTooShortMessage()
      return
    }
    if (button !== null) button.disabled = true
    if (status !== null) status.textContent = '…'
    try {
      const result = await window.pet.setSyncPassphrase(value)
      if (result?.ok === true) {
        input.value = ''
        if (status !== null) status.textContent = '已保存 · 下次导出会带上密文字段'
        await refreshSyncPassphrase()
      } else if (result?.reason === 'passphrase-too-short') {
        if (status !== null) status.textContent = BackupPolicy.passphraseTooShortMessage()
      } else {
        if (status !== null) status.textContent = '加密仓库不可用，暂时无法保存口令'
      }
    } catch (error) {
      if (status !== null) {
        status.textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`
      }
    } finally {
      if (button !== null) button.disabled = false
    }
  })

  $('sync-passphrase-clear')?.addEventListener('click', async () => {
    const status = $('sync-passphrase-status')
    if (
      !confirmAction({
        message: '清除同步口令后，后续同步包不再带密文字段；已经写出去的旧包仍然需要原口令才能解开。'
      })
    ) {
      return
    }
    try {
      const result = await window.pet.clearSyncPassphrase()
      if (result?.ok !== true) {
        if (status !== null) status.textContent = '清除失败'
        return
      }
      if (status !== null) status.textContent = '已清除 · 后续同步包不再带密文字段'
      await refreshSyncPassphrase()
    } catch (error) {
      if (status !== null) {
        status.textContent = `清除失败：${error instanceof Error ? error.message : String(error)}`
      }
    }
  })

  void refreshSyncPassphrase()

  $('voice-volume').addEventListener('input', (event) => {
    renderRangeLabel('voice-volume', event.target.value, 2)
  })
  $('voice-volume').addEventListener('change', (event) => {
    void patch({ voice: { volume: Number(event.target.value) } })
  })

  $('voice-max-chars').addEventListener('change', () => {
    void patch({ voice: { maxChars: Number($('voice-max-chars').value) } })
  })

  $('voice-min-interval').addEventListener('change', () => {
    void patch({ voice: { minIntervalSeconds: Number($('voice-min-interval').value) } })
  })

  // 语音唤醒词是独立一份名单：留空时回落到内置的「发句语音」。
  $('voice-wake-words').addEventListener('change', () => {
    const words = $('voice-wake-words')
      .value.split(/[、,，;；\s]+/)
      .map((word) => word.trim())
      .filter((word) => word !== '')
    void patch({ voice: { voiceWakeWords: words } })
  })

  const dshSceneInputs = {
    'voice-dsh-reply': 'reply',
    'voice-dsh-wake': 'wakeWord',
    'voice-dsh-autonomous': 'autonomous',
    'voice-dsh-moments': 'moments'
  }
  for (const [elementId, scene] of Object.entries(dshSceneInputs)) {
    $(elementId).addEventListener('change', (event) => {
      // 顺手清掉旧字段，免得 readDsh 那颗旧灯一直把 reply 顶亮。
      void patch({ voice: { readDsh: false, dshScenes: { [scene]: event.target.checked === true } } })
    })
  }

  // 语言
  $('locale').addEventListener('change', () => {
    void patch({ locale: $('locale').value })
  })

  // 唤醒词：失焦时保存，避免每敲一个字就写一次配置。
  $('chat-wake-words').addEventListener('change', () => {
    void patch({ wakeWords: parseWakeWords($('chat-wake-words').value) })
  })

  // 主动台词：参数即时保存；「试一句」真的请求一次，失败照实显示，不写「已完成」。
  $('presence-ai-enabled').addEventListener('change', () => {
    void patch({ presence: { aiEnabled: $('presence-ai-enabled').checked } })
  })

  $('presence-interval').addEventListener('change', () => {
    void patch({ presence: { intervalMinutes: Number($('presence-interval').value) } })
  })

  $('presence-city').addEventListener('change', () => {
    void patch({ presence: { city: $('presence-city').value.trim() } })
  })

  $('presence-owner-city').addEventListener('change', () => {
    void patch({ presence: { ownerCity: $('presence-owner-city').value.trim() } })
  })

  $('presence-owner-autolocate').addEventListener('change', () => {
    void patch({ presence: { ownerAutoLocate: $('presence-owner-autolocate').checked } })
  })

  // 0 表示不限次数；填错或留空时按默认值存，避免把闸门关死又不自知。
  $('presence-daily-cap').addEventListener('change', () => {
    const raw = Number($('presence-daily-cap').value)
    const value = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 0), 50) : 8
    $('presence-daily-cap').value = String(value)
    void patch({ presence: { dailyCap: value } })
  })

  // 0 表示一直等下去；其余按天算，超过这个天数就不再自动开口。
  $('presence-silence-days').addEventListener('change', () => {
    const raw = Number($('presence-silence-days').value)
    const value = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 0), 365) : 7
    $('presence-silence-days').value = String(value)
    void patch({ presence: { silenceDays: value } })
  })

  $('presence-weather').addEventListener('change', () => {
    void patch({ presence: { useWeather: $('presence-weather').checked } })
  })

  // 在这里手动打开也算一次明确同意，不用再弹一次首启询问。
  $('presence-screen').addEventListener('change', () => {
    void patch({
      presence: { screen: { enabled: $('presence-screen').checked, consentAsked: true } }
    })
  })

  // 夜间不扰：开关、时段、方式都即时保存，主进程每 30 秒重新判定一次。
  $('quiet-enabled').addEventListener('change', () => {
    void patch({ presence: { quiet: { enabled: $('quiet-enabled').checked } } })
  })

  const saveQuietWindow = () => {
    void patch({
      presence: {
        quiet: {
          // time 输入被清空时给回默认值，空字符串会让主进程判定成「未开启」。
          from: $('quiet-from').value || '23:00',
          to: $('quiet-to').value || '08:00'
        }
      }
    })
  }
  $('quiet-from').addEventListener('change', saveQuietWindow)
  $('quiet-to').addEventListener('change', saveQuietWindow)

  $('quiet-mode').addEventListener('change', () => {
    void patch({ presence: { quiet: { mode: $('quiet-mode').value } } })
  })

  // HUD 隐藏只写一个小开关；真正是否隐藏由渲染层按当前时间判定。
  $('quiet-hide-hud').addEventListener('change', () => {
    void patch({ presence: { quiet: { hideHud: $('quiet-hide-hud').checked } } })
  })

  const presencePreview = $('presence-preview')
  const presencePreviewOutput = $('presence-preview-output')
  if (presencePreview !== null) {
    presencePreview.addEventListener('click', async () => {
      presencePreview.disabled = true
      if (presencePreviewOutput !== null) presencePreviewOutput.textContent = '正在请求…'
      try {
        const result = await window.pet.speak('preview')
        if (presencePreviewOutput !== null) {
          if (typeof result?.line === 'string' && result.line !== '') {
            // 来源一起写出来：模型写的，还是本地兜底句，一眼能分清。
            presencePreviewOutput.textContent =
              (result.source === 'model' ? '模型：' : '本地兜底：') + result.line
          } else if (result?.reason === 'disabled') {
            presencePreviewOutput.textContent = '先打开上面的「用 AI 生成台词」'
          } else {
            presencePreviewOutput.textContent = `没有拿到台词（${result?.reason ?? 'unknown'}）`
          }
        }
      } catch (error) {
        if (presencePreviewOutput !== null) {
          presencePreviewOutput.textContent = `请求失败：${String(error?.message ?? error)}`
        }
      } finally {
        presencePreview.disabled = false
      }
    })
  }

  // 陪伴任务：只绑定界面上还在的每日复盘
  const careBindings = [
    ['care-daily-review-enabled', 'dailyReview', 'enabled', 'checkbox'],
    ['care-daily-review-at', 'dailyReview', 'at', 'text']
  ]

  for (const [id, group, key, kind] of careBindings) {
    $(id).addEventListener('change', () => {
      const value = kind === 'checkbox' ? $(id).checked : $(id).value
      void patch({ companion: { care: { [group]: { [key]: value } } } })
    })
  }

  // 每日额度：开关和上限分开绑，改一个不会把另一个冲掉。
  const budgetEnabled = $('care-budget-enabled')
  const budgetLimit = $('care-budget-limit')
  if (budgetEnabled !== null) {
    budgetEnabled.addEventListener('change', () => {
      void patch({ companion: { care: { dailyTokenBudget: { enabled: budgetEnabled.checked } } } })
    })
  }
  if (budgetLimit !== null) {
    budgetLimit.addEventListener('change', () => {
      const value = Number.parseInt(budgetLimit.value, 10)
      const limit = Number.isFinite(value) ? Math.max(0, value) : 0
      budgetLimit.value = String(limit)
      void patch({ companion: { care: { dailyTokenBudget: { limit } } } })
    })
  }

  // 请求守门与离线兜底：开关和上限各自独立，改一个不冲掉另一个。
  const guardEnabled = $('care-guard-enabled')
  const guardPerMinute = $('care-guard-per-minute')
  const offlineEnabled = $('care-offline-enabled')
  if (guardEnabled !== null) {
    guardEnabled.addEventListener('change', () => {
      void patch({ companion: { care: { requestGuard: { enabled: guardEnabled.checked } } } })
    })
  }
  if (guardPerMinute !== null) {
    guardPerMinute.addEventListener('change', () => {
      const value = Number.parseInt(guardPerMinute.value, 10)
      const perMinute = Number.isFinite(value) ? Math.min(120, Math.max(1, value)) : 20
      guardPerMinute.value = String(perMinute)
      void patch({ companion: { care: { requestGuard: { perMinute } } } })
    })
  }
  if (offlineEnabled !== null) {
    offlineEnabled.addEventListener('change', () => {
      void patch({ companion: { care: { offlineReply: { enabled: offlineEnabled.checked } } } })
    })
  }

  // 情绪与需求：每一项都只改自己的那一层。
  const emotionBindings = [
    ['emotion-afterglow-enabled', (value) => ({ afterglow: { enabled: value === true } })],
    ['emotion-afterglow-half-life', (value) => ({ afterglow: { halfLifeMinutes: value } })],
    ['emotion-expression-group', (value) => ({ expression: { group: value } })],
    ['emotion-needs-enabled', (value) => ({ needs: { enabled: value === true } })]
  ]

  for (const [id, build] of emotionBindings) {
    const element = $(id)
    if (element === null) continue
    element.addEventListener('change', () => {
      const raw = element.type === 'checkbox' ? element.checked : element.value
      const value =
        element.type === 'number' || element.type === 'range'
          ? Number.parseInt(String(raw), 10)
          : raw
      void patch({ companion: { emotion: build(value) } })
    })
  }

  // 手动触发巡视与反思：结果只回显真实返回值，不拼一句「已完成」。
  const dailyResult = $('daily-result')
  const dailyRun = $('daily-run')
  if (dailyRun !== null) {
    dailyRun.addEventListener('click', async () => {
      dailyRun.disabled = true
      if (dailyResult !== null) dailyResult.textContent = '正在汇总…'
      try {
        const result = await window.pet.dailyRun()
        if (dailyResult !== null) {
          dailyResult.textContent = result?.ok
            ? `${result.summary}（${result.review?.date ?? '今天'}）`
            : `没有写成：${result?.reason ?? '未知原因'}`
        }
      } catch (error) {
        if (dailyResult !== null) dailyResult.textContent = `调用失败：${String(error?.message ?? error)}`
      } finally {
        dailyRun.disabled = false
      }
    })
  }

  const reflectionRun = $('reflection-run')
  if (reflectionRun !== null) {
    reflectionRun.addEventListener('click', async () => {
      reflectionRun.disabled = true
      if (dailyResult !== null) dailyResult.textContent = '正在整理印象…'
      try {
        const result = await window.pet.reflectionRun()
        if (dailyResult !== null) {
          dailyResult.textContent = result?.ok
            ? `已写入 ${result.filePath}`
            : `没有写成：${result?.reason ?? '未知原因'}`
        }
      } catch (error) {
        if (dailyResult !== null) dailyResult.textContent = `调用失败：${String(error?.error ?? error)}`
      } finally {
        reflectionRun.disabled = false
      }
    })
  }

  // 记忆观察台已并入「她·观察台」：统一落到记忆 tab，不再单开 memory.html。
  $('open-memory-console')?.addEventListener('click', () => {
    void window.pet?.openInsight?.('memory')
  })

  // 四条轴：开关与灵敏度分开写回，只改当前这一条，不碰旁边的轴。
  for (const key of AXIS_KEYS) {
    $(`axis-${key}-enabled`)?.addEventListener('change', (event) => {
      void patch({ companion: { axes: { [key]: { enabled: event.target.checked } } } })
    })
    $(`axis-${key}-sensitivity`)?.addEventListener('change', (event) => {
      void patch({ companion: { axes: { [key]: { sensitivity: event.target.value } } } })
    })
  }

  // 记忆
  $('memory-enabled').addEventListener('change', () => {
    void patch({ companion: { memory: { enabled: $('memory-enabled').checked } } })
  })

  $('memory-max-items').addEventListener('change', () => {
    void patch({ companion: { memory: { maxItems: Number($('memory-max-items').value) } } })
  })

  // 记忆搜索：输入停顿 300ms 再查，命中结果从第一页开始。
  const memorySearch = $('memory-search')
  if (memorySearch !== null) {
    let timer = null
    memorySearch.addEventListener('input', () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        memoryQuery = memorySearch.value.trim()
        memoryOffset = 0
        void refreshMemoryList()
      }, 300)
    })
  }

  // 来源与时间筛选：选项一变就从第一页重查；导出沿用同一组条件。
  const memoryRoleSelect = $('memory-role')
  if (memoryRoleSelect !== null) {
    memoryRoleSelect.addEventListener('change', () => {
      memoryRole = memoryRoleSelect.value
      memoryOffset = 0
      void refreshMemoryList()
    })
  }

  const memoryFromInput = $('memory-from')
  if (memoryFromInput !== null) {
    memoryFromInput.addEventListener('change', () => {
      memoryFrom = memoryFromInput.value
      memoryOffset = 0
      void refreshMemoryList()
    })
  }

  const memoryToInput = $('memory-to')
  if (memoryToInput !== null) {
    memoryToInput.addEventListener('change', () => {
      memoryTo = memoryToInput.value
      memoryOffset = 0
      void refreshMemoryList()
    })
  }

  const memoryExport = $('memory-export')
  if (memoryExport !== null) {
    memoryExport.addEventListener('click', () => {
      void exportMemory()
    })
  }

  // 她记住的事：整份 JSONL 备份与还原，换机时能带走。
  const memoryFactsExport = $('memory-facts-export')
  if (memoryFactsExport !== null) {
    memoryFactsExport.addEventListener('click', () => {
      void exportMemoryFacts()
    })
  }

  const memoryFactsImport = $('memory-facts-import')
  if (memoryFactsImport !== null) {
    memoryFactsImport.addEventListener('click', () => {
      void importMemoryFacts()
    })
  }

  // 今日日程：手动看一次，或把后面的安排顺延半小时。
  const agendaRefresh = $('companion-agenda-refresh')
  if (agendaRefresh !== null) {
    agendaRefresh.addEventListener('click', () => {
      void refreshAgenda()
    })
  }

  const agendaDelay = $('companion-agenda-delay')
  if (agendaDelay !== null) {
    agendaDelay.addEventListener('click', () => {
      void delayAgenda()
    })
  }

  // 想看完整观察数据时，直接开观察台并落在对应分区，设置页不再重复铺一份。
  const agendaOpen = $('companion-agenda-open')
  if (agendaOpen !== null) {
    agendaOpen.addEventListener('click', () => {
      void window.pet?.openInsight?.('today')
    })
  }

  const memoryOpen = $('memory-open-insight')
  if (memoryOpen !== null) {
    memoryOpen.addEventListener('click', () => {
      void window.pet?.openInsight?.('memory')
    })
  }

  // 记忆列表：刷新、翻页、单条删除。
  const memoryRefresh = $('memory-refresh')
  if (memoryRefresh !== null) {
    memoryRefresh.addEventListener('click', () => {
      void refreshMemoryStats()
      void refreshMemoryFacts()
      void refreshMemoryList()
    })
  }

  const memoryPrev = $('memory-prev')
  if (memoryPrev !== null) {
    memoryPrev.addEventListener('click', () => {
      memoryOffset = Math.max(0, memoryOffset - MEMORY_PAGE_SIZE)
      void refreshMemoryList()
    })
  }

  const memoryNext = $('memory-next')
  if (memoryNext !== null) {
    memoryNext.addEventListener('click', () => {
      if (memoryOffset + MEMORY_PAGE_SIZE < memoryTotal) {
        memoryOffset += MEMORY_PAGE_SIZE
        void refreshMemoryList()
      }
    })
  }

  // 启动前体检：手动重跑一次，结果覆盖旧值。
  const preflightRefresh = $('preflight-refresh')
  if (preflightRefresh !== null) {
    preflightRefresh.addEventListener('click', () => {
      void refreshPreflight()
      void refreshStatusCards()
    })
  }

  // 一键诊断：把脱敏读数复制到剪贴板，方便用户直接贴给别人看。
  const diagnosticsCopy = $('diagnostics-copy')
  if (diagnosticsCopy !== null) {
    diagnosticsCopy.addEventListener('click', () => {
      void copyDiagnostics()
    })
  }

  // 聊天
  $('chat-enabled').addEventListener('change', () => {
    void patch({ companion: { chat: { enabled: $('chat-enabled').checked } } })
  })

  $('chat-model').addEventListener('change', () => {
    void patch({ companion: { chat: { model: $('chat-model').value } } })
  })

  $('chat-max-tokens').addEventListener('change', () => {
    void patch({ companion: { chat: { maxTokens: Number($('chat-max-tokens').value) } } })
  })

  $('chat-temperature').addEventListener('input', (event) => {
    renderRangeLabel('chat-temperature', event.target.value, 1)
  })
  $('chat-temperature').addEventListener('change', (event) => {
    void patch({ companion: { chat: { temperature: Number(event.target.value) } } })
  })

  $('chat-history-limit').addEventListener('change', () => {
    void patch({
      companion: { chat: { historyLimit: Number($('chat-history-limit').value) } }
    })
  })

  // 人格
  $('persona-enabled').addEventListener('change', () => {
    void patch({ companion: { persona: { enabled: $('persona-enabled').checked } } })
    void renderPersonaPreview()
  })

  // 贴近时刻：打开前再确认一次；取消就把开关拨回去，不留半开状态。
  $('intimacy-enabled').addEventListener('change', () => {
    const toggle = $('intimacy-enabled')
    if (toggle.checked !== true) {
      void patch({ companion: { intimacy: { enabled: false } } })
      return
    }
    const agreed = confirmAction({
      message:
        '打开后，她会在桌面本机、有由头的时候偶尔靠近一点；QQ 私聊要另外在观察台逐个打开，群聊不会触发。要打开吗？'
    })
    if (agreed !== true) {
      toggle.checked = false
      return
    }
    void patch({ companion: { intimacy: { enabled: true } } })
  })

  // 两个节奏滑杆：拖动只改读数，松手才写入，免得一路拖一路落盘。
  $('intimacy-idle').addEventListener('input', (event) => {
    $('intimacy-idle-value').textContent =
      `${Number(event.target.value)} ${intimacyUnit('persona.intimacyHoursUnit', '小时')}`
  })
  $('intimacy-idle').addEventListener('change', (event) => {
    void patch({ companion: { intimacy: { idleHours: Number(event.target.value) } } })
  })
  $('intimacy-aftercare').addEventListener('input', (event) => {
    $('intimacy-aftercare-value').textContent =
      `${Number(event.target.value)} ${intimacyUnit('persona.intimacyMinutesUnit', '分钟')}`
  })
  $('intimacy-aftercare').addEventListener('change', (event) => {
    void patch({ companion: { intimacy: { aftercareMinutes: Number(event.target.value) } } })
  })

  $('persona-extra').addEventListener('input', () => {
    updatePersonaCount()
  })

  $('persona-extra').addEventListener('change', () => {
    void patch({ companion: { persona: { extraPrompt: $('persona-extra').value } } })
    void renderPersonaPreview()
  })

  // 人格编辑（七个核心段落 + 三个补充维度）：输入时只更新字数，失焦或回车结束后落盘；
  // 恢复默认写空串继续跟随默认。
  for (const key of PERSONA_SECTIONS) {
    const field = personaField(key)
    if (field === null) continue
    field.addEventListener('input', () => updatePersonaSectionCount(key))
    field.addEventListener('change', () => {
      void savePersonaSection(key)
    })
    $(`persona-section-${key}-reset`)?.addEventListener('click', () => {
      field.value = personaSectionDefaults[key] ?? ''
      updatePersonaSectionCount(key)
      void (async () => {
        await patch({ companion: { persona: { sections: { [key]: '' } } } })
        await renderPersonaPreview()
      })()
    })
  }

  // 模块开关。写进 settings.modules，主窗口下次启动按它决定是否 bootstrap；
  // 气泡的显隐由主窗口监听 settings 变更即时处理。
  for (const [boxId, moduleId] of Object.entries({
    'module-bubble': 'builtin.bubble',
    'module-reminder': 'builtin.reminder',
    'module-balance': 'builtin.balance'
  })) {
    $(boxId).addEventListener('change', (event) => {
      void patch({ modules: { [moduleId]: { enabled: event.target.checked } } })
    })
  }

  // 概览：三步引导只负责带路，具体设置仍在各自面板。
  $('overview-open-chat').addEventListener('click', () => showPanel('connection'))
  $('overview-open-voice').addEventListener('click', () => showPanel('voice'))
  $('overview-open-company').addEventListener('click', () => showPanel('routine'))
  $('overview-open-insight').addEventListener('click', async () => {
    try {
      await window.pet.openInsight()
    } catch (error) {
      window.alert(`打开观察台失败：${error instanceof Error ? error.message : String(error)}`)
    }
  })

  // 能力中心：窗口由主进程单例管理，这里只负责把请求发出去。
  $('open-ability-center').addEventListener('click', async () => {
    try {
      await window.pet.openAbilityCenter()
    } catch (error) {
      window.alert(`打开能力中心失败：${error instanceof Error ? error.message : String(error)}`)
    }
  })

  // 游戏：排班、周常、检测、运行记录都搬到独立页面了，这里只留入口和一行状态。
  //
  // 设置窗不再重复一套逐项开关：同一个配置摆在两处，
  // 早晚会出现「这里改了、那边没刷新」的问题，所以只留一个跳转。
  async function refreshGameEntry() {
    const node = $('game-entry-status')
    if (node === null) return

    if (typeof window.pet?.gameDailyState !== 'function') {
      node.textContent = '当前版本没有游戏模块。'
      return
    }

    try {
      const result = await window.pet.gameDailyState()
      const games = result?.state?.games ?? {}
      const enabled = Object.entries(games)
        .filter(([, item]) => item?.enabled === true)
        .map(([key]) => key)

      node.textContent =
        enabled.length === 0
          ? '还没有启用的游戏。打开游戏页可以排班。'
          : `已启用 ${enabled.length} 个：${enabled.join('、')}`
    } catch (error) {
      node.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`
    }
  }

  const gameEntryButton = $('open-game-page')
  if (gameEntryButton !== null) {
    gameEntryButton.addEventListener('click', async () => {
      if (typeof window.pet?.openGamePage !== 'function') {
        gameEntryButton.textContent = '当前版本没有游戏页'
        return
      }
      try {
        await window.pet.openGamePage()
      } catch (error) {
        window.alert(`打开游戏页失败：${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }

  void refreshGameEntry()

  // 哔哩哔哩：登录态只读展示（有没有 SESSDATA），扫码登录与首页都复用陪看窗
  // （persist:cyrene-bili 独立分区）。在陪看窗里扫码登录后，切回设置窗触发
  // focus 事件，状态自动刷新，不用重启。
  async function refreshBiliEntry() {
    const node = $('bili-login-status')
    if (node === null) return

    if (typeof window.pet?.biliLoginStatus !== 'function') {
      node.textContent = '当前版本没有 B 站模块。'
      return
    }

    try {
      const status = await window.pet.biliLoginStatus()
      node.textContent = status?.loggedIn === true ? '已登录' : '未登录 · 可点右侧「扫码登录」'
    } catch (error) {
      node.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`
    }
  }

  $('bili-open-login')?.addEventListener('click', async () => {
    try {
      await window.pet.biliOpen('https://passport.bilibili.com/login')
    } catch (error) {
      window.alert(`打开登录页失败：${error instanceof Error ? error.message : String(error)}`)
    }
  })

  $('bili-open-home')?.addEventListener('click', async () => {
    try {
      await window.pet.biliOpen('https://www.bilibili.com')
    } catch (error) {
      window.alert(`打开 B 站失败：${error instanceof Error ? error.message : String(error)}`)
    }
  })

  window.addEventListener('focus', () => void refreshBiliEntry())
  void refreshBiliEntry()
  void refreshQqStatus()
  // 状态只在主进程真实变化后更新，轮询只读，不会触发重连。
  setInterval(() => {
    if (!document.hidden) void refreshQqStatus()
  }, 5000)

  // QQ：改一项存一项，失焦/切换即落盘；密钥单独走 Vault。
  const qqBusy = (button, busy) => {
    if (button === null || button === undefined) return
    button.setAttribute('aria-disabled', busy ? 'true' : 'false')
  }
  const qqIsBusy = (button) =>
    button !== null && button !== undefined && button.getAttribute('aria-disabled') === 'true'

  function renderQqRuntime(info) {
    const stateNode = $('qq-runtime-state')
    const detailNode = $('qq-runtime-detail')
    const inboundNode = $('qq-last-inbound')
    if (inboundNode !== null) {
      const openId = typeof info?.lastInboundOpenId === 'string' ? info.lastInboundOpenId : ''
      inboundNode.textContent =
        openId === '' ? t('qq.lastInboundEmpty') : t('qq.lastInboundValue').replace('{openid}', openId)
    }
    if (stateNode === null || detailNode === null) return
    if (info === null || info === undefined || info.enabled !== true) {
      stateNode.dataset.tone = 'off'
      stateNode.textContent = t('qq.runtimeOff')
      detailNode.textContent = info?.reason || t('qq.enabledHint')
      return
    }
    const labels = {
      starting: t('qq.runtimeStarting'),
      ready: t('qq.runtimeReady'),
      error: t('qq.runtimeError'),
      off: t('qq.runtimeOff')
    }
    stateNode.dataset.tone = info.state === 'ready' ? 'ok' : info.state === 'error' ? 'error' : 'off'
    stateNode.textContent = labels[info.state] ?? t('qq.runtimeOff')
    const parts = []
    if (typeof info.reason === 'string' && info.reason !== '') parts.push(info.reason)
    if (Number(info.queued) > 0) {
      parts.push(t('qq.runtimeQueued').replace('{count}', String(info.queued)))
    }
    if (info.transport === 'webhook') {
      const port = info.webhook?.port
      if (info.webhook?.listening === true) {
        parts.push(t('qq.runtimeWebhook').replace('{port}', String(port ?? '—')))
      } else if (info.webhook?.error) {
        parts.push(t('qq.runtimeWebhookFailed'))
      }
    }
    detailNode.textContent = parts.length === 0 ? '—' : parts.join(' · ')
  }

  async function refreshQqStatus() {
    if (typeof window.pet?.qqStatus !== 'function') return
    try {
      renderQqRuntime(await window.pet.qqStatus())
    } catch {
      renderQqRuntime({ enabled: true, state: 'error', reason: t('qq.runtimeError') })
    }
  }

  // 主进程重建通道有 400ms 防抖；稍后再读一次，避免立刻读到旧状态。
  const refreshQqStatusSoon = () => {
    setTimeout(() => void refreshQqStatus(), 600)
  }

  const saveQq = async (fields) => {
    await patch({ channels: { qq: fields } })
    refreshQqStatusSoon()
  }
  $('qq-enabled')?.addEventListener('change', (event) => {
    void saveQq({ enabled: event.target.checked === true })
  })
  /* 记忆隐私模式：记忆面板与账号面板各一个开关，读写同一份 state，两处互相同步 */
  const applyPrivacyMode = (checked, source) => {
    if (checked === true) {
      $('qq-privacy-mode').checked = true
      $('memory-privacy-mode').checked = true
      void saveQq({ privacyMode: true })
      return
    }
    source.checked = true
    const ok = confirmAction({
      strength: 'danger',
      confirmWord: '关闭',
      message: [
        '关闭记忆隐私模式后，会同时发生这些事：',
        '1. 群聊里每个人的发言都会并回主人这条记忆，不再按群、按发言人分开。',
        '2. 桌面窗口的人格提示词会带上群聊与陌生私聊的内容，打开窗口就可能看见。',
        '3. 在任何一个群里，她都可能顺势说出主人在别处说过的私事。',
        '4. 陌生私聊的内容也会进入同一条检索，别人问起时可能被回忆出来。',
      ].join('\n'),
    })
    if (ok !== true) return
    $('qq-privacy-mode').checked = false
    $('memory-privacy-mode').checked = false
    void saveQq({ privacyMode: false })
  }
  $('qq-privacy-mode')?.addEventListener('change', (event) => {
    applyPrivacyMode(event.target.checked === true, event.target)
  })
  $('memory-privacy-mode')?.addEventListener('change', (event) => {
    applyPrivacyMode(event.target.checked === true, event.target)
  })
  $('qq-imitate-format')?.addEventListener('change', (event) => {
    void saveQq({ imitateFormat: event.target.checked === true })
  })
  $('qq-transport')?.addEventListener('change', (event) => {
    updateQqTransportVisibility()
    void saveQq({ transport: event.target.value === 'webhook' ? 'webhook' : 'gateway' })
  })
  $('qq-app-id')?.addEventListener('change', (event) => {
    void saveQq({ appId: String(event.target.value ?? '').trim() })
  })
  $('qq-owners')?.addEventListener('change', () => {
    void saveQq({ ownerOpenIds: readQqOwners() })
  })
  $('qq-target')?.addEventListener('change', (event) => {
    void saveQq({ targetOpenId: String(event.target.value ?? '').trim() })
  })
  $('qq-public-key')?.addEventListener('change', (event) => {
    void saveQq({ publicKey: String(event.target.value ?? '').trim() })
  })
  $('qq-port')?.addEventListener('change', (event) => {
    const port = Number(event.target.value)
    const safe = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 8787
    event.target.value = String(safe)
    void saveQq({ webhookPort: safe })
  })

  $('qq-secret-save')?.addEventListener('click', async () => {
    const input = $('qq-secret')
    const value = String(input?.value ?? '').trim()
    if (value === '') {
      input?.focus()
      return
    }
    const button = $('qq-secret-save')
    if (qqIsBusy(button)) return
    qqBusy(button, true)
    try {
      await window.pet.setSecret(QQ_SECRET_SERVICE, value, QQ_SECRET_FIELD)
      input.value = ''
      await refreshQqMask()
      refreshQqStatusSoon()
      showSaved()
    } catch (error) {
      $('qq-secret-mask').textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      qqBusy(button, false)
    }
  })

  $('qq-secret-clear')?.addEventListener('click', async () => {
    const button = $('qq-secret-clear')
    if (qqIsBusy(button)) return
    if (
      !confirmAction({
        message: '清除已保存的 QQ 令牌？机器人会立刻断开，直到重新填写。',
        strength: 'danger',
        confirmWord: '清除'
      })
    ) {
      return
    }
    qqBusy(button, true)
    try {
      await window.pet.clearSecret(QQ_SECRET_SERVICE, QQ_SECRET_FIELD)
      $('qq-secret').value = ''
      await refreshQqMask()
      refreshQqStatusSoon()
      showSaved()
    } catch (error) {
      $('qq-secret-mask').textContent = `清除失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      qqBusy(button, false)
    }
  })

  $('qq-test')?.addEventListener('click', async () => {
    if (typeof window.pet?.qqTest !== 'function') return
    const button = $('qq-test')
    const result = $('qq-test-result')
    if (button === null || result === null) return
    if (qqIsBusy(button)) return
    qqBusy(button, true)
    result.textContent = '测试中…'
    try {
      const payload = await window.pet.qqTest()
      if (payload?.ok === true) {
        result.textContent = `网关可达 ${payload.gatewayHost || ''}`.trim()
      } else {
        const reason = payload?.reason ?? 'unknown'
        result.textContent =
          reason === 'missing-app-id'
            ? '缺少 AppID'
            : reason === 'missing-secret'
              ? '缺少 AppSecret'
              : `失败：${payload?.message ?? reason}`
      }
    } catch (error) {
      result.textContent = `失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      qqBusy(button, false)
      refreshQqStatusSoon()
    }
  })

  // 观察模式：把最近一条入站消息的发送者一键写进主人名单，主进程会随即重建通道。
  $('qq-bind-owner')?.addEventListener('click', async () => {
    if (typeof window.pet?.bindQqOwner !== 'function') return
    const button = $('qq-bind-owner')
    const hint = $('qq-last-inbound')
    if (button === null) return
    if (qqIsBusy(button)) return
    qqBusy(button, true)
    try {
      const result = await window.pet.bindQqOwner()
      if (result?.ok === true) {
        const owners = $('qq-owners')
        if (owners !== null && Array.isArray(result.ownerOpenIds)) {
          owners.value = result.ownerOpenIds.join(', ')
        }
        if (hint !== null) hint.textContent = t('qq.bindDone')
        showSaved()
      } else if (result?.reason === 'no-inbound') {
        if (hint !== null) hint.textContent = t('qq.bindNoInbound')
      } else if (hint !== null) {
        const detail = result?.message ?? result?.reason ?? ''
        hint.textContent = `${t('qq.bindFailed')}${detail}`
      }
    } catch (error) {
      if (hint !== null) {
        hint.textContent = `${t('qq.bindFailed')}${error instanceof Error ? error.message : String(error)}`
      }
    } finally {
      qqBusy(button, false)
      refreshQqStatusSoon()
    }
  })

  // DeepSeek 密钥：保存后立刻清空输入框，界面只留掩码。
  // 明文只在这一次 IPC 里出现，之后主进程也不回传。
  $('deepseek-save').addEventListener('click', async () => {
    const input = $('deepseek-key')
    const value = input.value.trim()
    if (value === '') {
      input.focus()
      return
    }

    const button = $('deepseek-save')
    button.disabled = true
    try {
      await window.pet.setSecret(DEEPSEEK_SERVICE, value, DEEPSEEK_FIELD)
      input.value = ''
      clearPending('deepseek-key')
      await refreshDeepSeekMask()
      showSaved()
    } catch (error) {
      $('deepseek-mask').textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      button.disabled = false
    }
  })

  $('balance-check')?.addEventListener('click', async () => {
    const button = $('balance-check')
    const result = $('balance-result')
    if (button === null || result === null) return
    button.disabled = true
    result.textContent = '…'
    try {
      const info = await window.pet.queryBalance()
      if (info?.ok === true) {
        const total = Number(info.totalBalance)
        const spent = Number(info.todaySpent)
        const parts = [Number.isFinite(total) ? `¥${total.toFixed(2)}` : '—']
        if (Number.isFinite(spent)) {
          parts.push(`${t('connection.balanceToday')} ≈¥${spent.toFixed(2)}`)
        }
        result.textContent = parts.join(' · ')
      } else if (info?.reason === 'no-key') {
        result.textContent = t('connection.balanceNoKey')
      } else {
        result.textContent = `${t('connection.balanceFailed')}（${String(info?.reason ?? 'unknown')}）`
      }
    } catch {
      result.textContent = t('connection.balanceFailed')
    } finally {
      button.disabled = false
    }
  })

  $('deepseek-clear').addEventListener('click', async () => {
    if (
      !confirmAction({
        message:
          '清除后本机不再保存这把 Key：余额查询、聊天、主动台词与云端语音合成会立刻停用，余额状态显示为未配置；本地音色、提醒与巡视汇总不受影响。DeepSeek 账户本身不受影响，重新粘贴即可恢复。'
      })
    ) {
      return
    }
    const button = $('deepseek-clear')
    button.disabled = true
    try {
      await window.pet.clearSecret(DEEPSEEK_SERVICE, DEEPSEEK_FIELD)
      $('deepseek-key').value = ''
      await refreshDeepSeekMask()
      showSaved()
    } catch (error) {
      $('deepseek-mask').textContent = `清除失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      button.disabled = false
    }
  })

  // 一键备份：目录、保留份数与自动节奏存在主进程的小配置里；
  // 自动备份口令由主进程用系统密钥加密保存，渲染侧始终拿不到明文。
  async function refreshBackupConfig() {
    const hint = $('backup-dir-hint')
    const keepInput = $('backup-keep')
    const status = $('backup-status')
    const autoEnabled = $('backup-auto-enabled')
    const autoDays = $('backup-auto-days')
    const autoStatus = $('backup-auto-status')
    const latestHint = $('backup-latest-hint')
    try {
      const config = await window.pet.backupConfig()
      if (hint !== null) {
        hint.textContent =
          typeof config?.dirName === 'string' && config.dirName !== ''
            ? `${t('backup.dirChosen')}：${config.dirName}`
            : `${t('backup.dirFallback')}：${config?.fallbackDirName ?? ''}`
      }
      if (keepInput !== null && Number.isInteger(config?.keep)) {
        keepInput.value = String(config.keep)
      }
      if (status !== null && typeof config?.lastRunAt === 'string' && config.lastRunAt !== '') {
        status.textContent = `${t('backup.lastRun')}：${new Date(config.lastRunAt).toLocaleString()}`
      }

      const intervalDays = Number.isInteger(config?.autoIntervalDays) ? config.autoIntervalDays : 0
      if (autoEnabled !== null) autoEnabled.checked = intervalDays > 0
      if (autoDays !== null) autoDays.value = String(intervalDays > 0 ? intervalDays : 7)
      if (autoStatus !== null) {
        if (intervalDays <= 0) {
          autoStatus.textContent = t('backup.autoOff')
        } else if (typeof config?.autoLastError === 'string' && config.autoLastError !== '') {
          autoStatus.textContent = `${t('backup.autoError')}：${config.autoLastError}`
        } else if (typeof config?.lastRunAt === 'string' && config.lastRunAt !== '') {
          autoStatus.textContent = `${t('backup.autoOn')}：${new Date(config.lastRunAt).toLocaleString()}`
        } else {
          autoStatus.textContent = t('backup.autoOn')
        }
      }

      if (latestHint !== null) {
        try {
          const latest = await window.pet.backupFindLatest()
          latestHint.textContent =
            latest?.found === true
              ? `${latest.fileName} · ${new Date(latest.mtime).toLocaleString()} · ${latest.path}`
              : `${t('backup.latestNone')}（${latest?.dir ?? ''}）`
        } catch {
          // 扫描失败时保留默认文案，不影响其它设置。
        }
      }
    } catch {
      // 读不到配置就保持默认文案，不影响手动备份。
    }
  }

  $('backup-choose-dir')?.addEventListener('click', async () => {
    const result = await window.pet.backupChooseDir()
    if (result?.ok === true) await refreshBackupConfig()
  })

  $('backup-keep')?.addEventListener('change', async () => {
    const input = $('backup-keep')
    const status = $('backup-status')
    const result = await window.pet.backupSetKeep(Number(input?.value))
    if (result?.ok !== true && status !== null) {
      status.textContent = result?.message ?? t('backup.keepInvalid')
    }
  })

  $('backup-auto-enabled')?.addEventListener('change', async (event) => {
    const checkbox = event.target
    const daysInput = $('backup-auto-days')
    const autoStatus = $('backup-auto-status')
    const passwordInput = $('backup-password')
    const enabled = checkbox?.checked === true
    const days = Math.max(1, Math.min(365, Number(daysInput?.value) || 7))
    const password = typeof passwordInput?.value === 'string' ? passwordInput.value : ''
    if (checkbox !== null) checkbox.disabled = true
    try {
      const result = await window.pet.backupSetAuto(enabled ? days : 0, password)
      if (result?.ok !== true) {
        if (checkbox !== null) checkbox.checked = false
        if (autoStatus !== null) {
          autoStatus.textContent =
            result?.reason === 'need-password'
              ? t('backup.autoNeedPassword')
              : (result?.message ?? t('backup.autoFailed'))
        }
        return
      }
      await refreshBackupConfig()
    } finally {
      if (checkbox !== null) checkbox.disabled = false
    }
  })

  $('backup-auto-days')?.addEventListener('change', () => {
    const checkbox = $('backup-auto-enabled')
    if (checkbox?.checked !== true) return
    checkbox.dispatchEvent(new Event('change'))
  })

  $('backup-run')?.addEventListener('click', async () => {
    const input = $('backup-password')
    const status = $('backup-status')
    const password = input?.value ?? ''
    if (!BackupPolicy.isPassphraseLongEnough(password)) {
      status.textContent = BackupPolicy.passphraseTooShortMessage()
      return
    }
    const advice = BackupPolicy.passphraseAdvice(password)
    if (
      !confirmAction({
        message: `${advice}备份会落到选定目录，并只保留最近几份。确定开始吗？`
      })
    ) {
      return
    }

    status.textContent = '正在备份…'
    try {
      const result = await window.pet.backupRun(password)
      if (result?.ok !== true) {
        status.textContent = `备份失败：${result?.message ?? result?.reason ?? '未知原因'}`
        return
      }
      const removed = Number(result.removed) || 0
      status.textContent =
        `已备份 ${result.fileName}` + (removed > 0 ? `，清理了 ${removed} 份旧备份` : '')
    } catch (error) {
      status.textContent = `备份失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      if (input) input.value = ''
    }
  })

  void refreshBackupConfig()

  // 加密备份：口令只在这次调用里出现，不写进设置，也不做本地缓存。
  $('backup-export')?.addEventListener('click', async () => {
    const input = $('backup-password')
    const status = $('backup-status')
    const password = input?.value ?? ''
    if (!BackupPolicy.isPassphraseLongEnough(password)) {
      status.textContent = BackupPolicy.passphraseTooShortMessage()
      return
    }
    const advice = BackupPolicy.passphraseAdvice(password)
    if (
      !confirmAction({
        message: `${advice}口令丢失后无法找回，也没有重置入口。确定继续导出吗？`
      })
    ) {
      return
    }

    status.textContent = '正在导出…'
    try {
      const result = await window.pet.vaultExport(password)
      if (result?.ok !== true) {
        status.textContent =
          result?.reason === 'canceled'
            ? '已取消'
            : `导出失败：${result?.message ?? result?.reason ?? '未知原因'}`
        return
      }
      status.textContent = `已导出 ${result.fileCount ?? 0} 个文件`
    } catch (error) {
      status.textContent = `导出失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      if (input) input.value = ''
    }
  })

  $('backup-import')?.addEventListener('click', async () => {
    const input = $('backup-password')
    const status = $('backup-status')
    const password = input?.value ?? ''
    if (!BackupPolicy.isPassphraseLongEnough(password)) {
      status.textContent = BackupPolicy.passphraseTooShortMessage()
      return
    }
    if (
      !confirmAction({
        message: '导入会覆盖本机现有的密钥与记忆，并需要重启；口令必须与导出时一致。',
        strength: 'danger',
        confirmWord: '导入'
      })
    ) {
      return
    }

    status.textContent = '正在导入…'
    try {
      const result = await window.pet.vaultImport(password)
      if (result?.ok !== true) {
        status.textContent =
          result?.reason === 'canceled'
            ? '已取消'
            : `导入失败：${result?.message ?? result?.reason ?? '未知原因'}`
        return
      }
      status.textContent = result.restartRequired === true ? '导入完成，正在重启…' : '导入完成'
    } catch (error) {
      status.textContent = `导入失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      if (input) input.value = ''
    }
  })

  // 轮换密钥：只影响之后的写入；旧记忆靠原 keyId 继续读，不会丢。
  $('backup-rotate')?.addEventListener('click', async () => {
    const button = $('backup-rotate')
    const status = $('rotate-status')
    if (
      !confirmAction({
        message:
          '会换一把新的数据密钥用于之后的写入。已有记忆和聊天历史仍能读，但用旧密钥导出的备份将无法再与当前数据合并。请先导出一次备份再操作。',
        strength: 'danger',
        confirmWord: '轮换'
      })
    ) {
      return
    }

    button.disabled = true
    status.textContent = '正在轮换…'
    try {
      const result = await window.pet.vaultRotate()
      if (result?.ok !== true) {
        status.textContent = `轮换失败：${result?.message ?? result?.reason ?? '未知原因'}`
        return
      }
      status.textContent = `已轮换：epoch ${result.from} → ${result.to}`
    } catch (error) {
      status.textContent = `轮换失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      button.disabled = false
    }
  })

  // 填写未提交：只标记真正需要按按钮才生效的输入
  for (const id of ['deepseek-key', 'backup-password']) {
    $(id)?.addEventListener('input', (event) => {
      if (String(event.target.value ?? '').trim() === '') clearPending(id)
      else markPending(id)
    })
  }

  $('close-btn').addEventListener('click', () => {
    if (
      pendingInputs.size > 0 &&
      !confirmAction({ message: '还有填写未提交，关窗后需要重新输入。确定关闭吗？' })
    ) {
      return
    }
    void window.pet.closeSettings()
  })

  // 右上角窗口按钮：自绘顶栏，最小化 / 最大化 / 关闭都从这里走。
  document.getElementById('win-min')?.addEventListener('click', () => {
    void window.pet?.minimizeSettings?.()
  })
  document.getElementById('win-max')?.addEventListener('click', () => {
    void window.pet?.toggleMaximizeSettings?.()
  })
  document.getElementById('win-close')?.addEventListener('click', () => {
    void window.pet?.closeSettings?.()
  })

  // 搜索：输入即过滤，清空即恢复完整列表；回车 / 上下键在命中项之间跳。
  $('settings-search').addEventListener('input', (event) => {
    runSearch(event.target.value)
  })
  $('settings-search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      stepSearchHit(event.shiftKey ? -1 : 1)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      stepSearchHit(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      stepSearchHit(-1)
    }
  })

  injectSectionResets()
  injectModuleResets()

  // 分组恢复默认：按钮自己声明恢复哪几个顶层键
  for (const button of document.querySelectorAll('.section-reset')) {
    button.addEventListener('click', () => {
      void resetSection(button)
    })
  }

  $('reset-all-settings')?.addEventListener('click', () => {
    void resetAllSettings()
  })

  $('factory-reset')?.addEventListener('click', () => {
    void factoryReset()
  })

  // Esc 先清搜索、再关窗；Ctrl/Cmd+F 聚焦搜索
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const search = $('settings-search')
      if (search !== null && search.value !== '') {
        search.value = ''
        clearSearchFilter()
        search.blur()
        return
      }
      void window.pet.closeSettings()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      $('settings-search')?.focus()
    }
  })

  // 设置窗保持打开时，主窗口改了尺寸要能反映最新值
  window.addEventListener('focus', () => {
    void refreshDiagnostics()
  })
}

// 主进程只回 state，人话统一走 reason-text.js；这里不再维护第二份映射。
function describeVoiceState(status) {
  const key = window.CyreneReasonText.voiceKey(status?.state)
  return key === null ? t('voice.state.unknown') : t(key)
}

// 密钥环状态给的是「现在能不能读到旧数据」，不是安全评级；措辞不做美化。
function describeKeyRingState(diagnostic) {
  if (diagnostic?.ok === false) return '不可用'
  // 迁移失败时明文可能还留在 settings.json，这条比密钥环状态更需要先看到。
  if (diagnostic?.legacyKeyMigration !== null && diagnostic?.legacyKeyMigration !== undefined) {
    return '⚠️ 明文密钥未迁移 · settings.json 里可能仍有 LLM Key'
  }
  const ring = diagnostic?.keyRingState
  if (ring === 'quarantined') return '已隔离重建 · 旧数据可能打不开'
  if (ring === 'rebuilt') return '已重建 · 旧数据可能打不开'
  const signer = diagnostic?.signerState === 'unavailable' ? ' · 签名不可用' : ''
  return `正常（${diagnostic?.backend ?? '未知后端'}）${signer}`
}

/** 四卡片里的时间只到分钟，不显示秒和时区，扫一眼就够。 */
function formatStatusTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function setStatusCard(id, value, tone, note) {
  const node = $(id)
  if (node === null) return
  node.textContent = value
  if (tone) node.dataset.tone = tone
  const noteNode = $(`${id}-note`)
  if (noteNode !== null) noteNode.textContent = note ?? ''
}

/**
 * 运行状态四卡片：QQ / 记忆条数 / 今天主动次数 / 上次反思。
 * 全部来自主进程只读快照；拿不到的项明确写「不可用」，不猜。
 */
async function refreshStatusCards() {
  if ($('status-card-qq') === null) return
  if (typeof window.pet?.statusSummary !== 'function') {
    for (const id of ['status-card-qq', 'status-card-memory', 'status-card-proactive', 'status-card-reflection']) {
      setStatusCard(id, t('status.cardUnknown'), 'off', '')
    }
    return
  }
  try {
    const info = await window.pet.statusSummary()
    const qq = info?.qq ?? {}
    const qqReady = qq.enabled === true && qq.state === 'ready'
    const qqLabel = qq.enabled !== true
      ? t('status.cardQqOff')
      : qqReady
        ? t('status.cardQqOn')
        : qq.state === 'error'
          ? t('status.cardQqError')
          : t('status.cardQqStarting')
    setStatusCard(
      'status-card-qq',
      qqLabel,
      qqReady ? 'ok' : qq.state === 'error' ? 'warn' : 'off',
      qq.reason || (qq.observeOnly === true ? t('status.cardQqObserve') : '')
    )

    const memory = info?.memory ?? {}
    const memoryCount = Number.isFinite(memory.count) ? memory.count : null
    setStatusCard(
      'status-card-memory',
      memoryCount === null ? t('status.cardUnknown') : t('status.cardMemoryValue').replace('{count}', String(memoryCount)),
      memoryCount === null ? 'off' : 'ok',
      memoryCount === null
        ? t('status.cardMemoryUnavailable')
        : t('status.cardMemoryNote').replace('{limit}', String(memory.limit ?? '—'))
    )

    const spoken = info?.proactive?.spokenToday
    setStatusCard(
      'status-card-proactive',
      Number.isFinite(spoken) ? t('status.cardProactiveValue').replace('{count}', String(spoken)) : t('status.cardUnknown'),
      Number.isFinite(spoken) ? 'ok' : 'off',
      Number.isFinite(spoken) ? t('status.cardProactiveNote') : ''
    )

    const lastAt = info?.reflection?.lastAt
    setStatusCard(
      'status-card-reflection',
      typeof lastAt === 'string' && lastAt !== '' ? formatStatusTime(lastAt) : t('status.cardReflectionNever'),
      typeof lastAt === 'string' && lastAt !== '' ? 'ok' : 'off',
      typeof lastAt === 'string' && lastAt !== '' ? t('status.cardReflectionNote') : t('status.cardReflectionHint')
    )

    // 内存超过告警线时把读数挂到记忆卡片下面，不另开一张卡。
    const guard = info?.memoryGuard
    if (guard?.last !== null && guard?.last !== undefined) {
      const memoryNote = $('status-card-memory-note')
      if (memoryNote !== null) {
        const suffix = t('status.cardMemoryPeak')
          .replace('{rss}', String(guard.last.rssMb ?? '—'))
          .replace('{warn}', String(guard.thresholds?.warnMb ?? '—'))
        memoryNote.textContent = `${memoryNote.textContent}${memoryNote.textContent === '' ? '' : ' · '}${suffix}`
      }
    }
  } catch (error) {
    console.error('[settings] 运行状态读取失败', error)
    for (const id of ['status-card-qq', 'status-card-memory', 'status-card-proactive', 'status-card-reflection']) {
      setStatusCard(id, t('status.cardUnknown'), 'off', '')
    }
  }
}

/**
 * 一键诊断：只复制脱敏后的读数，不带绝对路径、密钥或聊天正文。
 * 用户拿这段去求助时，别人能看懂发生了什么，也不会看到私密内容。
 */
function describeChannelHealth(value) {
  if (value === null || typeof value !== 'object') return '—'
  const parts = []
  if (value.state !== undefined) parts.push(String(value.state))
  if (value.ok === false && value.code !== undefined) parts.push(String(value.code))
  if (value.message !== undefined) parts.push(String(value.message))
  return parts.length > 0 ? parts.join(' · ') : '未知'
}

async function copyDiagnostics() {
  const button = $('diagnostics-copy')
  const restore = () => {
    if (button !== null) button.textContent = t('status.copyDiag')
  }
  try {
    if (typeof window.pet?.statusSummary !== 'function' || typeof window.pet?.diagnostics !== 'function') {
      throw new Error('diagnostics-unavailable')
    }
    const [status, diagnostics] = await Promise.all([window.pet.statusSummary(), window.pet.diagnostics()])
    const qq = status?.qq ?? {}
    const guard = status?.memoryGuard
    const buildLabel = buildInfoLabel(diagnostics?.app)
    const lines = [
      `时间：${new Date().toISOString()}`,
      `版本：${diagnostics?.app?.version ?? '—'}（Electron ${diagnostics?.app?.electron ?? '—'}）${buildLabel ? ` · ${buildLabel}` : ''}`,
      `QQ：${qq.enabled === true ? qq.state ?? '—' : '未启用'}${qq.reason ? ` · ${qq.reason}` : ''}`,
      `记忆：${status?.memory?.count ?? '—'} / ${status?.memory?.limit ?? '—'}`,
      `今天主动：${status?.proactive?.spokenToday ?? '—'}`,
      `上次反思：${status?.reflection?.lastAt ?? '尚未生成'}`,
      `内存：${guard?.last?.rssMb ?? '—'} MB（告警 ${guard?.thresholds?.warnMb ?? '—'} MB / 释放 ${guard?.thresholds?.criticalMb ?? '—'} MB）`,
      `模型：${(diagnostics?.media?.models ?? []).length} 个`,
      `QQ 通道：${describeChannelHealth(diagnostics?.channels?.qq)}`,
      `IPC：白名单 ${diagnostics?.ipcChannels?.listed?.length ?? '—'} / 已登记 ${diagnostics?.ipcChannels?.registered?.length ?? '—'}`
    ]
    await navigator.clipboard.writeText(lines.join('\n'))
    if (button !== null) button.textContent = t('status.copied')
    setTimeout(restore, 1600)
  } catch (error) {
    console.error('[settings] 复制诊断失败', error)
    if (button !== null) button.textContent = t('status.copyFailed')
    setTimeout(restore, 1600)
  }
}

/** 构建标识：短提交 + 是否有未提交改动 + 构建时间；开发态没有 BUILD-INFO 时返回空串。 */
function buildInfoLabel(app) {
  const sha = typeof app?.sha === 'string' ? app.sha.slice(0, 7) : ''
  if (sha === '') return ''
  const dirty = app?.dirty === true ? '+' : ''
  const builtAt = typeof app?.builtAt === 'string' ? app.builtAt.slice(0, 16).replace('T', ' ') : ''
  return [sha + dirty, builtAt].filter((part) => part !== '').join(' · ')
}

/* ---------------- 动作试播 / 表情试看（MEM-134）----------------
 *
 * 设置页原本只有气泡预览、语音试听、人格预览，没有动作 / 表情的试配入口。
 * 参照那三处的写法补两块，都动态注入（settings.html 不允许动）：
 *  a) 动作试播：清单来自宠物窗渲染层上报的 motion catalog（getRenderInfo().motion），
 *     点一下试播。渲染层动作控制器只活在宠物窗口里，设置窗驱动它需要一条
 *     「设置窗 → 主进程 → 宠物窗」转发通道；preload / main 目前都没有，
 *     按铁律不在这里乱造 IPC 名 —— 先落到待接线清单（见本次改动报告）。
 *  b) 表情试看：列出表情库标签，点一下让立绘临时切到该表情几秒再恢复。
 *     同样没有现成通道，落在待接线清单。
 */

// 与 renderer/expression.mjs 的 EXPRESSION_TAGS 保持一致。
// 设置窗与宠物窗是两个窗口、各加载各的脚本，这里 import 不到那边的模块，
// 只能复制一份；改 expression.mjs 时记得同步这里。
const EXPRESSION_PREVIEW_TAGS = [
  ['neutral', '平常'],
  ['happy', '开心'],
  ['excited', '兴奋'],
  ['shy', '害羞'],
  ['gentle', '温柔'],
  ['sad', '难过'],
  ['angry', '生气'],
  ['surprised', '惊讶'],
  ['tired', '疲惫'],
  ['thinking', '思考']
]

function buildPreviewItem({ id, label, hint, chipsId, noteId, noteText }) {
  const item = document.createElement('div')
  item.className = 'item item-stack'
  item.id = id

  const text = document.createElement('div')
  text.className = 'item-text'
  const labelNode = document.createElement('div')
  labelNode.className = 'item-label'
  labelNode.textContent = label
  const hintNode = document.createElement('div')
  hintNode.className = 'item-hint'
  hintNode.textContent = hint
  text.append(labelNode, hintNode)

  const chips = document.createElement('div')
  chips.id = chipsId
  chips.style.display = 'flex'
  chips.style.flexWrap = 'wrap'
  chips.style.gap = '6px'

  const note = document.createElement('p')
  note.className = 'section-note'
  note.id = noteId
  note.textContent = noteText ?? ''

  item.append(text, chips, note)
  return item
}

/** 把两块试配 UI 挂到立绘区的「模型状态」说明下面。 */
function ensureMotionPreviewBlocks() {
  const anchor = $('model-status')
  if (anchor === null || $('motion-preview-item') !== null) return
  const motionItem = buildPreviewItem({
    id: 'motion-preview-item',
    label: '动作试播',
    hint: '列出她当前模型能播的动作，点一下在桌面试播',
    chipsId: 'motion-preview-chips',
    noteId: 'motion-preview-note',
    noteText: '等她登场后才会探测到动作清单'
  })
  const expressionItem = buildPreviewItem({
    id: 'expression-preview-item',
    label: '表情试看',
    hint: '点一下让立绘临时切到该表情，几秒后恢复',
    chipsId: 'expression-preview-chips',
    noteId: 'expression-preview-note',
    noteText: ''
  })
  // 表情标签是静态表，注入时直接铺好；动作按钮等渲染层上报后由
  // updateMotionPreviewChips 刷新（与诊断同节奏，2 秒一拍）。
  const expressionChips = expressionItem.querySelector('#expression-preview-chips')
  for (const [tag, label] of EXPRESSION_PREVIEW_TAGS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'inline-btn'
    button.textContent = label
    button.title = tag
    button.addEventListener('click', () => tryPreviewExpression(tag))
    expressionChips.append(button)
  }
  anchor.after(motionItem, expressionItem)
}

/** 用宠物窗上报的 motion catalog 刷新动作试播按钮；清单为空时给一句人话。 */
function updateMotionPreviewChips(motion) {
  const chips = $('motion-preview-chips')
  if (chips === null) return
  const actions = Array.isArray(motion?.actions) ? motion.actions : []
  const labels =
    motion?.labels !== null && typeof motion?.labels === 'object' ? motion.labels : {}
  if (actions.length === 0) {
    chips.replaceChildren()
    const note = $('motion-preview-note')
    if (note !== null) {
      note.textContent =
        motion === null || motion === undefined
          ? '等她登场后才会探测到动作清单'
          : '当前模型没有可试播的动作'
    }
    return
  }
  chips.replaceChildren()
  for (const key of actions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'inline-btn'
    button.textContent =
      typeof labels[key] === 'string' && labels[key] !== '' ? labels[key] : key
    button.title = key
    button.addEventListener('click', () => tryPreviewAction(key))
    chips.append(button)
  }
  const note = $('motion-preview-note')
  if (note !== null) {
    note.textContent =
      `动作 ${motion?.kind ?? '—'} · 自带 ${motion?.nativeCount ?? 0} · ` +
      `参数 ${motion?.paramCount ?? 0}${motion?.pixi === true ? ' · pixi ✓' : ''}`
  }
}

/**
 * 试播一个动作。渲染层的动作控制器只活在宠物窗口里；设置窗驱动它需要一条
 * 「设置窗 → 主进程 → 宠物窗」转发通道（建议 IPC 名：pet:window:action）。
 * 目前 preload.cjs / main.mjs 都没有这条通道，按铁律不在这里造 IPC，
 * 只把请求记进待接线清单；通道接通后实现 window.pet.playAction 即可生效。
 */
function tryPreviewAction(key) {
  const playAction = window.pet?.playAction
  if (typeof playAction === 'function') {
    void playAction(key)
    return
  }
  const note = $('motion-preview-note')
  if (note !== null) {
    note.textContent = `动作试播通道未接线（待接线清单：pet:window:action）· 当前选：${key}`
  }
}

/**
 * 表情试看：立绘临时切到该表情几秒再恢复。
 * 同样需要一条设置窗 → 宠物窗的转发通道（建议 IPC 名：pet:window:expression，
 * 载荷 { tag, holdMs }），preload / main 目前没有 —— 记入待接线清单。
 */
function tryPreviewExpression(tag) {
  const setExpression = window.pet?.setExpression
  if (typeof setExpression === 'function') {
    void setExpression({ tag, holdMs: 3000 })
    return
  }
  const note = $('expression-preview-note')
  if (note !== null) {
    note.textContent = `表情试看通道未接线（待接线清单：pet:window:expression）· 当前选：${tag}`
  }
}

async function refreshDiagnostics() {
  // 四卡片和长表格各自独立失败：其中一项拿不到，不应拖垮另一项。
  void refreshStatusCards()
  try {
    const info = await window.pet.diagnostics()
    const buildLabel = buildInfoLabel(info.app)
    $('diag-version').textContent = `${info.app?.version ?? '—'}（Electron ${info.app?.electron ?? '—'}）${buildLabel ? ` · ${buildLabel}` : ''}`

    const size = await window.pet.getWindowSize()
    $('diag-size').textContent = size === null ? '—' : `${size.width} × ${size.height}`

    const media = await window.pet.getRenderInfo()
    $('diag-media').textContent = media.media ?? '未加载'
    $('diag-frames').textContent = String(media.frames ?? '—')
    $('diag-hit').textContent = String(media.hit ?? '—')
    // 顺手把动作清单同步给立绘区的动作试播按钮（2 秒一拍，和诊断同节奏）。
    updateMotionPreviewChips(media?.motion ?? null)

    const settingsNow = await window.pet.getSettings()
    const modules = Object.entries(settingsNow.modules ?? {})
    $('diag-modules').textContent =
      modules.length === 0
        ? '未配置'
        : modules
            .map(([name, toggle]) => `${name.replace('builtin.', '')}=${toggle.enabled ? 'on' : 'off'}`)
            .join(' · ')

    const voiceNote = $('diag-voice')
    if (typeof window.pet.voiceStatus === 'function') {
      const status = await window.pet.voiceStatus()
      const text = describeVoiceState(status)
      voiceNote.textContent = text
      // 语音面板底部也显示同一份真实状态，不必切到「运行状态」才看得到。
      const panelNote = $('voice-service-note')
      if (panelNote !== null) panelNote.textContent = `${t('voice.statusLabel')}：${text}`
    } else {
      voiceNote.textContent = t('voice.state.unknown')
    }

    // 密钥环状态决定「换机/密钥丢失后旧数据还能不能读」，比备份按钮更需要先看到。
    const keyringNote = $('backup-keyring')
    if (keyringNote !== null && typeof window.pet.vaultDiagnose === 'function') {
      keyringNote.textContent = describeKeyRingState(await window.pet.vaultDiagnose())
    }
  } catch (error) {
    console.error('[settings] 诊断读取失败', error)
  }
}

/**
 * 素材包：导入 / 列出 / 删除，以及把包内文件填进四个来源选择器。
 * 清单来自主进程；这里只负责显示和把选择写回 settings，不拼绝对路径。
 */
let packs = []

/** 把当前包的某一类文件填进 select；当前值失效时保留一条可见的坏引用。 */
function fillPackSelect(select, kind, currentValue, emptyLabel) {
  if (select === null) return
  select.textContent = ''

  const empty = document.createElement('option')
  empty.value = ''
  empty.textContent = emptyLabel
  select.append(empty)

  const seen = new Set()
  for (const pack of packs.filter((entry) => entry.enabled !== false)) {
    for (const item of pack.files?.[kind] ?? []) {
      const value = `pack:${pack.id}:${item.file}`
      if (seen.has(value)) continue
      seen.add(value)
      const option = document.createElement('option')
      option.value = value
      option.textContent = `${pack.name || pack.id} · ${item.name}`
      select.append(option)
    }
  }

  if (currentValue !== '' && !seen.has(currentValue)) {
    const stale = document.createElement('option')
    stale.value = currentValue
    stale.textContent = `${t('packs.stale')}：${currentValue}`
    select.append(stale)
  }
  select.value = currentValue
}

/** 只把素材包清单读进来填选择器；导入与启停都在表情包页里做。 */
async function loadPacks() {
  if (typeof window.pet.listPacks !== 'function') return
  try {
    const result = await window.pet.listPacks()
    packs = Array.isArray(result?.packs) ? result.packs : []
  } catch {
    packs = []
  }
  renderPackSelectors()
}

/** 设置页只显示待审核数量，真正的队列在表情包页里。 */
async function refreshStickerPending() {
  const badge = $('sticker-pending')
  if (badge === null || typeof window.pet.listStickerInbox !== 'function') return
  try {
    const result = await window.pet.listStickerInbox()
    const items = Array.isArray(result?.items) ? result.items : []
    badge.hidden = items.length === 0
    badge.textContent =
      items.length === 0 ? '' : t('packs.pendingBadge').replace('{n}', String(items.length))
  } catch {
    badge.hidden = true
  }
}

/** 重填所有来源选择器。settings 里存的是 pack:<id>:<file>，不存真实路径。 */
function renderPackSelectors() {
  const bubble = current?.bubble ?? {}
  const icon = current?.icon ?? {}
  const sticker = current?.sticker ?? {}

  fillPackSelect($('icon-tray'), 'icon', icon.tray ?? '', '内置 Cyrene 托盘图标')
  fillPackSelect($('icon-app'), 'icon', icon.app ?? '', '内置 Cyrene 图标')
  fillPackSelect($('bubble-background'), 'bubble', bubble.background ?? '', '不用底图（纯色气泡）')
  fillPackSelect($('bubble-font'), 'font', bubble.fontFamily ?? '', '内置字体栈')
  fillPackSelect($('sticker-source'), 'emoji', sticker.source ?? '', '不显示贴纸')

  // 默认开启：只有显式写成 false 才关。
  const autoApprove = $('sticker-auto-approve')
  if (autoApprove !== null) autoApprove.checked = sticker.autoApprove !== false

  const slice = $('bubble-slice')
  if (slice !== null) slice.value = String(bubble.backgroundSlice ?? 12)
}

function pickSticker(value) {
  const select = $('sticker-source')
  if (select === null) return
  select.value = value
  select.dispatchEvent(new Event('change'))
}

function bindPackEvents() {
  for (const button of document.querySelectorAll('.open-stickers')) {
    button.addEventListener('click', () => {
      if (typeof window.pet.openStickerWindow === 'function') void window.pet.openStickerWindow()
    })
  }

  $('icon-tray')?.addEventListener('change', (event) => {
    void patch({ icon: { tray: event.target.value } })
  })
  $('icon-app')?.addEventListener('change', (event) => {
    void patch({ icon: { app: event.target.value } })
  })
  $('bubble-background')?.addEventListener('change', (event) => {
    renderBubblePreview()
    void patch({ bubble: { background: event.target.value } })
  })
  $('bubble-font')?.addEventListener('change', (event) => {
    renderBubblePreview()
    void patch({ bubble: { fontFamily: event.target.value } })
  })
  $('sticker-source')?.addEventListener('change', (event) => {
    void patch({ sticker: { source: event.target.value } })
  })
  $('sticker-auto-approve')?.addEventListener('change', (event) => {
    void patch({ sticker: { autoApprove: event.target.checked } })
  })
  $('bubble-slice')?.addEventListener('change', (event) => {
    const value = Number(event.target.value)
    const slice = Number.isFinite(value) ? Math.min(64, Math.max(4, Math.round(value))) : 12
    event.target.value = String(slice)
    void patch({ bubble: { backgroundSlice: slice } })
  })
}

/** 外部跳转指定的面板；只接受真实存在的 data-panel，拼错就留在当前页。 */
function showPanelIfExists(name) {
  if (typeof name !== 'string' || name === '') return
  const target = LEGACY_PANELS[name] ?? name
  const known = [...document.querySelectorAll('.panel')].map((panel) => panel.dataset.panel)
  if (known.includes(target)) showPanel(target)
}

async function main() {
  await loadSettings()
  bindEvents()
  // 素材包清单要等设置读完后才能对齐当前选择。
  await loadPacks()
  await refreshStickerPending()
  // 素材清单到位后再画预览，否则底图/字体引用解析不到。
  renderBubblePreview()

  // 能力中心用 hash 指定落点（#memory / #voice / #status）；没有 hash 就回到上次看的面板。
  const hashPanel = window.location.hash.replace('#', '')
  if (hashPanel !== '') {
    showPanelIfExists(hashPanel)
  } else {
    const last = readLastPanel()
    if (last !== null) showPanelIfExists(last)
    else showPanel('overview')
  }
  refreshLockedState()
  // 设置窗已经开着时，主进程用事件要求切面板。
  window.pet.onSettingsPanel?.((panel) => {
    showPanelIfExists(panel)
  })
  await refreshDiagnostics()
  setInterval(() => {
    void refreshDiagnostics()
  }, 2000)
}

async function exportChatHistory() {
  const status = $('chat-data-status')
  if (typeof window.pet.exportChat !== 'function') return
  if (status !== null) status.textContent = t('data.chatExporting')
  try {
    const result = await window.pet.exportChat()
    if (result?.canceled === true) {
      if (status !== null) status.textContent = t('data.chatReady')
      return
    }
    if (result?.ok !== true) {
      if (status !== null) {
        status.textContent =
          result?.code === 'CHAT_EMPTY'
            ? t('data.chatEmpty')
            : `${t('data.chatFailed')} · ${result?.message ?? ''}`
      }
      return
    }
    if (status !== null) status.textContent = `${t('data.chatExported')} · ${result.path}`
  } catch (error) {
    if (status !== null) {
      status.textContent = `${t('data.chatFailed')} · ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}

async function clearChatHistory() {
  const status = $('chat-data-status')
  if (typeof window.pet.clearChat !== 'function') return
  const ok = confirmAction({
    message: t('data.chatClearConfirm'),
    strength: 'danger',
    confirmWord: t('common.confirmWord')
  })
  if (!ok) return
  try {
    const result = await window.pet.clearChat()
    if (result?.ok === false) {
      throw new Error(String(result.reason ?? 'persist-failed'))
    }
    if (status !== null) status.textContent = t('data.chatCleared')
  } catch (error) {
    if (status !== null) {
      status.textContent = `${t('data.chatFailed')} · ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}

$('chat-export')?.addEventListener('click', () => void exportChatHistory())
$('chat-clear')?.addEventListener('click', () => void clearChatHistory())

/* ---------------- 人格问卷 ---------------- */

/*
 * 量表只在主进程那一份：这里不重写题库和换算系数，
 * 只把 schema 画成题、把答案交回去算，再把结果读回来。
 */
let assessmentSchemaCache = null
const assessmentAnswers = {}

function assessmentQuestionRow(question, scale) {
  const row = document.createElement('div')
  row.className = 'assessment-q'

  const text = document.createElement('p')
  text.className = 'assessment-q-text'
  text.textContent = question.text
  row.append(text)

  const options = document.createElement('div')
  options.className = 'assessment-scale'
  for (const value of [1, 2, 3, 4, 5]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.value = String(value)
    button.textContent = String(value)
    button.title = scale.labels?.[value - 1] ?? String(value)
    button.addEventListener('click', () => {
      assessmentAnswers[question.id] = value
      for (const peer of options.querySelectorAll('button')) {
        peer.classList.toggle('active', Number(peer.dataset.value) === value)
      }
      renderAssessmentProgress()
    })
    options.append(button)
  }
  row.append(options)
  return row
}

function renderAssessmentProgress() {
  const total = assessmentSchemaCache?.questions?.length ?? 0
  const answered = Object.keys(assessmentAnswers).length
  const progress = $('assessment-progress')
  if (progress !== null) progress.textContent = `${answered} / ${total}`

  const hint = $('assessment-hint')
  if (hint !== null) {
    hint.textContent =
      answered === 0
        ? '还没有开始'
        : answered < total
          ? `还差 ${total - answered} 题，没答的维度不会自己补`
          : '答完了，可以保存'
  }
}

function renderAssessmentResult(record) {
  const box = $('assessment-result')
  if (box === null) return
  box.replaceChildren()
  if (record === null || record === undefined) return

  const result = record.result ?? {}
  const dimensions = result.dimensions ?? {}

  const heading = document.createElement('h3')
  heading.className = 'item-label'
  heading.textContent = '这次的结果'
  box.append(heading)

  for (const dimension of assessmentSchemaCache?.dimensions ?? []) {
    const item = dimensions[dimension.key]
    if (item === undefined) continue

    const row = document.createElement('div')
    row.className = 'assessment-result-row'

    const label = document.createElement('span')
    label.className = 'assessment-result-label'
    label.textContent = dimension.label

    const bar = document.createElement('div')
    bar.className = 'assessment-bar'
    const fill = document.createElement('span')
    fill.style.width = `${Math.max(2, Math.round(item.score))}%`
    bar.append(fill)

    const value = document.createElement('span')
    value.className = 'assessment-result-value'
    value.textContent =
      item.confidence < 1
        ? `${Math.round(item.score)}（${item.answered}/${item.total}）`
        : String(Math.round(item.score))

    row.append(label, bar, value)
    box.append(row)
  }

  if (typeof result.personaDraft === 'string' && result.personaDraft !== '') {
    const draft = document.createElement('p')
    draft.className = 'section-note'
    draft.textContent = result.personaDraft.split('\n').join(' ')
    box.append(draft)
  }

  for (const warning of result.warnings ?? []) {
    const line = document.createElement('p')
    line.className = 'section-note'
    line.textContent = warning
    box.append(line)
  }

  const comparison = record.comparison
  const compareLine = document.createElement('p')
  compareLine.className = 'section-note'
  if (comparison === null || comparison === undefined) {
    compareLine.textContent = '这是第一次保存，之后重测会在这里显示变化。'
  } else if (comparison.stable) {
    compareLine.textContent = '和上次相比没有明显漂移。'
  } else {
    const parts = comparison.changes.map(
      (item) => `${item.label} ${item.delta > 0 ? '+' : ''}${Math.round(item.delta)}`
    )
    compareLine.textContent = `和上次相比：${parts.join('，')}。`
  }
  box.append(compareLine)

  if (typeof record.updatedAt === 'string') {
    const at = document.createElement('p')
    at.className = 'section-note'
    at.textContent = `保存于 ${record.updatedAt.slice(0, 16).replace('T', ' ')}`
    box.append(at)
  }
}

/** 把一份已保存的记录铺回界面；传 null 就是清空草稿。 */
function applySavedAssessment(record) {
  for (const key of Object.keys(assessmentAnswers)) delete assessmentAnswers[key]
  const answers = record?.answers ?? {}
  for (const [key, value] of Object.entries(answers)) {
    if (Number.isFinite(Number(value))) assessmentAnswers[key] = Number(value)
  }

  const container = $('assessment-questions')
  if (container !== null) {
    for (const row of container.querySelectorAll('.assessment-q')) {
      const options = row.querySelector('.assessment-scale')
      const question = options?.dataset.question ?? null
      for (const button of row.querySelectorAll('.assessment-scale button')) {
        button.classList.toggle(
          'active',
          Number(button.dataset.value) === assessmentAnswers[question]
        )
      }
    }
  }

  renderAssessmentProgress()
  renderAssessmentResult(record)
}

async function initAssessmentPanel() {
  const container = $('assessment-questions')
  if (container === null) return

  try {
    assessmentSchemaCache = await window.pet.getAssessmentSchema()
  } catch (error) {
    const hint = $('assessment-hint')
    if (hint !== null) {
      hint.textContent = `题库读取失败：${error instanceof Error ? error.message : String(error)}`
    }
    return
  }

  container.replaceChildren()
  for (const question of assessmentSchemaCache.questions) {
    /* 每题自己记题号，回显时不用再查全局表。 */
    const row = assessmentQuestionRow(question, assessmentSchemaCache.scale ?? {})
    row.querySelector('.assessment-scale').dataset.question = question.id
    container.append(row)
  }

  try {
    const settingsNow = await window.pet.getSettings()
    applySavedAssessment(settingsNow?.persona?.assessment ?? null)
  } catch {
    renderAssessmentProgress()
  }

  $('assessment-save')?.addEventListener('click', async () => {
    const save = $('assessment-save')
    const hint = $('assessment-hint')
    if (save !== null) save.disabled = true
    try {
      const result = await window.pet.saveAssessment({ answers: assessmentAnswers })
      applySavedAssessment(result?.assessment ?? null)
      showSaved()
    } catch (error) {
      if (hint !== null) {
        hint.textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`
      }
    } finally {
      if (save !== null) save.disabled = false
    }
  })

  $('assessment-reset')?.addEventListener('click', () => {
    applySavedAssessment(null)
  })
}

void initAssessmentPanel()

// ---------- 设置窗底图：DSH 背景库的 settingsWindow 槽 ----------
// 直接铺在 body 上：每张卡片各自带底色，图只在卡片之间的缝隙里透出来，
// 不会影响可读性；没选图时把这三条内联样式清掉，回到主题自己的背景。
const SETTINGS_BG_POLL_MS = 1500
let settingsBgSignature = ''

function readSettingsBgSlot(live) {
  const slots = live?.background?.slots
  const slot = slots !== null && typeof slots === 'object' ? slots.settingsWindow : null
  if (slot === null || typeof slot !== 'object') return null
  const id = typeof slot.id === 'string' ? slot.id : ''
  if (id === '') return null
  const num = (value, min, max, fallback) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
  }
  return {
    id,
    posX: num(slot.posX, 0, 100, 50),
    posY: num(slot.posY, 0, 100, 50),
    dim: num(slot.dim, 0, 0.85, 0),
  }
}

function paintSettingsBackground(slot) {
  const body = document.body
  if (slot === null) {
    body.style.backgroundImage = ''
    body.style.backgroundPosition = ''
    body.style.backgroundSize = ''
    body.style.backgroundRepeat = ''
    return
  }
  const url = `pet-media://background/${encodeURIComponent(slot.id)}`
  body.style.backgroundImage =
    `linear-gradient(rgba(255, 250, 253, ${slot.dim}), rgba(255, 250, 253, ${slot.dim})), url("${url}")`
  body.style.backgroundPosition = `${slot.posX}% ${slot.posY}%`
  body.style.backgroundSize = 'cover'
  body.style.backgroundRepeat = 'no-repeat'
}

async function syncSettingsBackground() {
  try {
    const live = await window.pet?.pluginLive?.()
    const slot = readSettingsBgSlot(live)
    const signature = slot === null ? '' : `${slot.id}|${slot.posX}|${slot.posY}|${slot.dim}`
    if (signature === settingsBgSignature) return
    settingsBgSignature = signature
    paintSettingsBackground(slot)
  } catch {
    // 插件没在跑时读不到 live.json，静默保持原样
  }
}

void syncSettingsBackground()
setInterval(syncSettingsBackground, SETTINGS_BG_POLL_MS)

// 动态注入必须在 main() 读设置、绑事件之前完成：
// 三个补充维度文本框要能被回填与绑定，动作 / 表情试配块要能被搜索索引到。
ensurePersonaExtraFields()
ensureMotionPreviewBlocks()

void main()
