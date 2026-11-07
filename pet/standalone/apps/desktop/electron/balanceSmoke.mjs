/**
 * 余额账本的真机自检：不读 Key、不发网络请求，只验文件层与定时器。
 *
 * 用临时文件起一个同构 store，跑一轮真实的 setInterval tick，
 * 然后换一个新 store 从磁盘重建，确认切片没有在初始化时被清空。
 * 结果从 stdout 输出，由宿主决定退出码。
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLedgerStore } from './balance-ledger-store.mjs'
import { createBalanceMonitor } from './balance-monitor.mjs'
import { dateKeyInTimeZone, systemTimeZone } from './balance-ledger.mjs'

async function readFileOrNull(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function writeFileAtomic(file, value) {
  const temp = `${file}.tmp`
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(temp, file)
}

function createTempStore(file) {
  return createLedgerStore({
    read: () => readFileOrNull(file),
    write: (value) => writeFileAtomic(file, value)
  })
}

export async function runBalanceSmoke() {
  const file = path.join(os.tmpdir(), `pet-balance-smoke-${process.pid}.json`)
  await fs.rm(file, { force: true })

  const now = new Date()
  const zone = systemTimeZone()
  const today = dateKeyInTimeZone(now, zone)
  const store = createTempStore(file)

  // 先放一份 v0 旧账本，迁移后再跑轮询；前后结构都留在结果里便于比对。
  const v0 = { date: today, opening: 100, latest: 41 }
  await writeFileAtomic(file, v0)
  const v0After = await store.ensureLedger()
  const v0Slice = v0After.slices?.[today] ?? null

  let fetchCount = 0
  const monitor = createBalanceMonitor({
    store,
    fetchBalance: async () => {
      fetchCount += 1
      return { balance: 42, threshold: 20, fetchedAt: Date.now() }
    },
    // 40ms 一轮，只为在 150ms 内看到首个 tick；unref:false 保活到自检结束。
    intervalMs: 40,
    unref: false
  })

  monitor.start()
  // 冷启动首 tick 与一次手动触发并发：两个方向，不压第三个并发。
  const manualPromise = store.recordBalance({ balance: 43, threshold: 20, fetchedAt: Date.now() })
  await new Promise((resolve) => setTimeout(resolve, 180))
  monitor.stop()
  const manualLedger = await manualPromise
  const manualSlices = Object.keys(manualLedger.slices ?? {})

  const first = await readFileOrNull(file)
  const firstSlice = first?.slices?.[today] ?? null

  // 新 store 模拟杀进程重启：ready 是空的，只能从磁盘重建。
  const reopened = await createTempStore(file).ensureLedger()
  const reopenedSlice = reopened.slices?.[today] ?? null
  const slices = Object.keys(reopened.slices ?? {})

  await fs.rm(file, { force: true })

  return {
    ok:
      v0After.version === 1 &&
      v0Slice !== null &&
      v0Slice.balance === 41 &&
      v0Slice.tz === zone &&
      fetchCount >= 1 &&
      firstSlice !== null &&
      firstSlice.date === today &&
      firstSlice.tz === zone &&
      manualSlices.length === 1 &&
      reopenedSlice !== null &&
      reopenedSlice.date === today &&
      reopenedSlice.tz === zone &&
      slices.length <= 7,
    today,
    zone,
    fetchCount,
    manualSlices,
    v0Before: v0,
    v0Slice,
    slices,
    firstSlice,
    reopenedSlice
  }
}
