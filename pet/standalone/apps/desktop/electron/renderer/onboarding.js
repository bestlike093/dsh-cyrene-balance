const SERVICE = 'deepseek'
const FIELD = 'api_key'
const TOTAL = 4

const $ = (id) => document.getElementById(id)

let current = null
let step = 1

async function load() {
  current = await window.pet.getSettings()

  $('nickname').value = current.nickname ?? ''

  const voice = current.voice ?? {}
  $('voice-enabled').checked = voice.enabled === true
  $('voice-trigger').value = voice.trigger ?? 'proactive'

  const quiet = voice.quietHours ?? {}
  $('quiet-enabled').checked = quiet.enabled !== false
  $('quiet-start').value = quiet.start ?? '22:00'
  $('quiet-end').value = quiet.end ?? '08:00'

  await refreshKey()
  await refreshStands()
}

/** 只发增量，其余字段原样带回去。 */
async function patch(partial) {
  current = await window.pet.saveSettings({ ...current, ...partial })
}

async function refreshKey() {
  const label = $('key-status')
  try {
    const result = await window.pet.getSecretMasked(SERVICE, FIELD)
    const masked = typeof result?.masked === 'string' ? result.masked : ''
    label.textContent =
      masked === ''
        ? '还没有配置。之后在设置里填也一样。'
        : `已保存 ${masked}。想换的话，重新填一个再保存就行。`
  } catch {
    label.textContent = '暂时读不到密钥状态，不影响继续。'
  }
}

function render() {
  document.querySelectorAll('.step').forEach((node, index) => {
    node.classList.toggle('is-active', index === step - 1)
  })
  document.querySelectorAll('.dot').forEach((node, index) => {
    node.classList.toggle('is-active', index < step)
  })
  $('next').textContent = step === TOTAL ? '完成' : '下一步'
}

/**
 * 立绘：把本机已有的模型列出来，点一下就能切过去。
 * 没有模型时不塞假入口，直接说明先用随包立绘。
 */
async function refreshStands() {
  const list = $('stand-list')
  if (list === null) return
  list.textContent = ''

  let models = []
  try {
    const result = await window.pet.listModels()
    models = Array.isArray(result) ? result : []
  } catch {
    return
  }

  if (models.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'note'
    empty.textContent = '还没有导入模型，先用随包立绘。'
    list.appendChild(empty)
    return
  }

  for (const model of models) {
    const id = typeof model?.id === 'string' ? model.id : ''
    if (id === '') continue
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'link'
    button.textContent =
      typeof model?.name === 'string' && model.name !== '' ? model.name : id
    button.addEventListener('click', () => void pickStand(id, button))
    list.appendChild(button)
  }
}

async function pickStand(id, button) {
  button.disabled = true
  const status = $('stand-status')
  try {
    await window.pet.setActiveModel(id)
    if (status !== null) status.textContent = '已经换成这个了，回去就能看到。'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (status !== null) status.textContent = `没能切换：${message}`
  } finally {
    button.disabled = false
  }
}

async function importStand() {
  const status = $('stand-status')
  try {
    const imported = await window.pet.importModel('zip')
    const model = imported?.model ?? imported
    const id = typeof model?.id === 'string' ? model.id : ''
    if (id === '') {
      if (status !== null) status.textContent = '没有选中文件，先留着现在的样子。'
      return
    }
    await window.pet.setActiveModel(id)
    await refreshStands()
    if (status !== null) status.textContent = '导入好了，已经换上。'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (status !== null) status.textContent = `没能导入：${message}`
  }
}

async function saveKeyIfAny() {
  const input = $('api-key')
  const value = input.value.trim()
  if (value === '') return
  await window.pet.setSecret(SERVICE, value, FIELD)
  input.value = ''
  await refreshKey()
}

async function saveStep() {
  if (step === 1) {
    const nickname = $('nickname').value.trim()
    if (nickname !== '') await patch({ nickname })
    return
  }

  if (step === 2) {
    await patch({
      voice: {
        enabled: $('voice-enabled').checked,
        trigger: $('voice-trigger').value,
        quietHours: {
          enabled: $('quiet-enabled').checked,
          start: $('quiet-start').value || '22:00',
          end: $('quiet-end').value || '08:00'
        }
      }
    })
    return
  }

  // 第 3 步是立绘，点中即生效，没有要额外保存的字段。
  if (step === 3) return

  await saveKeyIfAny()
}

async function next() {
  const button = $('next')
  button.disabled = true
  try {
    await saveStep()

    if (step < TOTAL) {
      step += 1
      render()
      return
    }

    // 走完全部步骤才记成完成；中途关窗下次还会出现。
    await patch({ onboarded: true })
    window.close()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    $('key-status').textContent = `没能保存：${message}`
  } finally {
    button.disabled = false
  }
}

