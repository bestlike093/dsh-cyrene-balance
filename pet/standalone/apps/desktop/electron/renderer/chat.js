// 聊天窗：只负责显示与输入，历史与请求都在主进程。
// 消息一律用 textContent 写入，不拼 HTML。

const $ = (id) => document.getElementById(id)

/** 失败原因 → 界面上直接能看懂的一句话；映射统一在 reason-text.js。 */
function reasonText(reason) {
  return window.CyreneReasonText.chat(reason)
}

let sending = false
let lastFailedText = null

/** 时间戳只显示到分钟；解析失败就不显示，不硬塞一个假时间。 */
function formatTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function showNotice(text, actionLabel, action) {
  const notice = $('c-notice')
  const button = $('c-notice-action')
  $('c-notice-text').textContent = text
  notice.hidden = false

  if (typeof action === 'function') {
    button.textContent = actionLabel
    button.hidden = false
    button.onclick = action
  } else {
    button.hidden = true
    button.onclick = null
  }
}

function hideNotice() {
  $('c-notice').hidden = true
  $('c-notice-action').hidden = true
  $('c-notice-action').onclick = null
}

function openSettings() {
  // 从聊天窗进来时直接落在「聊天」面板，省得再找一次。
  if (typeof window.pet?.openSettings === 'function') {
    void window.pet.openSettings('chat')
  }
}

function scrollToBottom() {
  const log = $('c-log')
  log.scrollTop = log.scrollHeight
}

function appendMessage(role, content, at) {
  const empty = $('c-empty')
  if (empty !== null) empty.remove()

  const row = document.createElement('div')
  row.className = `c-row ${role}`

  const bubble = document.createElement('div')
  bubble.className = 'c-bubble'
  bubble.textContent = content

  const meta = document.createElement('div')
  meta.className = 'c-meta'
  meta.textContent = formatTime(at)

  row.append(bubble, meta)
  $('c-log').append(row)
  scrollToBottom()
  return row
}

/**
 * 照片气泡：地址由主进程给，这里不拼路径、不读本地文件。
 * 图裂了就把这一行收掉，别在对话里留一个空的框。
 */
function appendPhoto(url) {
  const empty = $('c-empty')
  if (empty !== null) empty.remove()

  const row = document.createElement('div')
  row.className = 'c-row assistant'

  const bubble = document.createElement('div')
  bubble.className = 'c-bubble c-photo'

  const img = document.createElement('img')
  img.alt = ''
  img.loading = 'lazy'
  img.addEventListener('error', () => row.remove())
  img.src = url

  const meta = document.createElement('div')
  meta.className = 'c-meta'
  meta.textContent = '刚拍下'

  bubble.append(img)
  row.append(bubble, meta)
  $('c-log').append(row)
  scrollToBottom()
  return row
}

/** 发送中的省略号气泡；返回移除函数。 */function appendTyping() {
  const row = document.createElement('div')
  row.className = 'c-row assistant'

  const bubble = document.createElement('div')
  bubble.className = 'c-bubble c-typing'
  for (let i = 0; i < 3; i += 1) bubble.append(document.createElement('span'))

  row.append(bubble)
  $('c-log').append(row)
  scrollToBottom()

  return () => {
    row.remove()
  }
}

function setStatus(text) {
  $('c-status').textContent = text
}

