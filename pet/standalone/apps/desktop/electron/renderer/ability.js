/**
 * 能力中心：九宫格入口。
 *
 * 每个格子只调用已登记通道；没接通的项由 HTML 侧 disabled 标出来，
 * 这里不画假按钮、不伪造成功。所有结果都写进下方日志区，失败给原因。
 */

const LOG_LIMIT = 40

const CHOICE_LABEL = { rock: '石头', paper: '布', scissors: '剪刀' }
const OUTCOME_LABEL = { win: '你赢了', lose: '人家赢了', draw: '平手' }
const PANEL_LABEL = { memory: '记忆', voice: '语音', status: '运行状态' }

const REASON_LABEL = {
  'vault-unavailable': '加密仓库不可用',
  'no-key': '还没配置 Key',
  'bad-key': 'Key 无效',
  'bad-choice': '出拳参数不对',
  'bad-action': '动作名不对',
  'write-failed': '文件写入失败',
  'read-failed': '文件读不出来',
  'no-report': '还没有日报',
  unreadable: '文件读不出来',
  'network-error': '网络请求失败',
  'http-error': '服务端返回错误'
}

const $ = (id) => document.getElementById(id)

function describeFailure(result, fallback) {
  if (result?.reason && REASON_LABEL[result.reason]) return REASON_LABEL[result.reason]
  if (result?.reason) return String(result.reason)
  if (typeof result?.message === 'string' && result.message !== '') return result.message
  return fallback
}

function appendLog(text) {
  const box = $('a-log')
  if (box === null) return

  if (box.dataset.empty !== 'false') {
    box.textContent = ''
    box.dataset.empty = 'false'
  }

  const line = document.createElement('div')
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  line.textContent = `${time}  ${text}`
  box.appendChild(line)

  while (box.childElementCount > LOG_LIMIT) box.removeChild(box.firstElementChild)
  box.scrollTop = box.scrollHeight
}

function setHint(action, text) {
  const card = document.querySelector(`.a-card[data-action="${action}"]`)
  const hint = card?.querySelector('[data-role="hint"]')
  if (hint !== null && hint !== undefined) hint.textContent = text
}

function renderStats(stats) {
  const s = stats ?? { rounds: 0, wins: 0, losses: 0, draws: 0 }
  $('rps-stats').textContent =
    `战绩：${s.rounds} 局 · 胜 ${s.wins} · 负 ${s.losses} · 平 ${s.draws}`
}

