/**
 * 表情包页。
 *
 * 三块数据：
 *   - 待审核：QQ 发来的图，只落在 packs/.inbox，必须用户逐张点「入库」；
 *   - 已入库：各个素材包里的 emoji，可以直接发到最近一次 QQ 会话；
 *   - 素材包：导入 zip、启用/停用、删除，以及坏包的真实原因。
 *
 * 页面只调 preload 暴露的固定方法，不拼真实磁盘路径。
 */

const state = {
  inbox: [],
  library: [],
  packs: [],
  packsLoaded: false,
  filter: '',
  tab: 'inbox',
  settings: null
}

/** 导入失败的结构化原因码 → 文案；认不出的 code 回落到主进程原文。 */
const PACK_IMPORT_REASONS = {
  INPUT_MISSING: 'packs.reasonInputMissing',
  PATH_UNSAFE: 'packs.reasonPathUnsafe',
  MODEL_FILE: 'packs.reasonModelFile',
  FILE_TOO_LARGE: 'packs.reasonFileTooLarge',
  TOTAL_TOO_LARGE: 'packs.reasonTotalTooLarge',
  NO_RECOGNIZED: 'packs.reasonNoRecognized',
  EMPTY_AFTER_IMPORT: 'packs.reasonEmpty',
  MANIFEST_INVALID: 'packs.reasonManifest',
  CANCELED: 'packs.reasonCanceled'
}

function t(key) {
  return window.PetI18n?.t(key) ?? key
}

function packImportReason(code) {
  const key = PACK_IMPORT_REASONS[code]
  return key === undefined ? '' : t(key)
}

/** 包的素材构成，例如「图标 2，字体 1，表情 18」。 */
function formatPackCounts(counts = {}) {
  const parts = []
  if (counts.icon > 0) parts.push(t('packs.countIcon').replace('{n}', String(counts.icon)))
  if (counts.font > 0) parts.push(t('packs.countFont').replace('{n}', String(counts.font)))
  if (counts.bubble > 0) parts.push(t('packs.countBubble').replace('{n}', String(counts.bubble)))
  if (counts.emoji > 0) parts.push(t('packs.countEmoji').replace('{n}', String(counts.emoji)))
  return parts.join('，')
}

function setPacksStatus(text, isError = false) {
  const node = $('s-packs-status')
  if (node === null) return
  node.textContent = text
  node.classList.toggle('is-error', isError)
}

const $ = (id) => document.getElementById(id)

/** 素材包 id → 人话名字。内置与自动收下是固定来源，其余显示包名。 */
function packLabel(item) {
  if (item.packName !== undefined && item.packName !== '') return item.packName
  if (item.packId === 'builtin') return '内置表情'
  if (item.packId === 'qq-auto') return '自动收下'
  return item.packId || '素材包'
}

function failureText(result, fallback) {
  if (typeof result?.message === 'string' && result.message !== '') return result.message
  if (typeof result?.reason === 'string' && result.reason !== '') return result.reason
  return fallback
}

