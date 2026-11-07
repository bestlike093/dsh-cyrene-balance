// 子窗口主题引导：把主进程传进来的 ?theme=OceanBlue|SakuraPink|Paper 映射成 data-theme。
// 放在 <head> 最前面，先定主题再加载样式，避免首帧闪一下默认色。
(() => {
  const SHORT = { OceanBlue: 'blue', SakuraPink: 'pink', Paper: 'ink' }
  const KNOWN = new Set(['blue', 'pink', 'ink'])
  // 预设全名和短名都认，避免某处传 'pink' 时静默掉回默认色。
  const apply = (preset) => {
    document.documentElement.dataset.theme = KNOWN.has(preset)
      ? preset
      : (SHORT[preset] ?? 'pink')
  }

  const preset = new URLSearchParams(location.search).get('theme')
  if (preset !== null && preset !== '') apply(preset)

  // 设置窗保存后主进程会广播 pet:settings:changed，已打开的子窗口跟着换肤。
  window.pet?.onSettingsChanged?.((next) => {
    const nextPreset = next?.theme?.preset
    if (typeof nextPreset === 'string' && nextPreset !== '') apply(nextPreset)
  })
})()
