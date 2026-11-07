/**
 * 自动描边：立绘 / Live2D 导入后自己判断该加黑边还是白边。
 *
 * 判断依据是「轮廓外圈可见像素的平均亮度」：亮色立绘配深色边、深色立绘配白边，
 * 这样贴在浅色桌面或深色壁纸上都不会糊成一片。
 * 采样失败（画布空、被污染、还没渲染）时不改样式，并把原因回报出去，
 * 绝不在读不到的时候偷偷挑一个颜色假装成功了。
 */

/** 描边配色。深色边不用纯黑，留一点蓝紫，跟界面的暗部一致。 */
export const OUTLINE_COLORS = {
  dark: '#181820',
  light: '#ffffff'
}

/** 亮度阈值：高于它算「亮立绘」，配深色边。 */
export const OUTLINE_LUMA_THRESHOLD = 150

/**
 * 亮度 → 描边颜色。
 * @returns {'dark'|'light'}
 */
export function decideOutlineColor(luma) {
  return typeof luma === 'number' && luma > OUTLINE_LUMA_THRESHOLD ? 'dark' : 'light'
}

/** 描边偏好：light=固定白边（默认），dark=固定深边，auto=按亮度自己选。 */
export const DEFAULT_OUTLINE_PREFERENCE = 'light'

/**
 * 采样结果 + 使用者偏好 → 实际要用的描边。
 * 偏好写了不认识的值时退回 auto，不因为一个笔误就把边去掉。
 */
export function resolveOutlineKey(prefer, luma) {
  const value = typeof prefer === 'string' ? prefer.trim().toLowerCase() : ''
  if (value === 'light' || value === 'dark') return value
  return decideOutlineColor(luma)
}

/**
 * 从画布采样轮廓亮度。
 *
 * 只取外圈一圈像素：描边是加在轮廓外侧的，画面中心的衣服颜色说明不了问题。
 * 外圈全透明时（立绘没铺满画布，很常见）退回整幅不透明像素，并如实标出用了哪种取样。
 *
 * @returns {{ok:true, luma:number, coverage:number, ringCoverage:number, region:'ring'|'full'}
 *          | {ok:false, reason:string}}
 */
export function sampleCanvasLuma(canvas, size = 72) {
  if (canvas === null || typeof canvas !== 'object') return { ok: false, reason: 'no-canvas' }
  const width = Number(canvas.width)
  const height = Number(canvas.height)
  if (!(width > 0) || !(height > 0)) return { ok: false, reason: 'empty-canvas' }

  let data = null
  try {
    const probe = document.createElement('canvas')
    probe.width = size
    probe.height = size
    const ctx = probe.getContext('2d', { willReadFrequently: true })
    if (ctx === null) return { ok: false, reason: 'no-2d-context' }
    ctx.drawImage(canvas, 0, 0, size, size)
    data = ctx.getImageData(0, 0, size, size).data
  } catch (error) {
    // 画布被跨域素材污染时 getImageData 直接抛；这是环境问题，不是 bug。
    return { ok: false, reason: `tainted:${error instanceof Error ? error.message : String(error)}` }
  }
  if (data === null) return { ok: false, reason: 'no-pixel-data' }

  const ringDepth = Math.max(2, Math.round(size * 0.12))
  let ringLuma = 0
  let ringCount = 0
  let fullLuma = 0
  let fullCount = 0

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4
      const alpha = data[index + 3]
      // 半透明边缘按不透明度加权，避免抗锯齿像素把亮度带偏。
      if (alpha < 24) continue
      const weight = alpha / 255
      const luma =
        data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
      fullLuma += luma * weight
      fullCount += weight
      const inRing =
        x < ringDepth || y < ringDepth || x >= size - ringDepth || y >= size - ringDepth
      if (inRing) {
        ringLuma += luma * weight
        ringCount += weight
      }
    }
  }

  const coverage = fullCount / (size * size)
  const ringCoverage = ringCount / (size * size)
  // 外圈至少要占到 0.4% 的加权面积，否则说明那里基本是空的，取样不可信。
  const useRing = ringCoverage > 0.004
  const luma = useRing ? ringLuma / ringCount : fullCount > 0 ? fullLuma / fullCount : null
  if (luma === null) return { ok: false, reason: 'no-opaque-pixel' }

  return {
    ok: true,
    luma: Math.round(luma),
    coverage: Number(coverage.toFixed(4)),
    ringCoverage: Number(ringCoverage.toFixed(4)),
    region: useRing ? 'ring' : 'full'
  }
}

