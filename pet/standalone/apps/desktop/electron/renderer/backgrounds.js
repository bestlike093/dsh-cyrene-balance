/**
 * 背景库页：列出 userData/backgrounds 里的图，点一下就选用。
 * 图片本体只在主进程里搬，这里只拿 id 和 pet-media URL。
 */
const $ = (id) => document.getElementById(id)

/* 五个可以分别设图的位置，顺序就是界面上的顺序。 */
const SLOT_DEFS = [
  ['petChat', '聊天窗'],
  ['petSettings', '设置页'],
  ['petPanels', '独立页面'],
  ['dshPage', 'DSH 页面'],
  ['dshCard', 'DSH 卡片'],
]

const state = {
  items: [],
  activeId: '',
  slots: {},
  busy: false,
}

function setStatus(text) {
  const el = $('b-status')
  if (el) el.textContent = text || ''
}

function showError(text) {
  const el = $('b-error')
  if (!el) return
  el.textContent = text || ''
  el.hidden = text === ''
}

function formatSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(stamp) {
  const value = Number(stamp)
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

/* 内置图放在 assets/backgrounds 下，用户导入的放在 userData/backgrounds 下，两套地址。 */
const BUILTIN_PREFIX = 'builtin:'

function mediaUrl(id) {
  if (id.startsWith(BUILTIN_PREFIX)) {
    return `pet-media://asset/backgrounds/${encodeURIComponent(id.slice(BUILTIN_PREFIX.length))}`
  }
  return `pet-media://background/${encodeURIComponent(id)}`
}

function render() {
  const grid = $('b-grid')
  const empty = $('b-empty')
  if (!grid || !empty) return
  grid.replaceChildren()

  const items = state.items
  empty.hidden = items.length > 0

  for (const item of items) {
    const card = document.createElement('div')
    card.className = 'b-card' + (item.id === state.activeId ? ' is-active' : '')
    card.setAttribute('role', 'button')
    card.tabIndex = 0
    card.title = '点一下用这张'

    const img = document.createElement('img')
    img.className = 'b-thumb'
    img.loading = 'lazy'
    img.alt = ''
    img.src = mediaUrl(item.id)
    img.addEventListener('error', () => {
      img.style.opacity = '0.25'
    })
    card.appendChild(img)

    /* 内置图不给删除按钮：它在应用目录里，删了也会随更新回来。 */
    if (item.builtin !== true) {
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'b-remove'
      remove.textContent = '×'
      remove.title = '删除这张图'
      remove.addEventListener('click', (event) => {
        event.stopPropagation()
        void removeItem(item)
      })
      card.appendChild(remove)
    }

    const meta = document.createElement('div')
    meta.className = 'b-meta'
    const size = document.createElement('span')
    size.textContent = [formatDate(item.addedAt), formatSize(item.size)].filter(Boolean).join(' · ')
    meta.appendChild(size)
    if (item.id === state.activeId) {
      const badge = document.createElement('span')
      badge.className = 'b-badge'
      badge.textContent = '在用'
      meta.appendChild(badge)
    }
    card.appendChild(meta)

    /* 槽位 chip：同一张图可以分别指定给不同窗口，点一次开、再点关。 */
    const slotRow = document.createElement('div')
    slotRow.className = 'b-slots'
    for (const [key, label] of SLOT_DEFS) {
      const on = state.slots[key]?.id === item.id
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'b-chip' + (on ? ' is-on' : '')
      chip.textContent = label
      chip.title = on ? `取消给${label}用` : `把这张给${label}用`
      chip.addEventListener('click', (event) => {
        event.stopPropagation()
        void toggleSlot(item, key, on)
      })
      slotRow.appendChild(chip)
    }
    card.appendChild(slotRow)

    const activate = () => {
      void applyItem(item)
    }
    card.addEventListener('click', activate)
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        activate()
      }
    })

    grid.appendChild(card)
  }

  const summary = $('b-summary')
  if (summary) {
    const used = SLOT_DEFS.filter(([key]) => {
      const id = state.slots[key]?.id
      return typeof id === 'string' && id !== ''
    }).map(([, label]) => label)
    summary.textContent =
      items.length === 0
        ? '还没有背景图'
        : `共 ${items.length} 张 · ${used.length === 0 ? '五个位置都还没用图' : `已用于：${used.join('、')}`}`
  }
}

