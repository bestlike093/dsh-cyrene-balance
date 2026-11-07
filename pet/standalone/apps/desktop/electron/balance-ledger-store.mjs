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

    // 已经是干净的 v1 时只读一次，不产生写。
    if (!isV1(raw) || JSON.stringify(raw) !== JSON.stringify(migrated)) {
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

  async function recordBalance(input = {}) {
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
   * 落一条 ack。`at` 用 ISO 字符串，和 slice 的 `dateKeyInTimeZone` 同一套时区口径。
   * 写盘与 slice 裁剪同批次：一次写，成功后才更新内存副本；失败不留下半截 ack。
   */
  async function markAck(segment, level = 'shown', input = {}) {
    if (typeof segment !== 'string' || segment.trim() === '') {
      throw new TypeError('markAck 需要非空 segment')
    }
    if (level !== 'shown' && level !== 'confirmed') {
      throw new TypeError('markAck 的 level 只能是 shown 或 confirmed')
    }

    const current = await ensureLedger()
    const at = input.now instanceof Date ? input.now : now()
    const zone = timeZone === null ? systemTimeZone() : timeZone()
    const acks = {
      ...(isRecord(current.acks) ? current.acks : {}),
      [segment]: { at: at.toISOString(), level }
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
  }

  return { ensureLedger, recordBalance, hasAck, markAck }
}