/** 跳过只跳过当前这页的内容，不会把 onboarded 标成完成。 */
function skip() {
  if (step < TOTAL) {
    step += 1
    render()
    return
  }
  $('next').disabled = true
  void patch({ onboarded: true }).then(
    () => window.close(),
    () => {
      $('next').disabled = false
    }
  )
}

$('next').addEventListener('click', () => void next())
$('skip').addEventListener('click', skip)
$('close').addEventListener('click', () => window.close())
$('stand-import')?.addEventListener('click', () => void importStand())
$('stand-folder')?.addEventListener('click', () => {
  void window.pet.openModelsFolder?.()
})

// 换机恢复：入口默认收起，点了才展开，避免吓到第一次用的人。
// 成功时主进程会自己重启，这里只负责把状态说清楚。
const RESTORE_REASON = {
  canceled: '已取消，没有改动任何数据。',
  'weak-password': `备份口令至少 ${BackupPolicy.PASSPHRASE_MIN_LENGTH} 位。`,
  'vault-unavailable': '本机加密仓库不可用，暂时没法恢复。',
  'invalid-backup': '这份备份打不开：口令不对，或文件已损坏。'
}

// 口令长度下限由 BackupPolicy 统一提供，HTML 的 minlength 只作静态兜底。
if ($('restore-password') !== null) {
  $('restore-password').minLength = BackupPolicy.PASSPHRASE_MIN_LENGTH
}

$('restore-toggle').addEventListener('click', () => {
  const box = $('restore-box')
  box.hidden = !box.hidden
  if (!box.hidden) $('restore-password').focus()
})

// 先把「能找到哪一份」说清楚，再让用户输口令；找不到就明确说没有。
function showLatestBackup(latest) {
  const found = $('restore-latest')
  const none = $('restore-latest-none')
  if (found === null || none === null) return
  if (latest?.found === true) {
    found.hidden = false
    none.hidden = true
    found.textContent = `${latest.fileName} · ${new Date(latest.mtime).toLocaleString()} · ${latest.path}`
  } else {
    found.hidden = true
    none.hidden = false
  }
}

void window.pet
  .backupFindLatest?.()
  .then(showLatestBackup)
  .catch(() => undefined)

const RESTORE_COUNTDOWN_SECONDS = 5
let restoreTimer = null
let restoreCountdown = false

function cancelRestore() {
  if (restoreTimer !== null) {
    window.clearInterval(restoreTimer)
    restoreTimer = null
  }
  restoreCountdown = false
  const button = $('restore-confirm')
  button.disabled = false
  button.textContent = '恢复并重启'
  $('restore-status').textContent = '已取消，没有改动任何数据。'
}

async function runRestore(password) {
  const button = $('restore-confirm')
  const status = $('restore-status')
  try {
    const result = await window.pet.vaultImport(password)
    if (result?.ok === true) {
      status.textContent = '已恢复，正在重启。'
      return
    }
    button.disabled = false
    status.textContent =
      RESTORE_REASON[result?.reason] ?? result?.message ?? '恢复失败，请再试一次。'
  } catch (error) {
    button.disabled = false
    const message = error instanceof Error ? error.message : String(error)
    status.textContent = `恢复失败：${message}`
  }
}

$('restore-confirm').addEventListener('click', () => {
  if (restoreCountdown) {
    cancelRestore()
    return
  }

  const button = $('restore-confirm')
  const status = $('restore-status')
  const password = $('restore-password').value
  if (!BackupPolicy.isPassphraseLongEnough(password)) {
    status.textContent = RESTORE_REASON['weak-password']
    return
  }

  // 恢复会覆盖本机数据并重启，留 5 秒反悔窗口；这期间按钮变成取消。
  let remaining = RESTORE_COUNTDOWN_SECONDS
  restoreCountdown = true
  button.textContent = `取消恢复（${remaining}）`
  status.textContent = `将在 ${remaining} 秒后覆盖本机数据并重启。点按钮可以取消。`
  restoreTimer = window.setInterval(() => {
    remaining -= 1
    if (remaining > 0) {
      button.textContent = `取消恢复（${remaining}）`
      status.textContent = `将在 ${remaining} 秒后覆盖本机数据并重启。点按钮可以取消。`
      return
    }
    window.clearInterval(restoreTimer)
    restoreTimer = null
    restoreCountdown = false
    button.disabled = true
    button.textContent = '恢复并重启'
    status.textContent = '正在恢复…'
    void runRestore(password)
  }, 1000)
})
$('save-key').addEventListener('click', async () => {
  const button = $('save-key')
  button.disabled = true
  try {
    await saveKeyIfAny()
    await refreshKey()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    $('key-status').textContent = `保存失败：${message}`
  } finally {
    button.disabled = false
  }
})

$('nickname').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void next()
})

void load()
