/**
 * 余额监控接线：把轮询调度器、账本文件层和抓余额函数接在一起。
 *
 * 职责边界：
 * - store 只负责迁移、读写与裁剪，失败时 reject 并清 ready；
 * - poller 只负责定时与 stop；
 * - 本模块决定「迁移失败就停轮询」，网络/抓取失败只记 onError，下一轮继续；
 * - 低额判定只读刚写入的 slice，告警去重走 ack，不改账本形状。
 *
 * 迁移失败不重试、不继续写账本：宁可这一轮余额空着，也不让半拉子账本往后写。
 */

import { buildSegment, shouldAlert } from './balance-alert.mjs'
import { createBalancePoller } from './balance-polling.mjs'

/** 取账本里日期最新的一片；recordBalance 写完当天后，它就是当天。 */
function latestSlice(ledger) {
  if (!ledger || typeof ledger.slices !== 'object' || ledger.slices === null) return null
  let latest = null
  for (const slice of Object.values(ledger.slices)) {
    if (!slice || typeof slice.date !== 'string') continue
    if (latest === null || slice.date > latest.date) latest = slice
  }
  return latest
}

export function createBalanceMonitor(options = {}) {
  const store = options.store
  if (
    !store ||
    typeof store.ensureLedger !== 'function' ||
    typeof store.recordBalance !== 'function'
  ) {
    throw new TypeError('createBalanceMonitor 需要 store.ensureLedger 与 store.recordBalance')
  }
  if (typeof options.fetchBalance !== 'function') {
    throw new TypeError('createBalanceMonitor 需要 fetchBalance')
  }

  const fetchBalance = options.fetchBalance
  const onError = typeof options.onError === 'function' ? options.onError : () => {}
  const onAlert = typeof options.onAlert === 'function' ? options.onAlert : null
  const canAlert =
    onAlert !== null &&
    typeof store.hasAck === 'function' &&
    typeof store.markAck === 'function'
  let poller = null

  /**
   * 低额时尝试响一次；onAlert 返回 false 表示窗口不在，先不落 ack，下一轮再试。
   * ack 写失败只记 onError，不阻塞轮询；下一次会按 fail-open 再响一次。
   */
  async function maybeAlert(slice, fallbackThreshold) {
    if (!canAlert || slice === null) return
    const threshold = slice.threshold ?? fallbackThreshold
    const segment = buildSegment(slice.date, threshold)
    if (segment === null) return

    const acked = store.hasAck(segment) ? { at: '', level: 'shown' } : null
    if (!shouldAlert(slice, threshold, acked)) return

    let shown = true
    try {
      shown = onAlert({
        segment,
        date: slice.date,
        balance: slice.balance,
        threshold
      }) !== false
    } catch (error) {
      onError({ code: 'balance-alert-failed', cause: error })
      return
    }
    if (!shown) return

    try {
      await store.markAck(segment, 'shown')
    } catch (error) {
      onError({ code: error?.code ?? 'balance-ack-failed', cause: error })
    }
  }

  async function tick() {
    try {
      await store.ensureLedger()

      const result = await fetchBalance().catch((error) => {
        onError({ code: 'balance-fetch-failed', reason: error })
        return null
      })
      if (!result) return

      const fresh = await store.recordBalance({
        balance: result.balance,
        threshold: result.threshold,
        fetchedAt: result.fetchedAt
      })

      await maybeAlert(latestSlice(fresh), result.threshold)
    } catch (error) {
      if (error?.code === 'ledger-migrate-failed') {
        poller?.stop()
        onError({ code: 'ledger-migrate-failed', cause: error })
        return
      }
      onError({ code: error?.code ?? 'balance-poll-failed', cause: error })
    }
  }

  poller = createBalancePoller({
    tick,
    intervalMs: options.intervalMs,
    unref: options.unref,
    onError
  })

  return poller
}