function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(ts) {
  const value = Number(ts)
  if (!Number.isFinite(value) || value <= 0) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

/** 缩略图点击放大；读不出来就标在格子上，不拿占位图冒充。 */
function createThumb(item, caption) {
  const box = document.createElement('div')
  box.className = 's-thumb'

  const img = document.createElement('img')
  img.src = item.url
  img.alt = item.name || item.file || '表情'
  img.loading = 'lazy'
  img.addEventListener('error', () => {
    box.classList.add('is-broken')
    box.title = `读不出来：${item.file ?? item.url}`
  })
  box.appendChild(img)

  box.addEventListener('click', () => openLightbox(item))
  return box
}

function openLightbox(item) {
  const box = $('s-lightbox')
  const img = $('s-lightbox-img')
  const caption = $('s-lightbox-caption')
  if (box === null || img === null || caption === null) return
  img.src = item.url
  img.alt = item.name || item.file || '表情'
  caption.textContent = [item.name || item.file, formatBytes(item.bytes)]
    .filter((part) => part !== '' && part !== undefined)
    .join(' · ')
  box.hidden = false
}

function closeLightbox() {
  const box = $('s-lightbox')
  if (box !== null) box.hidden = true
}

function emptyNotice(text) {
  const node = document.createElement('p')
  node.className = 's-empty'
  node.textContent = text
  return node
}

function renderInbox() {
  const grid = $('s-inbox-grid')
  if (grid === null) return
  grid.textContent = ''

  if (state.inbox.length === 0) {
    grid.appendChild(emptyNotice('还没有待审核的图。QQ 上发张表情过来，人家就替你收着。'))
    return
  }

  for (const item of state.inbox) {
    const card = document.createElement('article')
    card.className = 's-card'

    const nameInput = document.createElement('input')
    nameInput.className = 's-name'
    nameInput.type = 'text'
    nameInput.maxLength = 48
    nameInput.placeholder = '入库后的名字（可留空）'
    nameInput.value = ''

    card.appendChild(createThumb(item, item.filename))

    const meta = document.createElement('p')
    meta.className = 's-meta'
    meta.textContent = [
      item.chatType === 'group' ? '群聊' : item.chatType === 'private' ? '私聊' : '',
      formatTime(item.receivedAt),
      formatBytes(item.bytes)
    ]
      .filter((part) => part !== '')
      .join(' · ')
    card.appendChild(meta)

    card.appendChild(nameInput)

    const actions = document.createElement('div')
    actions.className = 's-actions'

    const approve = document.createElement('button')
    approve.type = 'button'
    approve.className = 'is-primary'
    approve.textContent = '入库'
    approve.addEventListener('click', () => {
      approve.disabled = true
      void approveItem(item.id, nameInput.value.trim(), approve)
    })

    const reject = document.createElement('button')
    reject.type = 'button'
    reject.className = 'is-danger'
    reject.textContent = '丢弃'
    reject.addEventListener('click', () => {
      reject.disabled = true
      void rejectItem(item.id, reject)
    })

    actions.append(approve, reject)
    card.appendChild(actions)
    grid.appendChild(card)
  }
}

function renderLibrary() {
  const grid = $('s-library-grid')
  if (grid === null) return
  grid.textContent = ''

  const visible = state.filter === ''
    ? state.library
    : state.library.filter((item) => item.packId === state.filter)

  if (visible.length === 0) {
    grid.appendChild(
      emptyNotice(
        state.library.length === 0
          ? '素材库里还没有表情。先在「待审核」里入库几张吧。'
          : '这个素材包里没有表情。'
      )
    )
    return
  }

  for (const item of visible) {
    const card = document.createElement('article')
    card.className = 's-card'
    card.appendChild(createThumb(item, item.name))

    const meta = document.createElement('p')
    meta.className = 's-meta'
    meta.textContent = [packLabel(item), item.label || item.file, formatBytes(item.bytes)]
      .filter((part) => part !== '' && part !== undefined)
      .join(' · ')
    card.appendChild(meta)

    const actions = document.createElement('div')
    actions.className = 's-actions'

    const send = document.createElement('button')
    send.type = 'button'
    send.textContent = '发到 QQ'
    send.addEventListener('click', () => {
      send.disabled = true
      void sendItem(item, send)
    })
    actions.appendChild(send)

    card.appendChild(actions)
    grid.appendChild(card)
  }
}

/** 包列表一行：缩略图、名称、构成、状态，以及启停/删除。 */
function createPackRow(pack) {
  const row = document.createElement('article')
  row.className = 's-pack-row'
  if (pack.broken === true) row.classList.add('is-broken')

  const thumb = document.createElement('div')
  thumb.className = 's-pack-thumb'
  const thumbUrl = pack.icon?.url ?? pack.emoji?.url ?? ''
  if (thumbUrl !== '') {
    const img = document.createElement('img')
    img.src = thumbUrl
    img.alt = pack.name || pack.id
    img.loading = 'lazy'
    img.addEventListener('error', () => thumb.classList.add('is-broken'))
    thumb.appendChild(img)
  }

  const text = document.createElement('div')
  text.className = 's-pack-text'

  const name = document.createElement('p')
  name.className = 's-pack-name'
  name.textContent = pack.name || pack.id

  const meta = document.createElement('p')
  meta.className = 's-meta'
  meta.textContent = [
    formatPackCounts(pack.counts ?? {}),
    formatBytes(pack.bytes),
    pack.source === 'builtin' ? t('packs.sourceBuiltin') : t('packs.sourceImported')
  ]
    .filter((part) => part !== '' && part !== undefined)
    .join(' · ')

  const badge = document.createElement('span')
  badge.className = 's-badge'
  if (pack.broken === true) {
    badge.classList.add('is-danger')
    badge.textContent = t('packs.statusBroken')
  } else if (pack.enabled === false) {
    badge.textContent = t('packs.statusDisabled')
  } else {
    badge.classList.add('is-ok')
    badge.textContent = t('packs.statusOk')
  }

  text.append(name, meta)
  if (pack.broken === true && typeof pack.manifestError === 'string') {
    const error = document.createElement('p')
    error.className = 's-meta'
    error.textContent = pack.manifestError
    text.appendChild(error)
  }
  text.appendChild(badge)
  row.append(thumb, text)

  if (pack.source !== 'builtin') {
    const actions = document.createElement('div')
    actions.className = 's-pack-actions'

    const toggle = document.createElement('label')
    toggle.className = 's-switch'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = pack.enabled !== false
    input.disabled = pack.broken === true
    const label = document.createElement('span')
    label.textContent = input.checked ? t('packs.statusOk') : t('packs.statusDisabled')
    input.addEventListener('change', () => {
      void togglePack(pack.id, input.checked, input)
    })
    toggle.append(input, label)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'is-danger'
    remove.textContent = t('packs.remove')
    remove.addEventListener('click', () => {
      void removePack(pack.id, remove)
    })

    actions.append(toggle, remove)
    row.appendChild(actions)
  }

  return row
}

/** 内置在前、导入在后；空分组不画标题。 */
function renderPacks() {
  const list = $('s-pack-list')
  if (list === null) return
  list.textContent = ''
  if (state.packsLoaded !== true) return

  if (state.packs.length === 0) {
    list.appendChild(emptyNotice(t('packs.empty')))
    return
  }

  for (const [source, title] of [
    ['builtin', t('packs.groupBuiltin')],
    ['imported', t('packs.groupImported')]
  ]) {
    const items = state.packs.filter((pack) => pack.source === source)
    if (items.length === 0) continue
    const head = document.createElement('h2')
    head.className = 's-pack-head'
    head.textContent = `${title}（${items.length}）`
    list.appendChild(head)
    for (const pack of items) list.appendChild(createPackRow(pack))
  }
}

function renderPacksCount() {
  const node = $('s-packs-count')
  if (node !== null) node.textContent = String(state.packs.length)
}

async function loadPacks() {
  if (typeof window.pet.listPacks !== 'function') return
  try {
    const result = await window.pet.listPacks()
    state.packs = result?.ok === true && Array.isArray(result.packs) ? result.packs : []
  } catch {
    state.packs = []
  }
  state.packsLoaded = true
  renderPacks()
  renderPacksCount()
}

async function importPack(button) {
  if (typeof window.pet.importPack !== 'function') return
  button.disabled = true
  setPacksStatus(t('packs.importing'))
  try {
    const result = await window.pet.importPack()
    if (result?.ok !== true) {
      const reason = packImportReason(result?.code)
      setPacksStatus(`${t('packs.importFailed')}：${reason === '' ? failureText(result, t('packs.reasonUnknown')) : reason}`, true)
      return
    }
    const name = result.pack?.name ?? result.pack?.id ?? t('packs.title')
    setPacksStatus(`${t('packs.imported')}「${name}」`)
    await loadPacks()
    await load()
  } catch (error) {
    setPacksStatus(`${t('packs.importFailed')}：${error instanceof Error ? error.message : String(error)}`, true)
  } finally {
    button.disabled = false
  }
}

async function togglePack(id, enabled, input) {
  input.disabled = true
  try {
    const result = await window.pet.setPackEnabled(id, enabled)
    if (result?.ok !== true) {
      input.checked = enabled !== true
      input.disabled = false
      setPacksStatus(`${t('packs.enableFailed')}：${failureText(result, t('packs.reasonUnknown'))}`, true)
      return
    }
    await loadPacks()
  } catch (error) {
    input.checked = enabled !== true
    input.disabled = false
    setPacksStatus(`${t('packs.enableFailed')}：${error instanceof Error ? error.message : String(error)}`, true)
  }
}

async function removePack(id, button) {
  const pack = state.packs.find((item) => item.id === id)
  const summary = formatPackCounts(pack?.counts ?? {})
  const detail = summary === '' ? '' : `（${summary}）`
  const word = t('packs.removeConfirmWordValue')
  const message = `${t('packs.removeConfirm').replace('{name}', pack?.name || id)}${detail}\n\n${t('packs.removeConfirmWord').replace('{word}', word)}`
  const answer = window.prompt(message, '')
  if (answer === null || answer.trim() !== word) return

  button.disabled = true
  try {
    const result = await window.pet.removePack(id)
    if (result?.ok !== true) {
      button.disabled = false
      setPacksStatus(`${t('packs.removeFailed')}：${failureText(result, t('packs.reasonUnknown'))}`, true)
      return
    }
    setPacksStatus(`${t('packs.removed')}「${pack?.name || id}」`)
    await loadPacks()
    await load()
  } catch (error) {
    button.disabled = false
    setPacksStatus(`${t('packs.removeFailed')}：${error instanceof Error ? error.message : String(error)}`, true)
  }
}

function renderAutoApprove() {
  const input = $('s-auto-approve')
  if (input === null) return
  input.checked = state.settings?.sticker?.autoApprove !== false
}

/** 开关直接写回设置；保存失败就把界面退回原状态，不假装成功。 */
async function saveAutoApprove(input) {
  if (state.settings === null) {
    input.checked = !input.checked
    window.alert('设置还没读出来，稍后再试一次。')
    return
  }
  const next = {
    ...state.settings,
    sticker: { ...(state.settings.sticker ?? {}), autoApprove: input.checked }
  }
  input.disabled = true
  try {
    const saved = await window.pet.saveSettings(next)
    state.settings = saved !== null && typeof saved === 'object' ? saved : next
    renderAutoApprove()
  } catch (error) {
    input.checked = !input.checked
    window.alert(`开关没保存上：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    input.disabled = false
  }
}

function renderCounts() {
  const inboxCount = $('s-inbox-count')
  const libraryCount = $('s-library-count')
  const summary = $('s-summary')
  if (inboxCount !== null) inboxCount.textContent = String(state.inbox.length)
  if (libraryCount !== null) libraryCount.textContent = String(state.library.length)
  if (summary !== null) {
    summary.textContent =
      state.inbox.length === 0 && state.library.length === 0
        ? 'QQ 发来的图会先停在待审核，收不收由你决定。'
        : `待审核 ${state.inbox.length} 张 · 已入库 ${state.library.length} 张`
  }
}

function renderPackFilter() {
  const select = $('s-pack-filter')
  if (select === null) return

  const packs = new Map()
  for (const item of state.library) {
    if (!packs.has(item.packId)) packs.set(item.packId, item.packName)
  }

  const current = state.filter
  select.textContent = ''
  const all = document.createElement('option')
  all.value = ''
  all.textContent = `全部（${state.library.length}）`
  select.appendChild(all)

  for (const [id, name] of packs) {
    const option = document.createElement('option')
    option.value = id
    option.textContent = name
    select.appendChild(option)
  }

  select.value = packs.has(current) ? current : ''
  state.filter = select.value
}

function render() {
  renderCounts()
  renderPackFilter()
  renderInbox()
  renderLibrary()
  renderPacksCount()
}

async function approveItem(id, name, button) {
  try {
    const result = await window.pet.approveSticker(id, {
      ...(name === '' ? {} : { name })
    })
    if (result?.ok !== true) {
      button.disabled = false
      window.alert(`入库没有成功：${failureText(result, '未知原因')}`)
      return
    }
    await load()
  } catch (error) {
    button.disabled = false
    window.alert(`入库没有成功：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function rejectItem(id, button) {
  try {
    const result = await window.pet.rejectSticker(id)
    if (result?.ok !== true) {
      button.disabled = false
      window.alert(`丢弃没有成功：${failureText(result, '未知原因')}`)
      return
    }
    await load()
  } catch (error) {
    button.disabled = false
    window.alert(`丢弃没有成功：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function sendItem(item, button) {
  try {
    // 优先传表情库 id：主进程据此还原路径；旧素材包对象没有 id 时退回 url。
    const result = await window.pet.sendSticker(item.id ?? item.url)
    if (result?.ok !== true) {
      button.disabled = false
      window.alert(`没有发出去：${failureText(result, 'QQ 不在可回复状态')}`)
      return
    }
    button.textContent = '已发送'
    window.setTimeout(() => {
      button.textContent = '发到 QQ'
      button.disabled = false
    }, 1800)
  } catch (error) {
    button.disabled = false
    window.alert(`没有发出去：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function load() {
  const [inboxResult, libraryResult] = await Promise.all([
    window.pet.listStickerInbox(),
    typeof window.pet.listStickerLibrary === 'function'
      ? window.pet.listStickerLibrary()
      : Promise.resolve(null)
  ])

  state.inbox = inboxResult?.ok === true && Array.isArray(inboxResult.items)
    ? inboxResult.items
    : []

  // 表情库已经包含内置、Cyrene 本体与用户素材包；拿不到时退回旧的 listPacks。
  if (libraryResult?.ok === true && Array.isArray(libraryResult.items)) {
    state.library = libraryResult.items
  } else {
    const packsResult = await window.pet.listPacks()
    const packs = packsResult?.ok === true && Array.isArray(packsResult.packs)
      ? packsResult.packs
      : []

    state.library = []
    for (const pack of packs) {
      const emojis = Array.isArray(pack?.files?.emoji) ? pack.files.emoji : []
      for (const item of emojis) {
        state.library.push({
          packId: pack.id,
          packName: pack.name || pack.id,
          file: item.file,
          name: item.name,
          url: item.url,
          bytes: item.bytes
        })
      }
    }
  }

  render()
}

const TABS = ['inbox', 'library', 'packs']

function switchTab(tab) {
  const next = TABS.includes(tab) ? tab : 'inbox'
  state.tab = next
  const panels = {
    inbox: $('s-panel-inbox'),
    library: $('s-panel-library'),
    packs: $('s-panel-packs')
  }
  for (const [key, panel] of Object.entries(panels)) {
    if (panel !== null) panel.hidden = key !== next
  }

  for (const button of document.querySelectorAll('.s-tab')) {
    button.classList.toggle('is-active', button.dataset.tab === next)
  }

  // 素材包只在第一次点开时读，避免每次开窗都多扫一遍目录。
  if (next === 'packs' && state.packsLoaded !== true) void loadPacks()
}

function bindEvents() {
  $('s-close')?.addEventListener('click', () => window.close())
  $('s-refresh')?.addEventListener('click', () => {
    void load()
  })
  $('s-refresh-packs')?.addEventListener('click', () => {
    void loadPacks()
  })
  $('s-import-pack')?.addEventListener('click', (event) => {
    void importPack(event.currentTarget)
  })
  $('s-auto-approve')?.addEventListener('change', (event) => {
    void saveAutoApprove(event.currentTarget)
  })

  document.querySelector('.s-tabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('.s-tab')
    if (button === null) return
    switchTab(button.dataset.tab)
  })

  $('s-pack-filter')?.addEventListener('change', (event) => {
    state.filter = event.target.value
    renderLibrary()
  })

  $('s-lightbox-close')?.addEventListener('click', closeLightbox)
  $('s-lightbox')?.addEventListener('click', (event) => {
    if (event.target === $('s-lightbox')) closeLightbox()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeLightbox()
  })
}

/** 界面文案跟随设置里的语言；读不到就保持 HTML 里的中文原文。 */
async function applyLocale() {
  try {
    const settings = await window.pet.getSettings()
    if (settings !== null && typeof settings === 'object') {
      state.settings = settings
      renderAutoApprove()
    }
    const locale = typeof settings?.locale === 'string' ? settings.locale : ''
    if (locale !== '') window.PetI18n?.apply(locale)
  } catch {
    // 设置读取失败不影响表情包本身。
  }
}

bindEvents()
void applyLocale()
void load()