/** 战绩不联网，打开窗口先读一次，免得让人以为每次都是 0 局。 */
async function refreshStats() {
  try {
    const result = await window.pet.rps('stats')
    if (result?.ok === true) renderStats(result.stats)
  } catch (error) {
    appendLog(`战绩读取失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function toggleRpsPanel() {
  const panel = $('rps-panel')
  if (panel === null) return
  panel.hidden = !panel.hidden
  if (!panel.hidden) void refreshStats()
}

async function playRound(choice) {
  const result = await window.pet.rps('play', choice)
  if (result?.ok !== true) {
    appendLog(`猜拳没有出成：${describeFailure(result, '未知原因')}`)
    return
  }

  const round = result.round
  $('rps-result').textContent =
    `你出${CHOICE_LABEL[round.user] ?? round.user}，人家出${CHOICE_LABEL[round.pet] ?? round.pet} —— ${OUTCOME_LABEL[round.outcome] ?? round.outcome}`
  renderStats(result.stats)
  appendLog(`猜拳：${OUTCOME_LABEL[round.outcome] ?? round.outcome}（第 ${result.stats.rounds} 局）`)
}

async function resetStats() {
  const result = await window.pet.rps('reset')
  if (result?.ok !== true) {
    appendLog(`清空战绩失败：${describeFailure(result, '未知原因')}`)
    return
  }
  renderStats(result.stats)
  $('rps-result').textContent = '还没出拳。'
  appendLog('战绩已清空。')
}

/** 按组渲染缩略图；图片读不出来就在那一格标记，不拿占位图冒充。 */
function renderAssetGroups(result) {
  const box = $('assets-groups')
  if (box === null) return
  box.textContent = ''

  const groups = Array.isArray(result?.groups) ? result.groups : []
  if (groups.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'a-note'
    empty.textContent = result?.reason === 'assets-missing'
      ? '没找到随包素材目录 assets/，开发时请确认仓库根下有它。'
      : '素材目录里没有可用的图片。'
    box.appendChild(empty)
    return
  }

  for (const group of groups) {
    const section = document.createElement('section')
    section.className = 'a-asset-group'

    const title = document.createElement('h3')
    title.textContent = `${group.name} · ${group.items.length}`
    section.appendChild(title)

    const grid = document.createElement('div')
    grid.className = 'a-asset-grid'

    for (const item of group.items) {
      const figure = document.createElement('figure')
      figure.className = 'a-asset-item'

      const img = document.createElement('img')
      img.src = item.url
      img.alt = item.name
      img.loading = 'lazy'
      img.addEventListener('error', () => {
        figure.classList.add('is-broken')
        figure.title = `读不出来：${item.file}`
      })

      const caption = document.createElement('figcaption')
      caption.textContent = item.name

      figure.append(img, caption)
      grid.appendChild(figure)
    }

    section.appendChild(grid)
    box.appendChild(section)
  }
}

/** 素材库：随包表情 / 立绘，加上已导入的 Live2D 模型数量。 */
async function loadAssets() {
  const result = await window.pet.listAssets()
  if (result?.ok !== true) {
    setHint('models', '读取失败')
    appendLog(`素材库读取失败：${describeFailure(result, '未知原因')}`)
    return
  }

  const total = Number.isInteger(result.total) ? result.total : 0
  const groups = Array.isArray(result.groups) ? result.groups : []
  $('assets-note').textContent = `随包 ${total} 张`
  setHint('models', `${total} 张素材`)
  renderAssetGroups(result)

  // Live2D 模型不随包，可能一个都没有，单独计一次数。
  let modelsText = '模型数量读取失败'
  try {
    const models = await window.pet.listModels()
    const count = models?.ok === true && Array.isArray(models.models) ? models.models.length : 0
    modelsText = `模型 ${count} 个`
  } catch {
    modelsText = '模型数量读取失败'
  }

  appendLog(total === 0
    ? `素材库：没有随包图片；${modelsText}。`
    : `素材库：${groups.length} 组 / ${total} 张随包素材；${modelsText}。`)
}

function toggleAssetsPanel() {
  const panel = $('assets-panel')
  if (panel === null) return
  panel.hidden = !panel.hidden
  if (!panel.hidden) void loadAssets()
}

async function openSettingsPanel(panel) {
  try {
    await window.pet.openSettings(panel)
    appendLog(`已打开设置 · ${PANEL_LABEL[panel] ?? panel}`)
  } catch (error) {
    appendLog(`打开设置失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function showBalance() {
  const result = await window.pet.queryBalance()
  if (result?.ok !== true) {
    setHint('balance', '查询失败')
    appendLog(`余额查询失败：${describeFailure(result, '未知原因')}`)
    return
  }

  if (typeof result.totalBalance !== 'number') {
    setHint('balance', '余额未知')
    appendLog('余额：接口没有返回可用总额，可能是账户余额暂不可用。')
    return
  }

  const total = `≈ ¥${result.totalBalance.toFixed(2)}`
  setHint('balance', total)
  appendLog(`余额：${total}（${result.currency ?? 'CNY'}）`)
}

async function runDaily() {
  const result = await window.pet.dailyRun()
  if (result?.ok !== true) {
    setHint('daily', '没跑成')
    appendLog(`每日巡视没有跑成：${describeFailure(result, '未知原因')}`)
    return
  }

  setHint('daily', '已生成')
  const summary = typeof result.summary === 'string' && result.summary !== ''
    ? result.summary
    : '今天没有可汇总的内容。'
  appendLog(`每日巡视：${summary}`)
}

async function runReflection() {
  const result = await window.pet.reflectionRun()
  if (result?.ok !== true) {
    setHint('reflection', '没写成')
    appendLog(`反思没有生成：${describeFailure(result, '未知原因')}`)
    return
  }

  const name = typeof result.filePath === 'string'
    ? result.filePath.split(/[\\/]/).pop()
    : ''
  setHint('reflection', name === '' ? '已生成' : `已写 ${name}`)

  const impressions = Array.isArray(result.impressions) ? result.impressions : []
  const text = impressions.length === 0 ? '已生成，但这次没有形成具体印象。' : impressions.slice(0, 3).join('；')
  appendLog(`反思：${text}`)
}

async function runAction(action) {
  switch (action) {
    case 'rps':
      toggleRpsPanel()
      return
    case 'models':
      toggleAssetsPanel()
      return
    case 'stickers':
      try {
        await window.pet.openStickerWindow()
        appendLog('已打开表情包预览页')
      } catch (error) {
        appendLog(`打开表情包失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return
    case 'memory':
    case 'voice':
    case 'status':
      await openSettingsPanel(action)
      return
    case 'insight':
      try {
        await window.pet.openInsight()
        appendLog('已打开观察台')
      } catch (error) {
        appendLog(`打开观察台失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return
    case 'balance':
      await showBalance()
      return
    case 'daily':
      await runDaily()
      return
    case 'reflection':
      await runReflection()
      return
    default:
      appendLog(`未识别的入口：${action}`)
  }
}

function bindEvents() {
  $('a-grid')?.addEventListener('click', (event) => {
    const card = event.target.closest('.a-card')
    if (card === null || card.disabled) return
    const action = card.dataset.action
    if (typeof action === 'string' && action !== '') void runAction(action)
  })

  document.querySelector('.a-rps-actions')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-choice]')
    if (button === null) return
    void playRound(button.dataset.choice)
  })

  $('rps-reset')?.addEventListener('click', () => {
    void resetStats()
  })

  $('a-clear-log')?.addEventListener('click', () => {
    const box = $('a-log')
    if (box === null) return
    box.textContent = '还没有操作。'
    box.dataset.empty = 'true'
  })

  $('a-close')?.addEventListener('click', () => {
    window.close()
  })

  void refreshStats()
}

bindEvents()
