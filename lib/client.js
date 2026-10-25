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
.cyp-title { font-size: 15px; font-weight: 600; letter-spacing: .02em; }
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

        react.useEffect(() => {
          load()
        }, [load])

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
            h('div', { className: 'cyp-title' }, '昔涟 · 桌宠'),
            h('div', { className: 'cyp-hint' }, 'Live2D 桌面桌宠：提问、风险审批和任务进程都会在这里出现。')),
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
