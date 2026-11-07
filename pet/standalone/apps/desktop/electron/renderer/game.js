// 游戏页逻辑：排班、检测、周常记录、运行记录。
//
// 和设置窗的关系：设置页只留一个总开关和「打开游戏」入口，
// 所有需要逐项填、需要看历史的东西都收在这里，不再占设置的位置。
//
// 这里同样只走 preload 白名单方法，不直接碰主进程。

const $ = (id) => document.getElementById(id)

let current = null
let gameDetected = null
let gameDaily = null
let gameAssistantState = null
let gameAssistantRecordTask = null

/** 优先用词条，缺词条时用页面里的中文兜底，避免整块变成 key。 */
function t(key, fallback) {
  const locale = current?.locale ?? 'zh-CN'
  const text = window.PetI18n?.t?.(key, locale)
  return typeof text === 'string' && text !== '' && text !== key ? text : fallback
}

function setNote(text, warn = false) {
  const node = $('g-preview')
  if (node === null) return
  node.textContent = text
  node.classList.toggle('g-note-warn', warn)
}

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

/* ── 概览 ───────────────────────────────────────────── */

function renderOverview() {
  const games = gameDaily?.state?.games ?? {}
  const enabled = Object.values(games).filter((item) => item?.enabled === true).length
  $('g-enabled-count').textContent = String(enabled)

  if (gameAssistantState === null) {
    $('g-weekly-points').textContent = '--'
  } else {
    $('g-weekly-points').textContent = gameAssistantState.weeklyText ?? '--'
  }

  const summary =
    typeof gameDaily?.error === 'string' && gameDaily.error !== ''
      ? `配置读取失败（${gameDaily.error}），已用默认值`
      : (gameDaily?.description ?? '四个游戏都还关着，谁也不会自己动')
  $('g-summary').textContent = summary
}

/* ── 排班 ───────────────────────────────────────────── */

function renderGameDetected() {
  if (gameDetected === null) return

  const bettergi = gameDetected.bettergi?.path ?? null
  const bettergiEl = $('game-bettergi-status')
  bettergiEl.textContent = bettergi === null ? '未找到 BetterGI.exe' : `已找到 · ${bettergi}`
  bettergiEl.title = bettergi ?? ''

  const picked = $('game-select').value
  const gamePath = gameDetected.games?.[picked]?.path ?? null
  const pathEl = $('game-path-status')
  pathEl.textContent = gamePath === null ? '未找到游戏本体' : `已找到 · ${gamePath}`
  pathEl.title = gamePath ?? ''
}

function fillGameForm(config) {
  $('game-time').value = config.time ?? '04:00'
  $('game-timeout').value = String(config.timeoutMinutes ?? 150)
  $('game-enabled').checked = config.enabled === true
  $('game-launch-game').checked = config.launchGame === true
  $('game-engine-path').value = config.gamePath ?? ''

  const days = new Set(config.days ?? [])
  for (const box of document.querySelectorAll('.game-day')) {
    box.checked = days.has(Number(box.value))
  }
  renderGameDetected()
}

function readGameForm() {
  const days = []
  for (const box of document.querySelectorAll('.game-day')) {
    if (box.checked) days.push(Number(box.value))
  }

  return {
    game: $('game-select').value,
    enabled: $('game-enabled').checked,
    time: $('game-time').value,
    days,
    timeoutMinutes: Number($('game-timeout').value),
    gamePath: $('game-engine-path').value.trim(),
    launchGame: $('game-launch-game').checked,
    mode: 'dry'
  }
}

function currentDailyConfig() {
  return gameDaily?.state?.games?.[$('game-select').value] ?? null
}

function renderGameRuns(runs = []) {
  const container = $('game-runs')
  if (container === null) return
  container.replaceChildren()

  if (runs.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'g-empty'
    empty.textContent = '这个游戏还没有运行记录。'
    container.append(empty)
    return
  }

  for (const run of runs) {
    const row = document.createElement('div')
    row.className = 'g-run'

    const when = new Date(run.startedAt ?? 0)
    const label = document.createElement('div')
    label.textContent = `${run.status ?? 'unknown'} · ${when.toLocaleString('zh-CN', { hour12: false })}`

    const detail = document.createElement('span')
    detail.textContent = `${run.mode ?? 'dry'}${run.runId === undefined ? '' : ` · ${run.runId}`}`

    row.append(label, detail)
    container.append(row)
  }
}

