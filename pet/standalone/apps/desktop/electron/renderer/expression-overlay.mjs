/**
 * 临时表情覆盖 + 墙钟回落。
 *
 * 出处：遐蝶桌宠驱动 live2d-driver（2026-11-10 定版）web/driver.mjs 的
 * expressionDeadline / scheduleExpressionReset。驱动自述「代码本仓自写，
 * 形态参考鲸语 jingyu-live2d（MIT）」。驱动注释里的理由照抄：
 * 「不用 setTimeout 当唯一依据——窗口长时间没人理、或系统休眠时，
 * 定时器会停，醒过来再看时钟就行。」
 *
 * dsh-pet 的表情控制器是「持续状态直到下一个情绪」，没有临时覆盖；
 * 贴纸换脸、触摸反应这类短表情需要它。这里包一层，不侵入控制器核心。
 */

/**
 * @param {object} options
 * @param {{apply:Function, reset:Function}} options.expression 表情控制器
 * @param {object|null} options.ticker Pixi ticker；没有则退回 rAF
 * @param {Function} [options.now] 时钟源，测试时可注入
 */
export function createExpressionOverlay(options = {}) {
  const {
    expression = null,
    ticker = null,
    now = () => Date.now(),
  } = options

  let deadline = 0
  let handler = null
  let rafId = null

  function releaseTicker() {
    if (handler !== null) {
      if (ticker !== null && typeof ticker.remove === 'function') ticker.remove(handler)
      if (rafId !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafId)
        rafId = null
      }
      handler = null
    }
  }

  /** 一帧：到点就回中性。墙钟对时，睡眠醒来第一帧立即收。 */
  function tick() {
    if (deadline === 0) {
      releaseTicker()
      return
    }
    if (now() >= deadline) {
      deadline = 0
      releaseTicker()
      try {
        expression?.reset?.({ source: 'overlay-expired' })
      } catch {
        // 回中性失败不能影响后续覆盖
      }
    }
  }

  function startTicker() {
    if (handler !== null) return
    handler = () => tick()
    if (ticker !== null && typeof ticker.add === 'function') {
      ticker.add(handler)
      return
    }
    if (typeof window !== 'undefined') {
      const loop = () => {
        tick()
        // tick 里到期或取消时会 releaseTicker 把 handler 清掉，这里跟着停。
        if (handler === null) return
        rafId = window.requestAnimationFrame(loop)
      }
      rafId = window.requestAnimationFrame(loop)
    }
  }

  /**
   * 盖一张临时脸，durationMs 后回中性。
   * 控制器不支持这个情绪时不设截止时间，如实返回。
   */
  function setTemporary(tag, durationMs = 30000, meta = {}) {
    if (expression === null || typeof expression?.apply !== 'function') {
      return { ok: false, reason: 'no-expression' }
    }
    const result = expression.apply(tag, { ...meta, source: 'overlay' })
    if (result?.ok !== true) return { ok: false, reason: result?.reason ?? 'unsupported' }
    deadline = now() + Math.max(1000, Number(durationMs) || 30000)
    startTicker()
    return { ok: true, tag: result.tag, channel: result.channel }
  }

  /** 立刻收掉临时脸（deadline 归零，不触发 reset 事件）。 */
  function cancel() {
    deadline = 0
    releaseTicker()
  }

  return { setTemporary, cancel, snapshot: () => ({ deadline }) }
}
