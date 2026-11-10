/**
 * 会话页：聊天历史 + QQ 会话。
 * 两边的数据都来自主进程，这里只做展示；写操作留给聊天窗。
 */
const $ = (id) => document.getElementById(id)

const params = new URLSearchParams(window.location.search)
const initialTab = params.get('tab') === 'qq' ? 'qq' : 'chat'

const state = {
  tab: initialTab,
  chatLoaded: false,
  qqLoaded: false,
}

function switchTab(tab) {
  state.tab = tab === 'qq' ? 'qq' : 'chat'
  for (const button of document.querySelectorAll('.s-tab')) {
    button.classList.toggle('is-active', button.dataset.tab === state.tab)
  }
  const chatPanel = $('s-panel-chat')
  const qqPanel = $('s-panel-qq')
  if (chatPanel) chatPanel.hidden = state.tab !== 'chat'
  if (qqPanel) qqPanel.hidden = state.tab !== 'qq'
  if (state.tab === 'chat' && !state.chatLoaded) void loadChat()
  if (state.tab === 'qq' && !state.qqLoaded) void loadQq()
}

function formatTime(stamp) {
  if (stamp === undefined || stamp === null || stamp === '') return ''
  const value = typeof stamp === 'number' ? stamp : Date.parse(String(stamp))
  if (!Number.isFinite(value)) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

function buildBubble(text, when, side) {
  const row = document.createElement('div')
  row.className = `s-msg ${side}`
  const bubble = document.createElement('div')
  bubble.className = 's-bubble'
  bubble.textContent = text
  const meta = document.createElement('span')
  meta.className = 's-meta'
  meta.textContent = when
  if (when !== '') bubble.appendChild(meta)
  row.appendChild(bubble)
  return row
}

async function loadChat() {
  const list = $('s-chat-list')
  const empty = $('s-chat-empty')
  if (!list || !empty) return
  if (typeof window.pet?.getChatHistory !== 'function') {
    empty.hidden = false
    empty.querySelector('strong').textContent = '聊天历史暂不可用'
    return
  }
  list.replaceChildren()
  try {
    const history = await window.pet.getChatHistory()
    const turns = Array.isArray(history) ? history : []
    state.chatLoaded = true
    empty.hidden = turns.length > 0
    for (const turn of turns) {
      const side = turn?.role === 'user' ? 'user' : 'assistant'
      const text = String(turn?.content ?? '')
      if (text === '') continue
      list.appendChild(buildBubble(text, formatTime(turn?.at), side))
    }
    setSummary(`共 ${turns.length} 条聊天记录`)
    scrollBottom()
  } catch (error) {
    empty.hidden = false
    empty.querySelector('strong').textContent = '聊天历史读取失败'
    setSummary(String(error?.message ?? error))
  }
}

function qqMessageText(message) {
  const value = message?.text ?? message?.content ?? message?.message ?? ''
  return String(value)
}

function qqMessageSide(message) {
  const direction = String(message?.direction ?? message?.role ?? message?.from ?? '')
  return direction === 'out' || direction === 'self' || direction === 'assistant' || direction === 'cyrene'
    ? 'user'
    : 'assistant'
}

async function loadQq() {
  const list = $('s-qq-list')
  const empty = $('s-qq-empty')
  const statusBox = $('s-qq-status')
  if (!list || !empty || !statusBox) return
  list.replaceChildren()
  statusBox.replaceChildren()
  if (typeof window.pet?.listQqConversations !== 'function') {
    empty.hidden = false
    empty.querySelector('strong').textContent = 'QQ 会话暂不可用'
    return
  }
  try {
    const result = await window.pet.listQqConversations()
    state.qqLoaded = true
    const stateLabel = String(result?.state ?? 'unknown')
    const chips = [
      ['通道', result?.enabled === true ? '已开启' : '未开启'],
      ['状态', stateLabel],
      ['模式', result?.observeOnly === true ? '只看不说' : '正常'],
    ]
    for (const [label, value] of chips) {
      const chip = document.createElement('span')
      const name = document.createElement('b')
      name.textContent = `${label}：`
      chip.appendChild(name)
      chip.appendChild(document.createTextNode(value))
      statusBox.appendChild(chip)
    }
    if (result?.lastInboundAt) {
      const chip = document.createElement('span')
      chip.textContent = `上次来信：${formatTime(result.lastInboundAt)}`
      statusBox.appendChild(chip)
    }

    const conversations = Array.isArray(result?.conversations) ? result.conversations : []
    let total = 0
    for (const conversation of conversations) {
      const messages = Array.isArray(conversation?.messages) ? conversation.messages : []
      total += messages.length
      const block = document.createElement('div')
      block.className = 's-peer'
      const title = document.createElement('p')
      title.className = 's-peer-title'
      title.textContent = `会话 ${String(conversation?.id ?? '')} · ${messages.length} 条`
      block.appendChild(title)
      for (const message of messages) {
        const text = qqMessageText(message)
        if (text === '') continue
        block.appendChild(
          buildBubble(text, formatTime(message?.at ?? message?.time ?? message?.timestamp), qqMessageSide(message))
        )
      }
      list.appendChild(block)
    }
    empty.hidden = total > 0
    if (total === 0 && result?.reason) {
      const hint = document.createElement('p')
      hint.className = 's-peer-title'
      hint.textContent = String(result.reason)
      list.appendChild(hint)
    }
    setSummary(total > 0 ? `QQ 会话共 ${total} 条最近消息` : 'QQ 通道还没有消息')
  } catch (error) {
    empty.hidden = false
    empty.querySelector('strong').textContent = 'QQ 会话读取失败'
    setSummary(String(error?.message ?? error))
  }
}

function setSummary(text) {
  const el = $('s-summary')
  if (el) el.textContent = text
}

function scrollBottom() {
  const body = document.querySelector('.s-body')
  if (body) body.scrollTop = body.scrollHeight
}

function bind() {
  $('s-close')?.addEventListener('click', () => window.close())
  for (const button of document.querySelectorAll('.s-tab')) {
    button.addEventListener('click', () => switchTab(button.dataset.tab))
  }
  $('s-refresh-chat')?.addEventListener('click', () => {
    state.chatLoaded = false
    void loadChat()
  })
  $('s-refresh-qq')?.addEventListener('click', () => {
    state.qqLoaded = false
    void loadQq()
  })
}

bind()
switchTab(initialTab)
