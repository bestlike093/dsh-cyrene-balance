/**
 * 余额账本文件层：单例迁移 + 读写串流。
 *
 * 迁移只发生在 ensureLedger() 第一次被调用时：
 * 读原文件 -> migrateLedger -> 需要时 write 一次 -> 返回同一个 opened。
 *
 * 迁移重入用 Promise 单例拦截，和 poller 的 busy 守卫不是一回事：
 * - busy 拦的是 tick 重入，避免慢请求叠罗汉；
 * - ready 拦的是迁移重入，避免并发读写各跑一遍 v0→v1。
 *
 * 失败契约：
 * - 不吞错，抛 { code: 'ledger-migrate-failed' }；
 * - ready 清空，下一次 ensureLedger() 可重试；
 * - 原文件由注入的 write 保证原子性，失败时保留旧内容。
 */

import {
  LEDGER_VERSION,
  dateKeyInTimeZone,
  migrateLedger,
  pruneAcks,
  pruneSlices,
  systemTimeZone
} from './balance-ledger.mjs'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isV1(value) {
  return isRecord(value) && value.version === LEDGER_VERSION && isRecord(value.slices)
}

function migrateFailure(cause) {
  const error = new Error('ledger migrate failed')
  error.code = 'ledger-migrate-failed'
  error.cause = cause
  return error
}

