/**
 * dsh-cyrene-pet — 客户端半（Client half）。
 *
 * 在 dsh 设置页挂一张「昔涟 · 桌宠」卡片：看运行状态，
 * 启动 / 重启 / 关闭桌宠进程。真正干活的是宿主半的
 * /cyrene-pet/control 路由。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cyrene-pet',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const PACKAGE_ID = 'dsh-cyrene-pet'
    const STATE_PATH = '/cyrene-pet/state'
    const CONTROL_PATH = '/cyrene-pet/control'
    const COMPANION_PATH = '/cyrene-pet/companion'
    const ABILITY_PATH = '/cyrene-pet/companion/ability'
    const SESSIONS_PATH = '/cyrene-pet/sessions'
    const SESSION_BIND_PATH = '/cyrene-pet/sessions/bind'
    const SESSION_HISTORY_PATH = '/cyrene-pet/sessions/history'
    const MEMORY_PATH = '/cyrene-pet/companion/memory'
    const MEMORY_PIN_PATH = '/cyrene-pet/companion/memory/pin'
    const MEMORY_FORGET_PATH = '/cyrene-pet/companion/memory/forget'
    const MEMORY_EXPORT_PATH = '/cyrene-pet/companion/memory/export'
    const MEMORY_IMPORT_PATH = '/cyrene-pet/companion/memory/import'
    const MEMORY_SETTINGS_PATH = '/cyrene-pet/companion/memory/settings'
    const BACKUP_EXPORT_PATH = '/cyrene-pet/companion/backup/export'
    const BACKUP_RESTORE_PATH = '/cyrene-pet/companion/backup/restore'
    const VAULT_ROTATE_PATH = '/cyrene-pet/companion/vault/rotate'
    const SLOT_LABELS = { identity: '身份', preference: '偏好', event: '事件', relation: '关系' }
    const RPS_OPTIONS = [
      { id: 'rock', label: '石头', mark: '✊' },
      { id: 'scissors', label: '剪刀', mark: '✌' },
      { id: 'paper', label: '布', mark: '🖐' },
    ]
    const RPS_LABELS = { rock: '石头', scissors: '剪刀', paper: '布' }

    const CSS = `
.cyp-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 640px;
  padding: 18px 20px;
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, currentColor 3%, transparent);
  font-size: 13px;
  line-height: 1.6;
}
.cyp-head { display: flex; flex-direction: column; gap: 4px; }
.cyp-title { display: flex; align-items: baseline; gap: 8px; font-size: 15px; font-weight: 600; letter-spacing: .02em; }
.cyp-version { opacity: .45; font-size: 11px; font-weight: 500; letter-spacing: .04em; }
.cyp-hint { opacity: .62; font-size: 12px; }
.cyp-state { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.cyp-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: .55; }
.cyp-dot[data-on="1"] { background: #3fbf7f; opacity: 1; }
.cyp-dot[data-err="1"] { background: #d9534f; opacity: 1; }
.cyp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cyp-btn {
  padding: 7px 16px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 4%, transparent);
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.cyp-btn:hover { background: color-mix(in srgb, #ef6ba8 16%, transparent); }
.cyp-btn:disabled { opacity: .5; cursor: default; }
.cyp-btn[data-tone="primary"] {
  border-color: color-mix(in srgb, #ef6ba8 40%, transparent);
  background: color-mix(in srgb, #ef6ba8 14%, transparent);
}
.cyp-status { font-size: 12px; opacity: .7; }
.cyp-status[data-tone="err"] { color: #d9534f; opacity: .95; }
.cyp-note { font-size: 11px; opacity: .5; word-break: break-all; }
.cyp-companion {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 8px 10px; border-radius: 10px;
  background: color-mix(in srgb, currentColor 3%, transparent);
}
.cyp-chip[data-tone="quiet"] { opacity: .55; }
.cyp-mem { border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); padding-top: 10px; }
.cyp-mem > summary { cursor: pointer; font-size: 12.5px; font-weight: 600; opacity: .85; }
.cyp-game { border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); padding-top: 10px; }
.cyp-game > summary { cursor: pointer; font-size: 12.5px; font-weight: 600; opacity: .85; }
.cyp-game-result { margin: 2px 0; font-size: 12px; }
.cyp-game-result[data-result="win"] { color: #2f9e6a; }
.cyp-game-result[data-result="lose"] { color: #c46a5a; }
.cyp-sessions { border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); padding-top: 10px; }
.cyp-sessions > summary { cursor: pointer; font-size: 12.5px; font-weight: 600; opacity: .85; }
.cyp-session-list { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.cyp-session-item {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  padding: 5px 7px; border: 1px solid transparent; border-radius: 8px;
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.cyp-session-item:hover { border-color: color-mix(in srgb, currentColor 14%, transparent); }
.cyp-session-item[data-active="1"] {
  border-color: color-mix(in srgb, #ef6ba8 34%, transparent);
  background: color-mix(in srgb, #ef6ba8 10%, transparent);
}
.cyp-session-run { flex: none; font-size: 10px; color: #2f9e6a; }
.cyp-session-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cyp-session-time { flex: none; font-size: 11px; opacity: .5; }
.cyp-preview {
  margin: 6px 0; padding: 8px 10px; border-radius: 8px;
  background: color-mix(in srgb, currentColor 4%, transparent);
  max-height: 260px; overflow: auto;
}
.cyp-preview-item { margin: 3px 0; font-size: 12px; line-height: 1.55; word-break: break-word; }
.cyp-preview-item[data-role="assistant"] { opacity: .85; }
.cyp-preview-role { font-size: 10px; opacity: .5; margin-right: 5px; }
.cyp-mem-list { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow: auto; margin: 8px 0; }
.cyp-mem-item {
  display: flex; align-items: flex-start; gap: 7px;
  padding: 7px 9px; border-radius: 9px;
  background: color-mix(in srgb, currentColor 3%, transparent);
}
.cyp-chip {
  flex: none; padding: 1px 7px; border-radius: 999px;
  background: color-mix(in srgb, #ef6ba8 14%, transparent);
  font-size: 10.5px; opacity: .9;
}
.cyp-mem-text { flex: 1; font-size: 12px; line-height: 1.5; word-break: break-word; }
.cyp-mini {
  flex: none; padding: 2px 7px; border-radius: 7px;
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  background: transparent; color: inherit; font: inherit; font-size: 10.5px; cursor: pointer;
}
.cyp-mini:hover { background: color-mix(in srgb, #ef6ba8 12%, transparent); }
.cyp-mem-form { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
.cyp-input, .cyp-select {
  padding: 5px 8px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
  color: inherit; font: inherit; font-size: 12px;
}
.cyp-input { flex: 1; min-width: 160px; }
.cyp-notice {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 10px; border-radius: 9px;
  background: color-mix(in srgb, #ef6ba8 12%, transparent);
  border: 1px solid color-mix(in srgb, #ef6ba8 28%, transparent);
  font-size: 12px;
}
.cyp-toggle { display: flex; align-items: center; gap: 7px; font-size: 12.5px; cursor: pointer; }
.cyp-toggle input { accent-color: #ef6ba8; }
`

    function log(level, message, error) {
      const logger = typeof console !== 'undefined' ? console : null
      if (logger === null) return
      const fn = logger[level] ?? logger.log
      try {
        fn.call(logger, `[${PACKAGE_ID}] ${message}`, error ?? '')
      } catch {
        /* 控制台不可用时静默 */
      }
    }

    function api(path, init) {
      return fetch(new URL(path, window.location.origin).href, init).then((response) => response.json())
    }

    function apply(ctx) {
      let react = null
      try {
        react = require('react')
      } catch (error) {
        log('warn', 'React 不可用，设置页卡片已跳过', error)
        return
      }
      const h = react.createElement

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.setAttribute('data-plugin-css', PACKAGE_ID)
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => tag.remove()
      }, `${PACKAGE_ID}: stylesheet`)

      function PetSection() {
        const [state, setState] = react.useState(null)
        const [status, setStatus] = react.useState('')
        const [tone, setTone] = react.useState('')
        const [busy, setBusy] = react.useState('')
        const [memories, setMemories] = react.useState(null)
        const [memText, setMemText] = react.useState('')
        const [memSlot, setMemSlot] = react.useState('event')
        const [memBusy, setMemBusy] = react.useState('')
        const [memStatus, setMemStatus] = react.useState('')
        const [companion, setCompanion] = react.useState(null)
        const [companionError, setCompanionError] = react.useState('')
        const [ability, setAbility] = react.useState(null)
        const [abilityBusy, setAbilityBusy] = react.useState('')
        const [abilityStatus, setAbilityStatus] = react.useState('')
        const [lastRound, setLastRound] = react.useState(null)
        const [allSessions, setAllSessions] = react.useState([])
        const [sessionsStatus, setSessionsStatus] = react.useState('')
        const [sessionBusy, setSessionBusy] = react.useState('')
        const [preview, setPreview] = react.useState(null)
        const [previewStatus, setPreviewStatus] = react.useState('')
        const [backupPassphrase, setBackupPassphrase] = react.useState('')
        const [backupEncrypted, setBackupEncrypted] = react.useState(true)
        const [backupBusy, setBackupBusy] = react.useState('')
        const [backupStatus, setBackupStatus] = react.useState('')

        const load = react.useCallback(() => {
          api(STATE_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setState(payload.value ?? {})
            })
            .catch((error) => {
              log('warn', '读取桌宠状态失败', error)
              setStatus('读取失败了… 宿主半可能没加载。')
              setTone('err')
            })
        }, [])

        const loadMemories = react.useCallback(() => {
          api(MEMORY_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setMemories(Array.isArray(payload.items) ? payload.items : [])
            })
            .catch((error) => {
              log('warn', '读取记忆失败', error)
              setMemories([])
              setMemStatus('记忆列表没读出来…')
            })
        }, [])

        const loadCompanion = react.useCallback(() => {
          api(COMPANION_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setCompanion(payload)
              setCompanionError('')
            })
            .catch((error) => {
              log('warn', '读取陪伴状态失败', error)
              setCompanion(null)
              setCompanionError('陪伴状态没读出来…')
            })
        }, [])

        const loadAbility = react.useCallback(() => {
          api(ABILITY_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setAbility(payload)
              if (payload.round) setLastRound(payload.round)
            })
            .catch((error) => {
              log('warn', '读取战绩失败', error)
              setAbility(null)
              setAbilityStatus('战绩没读出来…')
            })
        }, [])

        const loadSessions = react.useCallback(() => {
          api(SESSIONS_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              const workspaces = Array.isArray(payload.value?.workspaces) ? payload.value.workspaces : []
              const flat = []
              for (const workspace of workspaces) {
                const sessions = Array.isArray(workspace?.sessions) ? workspace.sessions : []
                for (const item of sessions) {
                  if (!item || typeof item.id !== 'string') continue
                  flat.push({ ...item, workspaceName: workspace.name ?? item.workspace ?? '' })
                }
              }
              flat.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
              setAllSessions(flat)
              setSessionsStatus('')
            })
            .catch((error) => {
              log('warn', '读取会话列表失败', error)
              setAllSessions([])
              setSessionsStatus('会话列表没读出来…')
            })
        }, [])

        const bindSession = (id, label) => {
          setSessionBusy(id === '' ? 'follow' : id)
          setSessionsStatus(id === '' ? '正在回到跟随当前对话…' : `正在切到「${label}」…`)
          api(SESSION_BIND_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              setState((current) => (current === null ? current : { ...current, boundSessionId: id === '' ? null : id }))
              setPreview(null)
              setPreviewStatus('')
              setSessionsStatus(id === '' ? '现在跟着当前对话走 ♪' : `已经切到「${label}」♪`)
              loadSessions()
              loadCompanion()
            })
            .catch((error) => {
              log('warn', '切换会话失败', error)
              setSessionsStatus('这条会话没切过去…')
            })
            .then(() => setSessionBusy(''))
        }

        const openSession = (id) => {
          setPreviewStatus('正在翻这十条…')
          setPreview(null)
          api(`${SESSION_HISTORY_PATH}?id=${encodeURIComponent(id)}&limit=10`, {
            headers: { accept: 'application/json' },
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setPreview(payload.value)
            })
            .catch((error) => {
              log('warn', '读取会话片段失败', error)
              setPreviewStatus('这段没翻开…')
            })
            .then(() => {
              setPreviewStatus((current) => (current === '正在翻这十条…' ? '' : current))
            })
        }

        react.useEffect(() => {
          load()
          loadCompanion()
          loadAbility()
          loadSessions()
          loadMemories()
        }, [load, loadCompanion, loadAbility, loadSessions, loadMemories])

        const memoryAction = (path, body, label, clearText = false) => {
          setMemBusy(label)
          setMemStatus(`${label}…`)
          api(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              setMemStatus(`${label}好了 ♪`)
              if (clearText) setMemText('')
              loadMemories()
            })
            .catch((error) => {
              log('warn', `记忆${label}失败`, error)
              setMemStatus(`${label}没有成功…`)
            })
            .then(() => setMemBusy(''))
        }

        const importRef = react.useRef(null)

        const saveMemorySettings = (patch, label) => {
          const body = {}
          if (Number.isFinite(state?.rev)) body.rev = state.rev
          if (typeof patch.memoryEnabled === 'boolean') body.enabled = patch.memoryEnabled
          if (typeof patch.memoryNoticeDismissed === 'boolean') {
            body.noticeDismissed = patch.memoryNoticeDismissed
          }
          setBusy('state')
          setStatus(`${label}…`)
          api(MEMORY_SETTINGS_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) {
                /* 409 会把最新状态一起带回来：先接住，用户再点一次就能用新 rev 保存 */
                if (payload?.value) setState(payload.value)
                const error = new Error(payload?.error?.message ?? 'failed')
                error.code = payload?.error?.code ?? ''
                throw error
              }
              setState(payload.value ?? {})
              setStatus(`${label}好了 ♪`)
              setTone('')
            })
            .catch((error) => {
              log('warn', `设置${label}失败`, error)
              setStatus(error?.code === 'stale' ? '设置在别处更新过了，已经刷新，请再试一次' : `${label}没有成功…`)
              setTone('err')
            })
            .then(() => setBusy(''))
        }

        const exportMemory = () => {
          setMemBusy('导出')
          setMemStatus('正在把她的记忆装进信封…')
          api(MEMORY_EXPORT_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              const text = JSON.stringify(payload, null, 2)
              const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = `cyrene-memory-${new Date().toISOString().slice(0, 10)}.json`
              link.click()
              URL.revokeObjectURL(url)
              setMemStatus('备份已经导出 ✉')
            })
            .catch((error) => {
              log('warn', '导出记忆失败', error)
              setMemStatus('备份没有导出成功…')
            })
            .then(() => setMemBusy(''))
        }

        const importMemory = (event) => {
          const file = event.target.files && event.target.files[0]
          event.target.value = ''
          if (!file) return
          file.text()
            .then((text) => {
              const parsed = JSON.parse(text)
              memoryAction(MEMORY_IMPORT_PATH, { memory: parsed.memory ?? parsed }, '恢复')
            })
            .catch((error) => {
              log('warn', '读取记忆备份失败', error)
              setMemStatus('这份备份读不出来…')
            })
        }

        const backupFileRef = react.useRef(null)

        const exportFullBackup = () => {
          if (backupEncrypted && backupPassphrase.trim().length < 8) {
            setBackupStatus('加密备份的口令至少需要 8 个字符')
            return
          }
          setBackupBusy('export')
          setBackupStatus('正在把整库装进备份…')
          api(BACKUP_EXPORT_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              encrypted: backupEncrypted,
              passphrase: backupPassphrase,
            }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              const text = JSON.stringify(payload.backup, null, 2)
              const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = payload.fileName || 'cyrene-pet-backup.json'
              link.click()
              URL.revokeObjectURL(url)
              setBackupStatus(backupEncrypted ? '加密备份已经导出 ✉' : '明文备份已经导出（请妥善保管）')
            })
            .catch((error) => {
              log('warn', '导出整库备份失败', error)
              setBackupStatus(`备份没有导出成功：${error?.message ?? '未知错误'}`)
            })
            .then(() => setBackupBusy(''))
        }

        const restoreFullBackup = (event) => {
          const file = event.target.files && event.target.files[0]
          event.target.value = ''
          if (!file) return
          file.text()
            .then((text) => {
              const parsed = JSON.parse(text)
              const encrypted = parsed && parsed.format === 'cyrene-pet-backup-envelope'
              if (encrypted && backupPassphrase.trim().length < 8) {
                throw new Error('这份备份需要口令，先在输入框里填好再恢复')
              }
              if (!window.confirm('恢复会覆盖当前的设置、记忆、好感和陪伴状态，确定继续吗？')) {
                return null
              }
              setBackupBusy('restore')
              setBackupStatus('正在恢复整库…')
              return api(BACKUP_RESTORE_PATH, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  backup: parsed,
                  passphrase: encrypted ? backupPassphrase : '',
                }),
              })
            })
            .then((payload) => {
              if (payload === null) return
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              setBackupStatus(`恢复好了，记忆 ${Number(payload.memoryCount) || 0} 条 ♪`)
              load()
              loadCompanion()
              loadMemories()
            })
            .catch((error) => {
              log('warn', '恢复整库备份失败', error)
              setBackupStatus(`没有恢复成功：${error?.message ?? '未知错误'}`)
            })
            .then(() => setBackupBusy(''))
        }

        const rotateVaultKeys = () => {
          if (!window.confirm('轮换后会重新加密本机的密钥仓库与记忆仓库，确定继续吗？')) return
          setBackupBusy('rotate')
          setBackupStatus('正在轮换本机密钥…')
          api(VAULT_ROTATE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              setBackupStatus('本机密钥已经轮换 ♪')
            })
            .catch((error) => {
              log('warn', '轮换本机密钥失败', error)
              setBackupStatus(`轮换没有成功：${error?.message ?? '未知错误'}`)
            })
            .then(() => setBackupBusy(''))
        }

        const playAbility = (choice) => {
          setAbilityBusy(choice)
          setAbilityStatus('')
          api(ABILITY_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ choice }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              setAbility(payload)
              setLastRound(payload.round ?? null)
            })
            .catch((error) => {
              log('warn', '出拳失败', error)
              setAbilityStatus('这一局没结算成功…')
            })
            .then(() => setAbilityBusy(''))
        }

        const whenText = (value) => {
          const stamp = Number(value)
          if (!Number.isFinite(stamp) || stamp <= 0) return ''
          const date = new Date(stamp)
          if (Number.isNaN(date.getTime())) return ''
          return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        }

        const roleLabel = (role) => {
          if (role === 'user') return '你'
          if (role === 'assistant') return '她'
          return '记录'
        }

        const sessionLabel = (item) => {
          const title = typeof item?.title === 'string' ? item.title.trim() : ''
          if (title !== '') return title
          const workspace = typeof item?.workspaceName === 'string' ? item.workspaceName.trim() : ''
          return workspace === '' ? '未命名对话' : `${workspace} · 未命名对话`
        }

        const control = (action, label) => {
          setBusy(action)
          setStatus(`${label}…`)
          setTone('')
          api(CONTROL_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              setState(payload.value ?? {})
              setBusy('')
              setStatus(
                action === 'start' ? '已经去叫桌宠起床了，稍等两秒 ♪' : action === 'restart' ? '重新拉起来了，等它露个脸 ♪' : '先把桌宠收起来了。',
              )
              setTone('')
            })
            .catch((error) => {
              log('warn', `桌宠${label}失败`, error)
              setBusy('')
              setStatus(`${label}没有成功… 看看宿主日志？`)
              setTone('err')
            })
        }

        if (state === null) {
          return h('div', { className: 'cyp-card' },
            h('p', { className: 'cyp-hint' }, '正在看看桌宠醒着没有…'))
        }

        const running = state.petRunning === true
        const runtimeError = typeof state.runtimeError === 'string' ? state.runtimeError : ''

        return h('div', { className: 'cyp-card' },
          h('div', { className: 'cyp-head' },
            h('div', { className: 'cyp-title' },
              '昔涟 · 桌宠',
              state.version ? h('span', { className: 'cyp-version' }, `v${state.version}`) : null),
            h('div', { className: 'cyp-hint' }, '桌面桌宠（立绘 / Live2D）：提问、风险审批和任务进程都会在这里出现。')),
          h('p', { className: 'cyp-note' },
            '外观、背景与人格在桌宠窗口右键 →「换形象」；这里负责启动、重启和看运行状态。'),
          h('div', { className: 'cyp-state' },
            h('i', {
              className: 'cyp-dot',
              'data-on': running ? '1' : '0',
              'data-err': runtimeError !== '' ? '1' : '0',
            }),
            h('span', null,
              running ? '桌宠正在运行' : state.enabled === false ? '桌宠已关闭' : '桌宠没有在运行')),
          runtimeError === ''
            ? null
            : h('div', { className: 'cyp-note' }, `最近一次启动失败：${runtimeError}`),
          h('div', { className: 'cyp-row' },
            h('button', {
              type: 'button',
              className: 'cyp-btn',
              'data-tone': 'primary',
              disabled: busy !== '' || running,
              onClick: () => control('start', '启动'),
            }, '启动'),
            h('button', {
              type: 'button',
              className: 'cyp-btn',
              disabled: busy !== '',
              onClick: () => control('restart', '重启'),
            }, '重启'),
            h('button', {
              type: 'button',
              className: 'cyp-btn',
              disabled: busy !== '' || !running,
              onClick: () => control('stop', '关闭'),
            }, '关闭'),
            h('button', {
              type: 'button',
              className: 'cyp-btn',
              disabled: busy !== '',
              onClick: load,
            }, '刷新')),
          h('p', { className: 'cyp-note' },
            '提示：提问与审批由「桌宠设置 → 对话与审批」决定在哪边出现；长按立绘会播报任务进程。'),
          companion === null
            ? h('p', { className: 'cyp-hint' }, companionError || '正在看她今天的心情…')
            : h('div', { className: 'cyp-companion' },
                h('span', { className: 'cyp-chip' },
                  `关系 · ${companion.bond && companion.bond.levelLabel ? companion.bond.levelLabel : '还陌生'}`),
                h('span', { className: 'cyp-chip' },
                  `今天开口 ${Number(companion.openings && companion.openings.today) || 0} 次`),
                h('span', { className: 'cyp-chip' },
                  `记忆 ${Number(companion.memoryCount) || 0} 条`),
                companion.openings && companion.openings.gaveUp === true
                  ? h('span', { className: 'cyp-chip', 'data-tone': 'quiet' }, '先安静几天')
                  : null,
                h('button', {
                  type: 'button',
                  className: 'cyp-mini',
                  onClick: loadCompanion,
                }, '刷新状态')),
          h('details', { className: 'cyp-sessions' },
            h('summary', null,
              `会话${allSessions.length > 0 ? `（${allSessions.length}）` : ''}`),
            h('p', { className: 'cyp-hint' },
              state.boundSessionId
                ? '已经选中一条会话；点「跟随当前对话」可以回到自动跟随。'
                : '现在跟着 DSH 的当前对话走。也可以选一条固定下来。'),
            sessionsStatus === ''
              ? null
              : h('p', { className: 'cyp-status' }, sessionsStatus),
            h('div', { className: 'cyp-session-list' },
              h('button', {
                type: 'button',
                className: 'cyp-session-item',
                'data-active': state.boundSessionId ? '0' : '1',
                disabled: sessionBusy !== '',
                onClick: () => bindSession('', ''),
              },
                h('span', { className: 'cyp-session-title' }, '跟随当前对话'),
                h('span', { className: 'cyp-session-time' }, '自动')),
              allSessions.length === 0
                ? h('p', { className: 'cyp-hint' }, '还没有能读到的会话。')
                : allSessions.slice(0, 20).map((item) =>
                    h('button', {
                      key: item.id,
                      type: 'button',
                      className: 'cyp-session-item',
                      'data-active': state.boundSessionId === item.id ? '1' : '0',
                      disabled: sessionBusy !== '',
                      onClick: () => {
                        bindSession(item.id, sessionLabel(item))
                        openSession(item.id)
                      },
                    },
                      h('span', { className: 'cyp-session-title' }, sessionLabel(item)),
                      item.running === true
                        ? h('span', { className: 'cyp-session-run' }, '生成中')
                        : null,
                      h('span', { className: 'cyp-session-time' }, whenText(item.updatedAt))))),
            previewStatus === ''
              ? null
              : h('p', { className: 'cyp-status' }, previewStatus),
            preview === null
              ? null
              : h('div', { className: 'cyp-preview' },
                  h('p', { className: 'cyp-hint' }, preview.title || '未命名会话'),
                  (Array.isArray(preview.messages) ? preview.messages : []).map((message, index) =>
                    h('p', {
                      key: `${preview.id ?? 'session'}-${index}`,
                      className: 'cyp-preview-item',
                      'data-role': message.role || 'other',
                    },
                      h('span', { className: 'cyp-preview-role' }, roleLabel(message.role)),
                      message.text
                        ? String(message.text).slice(0, 180)
                        : `[${message.kind || '记录'}]`)))),
          h('details', { className: 'cyp-mem' },
            h('summary', null,
              `她记住的事${Array.isArray(memories) ? `（${memories.length}）` : ''}`),
            h('p', { className: 'cyp-hint' },
              '这些会参与记忆回访和主动开口。固定下来的条目不会随时间淡掉，忘掉的会立刻从她的小本子里消失。'),
            Number(state.memoryFirstWriteAt) > 0 && state.memoryNoticeDismissed !== true
              ? h('div', { className: 'cyp-notice' },
                  h('span', null, '她第一次把你的事记进了加密的小本子。'),
                  h('button', {
                    type: 'button',
                    className: 'cyp-mini',
                    disabled: busy !== '',
                    onClick: () => saveMemorySettings({ memoryNoticeDismissed: true }, '收下提示'),
                  }, '知道啦'))
              : null,
            h('label', { className: 'cyp-toggle' },
              h('input', {
                type: 'checkbox',
                checked: state.memoryEnabled !== false,
                disabled: busy !== '',
                onChange: (event) => saveMemorySettings(
                  { memoryEnabled: event.target.checked },
                  event.target.checked ? '打开自动记忆' : '关闭自动记忆',
                ),
              }),
              h('span', null, '自动记住你说的事')),
            h('p', { className: 'cyp-hint' },
              state.memoryEnabled === false
                ? '现在只记得你手动写下的条目，会话里的内容不会自动进来。'
                : '默认开启，每轮最多收 4 条；只保存在本机加密仓库，可随时导出或整份恢复。'),
            state.memoryVaultError
              ? h('p', { className: 'cyp-status' }, `记忆仓库还没解锁：${state.memoryVaultError}`)
              : null,
            memories === null
              ? h('p', { className: 'cyp-hint' }, '正在翻她的小本子…')
              : memories.length === 0
                ? h('p', { className: 'cyp-hint' }, '还没记住什么。下面写一句，她就会收好。')
                : h('div', { className: 'cyp-mem-list' },
                    memories.slice(0, 20).map((item) =>
                      h('div', { key: item.id, className: 'cyp-mem-item' },
                        h('span', { className: 'cyp-chip' }, SLOT_LABELS[item.slot] ?? '记忆'),
                        h('span', { className: 'cyp-mem-text' }, item.text),
                        h('button', {
                          type: 'button',
                          className: 'cyp-mini',
                          disabled: memBusy !== '',
                          onClick: () => memoryAction(
                            MEMORY_PIN_PATH,
                            { id: item.id, pinned: item.pinned !== true },
                            item.pinned === true ? '取消固定' : '固定',
                          ),
                        }, item.pinned === true ? '取消固定' : '固定'),
                        h('button', {
                          type: 'button',
                          className: 'cyp-mini',
                          disabled: memBusy !== '',
                          onClick: () => {
                            if (window.confirm('要让她忘掉这条吗？')) {
                              memoryAction(MEMORY_FORGET_PATH, { id: item.id }, '忘掉')
                            }
                          },
                        }, '忘掉')))),
            h('div', { className: 'cyp-mem-form' },
              h('select', {
                className: 'cyp-select',
                value: memSlot,
                onChange: (event) => setMemSlot(event.target.value),
              }, ['identity', 'preference', 'event', 'relation'].map((slot) =>
                h('option', { key: slot, value: slot }, SLOT_LABELS[slot]))),
              h('input', {
                className: 'cyp-input',
                type: 'text',
                maxLength: 400,
                placeholder: '让她记住一件事…',
                value: memText,
                onChange: (event) => setMemText(event.target.value),
              }),
              h('button', {
                type: 'button',
                className: 'cyp-btn',
                'data-tone': 'primary',
                disabled: memBusy !== '' || memText.trim() === '',
                onClick: () => memoryAction(
                  MEMORY_PATH,
                  { text: memText.trim(), slot: memSlot },
                  '记下',
                  true,
                ),
              }, '记下')),
            h('div', { className: 'cyp-row' },
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: memBusy !== '',
                onClick: loadMemories,
              }, '刷新列表'),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: memBusy !== '',
                onClick: exportMemory,
              }, '导出备份'),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: memBusy !== '',
                onClick: () => importRef.current?.click(),
              }, '从备份恢复'),
              h('input', {
                ref: importRef,
                type: 'file',
                accept: 'application/json,.json',
                style: { display: 'none' },
                onChange: importMemory,
              }),
              memStatus === ''
                ? null
                : h('span', { className: 'cyp-status' }, memStatus))),
          h('details', { className: 'cyp-backup' },
            h('summary', null, '整库备份与密钥'),
            h('p', { className: 'cyp-hint' },
              '设置、记忆、好感、身体状态和最近开口都会一起打包。API Key、模型文件和语音缓存不会进备份。'),
            h('div', { className: 'cyp-row' },
              h('input', {
                className: 'cyp-input',
                type: 'password',
                placeholder: '备份口令（至少 8 个字符）',
                value: backupPassphrase,
                disabled: backupBusy !== '',
                onChange: (event) => setBackupPassphrase(event.target.value),
              }),
              h('label', { className: 'cyp-toggle' },
                h('input', {
                  type: 'checkbox',
                  checked: backupEncrypted,
                  disabled: backupBusy !== '',
                  onChange: (event) => setBackupEncrypted(event.target.checked),
                }),
                h('span', null, '用口令加密')),
              h('button', {
                type: 'button',
                className: 'cyp-btn',
                'data-tone': 'primary',
                disabled: backupBusy !== '',
                onClick: exportFullBackup,
              }, backupBusy === 'export' ? '导出中…' : '导出整库'),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: backupBusy !== '',
                onClick: () => backupFileRef.current?.click(),
              }, '恢复整库'),
              h('input', {
                ref: backupFileRef,
                type: 'file',
                accept: 'application/json,.json',
                style: { display: 'none' },
                onChange: restoreFullBackup,
              })),
            h('div', { className: 'cyp-row' },
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: backupBusy !== '',
                onClick: rotateVaultKeys,
              }, backupBusy === 'rotate' ? '轮换中…' : '轮换本机密钥'),
              h('span', { className: 'cyp-hint' }, '轮换只换本机加密材料，数据保留。')),
            backupStatus === ''
              ? null
              : h('p', { className: 'cyp-status' }, backupStatus)),
          h('details', { className: 'cyp-game' },
            h('summary', null,
              `陪她玩一局${ability && ability.summary ? `（${ability.summary.total} 局）` : ''}`),
            h('p', { className: 'cyp-hint' },
              '石头剪刀布，战绩只留在本机。她不会因为输了就不理你。'),
            ability === null
              ? h('p', { className: 'cyp-hint' }, abilityStatus || '正在翻战绩…')
              : h('div', { className: 'cyp-companion' },
                  h('span', { className: 'cyp-chip' },
                    ability.summary ? ability.summary.label : '还没交过手'),
                  h('span', { className: 'cyp-chip' },
                    `${Number(ability.summary?.win) || 0} 胜 / ${Number(ability.summary?.lose) || 0} 负 / ${Number(ability.summary?.draw) || 0} 平`),
                  h('span', { className: 'cyp-chip' },
                    `胜率 ${Number(ability.summary?.winRate) || 0}%`),
                  ability.summary && ability.summary.streak > 0
                    ? h('span', { className: 'cyp-chip' }, `连胜 ${ability.summary.streak}`)
                    : null),
            lastRound === null
              ? null
              : h('p', { className: 'cyp-game-result', 'data-result': lastRound.result },
                  `你出 ${RPS_LABELS[lastRound.user] ?? '？'}，她出 ${RPS_LABELS[lastRound.pet] ?? '？'}，${
                    lastRound.result === 'win'
                      ? '这局你赢啦 ♪'
                      : lastRound.result === 'lose'
                        ? '这局她赢了呢。'
                        : '平局，心有灵犀？'
                  }`),
            h('div', { className: 'cyp-row' },
              RPS_OPTIONS.map((option) =>
                h('button', {
                  key: option.id,
                  type: 'button',
                  className: 'cyp-btn',
                  disabled: abilityBusy !== '',
                  onClick: () => playAbility(option.id),
                }, `${option.mark} ${option.label}`))),
            abilityStatus === '' || ability === null
              ? null
              : h('p', { className: 'cyp-status' }, abilityStatus)),
          status === ''
            ? null
            : h('p', { className: 'cyp-status', 'data-tone': tone }, status))
      }

      try {
        ctx.slots.inject('settings.section', () => {
          try {
            return ctx.slots.register({
              name: 'settings.section',
              id: 'cyrene-pet',
              order: 32,
              label: () => '昔涟 · 桌宠',
            }, PetSection)
          } catch (error) {
            log('warn', '设置页槽位注册失败，跳过（不影响其他插件）', error)
            return () => {}
          }
        })
      } catch (error) {
        log('warn', '设置页槽位注入失败，跳过（不影响其他插件）', error)
      }
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
