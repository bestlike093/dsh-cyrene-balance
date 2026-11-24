// 遐蝶 · 驱动控制台
// 只做一件事：把命令行能做的事，变成能点的按钮。

const $ = (id) => document.getElementById(id)
const api = window.l2dControl

const el = {
  dot: $('status-dot'),
  status: $('status-text'),
  modelDir: $('model-dir'),
  modelMeta: $('model-meta'),
  pick: $('btn-pick'),
  reload: $('btn-reload'),
  expressions: $('expressions'),
  motions: $('motions'),
  capability: $('capability'),
  tell: $('btn-tell'),
  persona: $('btn-persona'),
  stop: $('btn-stop'),
  sayText: $('say-text'),
  say: $('btn-say'),
  follow: $('gaze-follow'),
  gazeHome: $('btn-gaze-home'),
  petW: $('pet-w'),
  petH: $('pet-h'),
  petScale: $('pet-scale'),
  petScaleValue: $('pet-scale-value'),
  applySize: $('btn-apply-size'),
  topmost: $('topmost'),
  petVisible: $('pet-visible'),
  doc: $('btn-doc'),
  quit: $('btn-quit'),
  toast: $('toast'),
}

let catalog = null
let catalogVersion = -1
let lastInfo = null
let currentExpression = null
let toastTimer = 0
// 大小滑杆的 100% 基准：第一次读到窗口尺寸时定下来
let baseSize = null
let scalePercent = 100

function setScaleLabel(percent) {
  scalePercent = percent
  if (el.petScaleValue !== null && el.petScaleValue !== undefined) el.petScaleValue.textContent = `${percent}%`
  if (el.petScale !== null && el.petScale !== undefined && Number(el.petScale.value) !== percent) {
    el.petScale.value = String(percent)
  }
}

function toast(message, bad = false) {
  el.toast.textContent = message
  el.toast.className = bad ? 'bad' : ''
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.toast.textContent = ''
    el.toast.className = ''
  }, 4200)
}

function setStatus(ready, error) {
  if (error) {
    el.dot.style.background = 'var(--err)'
    el.status.textContent = error
    return
  }
  el.dot.style.background = ready ? 'var(--ok)' : 'var(--warn)'
  el.status.textContent = ready ? '就绪' : '模型载入中…'
}

async function runCommand(payload) {
  const result = await api.command(payload)
  if (!result || result.ok !== true) {
    toast(`没做成：${result?.error || '未知错误'}`, true)
    return result
  }
  return result
}

async function refresh() {
  let info
  try {
    info = await api.info()
  } catch {
    setStatus(false, '控制台连接断开')
    return
  }
  lastInfo = info
  // 大小滑杆的 100% 基准：第一次读到窗口尺寸就定下来（放在前面，别让后面的渲染出错把它跳过）
  if (baseSize === null && info.bounds) {
    baseSize = { width: info.bounds.width, height: info.bounds.height }
    setScaleLabel(100)
  }
  setStatus(info.ready)

  el.modelDir.textContent = info.modelDir || '—'
  const counts = catalog
    ? `参数 ${catalog.parameters.length} · 表情 ${catalog.expressions.length} · 动作 ${Object.values(catalog.motionGroups).reduce((n, list) => n + list.length, 0)}`
    : '目录还没生成'
  el.modelMeta.textContent = `${info.model3 || '—'} · ${counts}`

  if (catalog === null || info.catalogVersion !== catalogVersion) {
    catalogVersion = info.catalogVersion
    if (catalogVersion > 0) {
      try {
        const loaded = await api.catalog()
        if (loaded) {
          catalog = loaded
          renderCatalog()
        }
      } catch {
        toast('模型目录读不出来', true)
      }
    }
  }

  // 尺寸框不要抢用户正在输入的值
  if (info.bounds) {
    if (document.activeElement !== el.petW) el.petW.value = info.bounds.width
    if (document.activeElement !== el.petH) el.petH.value = info.bounds.height
    if (baseSize === null) {
      baseSize = { width: info.bounds.width, height: info.bounds.height }
      setScaleLabel(100)
    }
  }
  el.topmost.checked = !!info.topmost
  el.petVisible.checked = info.visible !== false

  const expr = info.renderer?.expression ?? null
  if (expr !== currentExpression) {
    currentExpression = expr
    markExpression(expr)
  }
  const motion = info.renderer?.motion ?? null
  el.stop.disabled = !motion
}