function renderGameResult(result) {
  const lines = []
  if (result?.ok !== true) {
    lines.push('排班还不能预览：')
    for (const issue of result?.issues ?? []) lines.push(`· ${issue.message}`)
    setNote(lines.join('\n'), true)
    return
  }

  lines.push(result.preview)
  lines.push(`下次：${result.nextRunLabel}`)
  const dependencies = result.dependencies
  lines.push(`环境：${dependencies?.canRun === true ? '真实执行所需项已齐' : '真实执行还差一些项'}`)
  for (const item of dependencies?.items ?? []) {
    const detail = item.detail === undefined ? '' : ` · ${item.detail}`
    lines.push(`· ${item.label}：${item.status}${detail}`)
  }
  lines.push(result.risk)
  setNote(lines.join('\n'))
}

async function refreshGameRuns() {
  if (typeof window.pet?.gameDailyRuns !== 'function') return
  try {
    const result = await window.pet.gameDailyRuns({ game: $('game-select').value, limit: 5 })
    renderGameRuns(result?.runs ?? [])
  } catch {
    renderGameRuns([])
  }
}

function showCurrentGame() {
  const config = currentDailyConfig()
  if (config !== null) fillGameForm(config)
  void refreshGameRuns()
}

async function refreshGameDaily() {
  if (typeof window.pet?.gameDailyState !== 'function') return
  try {
    const result = await window.pet.gameDailyState()
    gameDaily = result
    showCurrentGame()
    renderOverview()
    setNote(
      typeof result?.error === 'string' && result.error !== ''
        ? `配置读取失败（${result.error}），已用默认值。`
        : (result?.description ?? '四个游戏都还关着，谁也不会自己动。')
    )
  } catch (error) {
    setNote(`配置读取失败：${message(error)}`, true)
  }
}

/* ── 游戏助手 ───────────────────────────────────────── */

function renderGameAssistantTasks() {
  const container = $('game-assistant-tasks')
  if (container === null) return

  const tasks = (gameAssistantState?.tasks ?? []).filter(
    (task) => task.game === 'starrail' && (task.kind === 'daily' || task.kind === 'weekly')
  )

  container.replaceChildren()

  if (tasks.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'g-empty'
    empty.textContent = '还没有可记录的周常任务。'
    container.append(empty)
    return
  }

  for (const task of tasks) {
    const row = document.createElement('div')
    row.className = 'g-task'

    const text = document.createElement('div')
    const label = document.createElement('div')
    label.className = 'g-task-name'
    label.textContent = task.label
    const hint = document.createElement('div')
    hint.className = 'g-task-meta'
    hint.textContent = task.note ?? ''
    text.append(label, hint)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'g-btn'
    button.textContent = t('gameAssistant.recordButton', '记录')
    button.addEventListener('click', () => openGameAssistantRecord(task))

    row.append(text, button)
    container.append(row)
  }
}

function renderGameAssistant() {
  if (gameAssistantState === null) return
  const risk = gameAssistantState.risk ?? {}

  const stateNode = $('game-assistant-state')
  if (risk.enabled === true) {
    stateNode.textContent = t('gameAssistant.stateOn', '已开启')
  } else if (risk.confirmations === 1) {
    stateNode.textContent = t('gameAssistant.stateOnce', '已确认一次')
  } else {
    stateNode.textContent = t('gameAssistant.closed', '默认关闭')
  }

  $('game-assistant-open').hidden = risk.enabled === true
  $('game-assistant-close').hidden = risk.enabled !== true

  const list = $('game-assistant-risk-list')
  list.replaceChildren()
  for (const line of risk.disclosures ?? []) {
    const item = document.createElement('li')
    item.textContent = line
    list.append(item)
  }

  $('game-assistant-risk-step').textContent =
    risk.enabled === true
      ? t('gameAssistant.stateEnabled', '已经开启')
      : t('gameAssistant.stepShort', '第 {n} / 2 次确认').replace(
          '{n}',
          String(Math.min(2, (risk.confirmations ?? 0) + 1))
        )

  $('game-assistant-confirm').textContent =
    (risk.confirmations ?? 0) >= 1
      ? t('gameAssistant.secondConfirm', '第二次确认')
      : t('gameAssistant.confirmFirst', '第一次确认')

  renderGameAssistantTasks()
  renderOverview()
}