/**
 * 键序无关的稳定序列化，用来判断「迁移后要不要重写」。
 * 直接 JSON.stringify 对键序敏感：同一个对象键序不同会误判成「变了」多写一次盘。
 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const inner = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')
    return `{${inner}}`
  }
  const serialized = JSON.stringify(value)
  return serialized === undefined ? String(value) : serialized
}

export function createLedgerStore(options = {}) {
  if (typeof options.read !== 'function' || typeof options.write !== 'function') {
    throw new TypeError('createLedgerStore 需要 read 与 write')
  }

  const read = options.read
  const write = options.write
  const now = typeof options.now === 'function' ? options.now : () => new Date()
  const timeZone = typeof options.timeZone === 'function' ? options.timeZone : null

  let ready = null
  /** 同步读 ack 的内存副本；未加载时保持空对象，hasAck 走 fail-open。 */
  let cachedAcks = {}

  /**
   * 写串行队列：recordBalance / markAck 的读-改-写全流程都排在这里，
   * 两个并发调用不会读到同一份旧账本再互相覆盖。
   */
  let writeQueue = Promise.resolve()

  function enqueueWrite(task) {
    const run = writeQueue.then(task)
    // 失败也吞进链尾：一个任务抛错不能卡死后面的写。
    writeQueue = run.then(
      () => {},
      () => {}
    )
    return run
  }

  async function openAndMigrate() {
    let raw = null
    try {
      raw = await read()
    } catch (error) {
      throw migrateFailure(error)
    }

    const migrated = migrateLedger(raw, {
      now: now(),
      timeZone: timeZone === null ? undefined : timeZone()
    })

    // 未来版本账本：migrateLedger 返回不可迁移标记，原文件原样保留，不写回、不继续用。
    if (isRecord(migrated) && migrated.__unmigratable === true) {
      const unsupported = new Error(
        `账本版本 v${migrated.version} 高于当前支持的 v${LEDGER_VERSION}，保留原文件不覆盖`
      )
      unsupported.code = 'ledger-version-unsupported'
      throw migrateFailure(unsupported)
    }

    // 已经是干净的 v1 时只读一次，不产生写。比较走键序无关的稳定序列化。
    if (!isV1(raw) || stableStringify(raw) !== stableStringify(migrated)) {
      try {
        await write(migrated)
      } catch (error) {
        throw migrateFailure(error)
      }
    }

    return migrated
  }

  async function ensureLedger() {
    if (ready === null) {
      ready = openAndMigrate()
        .then((ledger) => {
          cachedAcks = isRecord(ledger.acks) ? ledger.acks : {}
          return ledger
        })
        .catch((error) => {
          ready = null
          throw error
        })
    }
    return ready
  }

  function recordBalance(input = {}) {
    // 读-改-写整体排队：进队列后才 ensureLedger，读到的一定是上一笔写完的最新账本。
    return enqueueWrite(async () => {
      const balance = Number(input.balance)
      if (!Number.isFinite(balance)) {
        throw new TypeError('recordBalance 需要有限数值 balance')
      }

      const current = await ensureLedger()
      const at = input.now instanceof Date ? input.now : now()
      const zone = timeZone === null ? systemTimeZone() : timeZone()
      const date = dateKeyInTimeZone(at, zone)
      const existing = current.slices[date]
      const threshold =
        input.threshold === null
          ? null
          : Number.isFinite(input.threshold)
            ? input.threshold
            : (existing?.threshold ?? null)

      const acks = isRecord(current.acks) ? current.acks : {}
      const next = {
        version: LEDGER_VERSION,
        slices: {
          ...current.slices,
          [date]: {
            date,
            tz: zone,
            fetchedAt: Number.isFinite(input.fetchedAt) ? input.fetchedAt : at.getTime(),
            balance,
            threshold,
            acknowledgedAt: existing?.acknowledgedAt ?? null,
            lastAlertedAt: existing?.lastAlertedAt ?? null
          }
        },
        ...(Object.keys(acks).length === 0 ? {} : { acks })
      }

      // 写入时裁剪：slice 与 ack 用同一个 now / tz，一次写盘，避免分开裁出现中间态。
      const prunedAcks = pruneAcks(acks, { now: at, timeZone: zone })
      const pruned = {
        version: LEDGER_VERSION,
        slices: pruneSlices(next.slices, { now: at, timeZone: zone }),
        ...(Object.keys(prunedAcks).length === 0 ? {} : { acks: prunedAcks })
      }

      try {
        await write(pruned)
      } catch (error) {
        const failure = new Error('ledger write failed')
        failure.code = 'ledger-write-failed'
        failure.cause = error
        throw failure
      }

      ready = Promise.resolve(pruned)
      cachedAcks = prunedAcks
      return pruned
    })
  }

  /**
   * 同步查 ack，只问「这一段响过没」。
   *
   * fail-open：账本还没加载、读取失败或段格式不对时都返回 false，让调用方照常响。
   * 宁可多响一次，也不要因为一次读失败把提醒永久闷掉。
   */
  function hasAck(segment) {
    if (typeof segment !== 'string' || segment === '') return false
    return Object.prototype.hasOwnProperty.call(cachedAcks, segment)
  }

  /**
   * 取某段的 ack 记录（含 acknowledgedAt 响铃时刻与 balance 余额快照），没有则 null。
   * shouldAlert 靠它判断「余额是否进一步下降」，只问布尔会丢掉这两个字段。
   */
  function getAck(segment) {
    if (typeof segment !== 'string' || segment === '') return null
    const ack = cachedAcks[segment]
    return isRecord(ack) ? ack : null
  }

  /**
   * 落一条 ack。`at` 用 ISO 字符串，和 slice 的 `dateKeyInTimeZone` 同一套时区口径。
   * 写盘与 slice 裁剪同批次：一次写，成功后才更新内存副本；失败不留下半截 ack。
   */
  function markAck(segment, level = 'shown', input = {}) {
    if (typeof segment !== 'string' || segment.trim() === '') {
      return Promise.reject(new TypeError('markAck 需要非空 segment'))
    }
    if (level !== 'shown' && level !== 'confirmed') {
      return Promise.reject(new TypeError('markAck 的 level 只能是 shown 或 confirmed'))
    }

    // 读-改-写同样排队，避免和 recordBalance 并发时互相覆盖。
    return enqueueWrite(async () => {
      const current = await ensureLedger()
      const at = input.now instanceof Date ? input.now : now()
      const zone = timeZone === null ? systemTimeZone() : timeZone()
      const acks = {
        ...(isRecord(current.acks) ? current.acks : {}),
        [segment]: {
          at: at.toISOString(),
          level,
          // acknowledgedAt 专指「响铃时刻」；balance 是响铃时的余额快照，
          // 供 shouldAlert 判断余额有没有进一步下降。
          acknowledgedAt: at.toISOString(),
          ...(Number.isFinite(input.balance) ? { balance: input.balance } : {})
        }
      }
      const prunedAcks = pruneAcks(acks, { now: at, timeZone: zone })
      const next = {
        version: LEDGER_VERSION,
        slices: pruneSlices(current.slices, { now: at, timeZone: zone }),
        ...(Object.keys(prunedAcks).length === 0 ? {} : { acks: prunedAcks })
      }

      try {
        await write(next)
      } catch (error) {
        const failure = new Error('ledger write failed')
        failure.code = 'ledger-write-failed'
        failure.cause = error
        throw failure
      }

      ready = Promise.resolve(next)
      cachedAcks = prunedAcks
      return next
    })
  }

  return { ensureLedger, recordBalance, hasAck, getAck, markAck }
}
