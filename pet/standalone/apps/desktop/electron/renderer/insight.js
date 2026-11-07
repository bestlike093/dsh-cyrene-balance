/**
 * 观察台：把她此刻的样子摊开给人看。
 *
 * 只做三件事：读快照、按块画出来、把少数几个手动动作（好感、锁定、删一条记忆）发回去。
 * 页面每 15 秒静默读一次，只在她看得见的时候刷新：日程到点自动恢复、倒计时变化都能自己走到界面上。
 */

const PAGE_SIZE = 20

const LAYER_LABEL = {
  raw: '原始记录',
  episode: '一段经历',
  fact: '一件事',
  lesson: '学到的'
}

const GATE_LABEL = {
  open: '开口了',
  hard: '被条件挡住',
  no_reason: '没找到理由'
}

const SOURCE_LABEL = {
  thought: '攒下的话',
  loop: '刚才没说完的',
  social: '想找你说话',
  agenda: '日程里的空档',
  none: '没有由头'
}

const REASON_LABEL = {
  addressed: '叫到了她',
  name_only: '只提了名字',
  topic_match: '接上了话题',
  closing: '在道别',
  empty: '消息是空的',
  from_self: '是她自己说的',
  no_reason: '没找到理由',
  busy: '她正在忙',
  asleep: '她睡着了',
  cooldown: '刚说过话',
  night: '夜深了',
  focus: '你在专注',
  energy: '她有点累',
  quiet: '现在不适合插话',
  quiet_hours: '这个点不该打扰',
  daily_limit: '今天的额度用完了',
  silent_giveup: '说过几次没回，先退一步',
  continuation: '接着刚才的话',
  open_loop: '还有话没聊完',
  social_urge: '隔了一阵，想找你',
  no_cue: '这一拍没有由头',
  nothing_pending: '没有等着收尾的话',
  closer_exhausted: '已经收过尾了',
  not_yet: '还没到时候',
  empty_reply: '这次没想出话',
  unknown: '没说清原因'
}

const ERROR_LABEL = {
  'sessions-empty': '还没聊过',
  'memory-unavailable': '记忆库还没打开',
  'thoughts-unavailable': '念头池还没准备好',
  'agenda-unavailable': '日程还没开始',
  'body-unavailable': '身体状态读不到',
  'handoffs-unavailable': '没读完承接记录',
  'presence-unavailable': '此刻的上下文读不到'
}

const $ = (id) => document.getElementById(id)

let memoryState = { offset: 0, total: 0, items: [], query: '', layer: '' }
let refreshing = false

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  return String(value)
}

function clockOf(stamp) {
  const ms = Number(stamp)
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const date = new Date(ms)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const time = date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `今天 ${time}`
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${time}`
}

/** 把毫秒说成生活里的时间：不到一小时说分钟，超过就说几小时几分钟。 */
function spanLabel(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return '不隔'
  const minutes = Math.round(ms / 60000)
  if (minutes <= 0) return '不隔'
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`
}

function scopeLabel(scope) {
  const raw = text(scope, 'desktop')
  if (raw === 'desktop') return '在这台电脑上'
  if (raw.startsWith('qq:group:')) return `群里 · ${raw.slice('qq:group:'.length)}`
  if (raw.startsWith('qq:private:')) return `私聊 · ${raw.slice('qq:private:'.length)}`
  if (raw.startsWith('qq:')) return `QQ · ${raw.slice(3)}`
  return raw
}

