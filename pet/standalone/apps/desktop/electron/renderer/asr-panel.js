// 语音唤醒面板：改一项存一项，不设「保存」按钮。
// 配置存在主进程的 asr-config.json 里，这里只做读写与状态显示。
;(() => {
  const refs = {
    enabled: document.getElementById('asr-enabled'),
    backend: document.getElementById('asr-backend'),
    preferLocal: document.getElementById('asr-prefer-local'),
    wakeWords: document.getElementById('asr-wake-words'),
    localUrl: document.getElementById('asr-local-url'),
    cloudUrl: document.getElementById('asr-cloud-url'),
    cloudModel: document.getElementById('asr-cloud-model'),
    check: document.getElementById('asr-check'),
    state: document.getElementById('asr-state'),
    localPath: document.getElementById('asr-local-path'),
    localTools: document.getElementById('asr-local-tools'),
    localInstall: document.getElementById('asr-local-install'),
    localStart: document.getElementById('asr-local-start'),
    localLog: document.getElementById('asr-local-log')
  }
  if (refs.enabled === null || typeof window.pet?.asrGetConfig !== 'function') return

  const splitWords = (text) =>
    String(text)
      .split(/[、,，\s]+/)
      .map((item) => item.trim())
      .filter((item) => item !== '')

  function say(text) {
    if (refs.state !== null) refs.state.textContent = text
  }

  function paint(config) {
    refs.enabled.checked = config.enabled === true
    if (refs.backend !== null) refs.backend.value = config.backend
    if (refs.preferLocal !== null) refs.preferLocal.checked = config.preferLocal === true
    if (refs.wakeWords !== null) refs.wakeWords.value = Array.isArray(config.wakeWords) ? config.wakeWords.join('、') : ''
    if (refs.localUrl !== null) refs.localUrl.value = config.localUrl
    if (refs.cloudUrl !== null) refs.cloudUrl.value = config.cloudBaseUrl
    if (refs.cloudModel !== null) refs.cloudModel.value = config.cloudModel
  }

  // 后台保存：连续改动时只让最后一次的状态文字生效，避免闪。
  let pending = 0
  async function save(patch, okText) {
    pending += 1
    const ticket = pending
    try {
      const result = await window.pet.asrSaveConfig(patch)
      if (result?.ok === true && result.config) paint(result.config)
      if (ticket === pending) say(okText)
    } catch (error) {
      if (ticket === pending) say('没存上：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /** 本机识别的位置与就绪状态：路径要让人能直接看见、能复制。 */
  async function loadLocal() {
    if (typeof window.pet?.asrLocal !== 'function') return
    try {
      const info = await window.pet.asrLocal('info')
      if (info?.ok !== true) return
      if (refs.localPath !== null) refs.localPath.textContent = '模型目录：' + info.modelDir
      if (refs.localTools !== null) {
        const bits = [info.venvReady === true ? '依赖已装' : '依赖未装', info.modelReady === true ? '模型已下' : '模型未下']
        refs.localTools.textContent = '脚本：' + info.installer + ' · ' + bits.join(' · ')
      }
      if (refs.localInstall !== null && info.modelReady === true) {
        refs.localInstall.textContent = '重新下载/更新'
      }
    } catch {
      // 读不到就保持原样，不打断面板其它设置。
    }
  }

  async function runLocal(action) {
    if (typeof window.pet?.asrLocal !== 'function') return
    const installButton = refs.localInstall
    const startButton = refs.localStart
    if (installButton !== null) installButton.disabled = true
    if (startButton !== null) startButton.disabled = true
    if (refs.localLog !== null) {
      refs.localLog.hidden = false
      refs.localLog.textContent = action === 'install' ? '正在安装依赖与模型，第一次可能要几分钟…' : '正在启动本机服务…'
    }
    try {
      const result = await window.pet.asrLocal(action)
      if (refs.localLog !== null) {
        if (result?.ok === true) {
          refs.localLog.textContent =
            action === 'install' ? result.log || '装好了。' : '已发出启动指令，等几秒后点「检测一次」。'
        } else {
          refs.localLog.textContent = result?.log || result?.error || '没成功，稍后再试。'
        }
      }
      void loadLocal()
      if (action === 'start') setTimeout(() => void refresh(true), 3500)
    } catch (error) {
      if (refs.localLog !== null) {
        refs.localLog.textContent = '出错了：' + (error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (installButton !== null) installButton.disabled = false
      if (startButton !== null) startButton.disabled = false
    }
  }

  async function refresh(force) {
    try {
      if (force) {
        const status = await window.pet.asrStatus()
        if (status?.ok !== true) {
          say('状态没读到')
          return
        }
        paint(status.config)
        const local = status.local?.available === true
        const parts = [
          local ? `本机可用${status.local.model ? '（' + status.local.model + '）' : ''}` : '本机没接上',
          status.activeBackend === 'local' ? '这次走本机' : status.activeBackend === 'cloud' ? '这次走云端' : '两条路都不通',
          status.cloudConfigured ? '云端 Key 在' : '云端 Key 没填',
          status.config?.preferLocal === true ? '本机就绪会自动切过去' : '已关闭自动切换'
        ]
        say(parts.join(' · '))
        return
      }
      const result = await window.pet.asrGetConfig()
      if (result?.ok === true) paint(result.config)
      say('还没检测')
    } catch (error) {
      say('读配置失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  refs.enabled.addEventListener('change', () => {
    void save({ enabled: refs.enabled.checked }, refs.enabled.checked ? '麦克风已开' : '麦克风已关')
  })

  if (refs.backend !== null) {
    refs.backend.addEventListener('change', () => {
      void save({ backend: refs.backend.value }, '识别后端已更新')
    })
  }

  if (refs.preferLocal !== null) {
    refs.preferLocal.addEventListener('change', () => {
      void save(
        { preferLocal: refs.preferLocal.checked },
        refs.preferLocal.checked ? '本机就绪时会自动切过去' : '只按所选后端走'
      )
    })
  }

  if (refs.wakeWords !== null) {
    refs.wakeWords.addEventListener('change', () => {
      void save({ wakeWords: splitWords(refs.wakeWords.value) }, '唤醒词已更新')
    })
  }

  if (refs.localUrl !== null) {
    refs.localUrl.addEventListener('change', () => {
      void save({ localUrl: refs.localUrl.value }, '本机地址已更新')
    })
  }

  if (refs.cloudUrl !== null) {
    refs.cloudUrl.addEventListener('change', () => {
      void save({ cloudBaseUrl: refs.cloudUrl.value }, '云端地址已更新')
    })
  }

  if (refs.cloudModel !== null) {
    refs.cloudModel.addEventListener('change', () => {
      void save({ cloudModel: refs.cloudModel.value }, '云端模型已更新')
    })
  }

  if (refs.check !== null) {
    refs.check.addEventListener('click', () => {
      say('正在检测…')
      void refresh(true)
    })
  }

  if (refs.localInstall !== null) {
    refs.localInstall.addEventListener('click', () => {
      void runLocal('install')
    })
  }

  if (refs.localStart !== null) {
    refs.localStart.addEventListener('click', () => {
      void runLocal('start')
    })
  }

  void refresh(false)
  void loadLocal()
})()