async function refreshGameAssistant() {
  if (typeof window.pet?.gameAssistantStatus !== 'function') return
  try {
    gameAssistantState = await window.pet.gameAssistantStatus()
    renderGameAssistant()
  } catch (error) {
    $('game-assistant-state').textContent = `读取失败：${message(error)}`
  }
}

function openGameAssistantRecord(task) {
  gameAssistantRecordTask = task
  $('game-assistant-record-title').textContent = `${t(
    'gameAssistant.recordPrefix',
    '记录一次通关 · '
  )}${task.label}`
  $('game-assistant-record').hidden = false
  $('game-assistant-record-feedback').textContent = ''
  $('game-assistant-points').value = String(task.points ?? 0)
}

/* ── 事件 ───────────────────────────────────────────── */

$('g-close').addEventListener('click', () => window.close())

$('game-detect').addEventListener('click', async () => {
  if (typeof window.pet?.gameDetect !== 'function') return
  try {
    gameDetected = await window.pet.gameDetect()
    renderGameDetected()
    setNote('检测完成。可以保存排班，或直接做一次演练预览。')
  } catch (error) {
    setNote(`检测失败：${message(error)}`, true)
  }
})

$('game-select').addEventListener('change', () => {
  if (gameDaily === null) {
    renderGameDetected()
    return
  }
  showCurrentGame()
})

$('game-save').addEventListener('click', async () => {
  if (typeof window.pet?.gameDailyUpdate !== 'function') return
  const form = readGameForm()
  try {
    const result = await window.pet.gameDailyUpdate({
      game: form.game,
      patch: {
        enabled: form.enabled,
        time: form.time,
        days: form.days,
        timeoutMinutes: form.timeoutMinutes,
        gamePath: form.gamePath,
        launchGame: form.launchGame
      }
    })
    if (result?.ok === true) {
      gameDaily = result
      showCurrentGame()
      renderOverview()
      setNote('排班已保存。真实执行前还需要应用计划任务。')
      return
    }
    const lines = ['这次没有保存：']
    for (const issue of result?.issues ?? []) lines.push(`· ${issue.message}`)
    setNote(lines.join('\n'), true)
  } catch (error) {
    setNote(`保存失败：${message(error)}`, true)
  }
})

$('game-dry-run').addEventListener('click', async () => {
  if (typeof window.pet?.gameDryRun !== 'function') return
  try {
    renderGameResult(await window.pet.gameDryRun(readGameForm()))
  } catch (error) {
    setNote(`预览失败：${message(error)}`, true)
  }
})

$('game-apply').addEventListener('click', async () => {
  if (typeof window.pet?.gameDailyApply !== 'function') return
  try {
    const result = await window.pet.gameDailyApply()
    const lines = [result?.message ?? '已提交注册请求。']
    for (const task of result?.tasks ?? []) {
      lines.push(`· ${task.name ?? task.TaskName ?? '未知任务'}：${task.state ?? '已提交'}`)
    }
    setNote(lines.join('\n'), result?.ok !== true)
    await refreshGameDaily()
  } catch (error) {
    setNote(`应用失败：${message(error)}`, true)
  }
})

