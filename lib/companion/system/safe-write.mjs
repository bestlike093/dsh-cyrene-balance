/**
 * 写盘安全闸（P1 稳定性地基，借鉴 §3.5 / §4.6 / §1.8）。
 *
 * 把「原子写、写前备份、节流、失败补写、坏账本拒写」收成一个共享守卫，
 * 各存储（memory/deliver/assets）后续统一接线，避免各写一套。
 *
 * 保证：
 * - 原子：先写临时文件再 rename，崩溃不留半截文件；
 * - 写前备份：覆盖前把旧内容存进 .backup/，保留最近 N 份（报错前先备份）；
 * - 节流：throttleMs 内同一文件的多次写合并为最后一次；
 * - 失败补写：写失败进失败队列，flush() 重试，不丢数据；
 * - 坏账本拒写：opts.validate 校验旧内容，坏了先隔离再拒写（除非 force）。
 *
 * 零 Electron 依赖；fs / 时钟 / 定时器全部注入，方便单测。
 */

const CORRUPT = 'E_CORRUPT_LEDGER'

/** 内容可以是文本，也可以是二进制（表情包、模型截图）。 */
function isBinary(data) {
  return typeof data === 'object' && data !== null && typeof data.length === 'number' && !Array.isArray(data)
}

function payloadOf(data) {
  return isBinary(data) ? data : String(data)
}

export function createSafeWriter({
  fs,
  now = Date.now,
  setTimeout: schedule = globalThis.setTimeout,
  clearTimeout: cancel = globalThis.clearTimeout,
  throttleMs = 0,
  retries = 2,
  backupKeep = 3,
  log = () => {},
} = {}) {
  if (fs === null || typeof fs !== 'object') throw new Error('safe-write 需要注入 fs')

  const pending = new Map()   // file -> { text, opts, timer }
  const failed = new Map()    // file -> { text, opts }
  /* 最近一次写入的回执：写了哪个文件、备了什么。供诊断取用，不改 writeText 的返回类型。 */
  let lastReceipt = null

  function backupPath(file) {
    const idx = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
    const dir = idx >= 0 ? file.slice(0, idx) : '.'
    const base = idx >= 0 ? file.slice(idx + 1) : file
    return { dir: `${dir}/.backup`, base }
  }

  async function keepBackup(file, text) {
    const { dir, base } = backupPath(file)
    await fs.mkdir(dir, { recursive: true })
    const stamp = now()
    const target = `${dir}/${base}.${stamp}.bak`
    if (isBinary(text)) await fs.writeFile(target, text)
    else await fs.writeFile(target, text, 'utf8')
    /* 只留最近 backupKeep 份，旧的删掉，避免备份无限涨。 */
    const names = (await fs.readdir(dir))
      .filter((n) => n.startsWith(`${base}.`) && n.endsWith('.bak'))
      .sort()
    while (names.length > backupKeep) {
      const old = names.shift()
      try { await fs.unlink(`${dir}/${old}`) } catch { /* 删不掉不影响主流程 */ }
    }
    return target
  }

  async function atomicWrite(file, text) {
    const tmp = `${file}.tmp-${now()}-${Math.random().toString(36).slice(2, 8)}`
    if (isBinary(text)) await fs.writeFile(tmp, text)
    else await fs.writeFile(tmp, text, 'utf8')
    await fs.rename(tmp, file)
  }

  async function doWrite(file, text, opts = {}) {
    /* 二进制没有账本语义，只备份不校验；文本两类都做。 */
    const binary = isBinary(text)
    let existing = null
    try {
      existing = binary ? await fs.readFile(file) : await fs.readFile(file, 'utf8')
    } catch { existing = null }
    /* 默认没备份：新文件没有旧内容可备，这一格就是 0 份。 */
    let backup = { kind: 'none', path: null, count: 0, undoable: false }
    if (existing !== null && !binary && typeof opts.validate === 'function') {
      let ok = true
      try { opts.validate(existing) } catch { ok = false }
      if (!ok && !opts.force) {
        try { await fs.rename(file, `${file}.corrupt-${now()}`) } catch { /* 隔离失败仍拒写 */ }
        const err = new Error(`坏账本拒写：${file}`)
        err.code = CORRUPT
        throw err
      }
    }
    if (existing !== null) {
      const backupFile = await keepBackup(file, existing)
      backup = { kind: 'previous', path: backupFile, count: 1, undoable: true }
    }
    await atomicWrite(file, text)
    return { backup }
  }

  async function attempt(file, text, opts) {
    let lastErr = null
    for (let i = 0; i <= retries; i++) {
      try {
        const result = await doWrite(file, text, opts)
        failed.delete(file)
        lastReceipt = { ok: true, path: file, backup: result.backup }
        return true
      }
      catch (err) {
        lastErr = err
        if (err.code === CORRUPT) throw err  /* 拒写不重试 */
      }
    }
    failed.set(file, { text, opts })
    lastReceipt = { ok: false, path: file, backup: { kind: 'none', path: null, count: 0, undoable: false } }
    log('safe-write 失败进补写队列', file, lastErr?.message)
    return false
  }

  function writeText(file, text, opts = {}) {
    const payload = payloadOf(text)
    if (throttleMs <= 0) return attempt(file, payload, opts)
    const prev = pending.get(file)
    if (prev?.timer) cancel(prev.timer)
    const entry = { text: payload, opts, timer: null }
    entry.timer = schedule(() => {
      pending.delete(file)
      attempt(file, entry.text, entry.opts).catch(() => {})
    }, throttleMs)
    pending.set(file, entry)
    return Promise.resolve(true)
  }

  return {
    writeText,
    /* 二进制走同一套原子与备份，只是不吃 utf8 编码。 */
    writeBytes(file, buffer, opts = {}) {
      return writeText(file, payloadOf(buffer), opts)
    },
    writeJson(file, value, opts = {}) {
      return writeText(file, JSON.stringify(value), opts)
    },
    /* 失败补写：把队列里没写成功的再试一遍。 */
    async flush() {
      const jobs = [...failed.entries()]
      failed.clear()
      for (const [file, { text, opts }] of jobs) await attempt(file, text, opts)
      /* 节流中的也落盘。 */
      const pend = [...pending.entries()]
      for (const [file, e] of pend) { if (e.timer) cancel(e.timer); pending.delete(file); await attempt(file, e.text, e.opts) }
    },
    get pendingCount() { return pending.size },
    get failedCount() { return failed.size },
    /* 最近一次写入的回执：{ ok, path, backup: { kind, path, count, undoable } }。 */
    get lastReceipt() { return lastReceipt },
  }
}