function markExpression(name) {
  for (const chip of el.expressions.querySelectorAll('.chip')) {
    chip.classList.toggle('active', !!name && chip.dataset.name === name)
  }
}

function renderCatalog() {
  el.expressions.innerHTML = ''
  if (!catalog.expressions.length) {
    el.expressions.innerHTML = '<span class="muted">这个模型没有表情</span>'
  } else {
    for (const expression of catalog.expressions) {
      const chip = document.createElement('button')
      chip.className = 'chip'
      chip.textContent = expression.name
      chip.dataset.name = expression.name
      chip.title = expression.file || ''
      chip.addEventListener('click', async () => {
        await runCommand({ cmd: 'expression', name: expression.name })
      })
      el.expressions.appendChild(chip)
    }
  }

  el.motions.innerHTML = ''
  const groups = Object.entries(catalog.motionGroups)
  if (!groups.length) {
    el.motions.innerHTML = '<span class="muted">这个模型没有动作</span>'
  } else {
    for (const [group, list] of groups) {
      const row = document.createElement('div')
      row.className = 'group-row'
      const label = document.createElement('span')
      label.className = 'group-name'
      label.textContent = group
      row.appendChild(label)
      for (const motion of list) {
        const button = document.createElement('button')
        button.textContent = motion.name
        button.title = motion.file || ''
        button.addEventListener('click', async () => {
          await runCommand({ cmd: 'motion', group, index: motion.index })
        })
        row.appendChild(button)
      }
      el.motions.appendChild(row)
    }
  }
  markExpression(currentExpression)
  renderCapability()
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 能力识别结果：可动性等级、能做什么、能拼出什么、做不到什么。 */
function renderCapability() {
  const capability = catalog?.capability
  if (!capability) {
    el.capability.innerHTML = '<span class="muted">这个模型没有能力识别结果（目录是旧版本？重新载入一次试试）</span>'
    el.tell.disabled = true
    return
  }
  el.tell.disabled = false
  const lines = [
    `<div class="cap-line"><b>可动性 Lv.${capability.level} / 5</b> · ${escapeHtml(capability.levelLabel)}（分 ${capability.score}）</div>`,
    `<div class="cap-line"><span class="muted">能做：</span>${escapeHtml((capability.can || []).join('；') || '—')}</div>`,
    `<div class="cap-line"><span class="muted">能拼出来：</span>${escapeHtml((capability.derived || []).join('；') || '—')}</div>`,
    `<div class="cap-line"><span class="muted">做不到：</span>${escapeHtml((capability.cannot || []).join('；') || '无')}</div>`,
  ]
  el.capability.innerHTML = lines.join('')
}

async function pickModel() {
  const dir = await api.pickModel()
  if (!dir) return
  await applyModel(dir)
}

async function applyModel(dir) {
  toast('正在换模型…')
  const result = await api.applyModel(dir)
  if (!result.ok) {
    toast(`换不了：${result.error}`, true)
    return
  }
  catalog = null
  catalogVersion = -1
  toast(`已换到 ${result.model3}`)
  await refresh()
}

function bind() {
  el.pick.addEventListener('click', pickModel)
  el.reload.addEventListener('click', async () => {
    if (!lastInfo?.modelDir) return
    await applyModel(lastInfo.modelDir)
  })
  el.stop.addEventListener('click', async () => {
    await runCommand({ cmd: 'stop' })
  })
  async function sendSay() {
    const text = el.sayText.value.trim()
    if (!text) return
    const result = await runCommand({ cmd: 'say', text, duration: 6000 })
    if (result?.ok) el.sayText.value = ''
  }
  el.say.addEventListener('click', sendSay)
  el.sayText.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendSay()
  })
  el.follow.addEventListener('change', async () => {
    await runCommand({ cmd: 'follow-pointer', off: !el.follow.checked })
    if (!el.follow.checked) await runCommand({ cmd: 'gaze', off: true })
  })
  el.gazeHome.addEventListener('click', async () => {
    await runCommand({ cmd: 'gaze', off: true })
  })
  for (const button of document.querySelectorAll('[data-gaze]')) {
    button.addEventListener('click', async () => {
      const [x, y] = button.dataset.gaze.split(',').map(Number)
      el.follow.checked = false
      await runCommand({ cmd: 'follow-pointer', off: true })
      await runCommand({ cmd: 'gaze', x, y })
    })
  }
  for (const button of document.querySelectorAll('[data-mood]')) {
    button.addEventListener('click', async () => {
      const result = await runCommand({ cmd: 'mood', name: button.dataset.mood })
      if (result?.ok) toast(`情绪：${button.textContent}`)
    })
  }
  el.applySize.addEventListener('click', async () => {
    const width = Number(el.petW.value)
    const height = Number(el.petH.value)
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      toast('宽高要填数字', true)
      return
    }
    const result = await api.resize(width, height)
    if (result?.ok) {
      // 手动给了宽高，就把它当作 100% 的基准
      baseSize = { width: result.width, height: result.height }
      setScaleLabel(100)
      toast(`窗口改成 ${result.width} × ${result.height}`)
    } else {
      toast('改不了尺寸', true)
    }
    await refresh()
  })

  // 大小滑杆：按比例缩，不动比例本身。直接应用，不走防抖定时器——
  // 控制台被别的窗口挡住时 Chromium 会把定时器压得很慢，滑杆就会「拖了没反应」。
  let scaleBusy = false
  let scalePending = 0
  async function applyScale(percent) {
    if (scaleBusy) {
      scalePending = percent
      return
    }
    const base = baseSize ?? (lastInfo?.bounds ? { width: lastInfo.bounds.width, height: lastInfo.bounds.height } : null)
    if (base === null) return
    scaleBusy = true
    const width = Math.max(140, Math.round((base.width * percent) / 100))
    const height = Math.max(200, Math.round((base.height * percent) / 100))
    const result = await api.resize(width, height)
    if (!result?.ok) toast('改不了大小', true)
    await refresh()
    scaleBusy = false
    if (scalePending !== 0) {
      const next = scalePending
      scalePending = 0
      void applyScale(next)
    }
  }
  el.petScale.addEventListener('input', () => {
    const percent = Number(el.petScale.value) || 100
    setScaleLabel(percent)
    void applyScale(percent)
  })
  el.topmost.addEventListener('change', async () => {
    await api.topmost(el.topmost.checked)
    await refresh()
  })
  el.petVisible.addEventListener('change', async () => {
    await api.petVisible(el.petVisible.checked)
    await refresh()
  })
  el.doc.addEventListener('click', async () => {
    const failure = await api.openDoc()
    toast(failure ? failure : '已打开方法文档', !!failure)
  })
  el.tell.addEventListener('click', async () => {
    el.tell.disabled = true
    try {
      const result = await api.tellCapability()
      if (result?.ok) toast('能力已经递进会话了')
      else toast(`没递成：${result?.error || '未知原因'}`, true)
    } catch (error) {
      toast(`没递成：${error?.message || error}`, true)
    } finally {
      el.tell.disabled = false
    }
  })
  el.persona.addEventListener('click', async () => {
    el.persona.disabled = true
    try {
      const result = await api.sendPersona()
      if (result?.ok) toast('自带人设已经递进会话了')
      else toast(`没递成：${result?.error || '未知原因'}`, true)
    } catch (error) {
      toast(`没递成：${error?.message || error}`, true)
    } finally {
      el.persona.disabled = false
    }
  })
  el.quit.addEventListener('click', () => api.quit())
}

bind()
refresh()
setInterval(refresh, 1200)