function minutesText(ms) {
  const minutes = Math.round(Number(ms) / 60000)
  if (!Number.isFinite(minutes) || minutes <= 0) return ''
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`
}

function el(tag, className, content) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (content !== undefined) node.textContent = content
  return node
}

function emptyRow(message) {
  return el('div', 'i-empty', message)
}

function setActivePanel(key) {
  for (const tab of document.querySelectorAll('.i-tab')) {
    const on = tab.dataset.panel === key
    tab.classList.toggle('is-active', on)
    tab.setAttribute('aria-selected', on ? 'true' : 'false')
  }
  for (const panel of document.querySelectorAll('.i-panel')) {
    const on = panel.dataset.panel === key
    panel.classList.toggle('is-active', on)
    panel.hidden = !on
  }
}

/* ---------- 今天 ---------- */

function renderCards(snapshot) {
  const box = $('i-cards')
  box.textContent = ''

  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : []
  const messages = sessions.reduce((sum, item) => sum + (Number(item?.messages) || 0), 0)
  const memory = snapshot.memory
  const mood = snapshot.presence?.mood ?? null
  const body = snapshot.body
  const agenda = snapshot.agenda
  const agendaSuspended = agenda?.suspended === true
  const agendaInterrupted = agenda?.interrupted === true

  const cards = [
    {
      label: '心情',
      value: mood?.label ?? '读不到',
      note: Array.isArray(mood?.reasons) && mood.reasons.length > 0 ? mood.reasons.join('；') : '没特别的理由'
    },
    {
      label: '身体',
      value: body?.text ?? '读不到',
      note:
        body === null || body === undefined
          ? ''
          : `精力 ${Math.round(Number(body.energy) || 0)} · 困 ${Math.round(
              Number(body.drowsiness) || 0
            )} · 饿 ${Math.round(Number(body.hunger) || 0)}`,
      small: true
    },
    {
      // 被打断时她确实在陪你，卡片就直说「正在陪你」；平时仍按日程说「正走到」。
      label: agendaSuspended ? '正在陪你' : '正走到',
      value:
        agenda === null || agenda === undefined
          ? '还没排'
          : agendaInterrupted
            ? '睡着被叫醒'
            : agendaSuspended
              ? '陪着你'
              : agenda.title || '空闲',
      note:
        agenda === null || agenda === undefined
          ? ''
          : agendaInterrupted
            ? `${agenda.title || '睡觉'} · 睡眠债还留着`
            : agendaSuspended
              ? `${agenda.title || '原本的安排'} · 还会陪你 ${minutesText(agenda.remainingMs) || '不到 1 分钟'}`
              : agenda.segmentId || ''
    },
    {
      label: '这次被叫到',
      value: `${Number(snapshot.wake?.total) || 0} 次`,
      note: snapshot.wake?.lastAt ? `最近一次 ${clockOf(snapshot.wake.lastAt)}` : '还没被叫过'
    },
    {
      label: '她记着',
      value: memory?.available === false ? '库没开' : `${Number(memory?.count) || 0} 条`,
      note: memory === null || memory === undefined ? '读不到' : `冷存 ${Number(memory.cold) || 0} 条`
    },
    {
      label: '聊过',
      value: `${messages} 句`,
      note: sessions.length === 0 ? '还没有对话' : `${sessions.length} 段对话`
    }
  ]

  for (const card of cards) {
    const node = el('div', 'i-card')
    node.appendChild(el('div', 'i-card-label', card.label))
    node.appendChild(el('div', card.small ? 'i-card-value i-card-value-sm' : 'i-card-value', card.value))
    if (card.note) node.appendChild(el('div', 'i-card-note', card.note))
    box.appendChild(node)
  }
}

function renderTodayNote(snapshot) {
  const note = $('i-today-note')
  const parts = []

  const weather = snapshot.presence?.weather
  if (weather?.ok === true) {
    parts.push(`外面 ${weather.text ?? '天气不明'}，${weather.temperature}°C`)
  }

  // 节日和穿搭不再只藏在提示词里，观察台也要看得见。
  const lifestyle = snapshot.presence?.lifestyle
  if (lifestyle?.festival?.name) parts.push(`今天是${lifestyle.festival.name}`)
  if (lifestyle?.outfit?.label) {
    parts.push(`穿搭：${lifestyle.outfit.label}，${lifestyle.outfit.tip}`)
  }

  const lines = Array.isArray(snapshot.presence?.recentLines) ? snapshot.presence.recentLines : []
  if (lines.length > 0) parts.push(`刚说过：「${text(lines[lines.length - 1]).slice(0, 60)}」`)

  const errors = Array.isArray(snapshot.errors) ? snapshot.errors : []
  const readable = errors.map((code) => ERROR_LABEL[code]).filter((item) => item !== undefined)
  if (readable.length > 0) parts.push(readable.join('；'))

  note.textContent = parts.length > 0 ? parts.join(' · ') : '各段都读到了。'
}

function renderAgenda(snapshot) {
  const box = $('i-agenda')
  const note = $('i-agenda-note')
  box.textContent = ''
  note.textContent = ''

  const agenda = snapshot.agenda
  if (agenda === null || agenda === undefined) {
    box.appendChild(emptyRow('日程还没开始，等她自己排。'))
    return
  }

  note.textContent = agenda.date ? `${agenda.date}` : ''

  const item = el('div', 'i-item')
  const main = el('div', 'i-item-main')
  main.appendChild(el('span', 'i-item-text', agenda.title || '空闲'))
  main.appendChild(
    el('span', 'i-badge', agenda.interrupted ? '睡着被叫醒' : agenda.suspended ? '暂停中' : '进行中')
  )
  item.appendChild(main)

  const meta = el('div', 'i-item-meta')
  if (agenda.segmentId) meta.appendChild(el('span', '', agenda.segmentId))
  if (agenda.startedAt) meta.appendChild(el('span', '', `从 ${clockOf(agenda.startedAt)} 开始`))
  if (agenda.suspended) meta.appendChild(el('span', '', `还剩 ${minutesText(agenda.remainingMs)}`))
  if (agenda.interrupted) meta.appendChild(el('span', '', '睡眠债还留着'))
  if (agenda.reason) meta.appendChild(el('span', '', `原因：${agenda.reason}`))
  item.appendChild(meta)
  box.appendChild(item)
}

/* ---------- 念头 ---------- */

function renderThoughts(snapshot) {
  const list = $('i-thoughts')
  const count = $('i-thoughts-count')
  list.textContent = ''

  const thoughts = snapshot.thoughts
  if (thoughts === null || thoughts === undefined) {
    count.textContent = ''
    list.appendChild(emptyRow('念头池还没准备好。'))
    return
  }

  const counts = thoughts.counts ?? {}
  count.textContent = `开着 ${Number(counts.open) || 0} · 说过 ${Number(counts.used) || 0} · 过期 ${Number(
    counts.expired
  ) || 0} · 丢掉 ${Number(counts.dropped) || 0}`

  const open = Array.isArray(thoughts.open) ? thoughts.open : []
  if (open.length === 0) {
    list.appendChild(emptyRow('现在没有攒着没说的话。'))
    return
  }

  for (const thought of open) {
    const item = el('div', 'i-item')
    const main = el('div', 'i-item-main')
    main.appendChild(el('span', 'i-item-text', text(thought.text)))
    main.appendChild(el('span', 'i-badge', scopeLabel(thought.scope)))
    item.appendChild(main)

    const meta = el('div', 'i-item-meta')
    if (thought.at) meta.appendChild(el('span', '', `记于 ${thought.atText || clockOf(thought.at)}`))
    if (thought.expiresAt) meta.appendChild(el('span', '', `到 ${clockOf(thought.expiresAt)} 为止`))
    meta.appendChild(el('span', '', `分量 ${Math.round((Number(thought.weight) || 0) * 100)}%`))
    item.appendChild(meta)
    list.appendChild(item)
  }
}

function renderProactive(snapshot) {
  const list = $('i-proactive')
  const note = $('i-proactive-note')
  list.textContent = ''
  note.textContent = ''

  const gate = snapshot.proactive
  if (gate === null || gate === undefined) {
    list.appendChild(emptyRow('主动开口的记录还没准备好。'))
    return
  }

  note.textContent = gate.silenced ? '现在安静着' : '随时可以开口'

  const rows = []
  rows.push(['今天已经开口', `${gate.count} 次，上限 ${gate.dailyLimit} 次`])
  rows.push(['两次之间', `至少隔 ${spanLabel(gate.minGapMs)}`])
  const waitMs = Number(gate.nextAllowedAt) - Date.now()
  if (waitMs > 0) {
    rows.push(['下一次最早', `还有 ${spanLabel(waitMs)}（${clockOf(gate.nextAllowedAt)}）`])
  } else {
    rows.push(['下一次', '现在就可以'])
  }
  if (gate.silenced) {
    rows.push(['为什么安静', REASON_LABEL[gate.silenceReason] ?? text(gate.silenceReason, '没说原因')])
  }
  rows.push(['攒着没说的话', `${gate.openLoopCount} 件还想接着说`])

  const recentNote = gate.spoken + gate.held === 0 ? '最近还没有留下判断' : `开口 ${gate.spoken} 次 · 忍住 ${gate.held} 次`
  rows.push(['最近几次判断', recentNote])

  // 忍住的理由摊开，能直接看出最近卡在哪个闸门上。
  const reasons = Array.isArray(gate.reasonCounts) ? gate.reasonCounts : []
  if (reasons.length > 0) {
    const detail = reasons
      .map((item) => `${REASON_LABEL[item?.reason] ?? text(item?.reason, '没说清原因')} ${Number(item?.count) || 0} 次`)
      .join(' · ')
    rows.push(['忍不住的原因', detail])
  }

  for (const [label, value] of rows) {
    const item = el('div', 'i-item')
    const main = el('div', 'i-item-main')
    main.appendChild(el('span', 'i-item-text', label))
    main.appendChild(el('span', 'i-badge', value))
    item.appendChild(main)
    list.appendChild(item)
  }
}

function renderDecisions(snapshot) {
  const list = $('i-decisions')
  list.textContent = ''

  const thoughts = snapshot.thoughts
  const decisions = Array.isArray(thoughts?.decisions) ? thoughts.decisions : []
  if (decisions.length === 0) {
    list.appendChild(emptyRow('还没有留下判断。'))
    return
  }

  for (const decision of decisions) {
    const item = el('div', 'i-item')
    const main = el('div', 'i-item-main')
    main.appendChild(el('span', 'i-item-text', text(decision.text, '（没有留下原话）')))
    main.appendChild(el('span', 'i-badge', GATE_LABEL[decision.gate] ?? text(decision.gate)))
    item.appendChild(main)

    const meta = el('div', 'i-item-meta')
    meta.appendChild(el('span', '', scopeLabel(decision.scope)))
    if (decision.source) meta.appendChild(el('span', '', `由头：${SOURCE_LABEL[decision.source] ?? text(decision.source)}`))
    if (decision.at) meta.appendChild(el('span', '', decision.atText || clockOf(decision.at)))
    meta.appendChild(el('span', '', REASON_LABEL[decision.reason] ?? text(decision.reason)))
    if (Number(decision.hitCount) > 0) meta.appendChild(el('span', '', `撞上 ${decision.hitCount} 次`))
    item.appendChild(meta)
    list.appendChild(item)
  }
}

/* ---------- 关系 ---------- */

async function adjustFavor(scope, delta) {
  const note = delta > 0 ? `观察台手动调整 +${delta}` : `观察台手动调整 ${delta}`
  const result = await window.pet.adjustInsightFavor(scope, delta, note)
  if (result?.ok !== true) return toast(result)
  await refresh({ force: true })
}

async function setFavor(scope, value) {
  const result = await window.pet.setInsightFavor(scope, value, '观察台拖动设定')
  if (result?.ok !== true) return toast(result)
  await refresh({ force: true })
}

async function lockFavor(scope, locked) {
  const result = await window.pet.lockInsightFavor(scope, locked)
  if (result?.ok !== true) return toast(result)
  await refresh({ force: true })
}

async function resetFavor(scope) {
  const ok = window.confirm(`把「${scopeLabel(scope)}」的好感归零并解锁？只影响这一段。`)
  if (!ok) return
  const result = await window.pet.resetInsightScope(scope)
  if (result?.ok !== true) return toast(result)
  await refresh({ force: true })
}

function renderFavorLevel(session) {
  if (typeof session.level !== 'string' || session.level === '') return null
  const card = el('div', 'i-level')
  const head = el('div', 'i-level-head')
  head.appendChild(el('span', 'i-level-name', session.level))
  head.appendChild(el('span', 'i-level-caption', '现在的距离'))
  card.appendChild(head)

  const rows = [
    ['怎么称呼', session.address],
    ['主动程度', session.initiative],
    ['边界', session.boundary],
    ['语气节奏', session.pace]
  ]
  for (const [label, value] of rows) {
    if (typeof value !== 'string' || value === '') continue
    const row = el('div', 'i-level-row')
    row.appendChild(el('span', 'i-level-label', label))
    row.appendChild(el('span', 'i-level-value', value))
    card.appendChild(row)
  }
  return card
}

function renderFavorLog(session) {
  const entries = Array.isArray(session.manualLog) ? session.manualLog : []
  const box = el('div', 'i-favor-log')
  box.appendChild(el('div', 'i-favor-log-title', '最近改过'))
  if (entries.length === 0) {
    box.appendChild(emptyRow('还没有手动改过。'))
    return box
  }

  for (const entry of entries) {
    const row = el('div', 'i-favor-log-row')
    row.appendChild(el('span', 'i-favor-log-time', clockOf(entry.at)))
    const delta = Number(entry.delta) || 0
    const sign = delta > 0 ? `+${delta}` : `${delta}`
    row.appendChild(el('span', 'i-favor-log-change', `${entry.before} → ${entry.after}（${sign}）`))
    if (typeof entry.note === 'string' && entry.note !== '') {
      row.appendChild(el('span', 'i-favor-log-note', entry.note))
    }
    box.appendChild(row)
  }
  return box
}

function renderBonds(snapshot) {
  const list = $('i-bonds')
  list.textContent = ''

  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : []
  if (sessions.length === 0) {
    list.appendChild(emptyRow('还没有哪段对话留下记录。'))
    return
  }

  for (const session of sessions) {
    const node = el('div', 'i-bond')
    const head = el('div', 'i-bond-head')
    head.appendChild(el('span', 'i-bond-name', scopeLabel(session.scope)))
    head.appendChild(
      el(
        'span',
        'i-bond-favor',
        session.favor === null || session.favor === undefined ? '还没记' : `${session.favor} / 100`
      )
    )
    node.appendChild(head)

    const meter = el('div', 'i-meter')
    const fill = el('div', 'i-meter-fill')
    const percent = Math.min(100, Math.max(0, Number(session.favor) || 0))
    fill.style.width = `${percent}%`
    meter.appendChild(fill)
    node.appendChild(meter)

    const sliderRow = el('div', 'i-favor-row')
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.className = 'i-favor-range'
    slider.min = '0'
    slider.max = '100'
    slider.step = '1'
    slider.value = String(percent)
    slider.setAttribute('aria-label', `${scopeLabel(session.scope)}的好感`)
    const readout = el('span', 'i-favor-readout', String(percent))
    slider.addEventListener('input', () => {
      readout.textContent = slider.value
      fill.style.width = `${slider.value}%`
    })
    slider.addEventListener('change', () => {
      void setFavor(session.scope, Number(slider.value))
    })
    sliderRow.appendChild(slider)
    sliderRow.appendChild(readout)
    node.appendChild(sliderRow)

    const meta = el('div', 'i-bond-meta')
    meta.appendChild(el('span', '', `${Number(session.messages) || 0} 句`))
    if (session.lastAt) meta.appendChild(el('span', '', ` · 最近 ${clockOf(session.lastAt)}`))
    if (session.profile) meta.appendChild(el('span', '', ` · 画像 ${Number(session.profile.samples) || 0} 条`))
    if (session.locked) meta.appendChild(el('span', '', ' · 已锁住'))
    node.appendChild(meta)

    const levelCard = renderFavorLevel(session)
    if (levelCard !== null) node.appendChild(levelCard)

    const actions = el('div', 'i-bond-actions')
    for (const [label, delta] of [
      ['−5', -5],
      ['−1', -1],
      ['+1', 1],
      ['+5', 5]
    ]) {
      const button = el('button', '', label)
      button.type = 'button'
      button.addEventListener('click', () => {
        void adjustFavor(session.scope, delta)
      })
      actions.appendChild(button)
    }

    const lock = el('button', '', session.locked ? '解锁' : '锁住')
    lock.type = 'button'
    lock.addEventListener('click', () => {
      void lockFavor(session.scope, session.locked !== true)
    })
    actions.appendChild(lock)

    const reset = el('button', 'i-danger', '归零')
    reset.type = 'button'
    reset.addEventListener('click', () => {
      void resetFavor(session.scope)
    })
    actions.appendChild(reset)

    node.appendChild(actions)
    node.appendChild(renderFavorLog(session))
    list.appendChild(node)
  }
}

/* ---------- 记忆 ---------- */

function memoryQuery(reset) {
  const search = $('i-search').value.trim()
  const layer = $('i-layer').value

  // 搜索走全量筛选，分层筛选只在没搜索词时生效，界面上的提示与这里保持一致。
  const effectiveLayer = search === '' ? layer : ''
  memoryState = {
    offset: reset ? 0 : memoryState.items.length,
    total: memoryState.total,
    items: reset ? [] : memoryState.items,
    query: search,
    layer: effectiveLayer
  }
}

function renderMemoryCount(result) {
  const note = $('i-memory-count')
  if (result?.ok === false) {
    note.textContent = result.reason === 'vault-unavailable' ? '记忆库还没打开。' : '这一页没读出来。'
    return
  }

  const total = Number(result?.total) || 0
  const shown = memoryState.items.length
  const layerText = memoryState.layer ? ` · 只看${LAYER_LABEL[memoryState.layer] ?? memoryState.layer}` : ''
  const queryText = memoryState.query ? ` · 搜「${memoryState.query}」` : ''
  note.textContent = `一共 ${total} 条，已经看到 ${shown} 条${layerText}${queryText}`
}

/** 来源只做轻量回看：哪一侧、是否主动开口；不显示 openId 这类外部标识。 */
function memorySourceLabel(source) {
  if (source === null || typeof source !== 'object') return ''
  if (source.channel === 'qq') {
    return source.chatType === 'group' ? 'QQ 群' : 'QQ'
  }
  if (source.channel === 'desktop') {
    return source.proactive === true ? '桌面 · 主动' : '桌面'
  }
  return ''
}

function renderMemoryItems() {
  const list = $('i-memory')
  list.textContent = ''

  if (memoryState.items.length === 0) {
    list.appendChild(emptyRow(memoryState.query ? '没搜到。' : '还没有记下什么。'))
    return
  }

  for (const item of memoryState.items) {
    const node = el('div', 'i-item')
    const main = el('div', 'i-item-main')
    main.appendChild(el('span', 'i-item-text', text(item.text)))
    if (item.layer) main.appendChild(el('span', 'i-badge', LAYER_LABEL[item.layer] ?? text(item.layer)))
    node.appendChild(main)

    const meta = el('div', 'i-item-meta')
    meta.appendChild(el('span', '', item.role === 'user' ? '你说的' : '她说的'))
    if (item.at) meta.appendChild(el('span', '', item.atText || clockOf(item.at)))
    const sourceText = memorySourceLabel(item.source)
    if (sourceText !== '') meta.appendChild(el('span', '', sourceText))
    meta.appendChild(el('span', '', scopeLabel(item.scope)))
    if (item.cold === true) meta.appendChild(el('span', '', '冷存'))
    if (item.pinned === true) meta.appendChild(el('span', 'i-badge', '已钉'))
    if (item.supersedes) meta.appendChild(el('span', '', '顶替了旧的一条'))

    const pin = el('button', item.pinned === true ? 'i-pin is-on' : 'i-pin', item.pinned === true ? '取下' : '钉住')
    pin.type = 'button'
    pin.title = item.pinned === true ? '不再固定，恢复普通的降温与归档' : '固定住：不降温、不自动归档'
    pin.addEventListener('click', () => {
      void togglePin(item)
    })
    meta.appendChild(pin)

    const remove = el('button', 'i-danger', '删掉')
    remove.type = 'button'
    remove.addEventListener('click', () => {
      void deleteMemory(item.id)
    })
    meta.appendChild(remove)

    node.appendChild(meta)
    list.appendChild(node)
  }
}

async function loadMemory(reset) {
  memoryQuery(reset)
  const payload = {
    offset: memoryState.offset,
    limit: PAGE_SIZE
  }
  if (memoryState.query !== '') payload.query = memoryState.query
  if (memoryState.layer !== '') payload.layer = memoryState.layer

  const result = await window.pet.listMemory(payload)
  if (result?.ok !== true) {
    renderMemoryCount(result)
    $('i-memory-more').hidden = true
    return
  }

  const items = Array.isArray(result.items) ? result.items : []
  memoryState.total = Number(result.total) || 0
  memoryState.items = reset ? items : [...memoryState.items, ...items]

  renderMemoryCount(result)
  renderMemoryItems()
  $('i-memory-more').hidden = memoryState.items.length >= memoryState.total
}

async function deleteMemory(id) {
  if (typeof id !== 'string' || id === '') return
  const ok = window.confirm('把这一条从她的记忆里删掉？删了就找不回来。')
  if (!ok) return

  const result = await window.pet.deleteInsightMemory(id)
  if (result?.ok === false) return toast(result)
  await loadMemory(true)
  await refresh({ force: true })
}

/**
 * 钉子：钉住后这条不再降温、不会被自动归档，检索时也会排得更靠前。
 * 先改本地再重绘，避免整页重新拉取时闪一下。
 */
async function togglePin(item) {
  if (typeof item?.id !== 'string' || item.id === '') return
  if (typeof window.pet.pinMemory !== 'function') return
  const next = item.pinned !== true
  const result = await window.pet.pinMemory(item.id, next)
  if (result?.ok === false) return toast(result)

  item.pinned = next
  if (next) {
    item.cold = false
    item.archived = false
  }
  renderMemoryItems()
  await refresh({ force: true })
}

/* ---------- 反馈 ---------- */

let toastTimer = null

function showToast(message) {
  const box = $('i-toast')
  if (box === null) return
  box.textContent = message
  box.hidden = false
  if (toastTimer !== null) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastTimer = null
    box.hidden = true
  }, 4200)
}

function toast(result) {
  const code = text(result?.code || result?.reason || result?.message, '没成功')
  showToast(`刚才那一下没成：${code}`)
}

/* ---------- 关系：跨窗口承接 ---------- */

function renderHandoffs(snapshot) {
  const list = $('i-handoffs')
  if (list === null) return
  list.textContent = ''

  const handoffs = Array.isArray(snapshot.handoffs) ? snapshot.handoffs : []
  const note = $('i-handoff-note')
  if (note !== null) {
    note.textContent = handoffs.length === 0 ? '眼下没有' : `${handoffs.length} 句还没接上`
  }
  if (handoffs.length === 0) {
    list.appendChild(emptyRow('没有要从别处接过来的话。'))
    return
  }

  for (const item of handoffs) {
    const node = el('div', 'i-bond')
    const head = el('div', 'i-bond-head')
    head.appendChild(
      el('span', 'i-bond-name', `${scopeLabel(item.fromScope)} → ${scopeLabel(item.toScope)}`)
    )
    head.appendChild(el('span', 'i-bond-favor', clockOf(item.createdAt)))
    node.appendChild(head)

    node.appendChild(el('div', 'i-handoff-topic', text(item.topic)))

    const left = Number(item.expiresAt) - Date.now()
    const meta = el('div', 'i-bond-meta')
    meta.appendChild(el('span', '', left > 0 ? `还能记 ${minutesText(left)}` : '已经过期了'))
    node.appendChild(meta)

    list.appendChild(node)
  }
}

/* ---------- 总装 ---------- */

function render(snapshot) {
  renderCards(snapshot)
  renderTodayNote(snapshot)
  renderAgenda(snapshot)
  renderThoughts(snapshot)
  renderProactive(snapshot)
  renderDecisions(snapshot)
  renderBonds(snapshot)
  renderHandoffs(snapshot)
}

async function refresh({ force = false, quiet = false } = {}) {
  // 自动刷新可能和手动点击撞在一起；让前一次先走完，不并发扫两遍。
  if (refreshing) return
  refreshing = true
  try {
    const result = await window.pet.getInsightSnapshot({ force })
    if (result?.ok !== true) {
      if (!quiet) showToast(`没读到她的状态：${text(result?.message || result?.code, '未知原因')}`)
      return
    }
    render(result.snapshot)
  } finally {
    refreshing = false
  }
}

function bind() {
  for (const tab of document.querySelectorAll('.i-tab')) {
    tab.addEventListener('click', () => {
      const key = tab.dataset.panel
      setActivePanel(key)
      if (key === 'memory' && memoryState.items.length === 0) void loadMemory(true)
    })
  }

  $('i-refresh').addEventListener('click', () => {
    void refresh({ force: true })
  })

  $('i-close').addEventListener('click', () => {
    window.close()
  })

  $('i-memory-load').addEventListener('click', () => {
    void loadMemory(true)
  })

  $('i-memory-more').addEventListener('click', () => {
    void loadMemory(false)
  })

  $('i-search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void loadMemory(true)
    }
  })

  $('i-layer').addEventListener('change', () => {
    void loadMemory(true)
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close()
  })
}

bind()
void refresh({ force: true })

// 日程的「陪你 10 分钟」是读的时候才到点恢复，界面不刷新就永远看不见。
// 只在窗口可见时每 15 秒静默读一次；失败不弹提示，下一次自己再试。
const REFRESH_MS = 15_000
setInterval(() => {
  if (!document.hidden) void refresh({ quiet: true })
}, REFRESH_MS)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh({ quiet: true })
})

/** 支持从设置页直接落到某个分区；窗口已开着时由主进程发切换请求。 */
const VALID_TABS = new Set(['today', 'mind', 'proactive', 'bonds', 'memory'])
function focusTab(tab) {
  if (typeof tab !== 'string' || !VALID_TABS.has(tab)) return
  setActivePanel(tab)
  if (tab === 'memory' && memoryState.items.length === 0) void loadMemory(true)
}

focusTab(new URLSearchParams(window.location.search).get('tab'))
if (window.pet?.onInsightTab) {
  window.pet.onInsightTab(focusTab)
}
