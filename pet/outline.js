/* 立绘描边：默认白边，可以换成深边、按亮度自动，或直接关掉。
 *
 * 用 8 个方向的 drop-shadow 沿 alpha 轮廓叠出实边，透明区域不会多出方块。
 * 采样只取外圈一圈像素——描边加在轮廓外侧，画面中心的衣服颜色说明不了问题。
 * 采样失败（画布空、被污染、还没渲染）时不改样式，并把原因回报出去。
 */
(function () {
  'use strict'

  const COLORS = { dark: '#181820', light: '#ffffff' }
  const LUMA_THRESHOLD = 150
  const DEFAULT_PREFERENCE = 'light'

  function decideColor(luma) {
    return typeof luma === 'number' && luma > LUMA_THRESHOLD ? 'dark' : 'light'
  }

  function resolveKey(prefer, luma) {
    const value = typeof prefer === 'string' ? prefer.trim().toLowerCase() : ''
    if (value === 'light' || value === 'dark') return value
    if (value === 'none') return 'none'
    return decideColor(luma)
  }

  function sampleLuma(canvas, size) {
    const edge = size || 72
    if (canvas === null || typeof canvas !== 'object') return { ok: false, reason: 'no-canvas' }
    const width = Number(canvas.width)
    const height = Number(canvas.height)
    if (!(width > 0) || !(height > 0)) return { ok: false, reason: 'empty-canvas' }

    let data = null
    try {
      const probe = document.createElement('canvas')
      probe.width = edge
      probe.height = edge
      const ctx = probe.getContext('2d', { willReadFrequently: true })
      if (ctx === null) return { ok: false, reason: 'no-2d-context' }
      ctx.drawImage(canvas, 0, 0, edge, edge)
      data = ctx.getImageData(0, 0, edge, edge).data
    } catch (error) {
      return { ok: false, reason: 'tainted:' + (error instanceof Error ? error.message : String(error)) }
    }
    if (data === null) return { ok: false, reason: 'no-pixel-data' }

    const ringDepth = Math.max(2, Math.round(edge * 0.12))
    let ringLuma = 0
    let ringCount = 0
    let fullLuma = 0
    let fullCount = 0

    for (let y = 0; y < edge; y += 1) {
      for (let x = 0; x < edge; x += 1) {
        const index = (y * edge + x) * 4
        const alpha = data[index + 3]
        if (alpha < 24) continue
        const weight = alpha / 255
        const luma = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
        fullLuma += luma * weight
        fullCount += weight
        const inRing = x < ringDepth || y < ringDepth || x >= edge - ringDepth || y >= edge - ringDepth
        if (inRing) {
          ringLuma += luma * weight
          ringCount += weight
        }
      }
    }

    const ringCoverage = ringCount / (edge * edge)
    const useRing = ringCoverage > 0.004
    const luma = useRing ? ringLuma / ringCount : fullCount > 0 ? fullLuma / fullCount : null
    if (luma === null) return { ok: false, reason: 'no-opaque-pixel' }

    return {
      ok: true,
      luma: Math.round(luma),
      coverage: Number((fullCount / (edge * edge)).toFixed(4)),
      ringCoverage: Number(ringCoverage.toFixed(4)),
      region: useRing ? 'ring' : 'full',
    }
  }

  function apply(element, color, thickness) {
    if (element === null || typeof element.style !== 'object') return false
    const width = thickness === undefined ? 2 : thickness
    if (!(width > 0) || typeof color !== 'string' || color === '') {
      element.style.removeProperty('filter')
      return true
    }
    const steps = []
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]
    for (const [dx, dy] of dirs) {
      steps.push('drop-shadow(' + dx * width + 'px ' + dy * width + 'px 0 ' + color + ')')
    }
    element.style.setProperty('filter', steps.join(' '))
    return true
  }

  /* 等画布真渲染出一帧再采样。WebGL 不保留后备缓冲，所以挂在 postrender 上。 */
  function attach(options) {
    const canvas = options.canvas
    const renderer = options.renderer || null
    const thickness = options.thickness === undefined ? 2 : options.thickness
    const waitFrames = options.waitFrames === undefined ? 2 : options.waitFrames
    const prefer = options.prefer === undefined ? DEFAULT_PREFERENCE : options.prefer
    const onResult = options.onResult || null
    const maxAttempts = options.maxAttempts === undefined ? 8 : options.maxAttempts

    let attempts = 0
    let settled = false
    let timer = 0

    function finish(result) {
      if (settled) return
      settled = true
      if (renderer !== null && typeof renderer.off === 'function') renderer.off('postrender', onPostRender)
      let shown = result
      if (result.ok === true) {
        const key = resolveKey(prefer, result.luma)
        if (key === 'none') apply(canvas, '', 0)
        else apply(canvas, COLORS[key], thickness)
        shown = Object.assign({}, result, { color: key })
      }
      if (typeof onResult === 'function') {
        try {
          onResult(shown)
        } catch {
          /* 回调出错不影响描边本身 */
        }
      }
    }

    function onPostRender() {
      if (settled) return
      attempts += 1
      const sample = sampleLuma(canvas)
      if (sample.ok === true) {
        finish(sample)
        return
      }
      if (attempts >= maxAttempts) finish(sample)
    }

    if (renderer !== null && typeof renderer.on === 'function') {
      renderer.on('postrender', onPostRender)
    } else {
      let waited = 0
      const tick = () => {
        if (settled) return
        waited += 1
        if (waited <= waitFrames) {
          timer = window.requestAnimationFrame(tick)
          return
        }
        attempts += 1
        const sample = sampleLuma(canvas)
        if (sample.ok === true || attempts >= maxAttempts) finish(sample)
        else timer = window.requestAnimationFrame(tick)
      }
      timer = window.requestAnimationFrame(tick)
    }

    return function detach() {
      settled = true
      if (timer) window.cancelAnimationFrame(timer)
      if (renderer !== null && typeof renderer.off === 'function') renderer.off('postrender', onPostRender)
      apply(canvas, '', 0)
    }
  }

  window.CyreneOutline = {
    COLORS: COLORS,
    DEFAULT_PREFERENCE: DEFAULT_PREFERENCE,
    decideColor: decideColor,
    resolveKey: resolveKey,
    sampleLuma: sampleLuma,
    apply: apply,
    attach: attach,
  }
})()
