/**
 * 余额轮询调度器。
 *
 * 只负责定时触发，不读 settings、不碰 ledger、不发网络请求；
 * `tick` 由调用方注入，b3 接线时再把查余额与写账本接进来。
 *
 * 合约：
 * - `start()` 不立即 tick，只在 interval 到点时触发；
 * - tick 未完成时跳过本轮，避免慢请求叠罗汉；
 * - `updateInterval()` 在运行中会清掉旧 timer，按新间隔从当下重新计时；
 * - `stop()` 幂等，进程退出也调一次；
 * - tick 抛错交给 `onError`，调度器本身不崩进程；
 * - timer 默认 unref：轮询是后台看护，不阻止进程退出；
 * - 测试或显式保活传 `unref: false`；
 * - 进程退出由宿主调 `stop()`，把最后一把账刷完再走。
 */

export const DEFAULT_INTERVAL_MS = 30 * 60 * 1000

function normalizeInterval(value, fallback = DEFAULT_INTERVAL_MS) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function createBalancePoller(options = {}) {
  if (typeof options.tick !== 'function') {
    throw new TypeError('createBalancePoller 需要 tick 函数')
  }

  const tick = options.tick
  const setTimer = options.setInterval ?? setInterval
  const clearTimer = options.clearInterval ?? clearInterval
  const onError = typeof options.onError === 'function' ? options.onError : null
  const unref = options.unref !== false

  let intervalMs = normalizeInterval(options.intervalMs)
  let timer = null
  let running = false
  let busy = false

  function clearTimerHandle() {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  async function runTick() {
    if (busy) return
    busy = true
    try {
      await tick()
    } catch (error) {
      onError?.(error)
    } finally {
      busy = false
    }
  }

  function arm() {
    clearTimerHandle()
    timer = setTimer(() => {
      void runTick()
    }, intervalMs)
    if (unref) timer?.unref?.()
  }

  function start() {
    if (running) return false
    running = true
    arm()
    return true
  }

  function stop() {
    const wasRunning = running
    running = false
    clearTimerHandle()
    return wasRunning
  }

  function updateInterval(next) {
    const normalized = normalizeInterval(next, intervalMs)
    if (normalized === intervalMs) return false
    intervalMs = normalized
    if (running) arm()
    return true
  }

  return {
    start,
    stop,
    updateInterval,
    getIntervalMs: () => intervalMs,
    isRunning: () => running
  }
}