/**
 * 把描边写到一个元素上。
 *
 * 用 8 个方向的 drop-shadow 叠出实边：drop-shadow 跟随 alpha 轮廓，
 * 不像 box-shadow 那样只会画一个方框，透明区域不会多出黑块。
 * thickness 传 0 表示撤掉描边。
 */
export function applyOutline(element, color, thickness = 2) {
  if (element === null || typeof element.style !== 'object') return false
  if (!(thickness > 0) || typeof color !== 'string' || color === '') {
    element.style.removeProperty('filter')
    return true
  }
  const steps = []
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1]
  ]) {
    steps.push(`drop-shadow(${dx * thickness}px ${dy * thickness}px 0 ${color})`)
  }
  element.style.setProperty('filter', steps.join(' '))
  return true
}

/**
 * 给一个 Pixi 画布挂自动描边：等它真渲染出一帧再采样，采完就把监听摘掉。
 *
 * WebGL 画布默认不留后备缓冲，随便什么时候读都是空的，
 * 所以必须挂在 renderer 的 postrender 上，那一刻像素还在。
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas 目标画布
 * @param {object} options.renderer Pixi renderer（提供 on/off 与 postrender 事件）
 * @param {number} [options.thickness] 描边粗细，默认 2px
 * @param {number} [options.waitFrames] 没有 renderer 时先等几帧再采样，默认 2
 * @param {(result:object)=>void} [options.onResult] 采样结果回调，成功失败都会调
 * @returns {() => void} 取消函数：摘监听、清描边
 */
export function attachAutoOutline({
  canvas,
  renderer = null,
  thickness = 2,
  waitFrames = 2,
  prefer = DEFAULT_OUTLINE_PREFERENCE,
  onResult = null,
  maxAttempts = 8
}) {
  let attempts = 0
  let settled = false

  const finish = (result) => {
    if (settled) return
    settled = true
    if (renderer !== null && typeof renderer?.off === 'function') renderer.off('postrender', onPostRender)
    let shown = result
    if (result.ok === true) {
      const key = resolveOutlineKey(prefer, result.luma)
      applyOutline(canvas, OUTLINE_COLORS[key], thickness)
      shown = { ...result, color: key }
    }
    if (typeof onResult === 'function') {
      try {
        onResult(shown)
      } catch {
        // 观测回调出错不影响描边本身
      }
    }
  }

  function onPostRender() {
    if (settled) return
    attempts += 1
    const sample = sampleCanvasLuma(canvas)
    // 头几帧可能还没画上东西（模型异步加载），多试几次再放弃。
    if (sample.ok === true) {
      finish(sample)
      return
    }
    if (attempts >= maxAttempts) finish(sample)
  }

  if (renderer !== null && typeof renderer?.on === 'function') {
    renderer.on('postrender', onPostRender)
  } else {
    // 拿不到 renderer（静态立绘 / 帧序列走 RendererHost）：先等它画上几帧再采，
    // 采不到就下一帧再试，直到 maxAttempts 用完；最后一次结果照样如实回报。
    let waited = 0
    const tick = () => {
      if (settled) return
      waited += 1
      if (waited <= waitFrames) {
        window.requestAnimationFrame(tick)
        return
      }
      attempts += 1
      const sample = sampleCanvasLuma(canvas)
      if (sample.ok === true || attempts >= maxAttempts) finish(sample)
      else window.requestAnimationFrame(tick)
    }
    window.requestAnimationFrame(tick)
  }

  return () => {
    settled = true
    if (renderer !== null && typeof renderer?.off === 'function') renderer.off('postrender', onPostRender)
    applyOutline(canvas, '', 0)
  }
}