/**
 * 同步版：给「存档必须当场落盘」的调用方用（bond 初始化、决策账本）。
 * 同样是原子写＋写前备份＋坏账本拒写，只是没有节流与补写队列——
 * 同步调用本来就立即执行，排队反而会丢。
 */
export function createSafeWriterSync({ fs, now = Date.now, backupKeep = 3 } = {}) {
  if (fs === null || typeof fs !== 'object') throw new Error('safe-write 同步版需要注入 fs')

  function split(file) {
    const idx = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
    return idx >= 0
      ? { dir: file.slice(0, idx), base: file.slice(idx + 1) }
      : { dir: '.', base: file }
  }

  function keepBackup(file, existing) {
    const { dir, base } = split(file)
    const backupDir = `${dir}/.backup`
    try {
      fs.mkdirSync(backupDir, { recursive: true })
      const target = `${backupDir}/${base}.${now()}.bak`
      if (isBinary(existing)) fs.writeFileSync(target, existing)
      else fs.writeFileSync(target, existing, 'utf8')
      const names = fs.readdirSync(backupDir)
        .filter((n) => n.startsWith(`${base}.`) && n.endsWith('.bak'))
        .sort()
      while (names.length > backupKeep) {
        const old = names.shift()
        try { fs.unlinkSync(`${backupDir}/${old}`) } catch { /* 删不掉不影响主流程 */ }
      }
    } catch { /* 备份失败不该挡住主写入，但下面写入仍走原子 */ }
  }

  function write(file, data, opts = {}) {
    const payload = payloadOf(data)
    const binary = isBinary(payload)
    let existing = null
    try {
      existing = binary ? fs.readFileSync(file) : fs.readFileSync(file, 'utf8')
    } catch { existing = null }
    if (existing !== null && !binary && typeof opts.validate === 'function') {
      let ok = true
      try { opts.validate(existing) } catch { ok = false }
      if (!ok && !opts.force) {
        try { fs.renameSync(file, `${file}.corrupt-${now()}`) } catch { /* 隔离失败仍拒写 */ }
        const err = new Error(`坏账本拒写：${file}`)
        err.code = CORRUPT
        throw err
      }
    }
    if (existing !== null) keepBackup(file, existing)
    const { dir } = split(file)
    try { fs.mkdirSync(dir, { recursive: true }) } catch { /* 已存在 */ }
    const tmp = `${file}.tmp-${now()}-${Math.random().toString(36).slice(2, 8)}`
    if (isBinary(payload)) fs.writeFileSync(tmp, payload)
    else fs.writeFileSync(tmp, payload, 'utf8')
    fs.renameSync(tmp, file)
    return true
  }

  return {
    write,
    writeText: (file, text, opts) => write(file, text, opts),
    writeBytes: (file, buffer, opts) => write(file, buffer, opts),
    writeJson: (file, value, opts) => write(file, JSON.stringify(value), opts),
  }
}

export const SAFE_WRITE_CORRUPT = CORRUPT