async function refreshStatus() {
  if (typeof window.pet?.getChatStatus !== 'function') {
    setStatus('聊天接口没有接上')
    return
  }
  try {
    const status = await window.pet.getChatStatus()
    if (status?.enabled === true) {
      setStatus(`${status.model ?? 'deepseek-chat'} · 已就绪`)
    } else {
      setStatus('聊天未启用')
      showNotice(reasonText('disabled'), '打开设置', openSettings)
    }
  } catch (error) {
    setStatus(`读取状态失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function loadHistory() {
  if (typeof window.pet?.getChatHistory !== 'function') return
  try {
    const history = await window.pet.getChatHistory()
    if (!Array.isArray(history) || history.length === 0) return
    for (const turn of history) {
      appendMessage(turn.role === 'user' ? 'user' : 'assistant', String(turn.content ?? ''), turn.at)
    }
  } catch {
    // 历史读不出来不影响继续聊，静默跳过。
  }
}

function setSending(value) {
  sending = value
  $('send-btn').disabled = value
  $('c-input').disabled = value
}

async function send() {
  if (sending) return

  const input = $('c-input')
  const text = input.value.trim()
  if (text === '') return
  if (typeof window.pet?.sendChat !== 'function') {
    showNotice('聊天接口没有接上，发不出去。')
    return
  }

  lastFailedText = text
  hideNotice()
  appendMessage('user', text, new Date().toISOString())
  input.value = ''
  setSending(true)
  const stopTyping = appendTyping()

  try {
    const result = await window.pet.sendChat(text)
    stopTyping()

    if (result?.ok === true) {
      appendMessage('assistant', String(result.reply ?? ''), result.at)
      // 她真拍下一张时，紧跟一句话把照片放出来；没有地址就不占位。
      const photoUrl = typeof result.photo?.url === 'string' ? result.photo.url : ''
      if (photoUrl !== '') {
        appendPhoto(photoUrl)
      } else if (typeof result.photoFailed === 'string') {
        showNotice(`这次没拍成：${reasonText(result.photoFailed)}`)
      }
      lastFailedText = null
      return
    }

    const reason = String(result?.reason ?? 'request-failed')
    showNotice(reasonText(reason), reason === 'disabled' || reason === 'no-key' ? '打开设置' : null, openSettings)
  } catch (error) {
    stopTyping()
    showNotice(`发送失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    setSending(false)
    input.focus()
  }
}

function bindEvents() {
  $('send-btn').addEventListener('click', () => {
    void send()
  })

  // Enter 发送、Shift+Enter 换行；输入法组词时的 Enter 不能当发送。
  $('c-input').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    if (event.shiftKey) return
    if (event.isComposing) return
    event.preventDefault()
    void send()
  })

  // 导出聊天记录：只在点击时写文件，保存位置由主进程弹系统对话框。
  $('export-btn')?.addEventListener('click', async () => {
    if (typeof window.pet?.exportChat !== 'function') return
    const zh = navigator.language.toLowerCase().startsWith('zh')
    const button = $('export-btn')
    if (button !== null) button.disabled = true
    try {
      const result = await window.pet.exportChat()
      if (result?.ok === true) {
        showNotice(zh ? '已导出，文件在你刚才选的位置' : 'Exported to the location you chose')
      } else if (result?.code === 'CHAT_EMPTY') {
        showNotice(zh ? '还没有可导出的对话' : 'Nothing to export yet')
      } else if (result?.reason !== 'canceled') {
        showNotice(zh ? '导出失败，详见日志' : 'Export failed, see logs')
      }
    } catch {
      showNotice(zh ? '导出失败，详见日志' : 'Export failed, see logs')
    } finally {
      if (button !== null) button.disabled = false
    }
  })

  $('clear-btn').addEventListener('click', async () => {
    if (typeof window.pet?.clearChat !== 'function') return
    // 清空不可恢复，先问一句；文案跟着系统语言走，不写死单语。
    const zh = navigator.language.toLowerCase().startsWith('zh')
    const ok = window.confirm(
      zh
        ? '清空这段对话后无法恢复，确定吗？'
        : 'This conversation cannot be recovered once cleared. Continue?'
    )
    if (!ok) return
    const result = await window.pet.clearChat()
    if (result?.ok === false) {
      showNotice(reasonText(String(result.reason ?? 'persist-failed')))
      return
    }
    const log = $('c-log')
    log.replaceChildren()
    const empty = document.createElement('p')
    empty.className = 'c-empty'
    empty.id = 'c-empty'
    empty.textContent = '对话已经清空。'
    log.append(empty)
    hideNotice()
    lastFailedText = null
  })

  $('close-btn').addEventListener('click', () => {
    if (typeof window.pet?.closeChat === 'function') {
      void window.pet.closeChat()
    } else {
      window.close()
    }
  })

  // 设置窗改了开关后，这里立刻反映，不用重开窗口。
  if (typeof window.pet?.onSettingsChanged === 'function') {
    window.pet.onSettingsChanged(() => {
      void refreshStatus()
    })
  }
}

async function main() {
  bindEvents()
  await refreshStatus()
  await loadHistory()
  $('c-input').focus()
}

void main()
