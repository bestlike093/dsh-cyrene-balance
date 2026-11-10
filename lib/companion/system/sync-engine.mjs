/**
 * 增量同步引擎（从 old vault 的 syncEngine + HLC 移植）。
 *
 * 约束：
 *   - 只做内存里的记录合并，不碰磁盘、不碰网络；
 *   - 时间戳用定长 HLC 字符串，字典序即时间序；
 *   - 冲突按 LWW 解决，同时间戳不同值保留本地并上报冲突。
 */

const WALL_DIGITS = 13
const COUNTER_DIGITS = 4
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1

function pad(value, digits) {
  return String(Math.max(0, Math.trunc(value))).padStart(digits, '0')
}

function normalizeNode(node) {
  return String(node ?? '').trim().slice(0, 16) || 'local'
}

export function formatHlc(stamp) {
  return pad(stamp.wall, WALL_DIGITS) + pad(stamp.counter, COUNTER_DIGITS) + '-' + normalizeNode(stamp.node)
}

export function parseHlc(value) {
  const text = String(value ?? '')
  const dash = text.indexOf('-')
  const body = dash < 0 ? text : text.slice(0, dash)
  const node = dash < 0 ? 'local' : text.slice(dash + 1)
  const wall = Number(body.slice(0, WALL_DIGITS))
  const counter = Number(body.slice(WALL_DIGITS))
  return {
    wall: Number.isFinite(wall) ? wall : 0,
    counter: Number.isFinite(counter) ? counter : 0,
    node
  }
}