async function refresh() {
  if (typeof window.pet?.listBackgrounds !== 'function') {
    showError('主进程没有提供背景通道，请重启桌宠后再试。')
    return
  }
  setStatus('读取中…')
  try {
    const result = await window.pet.listBackgrounds()
    if (!result || result.ok !== true) {
      showError('背景清单读取失败。')
      return
    }
    state.items = Array.isArray(result.items) ? result.items : []
    state.activeId = String(result.active?.id ?? '')
    state.slots = result.slots && typeof result.slots === 'object' ? result.slots : {}
    showError('')
    render()
    setStatus('')
  } catch (error) {
    showError(`背景清单读取失败：${error?.message ?? error}`)
    setStatus('')
  }
}

async function applyItem(item) {
  if (state.busy || item.id === state.activeId) return
  state.busy = true
  setStatus('正在切换…')
  try {
    const result = await window.pet.applyBackground(item.id)
    if (result?.ok === true) {
      state.activeId = item.id
      render()
      setStatus('已换成这张')
    } else {
      showError(`换背景失败：${result?.reason ?? '未知原因'}`)
    }
  } catch (error) {
    showError(`换背景失败：${error?.message ?? error}`)
  } finally {
    state.busy = false
  }
}

/* 点 chip：开/关某一个位置，其他位置不受影响。 */
async function toggleSlot(item, slot, currentlyOn) {
  if (state.busy) return
  if (typeof window.pet?.setBackgroundSlot !== 'function') {
    showError('主进程没有提供槽位通道，请重启桌宠后再试。')
    return
  }
  state.busy = true
  setStatus(currentlyOn ? '正在取消…' : '正在设置…')
  try {
    const result = await window.pet.setBackgroundSlot(slot, { id: currentlyOn ? '' : item.id })
    if (result?.ok === true) {
      state.slots = result.slots ?? state.slots
      state.activeId = String(state.slots.petChat?.id ?? '')
      render()
      setStatus(currentlyOn ? '已取消这个位置' : '已设好')
    } else {
      showError(`设置失败：${result?.reason ?? '未知原因'}`)
    }
  } catch (error) {
    showError(`设置失败：${error?.message ?? error}`)
  } finally {
    state.busy = false
  }
}

async function removeItem(item) {
  if (state.busy) return
  const label = '删除后这张图就不在库里了，确定吗？'
  if (typeof window.confirm === 'function' && !window.confirm(label)) return
  state.busy = true
  setStatus('正在删除…')
  try {
    const result = await window.pet.removeBackground(item.id)
    if (result?.ok === true) {
      state.items = state.items.filter((entry) => entry.id !== item.id)
      state.activeId = String(state.slots.petChat?.id ?? '')
      render()
      setStatus('已删除')
    } else {
      showError(`删除失败：${result?.reason ?? '未知原因'}`)
    }
  } catch (error) {
    showError(`删除失败：${error?.message ?? error}`)
  } finally {
    state.busy = false
  }
}

async function importImage() {
  if (state.busy) return
  if (typeof window.pet?.pickBackground !== 'function') return
  state.busy = true
  setStatus('等你在文件框里选…')
  try {
    const result = await window.pet.pickBackground()
    if (result?.ok === true) {
      await refresh()
      setStatus('已导入并选用')
    } else if (result?.reason === 'canceled') {
      setStatus('')
    } else {
      showError(`导入失败：${result?.reason ?? '未知原因'}`)
      setStatus('')
    }
  } catch (error) {
    showError(`导入失败：${error?.message ?? error}`)
    setStatus('')
  } finally {
    state.busy = false
  }
}

async function clearActive() {
  if (state.busy || state.activeId === '') return
  if (typeof window.pet?.clearBackground !== 'function') return
  state.busy = true
  try {
    const result = await window.pet.clearBackground()
    if (result?.ok === true) {
      state.activeId = ''
      state.slots = {}
      render()
      setStatus('已清空五个位置的背景')
    }
  } catch (error) {
    showError(`取消背景失败：${error?.message ?? error}`)
  } finally {
    state.busy = false
  }
}

function bind() {
  $('b-close')?.addEventListener('click', () => window.close())
  $('b-import')?.addEventListener('click', () => void importImage())
  $('b-clear')?.addEventListener('click', () => void clearActive())
  $('b-refresh')?.addEventListener('click', () => void refresh())
  /* 主进程设置被别的窗口改动时也刷一遍，避免看到过期清单 */
  window.pet?.onSettingsChanged?.(() => {
    void refresh()
  })
}

bind()
void refresh()
