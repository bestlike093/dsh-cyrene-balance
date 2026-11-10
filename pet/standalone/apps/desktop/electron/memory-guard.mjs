/**
 * 主进程内存自检。
 *
 * 只做三件事：
 *   1. 每分钟读一次 process.memoryUsage()，记下 rss / heap 快照；
 *   2. 超过 warn 记一条日志（同一档位 5 分钟内只记一次，避免刷屏）；
 *   3. 超过 critical 时调用一次释放回调（落盘 + 清缓存），并提示用户重启。
 *
 * 阈值按报告第七节：800 MB 记日志，1.2 GB 主动释放。数值可注入，方便测试。
 */
const MB = 1024 * 1024

export const MEMORY_WARN_BYTES = 800 * MB
export const MEMORY_CRITICAL_BYTES = 1200 * MB
const DEFAULT_INTERVAL_MS = 60_000
const LOG_COOLDOWN_MS = 5 * 60_000
// critical 释放一次之后先安静十分钟：清缓存本身要时间，连续触发只会拖慢主进程。
const RELEASE_COOLDOWN_MS = 10 * 60_000

export function createMemoryGuard(options = {}) {
  const {
    sample = () => process.memoryUsage(),
    now = Date.now,
    log = () => {},
    onRelease = async () => {},
    warnBytes = MEMORY_WARN_BYTES,
    criticalBytes = MEMORY_CRITICAL_BYTES,
    intervalMs = DEFAULT_INTERVAL_MS,
    notify = () => {}
  } = options

  // intervalMs 夹到 1 秒以上：0 / 负数 / 极小值会让定时器空转，
  // 每秒一次自检没有意义，还会拖慢主进程。
  const parsedInterval = Number(intervalMs)
  const tickMs = Math.max(
    1000,
    Math.floor(Number.isFinite(parsedInterval) ? parsedInterval : DEFAULT_INTERVAL_MS)
  )

  let timer = null
  let last = null
  let lastLevel = 'ok'
  let lastLoggedAt = 0
  let releaseCount = 0
  let lastReleaseAt = Number.NEGATIVE_INFINITY
  let releasing = false

  function toSnapshot(usage, at) {
    const rss = Number(usage?.rss) || 0
    const heapUsed = Number(usage?.heapUsed) || 0
    const heapTotal = Number(usage?.heapTotal) || 0
    const external = Number(usage?.external) || 0
    const level = rss >= criticalBytes ? 'critical' : rss >= warnBytes ? 'warn' : 'ok'
    return {
      at,
      rss,
      heapUsed,
      heapTotal,
      external,
      rssMb: Math.round((rss / MB) * 10) / 10,
      heapUsedMb: Math.round((heapUsed / MB) * 10) / 10,
      level
    }
  }

  /**
   * 采一次。返回快照；critical 时会等释放回调跑完再返回，
   * 这样调用方拿到的是「已经处理过」的状态。
   */
  async function check() {
    let usage = null
    try {
      usage = sample()
    } catch (error) {
      log('[memory] 读取内存占用失败', error)
      return last
    }
    const snapshot = toSnapshot(usage, now())
    const changed = snapshot.level !== lastLevel
    last = snapshot
    if (snapshot.level === 'ok') {
      lastLevel = 'ok'
      return snapshot
    }
    if (changed || snapshot.at - lastLoggedAt >= LOG_COOLDOWN_MS) {
      lastLoggedAt = snapshot.at
      log(
        snapshot.level === 'critical'
          ? `[memory] 主进程占用 ${snapshot.rssMb} MB，超过 ${Math.round(criticalBytes / MB)} MB，开始释放缓存`
          : `[memory] 主进程占用 ${snapshot.rssMb} MB，超过 ${Math.round(warnBytes / MB)} MB`
      )
    }
    lastLevel = snapshot.level
    if (snapshot.level === 'critical' && !releasing && snapshot.at - lastReleaseAt >= RELEASE_COOLDOWN_MS) {
      releasing = true
      // 无论成败都推进冷却起点：释放失败多半是系统性问题，
      // 不推进会变成每分钟重试一次，把主进程拖得更慢。
      lastReleaseAt = snapshot.at
      try {
        await onRelease(snapshot)
        releaseCount += 1
      } catch (error) {
        log('[memory] 释放缓存失败', error)
      } finally {
        releasing = false
      }
      // 提示用户重启是另一件事：它抛错不能被记成「释放失败」。
      try {
        notify(snapshot)
      } catch (error) {
        log('[memory] 释放后的用户提示失败', error)
      }
    }
    return snapshot
  }

  function start() {
    if (timer !== null) return
    timer = setInterval(() => {
      // check 内部已尽力吞错，这里再兜一层，别让定时器因未捕获的 reject 崩掉。
      check().catch((error) => log('[memory] 定时自检异常', error))
    }, tickMs)
    timer.unref?.()
    // 启动时先采一次，别等到一分钟后才知道已经很高。
    check().catch((error) => log('[memory] 启动自检异常', error))
  }

  function stop() {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  function status() {
    return {
      last,
      thresholds: {
        warnMb: Math.round((warnBytes / MB) * 10) / 10,
        criticalMb: Math.round((criticalBytes / MB) * 10) / 10
      },
      intervalMs: tickMs,
      releaseCount,
      running: timer !== null
    }
  }

  return { check, start, stop, status }
}