/** 比较两个 HLC：<0 表示 a 更早，>0 表示 a 更晚。 */
export function compareHlc(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

export class HybridClock {
  constructor(node = 'local') {
    this.wall = 0
    this.counter = 0
    this.node = normalizeNode(node)
  }

  /** 产生一个本地事件时间戳。 */
  now() {
    const physical = Date.now()
    if (physical > this.wall) {
      this.wall = physical
      this.counter = 0
    } else {
      this.counter = this.counter >= MAX_COUNTER ? 0 : this.counter + 1
      if (this.counter === 0) this.wall += 1
    }
    return formatHlc({ wall: this.wall, counter: this.counter, node: this.node })
  }

  /** 收到远端时间戳后推进本地时钟，保证因果不倒退。 */
  receive(remote) {
    const r = parseHlc(remote)
    const physical = Date.now()
    const maxWall = Math.max(physical, this.wall, r.wall)
    if (maxWall === this.wall && maxWall === r.wall) {
      this.counter = Math.max(this.counter, r.counter) + 1
    } else if (maxWall === this.wall) {
      this.counter += 1
    } else if (maxWall === r.wall) {
      this.counter = r.counter + 1
    } else {
      this.counter = 0
    }
    this.wall = maxWall
    if (this.counter > MAX_COUNTER) {
      this.wall += 1
      this.counter = 0
    }
    return formatHlc({ wall: this.wall, counter: this.counter, node: this.node })
  }
}

export class SyncError extends Error {
  constructor(reason, message, details = null) {
    super(message)
    this.name = 'SyncError'
    this.reason = reason
    this.details = details
  }
}

function validateRecord(record) {
  if (record === null || typeof record !== 'object') {
    throw new SyncError('invalid-record', '同步记录必须是对象')
  }
  if (typeof record.key !== 'string' || record.key.length === 0 || record.key.length > 128) {
    throw new SyncError('invalid-key', '同步记录的 key 不合法')
  }
  if (typeof record.hlc !== 'string' || record.hlc.length === 0) {
    throw new SyncError('invalid-hlc', '同步记录的 hlc 不合法')
  }
}

function stableSort(records) {
  return [...records].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 旧记录没有字段时间戳时，整条记录的 hlc 就是每个字段的兜底时间戳。 */
function fieldStamps(record) {
  if (isPlainObject(record.fields)) return { ...record.fields }
  const value = isPlainObject(record.value) ? record.value : {}
  return Object.fromEntries(Object.keys(value).map((field) => [field, record.hlc]))
}

/**
 * 逐字段合并两个对象记录。
 * 返回的 hlc 取两者较大值，字段时间戳各自保留，下一次合并仍然按字段比较。
 */
function mergeObjectRecords(local, remote) {
  const localValue = isPlainObject(local.value) ? local.value : {}
  const remoteValue = isPlainObject(remote.value) ? remote.value : {}
  const localStamps = fieldStamps(local)
  const remoteStamps = fieldStamps(remote)
  const value = {}
  const fields = {}
  const fieldConflicts = []
  let winner = 'local'

  const names = new Set([...Object.keys(localValue), ...Object.keys(remoteValue)])
  for (const field of names) {
    const hasLocal = Object.prototype.hasOwnProperty.call(localValue, field)
    const hasRemote = Object.prototype.hasOwnProperty.call(remoteValue, field)
    if (hasLocal && hasRemote) {
      const order = compareHlc(remoteStamps[field] ?? '', localStamps[field] ?? '')
      const takeRemote = order > 0
      value[field] = takeRemote ? remoteValue[field] : localValue[field]
      fields[field] = takeRemote ? remoteStamps[field] ?? remote.hlc : localStamps[field] ?? local.hlc
      if (order === 0 && JSON.stringify(localValue[field]) !== JSON.stringify(remoteValue[field])) {
        fieldConflicts.push(field)
      }
      if (takeRemote) winner = 'remote'
      continue
    }
    if (hasRemote) {
      value[field] = remoteValue[field]
      fields[field] = remoteStamps[field] ?? remote.hlc
      winner = 'remote'
      continue
    }
    value[field] = localValue[field]
    fields[field] = localStamps[field] ?? local.hlc
  }

  return {
    record: {
      key: remote.key,
      value,
      fields,
      hlc: compareHlc(remote.hlc, local.hlc) > 0 ? remote.hlc : local.hlc
    },
    winner,
    fieldConflicts
  }
}

/**
 * 增量同步引擎。
 *
 * 合并策略：HLC 大者胜（LWW）；同 HLC 同值视为重放直接跳过；
 * 同 HLC 不同值保留本地并记录冲突，交给上层提示用户。
 */
export class SyncEngine {
  constructor(options = {}) {
    const node = typeof options.node === 'string' ? options.node.trim() : ''
    if (node === '') throw new SyncError('missing-node', '同步节点名不能为空')
    this.node = node
    this.clock = options.clock ?? new HybridClock(node)
    this.now = typeof options.now === 'function' ? options.now : Date.now
    this.maxSkewMs = Number.isFinite(options.maxSkewMs) ? options.maxSkewMs : 5 * 60 * 1000
    this.records = new Map()
  }

  get nodeName() {
    return this.node
  }

  put(key, value) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new SyncError('invalid-key', '同步 key 不能为空')
    }
    const hlc = this.clock.now()
    const record = { key, value, hlc }
    /* 对象值记下每个字段的时间戳，合并时可以逐字段取较新的那一侧。 */
    if (isPlainObject(value)) {
      record.fields = Object.fromEntries(Object.keys(value).map((field) => [field, hlc]))
    }
    this.records.set(key, record)
    return record
  }

  /**
   * 只改部分字段：提到的字段刷新时间戳，没提到的保留原来的字段时间戳。
   * 这是字段级合并的写入口；整条覆盖仍然用 put。
   */
  patch(key, partial) {
    if (!isPlainObject(partial)) {
      throw new SyncError('invalid-value', 'patch 必须是非数组对象')
    }
    const prev = this.records.get(key)
    const hlc = this.clock.now()
    const value = isPlainObject(prev?.value) ? { ...prev.value } : {}
    const fields = prev === undefined ? {} : fieldStamps(prev)
    for (const [field, fieldValue] of Object.entries(partial)) {
      value[field] = fieldValue
      fields[field] = hlc
    }
    const record = { key, value, hlc, fields }
    this.records.set(key, record)
    return record
  }

  get(key) {
    return this.records.get(key)
  }

  snapshot() {
    return stableSort([...this.records.values()])
  }

  /** 增量导出：只返回比 since 更新的记录，按 key 稳定排序。 */
  since(hlc) {
    const records = [...this.records.values()].filter(
      (record) => hlc === undefined || compareHlc(record.hlc, hlc) > 0
    )
    return { node: this.node, records: stableSort(records) }
  }

  merge(remote) {
    if (remote === null || typeof remote !== 'object') {
      throw new SyncError('invalid-changeset', '远端变更集必须是对象')
    }
    if (typeof remote.node !== 'string' || remote.node.length === 0) {
      throw new SyncError('missing-node', '远端节点名不能为空')
    }
    if (!Array.isArray(remote.records)) {
      throw new SyncError('invalid-changeset', '远端变更集必须是数组')
    }

    /* 先整批校验，避免一半写入一半失败。 */
    const now = this.now()
    for (const record of remote.records) {
      validateRecord(record)
      const wall = parseHlc(record.hlc).wall
      if (wall <= 0 || Math.abs(now - wall) > this.maxSkewMs) {
        throw new SyncError('timestamp-expired', `同步时间戳超出允许偏差：${record.key}`, {
          key: record.key,
          hlc: record.hlc,
          now,
          maxSkewMs: this.maxSkewMs
        })
      }
    }

    const conflicts = []
    for (const record of remote.records) {
      /* 合并过的远端时间戳不能再被本地后续写入追上并反超。 */
      this.clock.receive(record.hlc)
      const local = this.records.get(record.key)
      if (local === undefined) {
        this.records.set(record.key, record)
        continue
      }

      /* 两边都是对象且至少一边带字段时间戳时，逐字段取较新的那一侧。 */
      const bothPlain = isPlainObject(local.value) && isPlainObject(record.value)
      const hasFieldStamps = isPlainObject(local.fields) || isPlainObject(record.fields)
      if (bothPlain && hasFieldStamps) {
        const merged = mergeObjectRecords(local, record)
        this.records.set(record.key, merged.record)
        if (merged.winner === 'remote' || merged.fieldConflicts.length > 0) {
          conflicts.push({
            key: record.key,
            localHlc: local.hlc,
            remoteHlc: record.hlc,
            winner: merged.winner,
            ...(merged.fieldConflicts.length > 0 ? { fields: merged.fieldConflicts } : {})
          })
        }
        continue
      }

      if (record.hlc === local.hlc) {
        if (JSON.stringify(record.value) !== JSON.stringify(local.value)) {
          conflicts.push({ key: record.key, localHlc: local.hlc, remoteHlc: record.hlc, winner: 'local' })
        }
        continue
      }

      if (compareHlc(record.hlc, local.hlc) > 0) {
        this.records.set(record.key, record)
        conflicts.push({ key: record.key, localHlc: local.hlc, remoteHlc: record.hlc, winner: 'remote' })
      } else {
        conflicts.push({ key: record.key, localHlc: local.hlc, remoteHlc: record.hlc, winner: 'local' })
      }
    }

    conflicts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    return { records: this.snapshot(), conflicts }
  }
}