$('game-task-query').addEventListener('click', async () => {
  if (typeof window.pet?.gameDailyQuery !== 'function') return
  try {
    const result = await window.pet.gameDailyQuery()
    if (result?.ok !== true) {
      setNote(`查询失败：${result?.stderr ?? '未知错误'}`, true)
      return
    }
    const names = (result.tasks ?? []).map((task) => task.name ?? task.TaskName ?? '未知任务')
    setNote(names.length === 0 ? '计划任务里还没有 Cyrene 的日常。' : `已注册：${names.join('、')}`)
  } catch (error) {
    setNote(`查询失败：${message(error)}`, true)
  }
})

$('game-disable').addEventListener('click', async () => {
  if (typeof window.pet?.gameDailyDisable !== 'function') return
  const game = $('game-select').value
  try {
    const result = await window.pet.gameDailyDisable([game])
    setNote(result?.message ?? '已关闭这个游戏。', result?.ok !== true)
    await refreshGameDaily()
  } catch (error) {
    setNote(`关闭失败：${message(error)}`, true)
  }
})

$('game-assistant-open').addEventListener('click', () => {
  $('game-assistant-risk').hidden = false
  $('game-assistant-feedback').textContent = ''
})

$('game-assistant-cancel').addEventListener('click', () => {
  $('game-assistant-risk').hidden = true
})

$('game-assistant-confirm').addEventListener('click', async () => {
  if (typeof window.pet?.gameAssistantConfirm !== 'function') return
  try {
    const result = await window.pet.gameAssistantConfirm({
      acknowledged: $('game-assistant-ack').checked,
      phrase: $('game-assistant-phrase').value,
      understandsRealRun: $('game-assistant-understand').checked
    })
    $('game-assistant-feedback').textContent = result?.message ?? '已提交。'
    if (result?.ok === true) {
      await refreshGameAssistant()
      if (gameAssistantState?.risk?.enabled === true) {
        $('game-assistant-risk').hidden = true
      }
    }
  } catch (error) {
    $('game-assistant-feedback').textContent = `确认失败：${message(error)}`
  }
})

$('game-assistant-close').addEventListener('click', async () => {
  if (typeof window.pet?.gameAssistantDisable !== 'function') return
  try {
    await window.pet.gameAssistantDisable()
    await refreshGameAssistant()
  } catch (error) {
    $('game-assistant-state').textContent = `关闭失败：${message(error)}`
  }
})

$('game-assistant-record-cancel').addEventListener('click', () => {
  $('game-assistant-record').hidden = true
})

$('game-assistant-record-save').addEventListener('click', async () => {
  if (gameAssistantRecordTask === null) return
  if (typeof window.pet?.gameAssistantRecord !== 'function') return

  const task = gameAssistantRecordTask
  const source = task.id.includes('currency')
    ? 'currency-war'
    : task.id.includes('divergent')
      ? 'divergent-universe'
      : 'other'

  try {
    const result = await window.pet.gameAssistantRecord({
      id: `${task.id}-${Date.now()}`,
      source,
      difficulty: $('game-assistant-difficulty').value,
      completed: $('game-assistant-completed').checked,
      points: Number($('game-assistant-points').value),
      claimed: $('game-assistant-claimed').checked,
      recordedAt: Date.now()
    })
    $('game-assistant-record-feedback').textContent = result?.ok
      ? '记录好了。'
      : (result?.error ?? '记录失败')
    if (result?.ok) {
      $('game-assistant-record').hidden = true
      await refreshGameAssistant()
    }
  } catch (error) {
    $('game-assistant-record-feedback').textContent = `保存失败：${message(error)}`
  }
})

/* ── 启动 ───────────────────────────────────────────── */

async function init() {
  try {
    current = await window.pet?.getSettings?.()
    window.PetI18n?.apply?.(current?.locale ?? 'zh-CN')
  } catch {
    // 读不到设置不影响游戏页本身，按中文默认继续。
  }

  await Promise.all([refreshGameDaily(), refreshGameAssistant()])

  if (typeof window.pet?.gameDetect === 'function') {
    try {
      gameDetected = await window.pet.gameDetect()
      renderGameDetected()
    } catch {
      // 检测失败就保留「还没有检测」，用户可以手动点。
    }
  }
}

void init()
